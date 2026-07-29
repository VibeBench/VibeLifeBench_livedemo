/**
 * Global demo playback clock — scales wall-clock waits for animations & gaps.
 * Live autoplay and post-run「加速回放」both read getPlaybackSpeed().
 *
 * Card overlays use cardDisplayMs(): full length during live inference;
 * during加速回放 capped ~1s so cinematic cards don't bottleneck the run.
 */

let speed = 2;
/** True only while startAcceleratedReplay is running (not live LLM autoplay). */
let replayMode = false;

export function getPlaybackSpeed() {
  return speed;
}

export function setPlaybackSpeed(n) {
  const v = Math.max(0.5, Math.min(16, Number(n) || 1));
  speed = v;
  try {
    document.documentElement.style.setProperty("--demo-speed", String(v));
  } catch {
    /* ignore */
  }
  syncReplaySpeedClass();
  return speed;
}

export function setReplayMode(on) {
  replayMode = Boolean(on);
  syncReplaySpeedClass();
  return replayMode;
}

export function isReplayMode() {
  return replayMode;
}

function syncReplaySpeedClass() {
  try {
    document.documentElement.classList.toggle("is-replay-fast", replayMode);
  } catch {
    /* ignore */
  }
}

/** Scale a base duration: faster speed → shorter wait. */
export function playbackMs(baseMs, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const raw = Number(baseMs);
  if (!Number.isFinite(raw) || raw <= 0) return Math.max(min, 0);
  const scaled = Math.round(raw / speed);
  return Math.min(max, Math.max(min, scaled));
}

/**
 * Map / status card hold time.
 * - Live inference (not replay): keep the designed duration (no slowdown).
 * - 加速回放: cap at ~1s so cards don't drag behind the speed multiplier.
 */
export function cardDisplayMs(baseMs = 2400) {
  const raw = Number(baseMs);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (!replayMode) return Math.round(raw);
  // Readable flash during replay — never linger past 1s.
  const scaled = Math.round(raw / Math.max(speed, 1));
  return Math.min(1000, Math.max(scaled, 500));
}

export function sleepPlayback(baseMs, opts) {
  return new Promise((resolve) => setTimeout(resolve, playbackMs(baseMs, opts)));
}

export function sleepCard(baseMs) {
  return new Promise((resolve) => setTimeout(resolve, cardDisplayMs(baseMs)));
}

/** Label for UI (1× / 2× / …). */
export function playbackSpeedLabel(n = speed) {
  const v = Number(n) || 1;
  return Number.isInteger(v) ? `${v}×` : `${v}×`;
}
