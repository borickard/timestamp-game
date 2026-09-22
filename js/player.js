// Thin wrapper around the YouTube IFrame API that shows a single frame
// ("still") of a video at a given time, with the YouTube UI kept out of view.
//
// YouTube no longer lets embeds hide the title bar or the pause overlay, so
// the page does it instead: the iframe is scaled up inside a clipping frame so
// the top and bottom bars fall outside it, and a shield element on top blocks
// hover and clicks. A curtain covers the frame while it seeks and pauses, so
// the player never sees the title card, spinner or a moving picture.

const LOAD_TIMEOUT_MS = 15000;
// A candidate shorter than this share of the film's runtime is a clip or
// trailer rather than the full film.
const MIN_RUNTIME_SHARE = 0.6;

let apiReady = null;

function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => {
      apiReady = null;
      tag.remove();
      reject(new Error("Could not load the YouTube player."));
    };
    document.head.appendChild(tag);
  });
  return apiReady;
}

export class StillPlayer {
  constructor(hostId) {
    this.hostId = hostId;
    this.player = null;
    this.videoId = null;
    this.pending = null; // { resolve, reject, target, timer }
    this.workingIds = loadWorkingIds();
  }

  async init() {
    const YT = await loadApi();
    await new Promise((resolve) => {
      this.player = new YT.Player(this.hostId, {
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          cc_load_policy: 0,
        },
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => this.onStateChange(e),
          onError: (e) => this.onError(e),
        },
      });
    });
  }

  // Candidate IDs for a movie, with the last one known to work first.
  candidates(movie) {
    const known = this.workingIds[movie.imdb];
    const ids = movie.youtube.slice();
    if (known && ids.includes(known)) {
      ids.splice(ids.indexOf(known), 1);
      ids.unshift(known);
    }
    return ids;
  }

  // Shows the frame at `seconds` into the movie. Resolves with the video's
  // duration in seconds, or rejects when no candidate video can be played.
  async showStill(movie, seconds) {
    if (this.videoId && this.movie === movie) {
      try {
        return await this.seekAndFreeze(seconds);
      } catch {
        // The current video stopped working; fall through and try the rest.
      }
    }
    this.movie = movie;
    for (const id of this.candidates(movie)) {
      try {
        const duration = await this.loadAndFreeze(id, seconds, movie);
        this.videoId = id;
        this.workingIds[movie.imdb] = id;
        saveWorkingIds(this.workingIds);
        return duration;
      } catch (err) {
        console.warn(`YouTube video ${id} for ${movie.title} is unusable:`, err.message);
      }
    }
    this.videoId = null;
    throw new Error(`No playable YouTube upload found for this film.`);
  }

  loadAndFreeze(id, seconds, movie) {
    return this.waitForFrame(seconds, movie, () => {
      this.player.mute();
      this.player.loadVideoById({ videoId: id, startSeconds: seconds });
    });
  }

  seekAndFreeze(seconds) {
    return this.waitForFrame(seconds, this.movie, () => {
      this.player.mute();
      this.player.seekTo(seconds, true);
      this.player.playVideo();
    });
  }

  waitForFrame(target, movie, start) {
    this.cancelPending();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.player.stopVideo();
        reject(new Error("timed out"));
      }, LOAD_TIMEOUT_MS);
      this.pending = { resolve, reject, target, movie, timer, checking: false };
      start();
    });
  }

  cancelPending() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(new Error("cancelled"));
    this.pending = null;
  }

  onStateChange(e) {
    const p = this.pending;
    if (!p || e.data !== window.YT.PlayerState.PLAYING || p.checking) return;
    p.checking = true;

    const duration = this.player.getDuration();
    if (duration && duration < p.movie.runtime * 60 * MIN_RUNTIME_SHARE) {
      this.finish((q) => q.reject(new Error(`only ${Math.round(duration / 60)} min long`)));
      this.player.stopVideo();
      return;
    }

    // Wait until playback has actually reached the requested time, so the
    // frame shown is the one asked for and not a stale frame from before.
    const poll = () => {
      if (this.pending !== p) return;
      const t = this.player.getCurrentTime();
      const goal = Math.min(p.target, duration || Infinity);
      if (t >= goal - 1 && t < goal + 5) {
        this.player.pauseVideo();
        // Give the pause a moment to settle before lifting the curtain.
        setTimeout(() => this.finish((q) => q.resolve(duration)), 300);
      } else {
        setTimeout(poll, 100);
      }
    };
    poll();
  }

  onError(e) {
    // 2: bad id, 5: HTML5 error, 100: removed/private, 101/150: embedding disabled.
    this.finish((q) => q.reject(new Error(`YouTube error ${e.data}`)));
  }

  finish(fn) {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    fn(p);
  }

  // Plays the current scene with sound, used after the answer is revealed.
  playScene() {
    if (!this.videoId) return;
    this.player.unMute();
    this.player.playVideo();
  }

  pause() {
    if (this.player && this.player.pauseVideo) this.player.pauseVideo();
  }

  stop() {
    this.cancelPending();
    if (this.player && this.player.stopVideo) this.player.stopVideo();
    this.videoId = null;
    this.movie = null;
  }

  watchUrl(seconds) {
    return this.videoId
      ? `https://www.youtube.com/watch?v=${this.videoId}&t=${Math.floor(seconds)}s`
      : null;
  }
}

const STORAGE_KEY = "timestamp-game:working-ids";

function loadWorkingIds() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveWorkingIds(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode); the cache is only an optimisation.
  }
}
