# Emotion Labeling Task (HAI FA26 — Assignment 1, A1-2)

A web interface where anonymous participants label the emotion expressed in 5
tweets from the [dair-ai/emotion](https://huggingface.co/datasets/dair-ai/emotion)
dataset (sadness, joy, love, anger, fear, surprise).

- **Live task:** `https://<your-github-username>.github.io/<repo-name>/`
- **Frontend:** static HTML/CSS/JS in `site/`, hosted on GitHub Pages
- **Backend:** Supabase (Postgres) — schema and seed data in `supabase/`

## How it works

1. **Welcome & consent** → **instructions** (definitions of the six emotions) → **5 posts** → **thank-you page**.
2. When a participant starts, the database function `start_session()` creates an
   anonymous participant (random UUID) and assigns 5 tweets. It picks the tweets
   that have been assigned the **fewest times so far, with random tie-breaking**,
   so each participant gets a different random set and all 60 tweets receive
   labels evenly.
3. Each answer is saved immediately through `submit_label()`, which only accepts
   tweets assigned to that participant and ignores duplicate submits.
4. Refreshing the page resumes where the participant left off (progress is kept
   in `sessionStorage`); opening a new tab starts a new participant.

### What is recorded

| Table | Contents |
|---|---|
| `participants` | anonymous `id` (UUID), `started_at`, `completed_at` |
| `assignments` | which 5 tweets each participant was shown, and in which order |
| `labels` | `participant_id`, `tweet_id`, `position` (1–5), `chosen_label`, `response_time_ms`, `created_at` |
| `tweets` | the 60 task tweets with their dataset `ground_truth` |

The view **`labels_with_truth`** joins them into one table: who labeled which
tweet, with which label, next to the dataset's label. No names, emails, IP
addresses or browser details are collected.

### Privacy / security

The browser only has the public Supabase anon key. Row Level Security is on for
every table with no policies, so that key cannot read or write any table
directly; it can only call `start_session()`, `submit_label()` and `ping()`.
Ground-truth labels are never sent to the browser.

## Task dataset

`data/prepare_dataset.py` builds the 60-tweet task set (10 per emotion) from
the dataset's **test split**:

- excludes texts shorter than 6 or longer than 35 words;
- excludes texts matching a blocklist (self-harm, sexual content, slurs, drugs, URLs);
- excludes 6 rows reviewed by hand (truncated/garbled text, page markup, drugs, politics);
- orders each emotion's remaining tweets deterministically (seeded hash) and takes the first 10.

Output: `data/tweets.json` and `supabase/seed.sql`. To regenerate:

```bash
python3 -m venv .venv && .venv/bin/pip install -r data/requirements.txt
.venv/bin/python data/prepare_dataset.py
```

Dataset labels were kept as-is even when they look debatable — that label noise is part of what the task surfaces.

## Setup (from scratch)

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste and run `supabase/schema.sql`, then `supabase/seed.sql`.
3. Under **Project Settings → API**, copy the **Project URL** and the **anon / publishable key**.

### 2. Frontend config

Put those two values in `site/config.js`.

### 3. GitHub Pages

1. Push this folder to a GitHub repository (branch `main`).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The `Deploy site to GitHub Pages` workflow publishes `site/` on every push.

### 4. Keep Supabase awake

Free Supabase projects pause after a period of inactivity. The
`Keep Supabase alive` workflow calls `ping()` every 3 days. Add two repository
secrets under **Settings → Secrets and variables → Actions**:
`SUPABASE_URL` and `SUPABASE_ANON_KEY`. Run it once manually from the
**Actions** tab to check it succeeds.

If the project does get paused, restore it from the Supabase dashboard (data is kept).

## Running locally

No build step. Serve `site/` with any static server, e.g.:

```bash
python3 -m http.server 8000 --directory site
```

and open <http://localhost:8000> (uses the Supabase project in `config.js`).

## Viewing the collected data

In Supabase: **Table Editor → `labels_with_truth`** (or run
`select * from labels_with_truth;` in the SQL Editor). Export to CSV from the same view.

## Files

```
site/                 index.html, style.css, app.js, config.js   (the task interface)
supabase/schema.sql   tables, RLS, analysis view, database functions
supabase/seed.sql     the 60 task tweets (generated)
data/                 prepare_dataset.py, tweets.json, requirements.txt
.github/workflows/    deploy-pages.yml, keep-alive.yml
```
