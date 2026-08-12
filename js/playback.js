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

/**
 * Scale a base duration: faster speed → shorter wait.
 * min/max are also divided by speed so floors (e.g. ecom HOLD_FLOOR) cannot
 * defeat 4×/8× — otherwise every step stays clamped near the 1× floor.
 *
 * Options:
 * - protectMin: keep `min` as an absolute floor (not divided by speed)
 * - softMaxSpeed: cap the divisor so waits don't collapse at 8× (chat readability)
 */
export function playbackMs(baseMs, { min = 0, max = Number.POSITIVE_INFINITY, protectMin = false, softMaxSpeed = null } = {}) {
  const raw = Number(baseMs);
  const sFull = Math.max(Number(speed) || 1, 0.5);
  const s =
    softMaxSpeed != null && Number.isFinite(Number(softMaxSpeed))
      ? Math.min(sFull, Math.max(1, Number(softMaxSpeed)))
      : sFull;
  const scaledMin = protectMin
    ? Math.max(0, Math.round(Number(min) || 0))
    : Math.max(0, Math.round((Number(min) || 0) / sFull));
  const scaledMax = Number.isFinite(max)
    ? Math.max(scaledMin, Math.round(Number(max) / (protectMin ? 1 : sFull)))
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(raw) || raw <= 0) return scaledMin;
  const scaled = Math.round(raw / s);
  return Math.min(scaledMax, Math.max(scaledMin, scaled));
}

/**
 * Chat / IM dwell — stays readable at 8×, especially for human lines.
 * Soft-caps speed so people can still read bubbles in the chat window.
 */
export function chatPlaybackMs(baseMs = 900, { human = false, chars = 0 } = {}) {
  const s = Math.max(Number(speed) || 1, 0.5);
  const n = Math.max(0, Number(chars) || 0);
  const designed =
    Number(baseMs) > 0
      ? Number(baseMs)
      : human
        ? Math.min(2800, Math.max(900, 520 + n * 26))
        : Math.min(1600, Math.max(420, 280 + n * 14));
  // Never scale chat harder than ~2.4× for humans / ~3.5× for agent.
  const softMax = human ? 2.4 : 3.5;
  const floor = human
    ? s >= 8
      ? 780
      : s >= 4
        ? 900
        : 720
    : s >= 8
      ? 300
      : s >= 4
        ? 380
        : 320;
  return playbackMs(designed, {
    min: floor,
    max: Math.max(designed, floor),
    protectMin: true,
    softMaxSpeed: softMax,
  });
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
