/**
 * upgrade.js — the rapid-fire (rifle) upgrade.
 *
 * Free-to-play model: shooting is free and unlimited. Spending the upgrade
 * currency buys a temporary RAPID-FIRE window — each trigger fires a burst
 * instead of a single shot — for RAPID_DURATION seconds, then reverts.
 *
 * MODULARITY: grantRapidFire() is the single, clean entry point that activates
 * the upgrade. The fake upgrade button calls it today; a real Lightning payment
 * confirmation will call the exact same function later — no gameplay rewrite.
 */

const RAPID_DURATION = 60; // seconds of rapid-fire per activation

// Burst shape used by shoot.js while rapid-fire is active:
// each trigger fires RAPID_BURST shots, RAPID_INTERVAL_MS apart.
export const RAPID_BURST       = 6;
export const RAPID_INTERVAL_MS = 60;

// Seconds of rapid-fire remaining. 0 = normal single-shot mode.
let remaining = 0;

/**
 * grantRapidFire() — activate (or refresh) the rapid-fire window.
 *
 * >>> This is the hook real Lightning plugs into. <<<
 * On a confirmed payment, call grantRapidFire() — nothing else changes.
 */
export function grantRapidFire() {
  remaining = RAPID_DURATION;
}

/** True while rapid-fire is active. Read by shoot.js to decide burst vs single. */
export function isRapidFire() {
  return remaining > 0;
}

/** Whole seconds left, for the HUD countdown. */
export function getRemainingSeconds() {
  return Math.ceil(remaining);
}

/** Total window length, so the HUD can show e.g. progress if it wants. */
export function getDuration() {
  return RAPID_DURATION;
}

/** Tick the countdown each frame. Call from the animation loop. */
export function updateUpgrade(delta) {
  if (remaining > 0) {
    remaining = Math.max(0, remaining - delta);
  }
}
