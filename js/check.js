// Checks every YouTube ID in the catalog by loading it in a small muted
// player and seeing whether it starts, how long it is, or which error it gives.

import { PLAYABLE } from "./movies.js";
import { MIN_RUNTIME_SHARE, loadApi } from "./player.js";

const TIMEOUT_MS = 20000;
const ERRORS = {
  2: "invalid ID",
  5: "player error",
  100: "removed or private",
  101: "embedding disabled",
  150: "embedding disabled",
  153: "embedding blocked (missing referrer)",
};

const $ = (id) => document.getElementById(id);

function row(movie, id) {
  const tr = document.createElement("tr");
  const film = document.createElement("td");
  film.textContent = `${movie.title} (${movie.year})`;
  const video = document.createElement("td");
  const link = Object.assign(document.createElement("a"), {
    href: `https://www.youtube.com/watch?v=${id}`,
    target: "_blank",
    rel: "noopener",
  });
  link.appendChild(Object.assign(document.createElement("code"), { textContent: id }));
  video.appendChild(link);
  const status = document.createElement("td");
  status.className = "wait";
  status.textContent = "waiting…";
  tr.append(film, video, status);
  $("rows").appendChild(tr);
  return status;
}

function probe(player, movie, id) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, text) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      player.stopVideo();
      resolve({ ok, text });
    };
    const timer = setTimeout(() => finish(false, "timed out"), TIMEOUT_MS);
    player.__onState = (state) => {
      if (state !== window.YT.PlayerState.PLAYING) return;
      const duration = player.getDuration();
      const minutes = Math.round(duration / 60);
      if (duration && duration < movie.runtime * 60 * MIN_RUNTIME_SHARE) {
        finish(false, `too short: ${minutes} min, film is ${movie.runtime} min`);
      } else {
        finish(true, `OK, ${minutes} min`);
      }
    };
    player.__onError = (code) => finish(false, ERRORS[code] || `error ${code}`);
    player.mute();
    player.loadVideoById({ videoId: id, startSeconds: 600 });
  });
}

async function run() {
  $("btn-run").disabled = true;
  $("rows").replaceChildren();
  $("summary").textContent = "Loading the YouTube player…";

  const YT = await loadApi();
  const player = await new Promise((resolve) => {
    const p = new YT.Player("probe", {
      host: "https://www.youtube-nocookie.com",
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 0, controls: 0, playsinline: 1, rel: 0 },
      events: {
        onReady: () => resolve(p),
        onStateChange: (e) => p.__onState?.(e.data),
        onError: (e) => p.__onError?.(e.data),
      },
    });
  });

  const jobs = PLAYABLE.flatMap((m) => m.youtube.map((id) => ({ movie: m, id, cell: row(m, id) })));
  const working = new Set();
  let checked = 0;
  for (const job of jobs) {
    job.cell.textContent = "checking…";
    const { ok, text } = await probe(player, job.movie, job.id);
    job.cell.className = ok ? "ok" : "bad";
    job.cell.textContent = text;
    if (ok) working.add(job.movie.imdb);
    checked++;
    $("summary").textContent = `Checked ${checked} of ${jobs.length} videos…`;
  }

  const dead = PLAYABLE.filter((m) => !working.has(m.imdb));
  $("summary").textContent = dead.length
    ? `Done. No working video for: ${dead.map((m) => m.title).join(", ")}.`
    : `Done. Every film has at least one working video.`;
  $("summary").className = `summary ${dead.length ? "bad" : "ok"}`;
  $("btn-run").disabled = false;
}

$("btn-run").addEventListener("click", () => {
  run().catch((err) => {
    $("summary").textContent = err.message;
    $("summary").className = "summary bad";
    $("btn-run").disabled = false;
  });
});
