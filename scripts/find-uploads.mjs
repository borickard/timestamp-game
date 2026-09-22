#!/usr/bin/env node
// Searches YouTube for full-length uploads of the films in films.json and
// writes the matches to ../js/found.js, which the game merges into its catalog.
//
// A result counts as a match when its length is close to the film's runtime
// and its title names the film without looking like a trailer, review, clip
// and so on. Matches are ranked by how close the length is, then by views.
//
// Usage (from this folder):
//   npm install
//   npx playwright install chromium
//   node find-uploads.mjs                   # search every film in films.json
//   node find-uploads.mjs --only godfather  # films whose title contains "godfather"
//   node find-uploads.mjs --headed          # show the browser (helps if YouTube blocks headless)
//   node find-uploads.mjs --dry             # print matches without writing js/found.js
//   node find-uploads.mjs --max 3           # keep at most 3 videos per film (default 5)
//
// Afterwards, open /check.html in the game to see which matches embed.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILMS_FILE = path.join(HERE, "films.json");
const OUT_FILE = path.join(HERE, "..", "js", "found.js");

// "Long (> 20 minutes)" search filter, so short clips don't crowd out results.
const LONG_FILTER = "EgIYAg%3D%3D";
// A match must be at least this share of the runtime, and at most this much
// longer (uploads sometimes pad with intros or run at a slightly slower speed).
const MIN_SHARE = 0.85;
const MAX_SHARE = 1.15;
const MAX_EXTRA_MIN = 10;
const PAUSE_MS = [2500, 5000]; // between searches, to go easy on YouTube

const JUNK = [
  "trailer", "teaser", "review", "reaction", "reacts", "explained", "explain",
  "recap", "breakdown", "analysis", "summary", "summarized", "clip", "clips",
  "scene", "scenes", "behind the scenes", "making of", "soundtrack", "ost",
  "score", "audiobook", "podcast", "commentary", "fan film", "parody",
  "in minutes", "ending", "honest", "everything wrong", "vs", "documentary",
  "interview", "cast", "then and now", "deleted",
];

// ---------- pure helpers (exported for testing) ----------

export function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "2:22:10" -> 8530 seconds.
export function parseLength(text) {
  if (!text) return 0;
  const parts = text.trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function parseViews(text) {
  if (!text) return 0;
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

// Collects every videoRenderer object in YouTube's search page data.
export function collectVideos(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectVideos(item, out);
    return out;
  }
  if (node.videoRenderer) {
    const v = node.videoRenderer;
    out.push({
      id: v.videoId,
      title: v.title?.runs?.map((r) => r.text).join("") ?? v.title?.simpleText ?? "",
      channel: v.ownerText?.runs?.[0]?.text ?? "",
      seconds: parseLength(v.lengthText?.simpleText),
      views: parseViews(v.viewCountText?.simpleText),
      live: Boolean(v.badges?.some((b) => /live/i.test(JSON.stringify(b)))),
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectVideos(value, out);
  }
  return out;
}

const bare = (name) => normalize(name).replace(/^the /, "");

function namesFilm(title, film) {
  const t = ` ${normalize(title)} `;
  return [film.title, ...(film.aliases ?? [])].some((n) => t.includes(` ${bare(n)} `));
}

const SEQUEL = /\b(part (ii|iii|iv|2|3|4|two|three|four)|ii|iii|iv|chapter \d)\b/;

// True when the video is more likely another film whose title contains this
// one's, e.g. "The Dark Knight Rises" for "The Dark Knight", or a sequel.
function namesOtherFilm(title, film, otherTitles) {
  const t = ` ${normalize(title)} `;
  const own = bare(film.title);
  if (SEQUEL.test(t) && !SEQUEL.test(` ${normalize(film.title)} `)) return true;
  return otherTitles.some((o) => {
    const other = bare(o);
    return other !== own && other.includes(own) && t.includes(` ${other} `);
  });
}

function looksLikeJunk(title) {
  const t = ` ${normalize(title)} `;
  return JUNK.some((word) => t.includes(` ${word} `));
}

// Why a video was rejected, or null when it's a match.
export function rejection(video, film, otherTitles = []) {
  if (!video.id) return "no id";
  if (video.live) return "live stream";
  const min = film.runtime * 60 * MIN_SHARE;
  const max = Math.max(film.runtime * 60 * MAX_SHARE, (film.runtime + MAX_EXTRA_MIN) * 60);
  if (!video.seconds) return "no length";
  if (video.seconds < min) return `too short (${Math.round(video.seconds / 60)} min)`;
  if (video.seconds > max) return `too long (${Math.round(video.seconds / 60)} min)`;
  if (!namesFilm(video.title, film)) return "title doesn't name the film";
  if (namesOtherFilm(video.title, film, otherTitles)) return "looks like a different film or sequel";
  if (looksLikeJunk(video.title)) return "looks like a clip/review/trailer";
  return null;
}

export function rank(videos, film, otherTitles = []) {
  const target = film.runtime * 60;
  return videos
    .filter((v) => rejection(v, film, otherTitles) === null)
    .map((v) => ({
      ...v,
      // Minutes off the runtime; small bonuses for naming the year or "full movie".
      score:
        Math.abs(v.seconds - target) / 60 -
        (normalize(v.title).includes(String(film.year)) ? 3 : 0) -
        (/full (movie|film)/i.test(v.title) ? 2 : 0),
    }))
    .sort((a, b) => a.score - b.score || b.views - a.views);
}

// Game catalog entry for a film, keeping IDs found on earlier runs.
export function toEntry(film, ids, previous) {
  const old = previous?.youtube ?? [];
  const youtube = [...new Set([...old, ...ids])];
  const entry = {
    imdb: film.imdb,
    title: film.title,
    year: film.year,
    runtime: film.runtime,
    genres: film.genres ?? [],
    aliases: film.aliases ?? [],
    youtube,
    skipStart: film.skipStart ?? 3,
    // Modern films have long end credits.
    skipEnd: film.skipEnd ?? (film.year >= 1980 ? 10 : 4),
  };
  // Most films since the mid-1950s are widescreen, letterboxed in 16:9 uploads.
  const zoom = film.zoom ?? (film.year >= 1955 ? 1.25 : null);
  if (zoom) entry.zoom = zoom;
  return entry;
}

function renderFoundFile(entries) {
  return `// Generated by scripts/find-uploads.mjs. Edit scripts/films.json and re-run
// the script rather than editing this file by hand. IDs from earlier runs are
// kept; delete one here if check.html reports it dead and it isn't coming back.
export const FOUND = ${JSON.stringify(entries, null, 2)};
`;
}

async function loadPrevious() {
  try {
    const mod = await import(`${pathToFileURL(OUT_FILE).href}?t=${Date.now()}`);
    return new Map(mod.FOUND.map((e) => [e.imdb, e]));
  } catch {
    return new Map();
  }
}

// ---------- browser ----------

async function search(page, film) {
  const query = `${film.title} ${film.year} full movie`;
  const url =
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` +
    `&sp=${LONG_FILTER}&hl=en&gl=US`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // EU visitors get a cookie consent page first.
  if (page.url().includes("consent.")) {
    const button = page.getByRole("button", { name: /reject all|avvisa alla|accept all|godkänn alla/i }).first();
    await button.click({ timeout: 10000 });
    await page.waitForURL(/youtube\.com\/results/, { timeout: 15000 });
  }

  await page.waitForFunction(() => window.ytInitialData, null, { timeout: 20000 });
  // Scroll once so a few more results load.
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(1500);

  const initial = await page.evaluate(() => window.ytInitialData);
  const videos = collectVideos(initial);
  // Results added by scrolling only exist in the page, so read those from the DOM.
  const more = await page.$$eval("ytd-video-renderer", (els) =>
    els.map((el) => ({
      id: el.querySelector("a#thumbnail")?.href?.match(/v=([\w-]{11})/)?.[1],
      title: el.querySelector("#video-title")?.textContent?.trim() ?? "",
      channel: el.querySelector("#channel-name a")?.textContent?.trim() ?? "",
      length: el.querySelector("badge-shape .yt-badge-shape__text, #time-status #text")?.textContent?.trim() ?? "",
    })),
  );
  const seen = new Set(videos.map((v) => v.id));
  for (const m of more) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    videos.push({ id: m.id, title: m.title, channel: m.channel, seconds: parseLength(m.length), views: 0, live: false });
  }
  return videos;
}

function parseArgs(argv) {
  const args = { headed: false, dry: false, max: 5, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--headed") args.headed = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--max") args.max = Number(argv[++i]) || args.max;
    else if (a === "--only") args.only = normalize(argv[++i] ?? "");
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtMin = (s) => `${Math.round(s / 60)} min`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node find-uploads.mjs [--only <title>] [--max <n>] [--headed] [--dry]");
    return;
  }

  let films = JSON.parse(await readFile(FILMS_FILE, "utf8"));
  if (args.only) films = films.filter((f) => normalize(f.title).includes(args.only));
  if (!films.length) throw new Error("No films to search. Check films.json or --only.");

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  // Pre-answer the consent prompt ("reject all") so it usually doesn't appear.
  await context.addCookies([
    { name: "SOCS", value: "CAI", domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();

  const { TITLE_POOL } = await import("../js/movies.js");
  const otherTitles = [...new Set([...TITLE_POOL.map(([t]) => t), ...films.map((f) => f.title)])];
  const previous = await loadPrevious();
  const results = new Map(previous);
  try {
    for (const [i, film] of films.entries()) {
      console.log(`\n${film.title} (${film.year}), ${film.runtime} min`);
      let videos;
      try {
        videos = await search(page, film);
      } catch (err) {
        console.log(`  search failed: ${err.message.split("\n")[0]}`);
        continue;
      }
      const matches = rank(videos, film, otherTitles).slice(0, args.max);
      if (!matches.length) {
        console.log(`  no matches among ${videos.length} results`);
        for (const v of videos.slice(0, 5)) console.log(`    skipped ${v.id}: ${rejection(v, film, otherTitles)} | ${v.title}`);
      }
      for (const m of matches) {
        console.log(`  ✓ ${m.id}  ${fmtMin(m.seconds).padStart(7)}  ${m.channel} | ${m.title}`);
      }
      if (matches.length || previous.has(film.imdb)) {
        results.set(film.imdb, toEntry(film, matches.map((m) => m.id), previous.get(film.imdb)));
      }
      if (i < films.length - 1) await sleep(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
    }
  } finally {
    await browser.close();
  }

  const entries = [...results.values()];
  if (args.dry) {
    console.log(`\n--dry: not writing ${path.relative(process.cwd(), OUT_FILE)}`);
    return;
  }
  await writeFile(OUT_FILE, renderFoundFile(entries));
  console.log(`\nWrote ${entries.length} films to ${path.relative(process.cwd(), OUT_FILE)}.`);
  console.log("Next: open /check.html in the game to see which videos embed.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
