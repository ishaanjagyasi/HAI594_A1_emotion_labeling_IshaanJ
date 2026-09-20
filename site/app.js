// Emotion labeling task: frontend logic.
// Flow: welcome/consent -> instructions -> 5 posts -> done.
// Progress lives in sessionStorage so a page refresh resumes instead of
// creating a new participant.

const EMOTIONS = [
  { id: "joy",      name: "Joy",      color: "#ffc629", def: "Happy, pleased, proud, relaxed or grateful." },
  { id: "love",     name: "Love",     color: "#ff7eb9", def: "Affection, warmth, care or fondness toward someone or something." },
  { id: "surprise", name: "Surprise", color: "#b69aff", def: "Amazed, shocked, stunned or caught off guard." },
  { id: "sadness",  name: "Sadness",  color: "#5eb1ff", def: "Down, hurt, lonely, disappointed or hopeless." },
  { id: "fear",     name: "Fear",     color: "#4fd6a0", def: "Scared, nervous, anxious, worried or unsure." },
  { id: "anger",    name: "Anger",    color: "#ff5c4d", def: "Annoyed, irritated, resentful, insulted or hostile." },
];
const BIRD_COLOR = "#ffc629";

const STORAGE_KEY = "emotion-labeling-state";
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;

const $ = (id) => document.getElementById(id);

let state = loadState() || { screen: "welcome" };
let selected = null;      // emotion id chosen for the current post
let shownAt = 0;          // when the current post appeared (ms)
let submitting = false;

// ------------------------------------------------------------------ storage

function loadState() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (e.g. private mode): the task still works, it just won't survive a refresh.
  }
}

// ------------------------------------------------------------------ backend

async function rpc(fn, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} failed (${res.status}): ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ------------------------------------------------------------------ rendering

// Inline SVG of a sprite character: a flat colored copy offset behind the ink
// drawing gives the "misprinted" look.
function critter(id, className = "") {
  const color = EMOTIONS.find((e) => e.id === id)?.color ?? BIRD_COLOR;
  return `<svg class="critter ${className}" style="--emo:${color}" viewBox="0 0 120 120" aria-hidden="true">` +
    `<use href="#c-${id}" class="critter-shadow" x="5" y="5" width="120" height="120"/>` +
    `<use href="#c-${id}" width="120" height="120"/></svg>`;
}

function renderCrew(el) {
  el.innerHTML = EMOTIONS.map((e) => critter(e.id)).join("");
}

function show(screen) {
  state.screen = screen;
  saveState();
  for (const s of document.querySelectorAll(".screen")) {
    s.hidden = s.id !== `screen-${screen}`;
  }
  if (screen === "label") renderPost();
  if (screen === "done") $("completion-code").textContent = state.participantId.slice(0, 8).toUpperCase();
  window.scrollTo(0, 0);
}

function renderDefinitions(el) {
  el.innerHTML = EMOTIONS.map(
    (e, i) => `<div class="def" style="--emo:${e.color}">${critter(e.id)}<dt><span class="key">${i + 1}</span>${e.name}</dt><dd>${e.def}</dd></div>`
  ).join("");
}

function renderOptions() {
  const box = $("options");
  box.innerHTML = "";
  EMOTIONS.forEach((e, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    btn.dataset.emotion = e.id;
    btn.style.setProperty("--emo", e.color);
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.innerHTML = `${critter(e.id)}<span class="option-name">${e.name}</span><span class="key">${i + 1}</span>`;
    btn.addEventListener("click", () => select(e.id));
    box.appendChild(btn);
  });
}

function renderPost() {
  const total = state.tweets.length;
  const i = state.index;
  const tweet = state.tweets[i];

  $("progress-text").textContent = `Post ${i + 1} of ${total}`;
  $("progress-bar").style.width = `${(i / total) * 100}%`;
  document.querySelector(".progress").setAttribute("aria-valuenow", String(i));
  $("tweet-text").textContent = tweet.text;
  $("btn-next").textContent = i === total - 1 ? "Finish" : "Next";
  $("submit-error").hidden = true;

  // Drop focus left on the previous post's buttons so it doesn't look like a pre-selection.
  document.activeElement?.blur();
  select(null);
  shownAt = performance.now();
}

function select(emotionId) {
  selected = emotionId;
  for (const btn of document.querySelectorAll(".option")) {
    const on = btn.dataset.emotion === emotionId;
    btn.classList.toggle("selected", on);
    btn.setAttribute("aria-checked", String(on));
  }
  $("btn-next").disabled = !emotionId || submitting;
}

// ------------------------------------------------------------------ actions

async function startSession() {
  const btn = $("btn-start");
  btn.disabled = true;
  btn.textContent = "Loading posts…";
  $("start-error").hidden = true;
  try {
    const data = await rpc("start_session");
    state.participantId = data.participant_id;
    state.tweets = data.tweets;
    state.index = 0;
    show("label");
  } catch (err) {
    console.error(err);
    $("start-error").textContent = "Couldn't load the posts. Please check your connection and try again.";
    $("start-error").hidden = false;
    btn.disabled = false;
    btn.textContent = "Start labeling";
  }
}

async function submitLabel() {
  if (!selected || submitting) return;
  submitting = true;
  const btn = $("btn-next");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  $("submit-error").hidden = true;

  try {
    await rpc("submit_label", {
      p_participant_id: state.participantId,
      p_tweet_id: state.tweets[state.index].id,
      p_label: selected,
      p_response_time_ms: Math.round(performance.now() - shownAt),
    });
    state.index += 1;
    submitting = false;
    btn.textContent = label;
    if (state.index >= state.tweets.length) show("done");
    else { saveState(); renderPost(); }
  } catch (err) {
    console.error(err);
    submitting = false;
    btn.textContent = label;
    btn.disabled = false;
    $("submit-error").textContent = "Your answer couldn't be saved. Please try again.";
    $("submit-error").hidden = false;
  }
}

// ------------------------------------------------------------------ wiring

document.addEventListener("keydown", (e) => {
  if (state.screen !== "label" || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= EMOTIONS.length) select(EMOTIONS[n - 1].id);
  else if (e.key === "Enter" && selected) { e.preventDefault(); submitLabel(); }
});

$("btn-consent").addEventListener("click", () => show("instructions"));
$("btn-start").addEventListener("click", startSession);
$("btn-next").addEventListener("click", submitLabel);

for (const el of document.querySelectorAll("[data-critter]")) el.innerHTML = critter(el.dataset.critter);
renderCrew($("hero-crew"));
renderCrew($("done-crew"));
renderDefinitions($("definitions"));
renderDefinitions($("definitions-inline"));
renderOptions();
show(state.screen);
