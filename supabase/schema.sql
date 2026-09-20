-- Emotion labeling task: database schema for Supabase (Postgres).
-- Run this whole file once in the Supabase SQL Editor, then run seed.sql.
--
-- Access model: the browser uses the public anon key, which can read or write
-- NO table directly (RLS is on with no policies). It can only call:
--   start_session()  -> creates an anonymous participant and assigns 5 tweets
--   submit_label()   -> records one label for an assigned tweet
--   ping()           -> harmless read used by the keep-alive workflow
-- Ground-truth labels never leave the database.

-- ---------------------------------------------------------------- tables

create table tweets (
  id           int primary key,
  source_row   int  not null,          -- row index in dair-ai/emotion test split
  text         text not null,
  ground_truth text not null check (ground_truth in ('sadness','joy','love','anger','fear','surprise'))
);

-- One row per visit. The random UUID is the only identifier: no name, email, IP or browser info.
create table participants (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- Which tweets each participant was shown, and in what order.
create table assignments (
  participant_id uuid     not null references participants(id) on delete cascade,
  tweet_id       int      not null references tweets(id),
  position       smallint not null check (position between 1 and 5),
  assigned_at    timestamptz not null default now(),
  primary key (participant_id, tweet_id),
  unique (participant_id, position)
);

-- The collected data: who labeled which tweet with which label.
create table labels (
  id               bigint generated always as identity primary key,
  participant_id   uuid     not null,
  tweet_id         int      not null,
  position         smallint not null,
  chosen_label     text     not null check (chosen_label in ('sadness','joy','love','anger','fear','surprise')),
  response_time_ms int      check (response_time_ms >= 0),
  created_at       timestamptz not null default now(),
  unique (participant_id, tweet_id),
  foreign key (participant_id, tweet_id) references assignments(participant_id, tweet_id) on delete cascade
);

alter table tweets       enable row level security;
alter table participants enable row level security;
alter table assignments  enable row level security;
alter table labels       enable row level security;

-- ---------------------------------------------------------------- analysis view
-- For the dashboard / screenshot. security_invoker + revoked grants keep it private.

create view labels_with_truth with (security_invoker = true) as
select
  l.participant_id,
  l.position,
  l.tweet_id,
  t.text,
  l.chosen_label,
  t.ground_truth,
  l.chosen_label = t.ground_truth as matches_ground_truth,
  l.response_time_ms,
  l.created_at
from labels l
join tweets t on t.id = l.tweet_id
order by l.created_at;

revoke all on labels_with_truth from anon, authenticated;

-- ---------------------------------------------------------------- functions

-- Creates an anonymous participant and assigns 5 distinct tweets, preferring the
-- tweets that have been assigned least so far (random tie-break). Everyone gets a
-- different random set, and labels spread evenly across all 60 tweets.
create function start_session()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  -- Serialize assignment so two simultaneous visitors see up-to-date counts.
  perform pg_advisory_xact_lock(hashtext('start_session'));

  insert into participants default values returning id into pid;

  insert into assignments (participant_id, tweet_id, position)
  select pid, t.id, row_number() over (order by random())
  from (
    select tw.id
    from tweets tw
    left join assignments a on a.tweet_id = tw.id
    group by tw.id
    order by count(a.tweet_id), random()
    limit 5
  ) t;

  return json_build_object(
    'participant_id', pid,
    'tweets', (
      select json_agg(json_build_object('id', tw.id, 'text', tw.text, 'position', a.position)
                      order by a.position)
      from assignments a
      join tweets tw on tw.id = a.tweet_id
      where a.participant_id = pid
    )
  );
end;
$$;

-- Records one label. Only tweets assigned to this participant are accepted; a
-- repeated submit (e.g. network retry) is ignored rather than duplicated.
create function submit_label(
  p_participant_id   uuid,
  p_tweet_id         int,
  p_label            text,
  p_response_time_ms int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pos smallint;
begin
  select position into pos
  from assignments
  where participant_id = p_participant_id and tweet_id = p_tweet_id;

  if pos is null then
    raise exception 'Tweet % is not assigned to this participant', p_tweet_id;
  end if;

  insert into labels (participant_id, tweet_id, position, chosen_label, response_time_ms)
  values (p_participant_id, p_tweet_id, pos, p_label, greatest(p_response_time_ms, 0))
  on conflict (participant_id, tweet_id) do nothing;

  update participants
  set completed_at = now()
  where id = p_participant_id
    and completed_at is null
    and (select count(*) from labels where participant_id = p_participant_id) = 5;
end;
$$;

create function ping()
returns int
language sql
security definer
set search_path = public
as $$ select count(*)::int from tweets $$;

revoke all on function start_session()                    from public, anon, authenticated;
revoke all on function submit_label(uuid, int, text, int) from public, anon, authenticated;
revoke all on function ping()                             from public, anon, authenticated;
grant execute on function start_session()                    to anon;
grant execute on function submit_label(uuid, int, text, int) to anon;
grant execute on function ping()                             to anon;
