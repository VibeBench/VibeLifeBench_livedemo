/**
 * Global demo playback clock — scales wall-clock waits for animations & gaps.
 * Live autoplay and post-run「加速回放」both read getPlaybackSpeed().
 */

let speed = 1;

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
  return speed;
}

/** Scale a base duration: faster speed → shorter wait. */
export function playbackMs(baseMs, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const raw = Number(baseMs);
  if (!Number.isFinite(raw) || raw <= 0) return Math.max(min, 0);
  const scaled = Math.round(raw / speed);
  return Math.min(max, Math.max(min, scaled));
}

export function sleepPlayback(baseMs, opts) {
  return new Promise((resolve) => setTimeout(resolve, playbackMs(baseMs, opts)));
}

/** Label for UI (1× / 2× / …). */
export function playbackSpeedLabel(n = speed) {
  const v = Number(n) || 1;
  return Number.isInteger(v) ? `${v}×` : `${v}×`;
}
