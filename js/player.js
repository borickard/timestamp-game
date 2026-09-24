// Thin wrapper around the YouTube IFrame API that shows a single frame
// ("still") of a video at a given time, with the YouTube UI kept out of view.
//
// YouTube no longer lets embeds hide the title bar or the pause overlay, so
// the page does it instead: the iframe is scaled up inside a clipping frame so
// the top and bottom bars fall outside it, and a shield element on top blocks
// hover and clicks. A curtain covers the frame while it seeks and pauses, so
// the player never sees the title card, spinner or a moving picture.
//
// On phones YouTube draws its title, a big play button and its logo over any
// paused embed, and cropping can't hide the play button in the middle. So in
// "hold" mode the video isn't paused: it keeps playing, muted, at quarter
// speed, and jumps back to the chosen moment every fraction of a second, which
// looks almost still. The curtain stays down for the first few seconds of a new
// video, while YouTube's title is showing.

const LOAD_TIMEOUT_MS = 15000;
// Hold mode: how long YouTube's title shows after a video starts playing.
const HOLD_TITLE_MS = 3500;
const HOLD_RATE = 0.25;
// Hold mode: jump back once playback is this many seconds past the moment.
const HOLD_WINDOW_S = 0.25;
// A candidate shorter than this share of the film's runtime is a clip or
// trailer rather than the full film.
export const MIN_RUNTIME_SHARE = 0.6;

let apiReady = null;

export function loadApi() {
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
  constructor(hostId, { hold = false } = {}) {
    this.hostId = hostId;
    this.hold = hold;
    this.holdTimer = null;
    this.player = null;
    this.videoId = null;
    this.pending = null; // { resolve, reject, target, timer }
    this.scenePlaying = false;
    this.badIds = new Set(); // failed this session, so not retried
    this.onBroken = null; // called if the video on screen stops working
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
    const ids = movie.youtube.filter((id) => !this.badIds.has(id));
    if (known && ids.includes(known)) {
      ids.splice(ids.indexOf(known), 1);
      ids.unshift(known);
    }
    return ids;
  }

  // Shows the frame at `seconds` into the movie. Resolves with the video's
  // duration in seconds, or rejects when no candidate video can be played.
  async showStill(movie, seconds) {
    this.scenePlaying = false;
    this.stopHold();
    if (this.videoId && this.movie === movie) {
      try {
        return await this.seekAndFreeze(seconds);
      } catch (err) {
        if (err.message === "cancelled") throw err;
        // The current video stopped working; fall through and try the rest.
        this.forget(this.videoId);
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
        if (err.message === "cancelled") throw err;
        this.forget(id);
        console.warn(`YouTube video ${id} for ${movie.title} is unusable:`, err.message);
      }
    }
    this.videoId = null;
    throw new Error(`No playable YouTube upload found for this film.`);
  }

  loadAndFreeze(id, seconds, movie) {
    return this.waitForFrame(seconds, movie, true, () => {
      this.player.mute();
      this.player.loadVideoById({ videoId: id, startSeconds: seconds });
    });
  }

  seekAndFreeze(seconds) {
    return this.waitForFrame(seconds, this.movie, false, () => {
      this.player.mute();
      this.player.seekTo(seconds, true);
      this.player.playVideo();
    });
  }

  // `fresh` is true when a new video is being loaded rather than seeked.
  waitForFrame(target, movie, fresh, start) {
    this.cancelPending();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.player.stopVideo();
        reject(new Error("timed out"));
      }, LOAD_TIMEOUT_MS);
      this.pending = { resolve, reject, target, movie, fresh, timer, checking: false };
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
    const { PLAYING } = window.YT.PlayerState;
    const p = this.pending;
    if (!p) {
      // Only "Play the scene" may play a video once a still is on screen.
      // (In hold mode the still is a video that keeps playing on purpose.)
      if (e.data === PLAYING && this.videoId && !this.scenePlaying && !this.hold) {
        this.player.pauseVideo();
      }
      return;
    }
    if (e.data !== PLAYING || p.checking) return;
    p.checking = true;
    const startedAt = Date.now();

    const duration = this.player.getDuration();
    if (duration && duration < p.movie.runtime * 60 * MIN_RUNTIME_SHARE) {
      this.finish((q) => q.reject(new Error(`only ${Math.round(duration / 60)} min long`)));
      this.player.stopVideo();
      return;
    }
    const goal = Math.min(p.target, duration || Infinity);

    // Wait until playback has actually reached the requested time, so the
    // frame shown is the one asked for and not a stale frame from before.
    const seek = () => {
      if (this.pending !== p) return;
      const t = this.player.getCurrentTime();
      if (t >= goal - 1 && t < goal + 5) {
        if (this.hold) holdThere();
        else {
          this.player.pauseVideo();
          settle(t, 0);
        }
      } else {
        setTimeout(seek, 100);
      }
    };

    // Then wait until the player really is paused and the picture has stopped
    // moving before lifting the curtain. pauseVideo() is asynchronous and is
    // sometimes ignored while buffering, so keep re-issuing it until it holds.
    const settle = (lastT, steady) => {
      setTimeout(() => {
        if (this.pending !== p) return;
        const t = this.player.getCurrentTime();
        if (this.player.getPlayerState() !== window.YT.PlayerState.PAUSED) {
          this.player.pauseVideo();
          settle(t, 0);
        } else if (Math.abs(t - lastT) < 0.01 && steady >= 2) {
          this.finish((q) => q.resolve(duration));
        } else {
          settle(t, Math.abs(t - lastT) < 0.01 ? steady + 1 : 0);
        }
      }, 120);
    };
    // Hold mode: keep replaying the moment, and reveal it once YouTube's
    // title has faded (a fresh video) or the loop has settled (a seek).
    const holdThere = () => {
      this.startHold(goal);
      const wait = p.fresh ? Math.max(0, HOLD_TITLE_MS - (Date.now() - startedAt)) : 0;
      setTimeout(() => this.finish((q) => q.resolve(duration)), Math.max(600, wait));
    };
    seek();
  }

  startHold(goal) {
    this.stopHold();
    this.player.setPlaybackRate(HOLD_RATE);
    this.holdTimer = setInterval(() => {
      const { PAUSED, ENDED } = window.YT.PlayerState;
      const state = this.player.getPlayerState();
      if (state === PAUSED || state === ENDED) this.player.playVideo();
      const t = this.player.getCurrentTime();
      if (t > goal + HOLD_WINDOW_S || t < goal - 0.5) this.player.seekTo(goal, true);
    }, 100);
  }

  stopHold() {
    clearInterval(this.holdTimer);
    this.holdTimer = null;
  }

  onError(e) {
    // 2: bad id, 5: HTML5 error, 100: removed/private, 101/150: embedding disabled.
    if (this.pending) {
      this.finish((q) => q.reject(new Error(`YouTube error ${e.data}`)));
      return;
    }
    // An error after a still was shown means YouTube has replaced the frame
    // with its own error screen. Drop the video and let the game recover.
    if (this.videoId) {
      console.warn(`YouTube video ${this.videoId} broke after loading: error ${e.data}`);
      this.forget(this.videoId);
      this.videoId = null;
      this.onBroken?.();
    }
  }

  forget(id) {
    if (id === this.videoId) this.stopHold();
    this.badIds.add(id);
    for (const [imdb, known] of Object.entries(this.workingIds)) {
      if (known === id) delete this.workingIds[imdb];
    }
    saveWorkingIds(this.workingIds);
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
    this.scenePlaying = true;
    this.stopHold();
    this.player.setPlaybackRate(1);
    this.player.unMute();
    this.player.playVideo();
  }

  pause() {
    if (this.player && this.player.pauseVideo) this.player.pauseVideo();
  }

  stop() {
    this.cancelPending();
    this.stopHold();
    this.scenePlaying = false;
    this.videoId = null;
    if (this.player && this.player.stopVideo) this.player.stopVideo();
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
