import { PLAYABLE, TITLE_POOL } from "./movies.js";
import { StillPlayer } from "./player.js";

const ROUNDS = 5;
const MAX_GUESSES = 3;
const POINTS = { base: 100, extraFrame: 20, wrongGuess: 15, floor: 10 };

const $ = (id) => document.getElementById(id);
// Phones get "hold" mode, because YouTube covers paused videos with its own
// UI there (see player.js). Add ?hold=1 or ?hold=0 to the URL to force it.
const holdParam = new URLSearchParams(location.search).get("hold");
const HOLD = holdParam
  ? holdParam === "1"
  : matchMedia("(hover: none) and (pointer: coarse)").matches;
const player = new StillPlayer("yt-host", { hold: HOLD });
let playerReady = null;

// `players` is an array so a multiplayer mode and scoreboard can slot in later.
const state = {
  players: [],
  current: 0,
  queue: [],
  round: 0,
  rounds: 0,
  movie: null,
  duration: 0, // seconds; runtime estimate until the video reports its real length
  frames: [], // timestamps (seconds) looked at this round
  wrong: 0,
  history: [],
};

// ---------- helpers ----------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmt(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function normalize(title) {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function isCorrect(guess, movie) {
  const g = normalize(guess.replace(/\s*\(\d{4}\)\s*$/, ""));
  if (!g) return false;
  return [movie.title, ...movie.aliases].some((t) => {
    const n = normalize(t);
    // Allow small typos in longer titles, but not in short ones like "M".
    return g === n || (n.length >= 6 && levenshtein(g, n) <= Math.floor(n.length / 8) + 1);
  });
}

// Earliest and latest seconds a frame may come from.
function range() {
  const m = state.movie;
  const lo = m.skipStart * 60;
  const hi = Math.max(lo + 60, state.duration - m.skipEnd * 60);
  return [lo, hi];
}

function roundPoints() {
  const extra = Math.max(0, state.frames.length - 1);
  return Math.max(
    POINTS.floor,
    POINTS.base - extra * POINTS.extraFrame - state.wrong * POINTS.wrongGuess,
  );
}

function show(screen) {
  for (const s of ["start", "game", "end"]) $(`screen-${s}`).hidden = s !== screen;
  $("hud").hidden = screen !== "game";
}

function panel(name) {
  for (const p of ["pick", "guess", "result"]) $(`panel-${p}`).hidden = p !== name;
}

function setCurtain(text) {
  $("curtain").classList.toggle("open", text === null);
  if (text !== null) $("curtain-text").textContent = text;
}

function showError(msg) {
  $("game-error").hidden = !msg;
  $("game-error").textContent = msg || "";
}

function updateHud() {
  $("hud-round").textContent = `${state.round + 1}/${state.rounds}`;
  $("hud-score").textContent = state.players[state.current].score;
}

// ---------- flow ----------

function startGame() {
  const name = $("player-name").value.trim() || "Player 1";
  saveName(name);
  state.players = [{ name, score: 0 }];
  state.current = 0;
  state.queue = shuffle(PLAYABLE);
  state.rounds = Math.min(ROUNDS, state.queue.length);
  state.round = 0;
  state.history = [];
  show("game");
  playerReady = playerReady || player.init();
  startRound();
}

function startRound() {
  state.movie = state.queue[state.round];
  state.duration = state.movie.runtime * 60;
  state.frames = [];
  state.wrong = 0;
  player.stop();
  if (state.movie.zoom) $("frame").style.setProperty("--zoom", state.movie.zoom);
  else $("frame").style.removeProperty("--zoom");
  showError("");
  setCurtain(`Mystery film #${state.round + 1}`);
  $("guess-input").value = "";
  $("guess-feedback").textContent = "";
  renderTimeline();
  updateHud();
  preparePick();
}

function preparePick() {
  const [lo, hi] = range();
  const slider = $("pick-slider");
  slider.min = lo;
  slider.max = hi;
  slider.step = 1;
  // Start somewhere random so the slider position gives nothing away.
  slider.value = Math.round(lo + Math.random() * (hi - lo));
  onSlide();
  $("pick-hint").textContent = state.frames.length
    ? `Pick a different moment. This frame costs ${POINTS.extraFrame} points.`
    : `The film runs about ${fmt(state.duration)}. Opening titles and end credits are left out.`;
  panel("pick");
  $("btn-show").disabled = false;
}

function onSlide() {
  $("pick-time").textContent = fmt(Number($("pick-slider").value));
}

function randomMoment() {
  const [lo, hi] = range();
  $("pick-slider").value = Math.round(lo + Math.random() * (hi - lo));
  onSlide();
}

async function showFrame() {
  const seconds = Number($("pick-slider").value);
  $("btn-show").disabled = true;
  if (await loadFrame(seconds)) {
    state.frames.push(seconds);
    renderTimeline();
    panel("guess");
    updateGuessesLeft();
    $("guess-input").focus();
  }
}

// Shows the frame at `seconds` behind the curtain and lifts it. Returns false,
// and moves on to the next film, when no upload of this film can be shown.
async function loadFrame(seconds) {
  const movie = state.movie;
  showError("");
  setCurtain("Rolling film…");
  try {
    await playerReady;
    const duration = await player.showStill(movie, seconds);
    if (state.movie !== movie) return false;
    if (duration) state.duration = duration;
    setCurtain(null);
    return true;
  } catch (err) {
    if (err.message === "cancelled" || state.movie !== movie) return false;
    setCurtain("Projector jammed");
    showError(`${err.message} Skipping to the next film.`);
    // Don't charge the player for a film that can't be shown.
    state.history.push({ movie, points: 0, skipped: true });
    $("btn-show").disabled = false;
    setTimeout(nextRound, 2500);
    return false;
  }
}

// The video on screen was taken down or failed after it loaded, so YouTube is
// showing its error page. Hide it and show the same moment from another upload.
player.onBroken = () => {
  const last = state.frames[state.frames.length - 1];
  if (last === undefined) return;
  loadFrame(last);
};

function updateGuessesLeft() {
  const left = MAX_GUESSES - state.wrong;
  $("guesses-left").textContent = `(${left} ${left === 1 ? "guess" : "guesses"} left, ${roundPoints()} pts)`;
}

function submitGuess(e) {
  e.preventDefault();
  const guess = $("guess-input").value.trim();
  if (!guess) return;
  if (isCorrect(guess, state.movie)) {
    endRound(true);
    return;
  }
  state.wrong++;
  if (state.wrong >= MAX_GUESSES) {
    endRound(false, "Out of guesses. It was…");
    return;
  }
  $("guess-feedback").textContent = `Not “${guess}”. Try again.`;
  $("guess-input").value = "";
  updateGuessesLeft();
  $("guess-input").focus();
}

function anotherFrame() {
  $("guess-feedback").textContent = "";
  preparePick();
}

function endRound(won, lossText = "It was…") {
  const points = won ? roundPoints() : 0;
  const p = state.players[state.current];
  p.score += points;
  state.history.push({ movie: state.movie, points, won, frames: state.frames.length });
  updateHud();

  const m = state.movie;
  $("result-verdict").textContent = won
    ? `Correct! +${points} points`
    : lossText;
  $("result-verdict").className = `verdict ${won ? "win" : "lose"}`;
  $("result-title").textContent = m.title;
  $("result-meta").textContent = `${m.year} · ${m.genres.join(", ")}`;
  const last = state.frames[state.frames.length - 1] || 0;
  const link = player.watchUrl(last);
  $("result-link").hidden = !link;
  if (link) $("result-link").href = link;
  $("btn-next").textContent = state.round + 1 >= state.rounds ? "See final score" : "Next film";
  panel("result");
}

function nextRound() {
  player.stop();
  state.round++;
  if (state.round >= state.rounds) endGame();
  else startRound();
}

function endGame() {
  const p = state.players[state.current];
  show("end");
  $("end-score").textContent = `${p.score} pts`;
  const previousBest = loadBest();
  saveBest(p.score);
  $("end-title").textContent = p.score > previousBest ? "New best score!" : `Final score, ${p.name}`;
  $("end-recap").replaceChildren(
    ...state.history.map((h) => {
      const li = document.createElement("li");
      const status = h.skipped ? "couldn't be loaded" : h.won ? `+${h.points}` : "missed";
      li.textContent = `${h.movie.title} (${h.movie.year}): ${status}`;
      return li;
    }),
  );
}

function renderTimeline() {
  const el = $("timeline");
  el.replaceChildren();
  if (!state.frames.length) return;
  const total = state.duration || 1;
  for (const t of state.frames) {
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.style.left = `${Math.min(100, (t / total) * 100)}%`;
    mark.title = fmt(t);
    el.appendChild(mark);
  }
}

// ---------- persistence ----------

function saveName(name) {
  try { localStorage.setItem("timestamp-game:name", name); } catch {}
}

function loadName() {
  try { return localStorage.getItem("timestamp-game:name") || ""; } catch { return ""; }
}

function loadBest() {
  try { return Number(localStorage.getItem("timestamp-game:best")) || 0; } catch { return 0; }
}

function saveBest(score) {
  const best = Math.max(loadBest(), score);
  try { localStorage.setItem("timestamp-game:best", String(best)); } catch {}
  return best;
}

// ---------- wiring ----------

function init() {
  const titles = new Map();
  for (const [t, y] of TITLE_POOL) titles.set(normalize(t), `${t} (${y})`);
  for (const m of PLAYABLE) titles.set(normalize(m.title), `${m.title} (${m.year})`);
  $("titles").replaceChildren(
    ...[...titles.values()].sort().map((v) => Object.assign(document.createElement("option"), { value: v })),
  );

  $("player-name").value = loadName();
  const best = loadBest();
  $("best-score").textContent = best ? `Your best: ${best} pts` : "";

  $("btn-start").addEventListener("click", startGame);
  $("pick-slider").addEventListener("input", onSlide);
  $("btn-random").addEventListener("click", randomMoment);
  $("btn-show").addEventListener("click", showFrame);
  $("panel-guess").addEventListener("submit", submitGuess);
  $("btn-another").addEventListener("click", anotherFrame);
  $("btn-giveup").addEventListener("click", () => endRound(false));
  $("btn-scene").addEventListener("click", () => player.playScene());
  $("btn-next").addEventListener("click", nextRound);
  $("btn-again").addEventListener("click", () => {
    $("best-score").textContent = `Your best: ${loadBest()} pts`;
    show("start");
  });

  // Warm up the YouTube API while the player reads the rules.
  playerReady = player.init();
  playerReady.catch(() => {
    playerReady = null;
  });
}

init();
