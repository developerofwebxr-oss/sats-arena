/**
 * score.js — round scoring and persistent best score.
 *
 * Tracks hits and misses for the current round.
 * Best score (hits) persisted in localStorage so it survives page refresh.
 *
 * Public API:
 *   recordHit()       — call from shoot.js on a confirmed hit
 *   recordMiss()      — call from shoot.js on a confirmed miss
 *   getRoundStats()   — returns { hits, misses, accuracy } for the current round
 *   resetRound()      — zeroes counters for a new round (called on reload)
 *   getBestScore()    — returns all-time best hit count from localStorage
 */

const STORAGE_KEY = 'satsArena_bestScore';

let hits   = 0;
let misses = 0;

export function recordHit() {
  hits += 1;
}

export function recordMiss() {
  misses += 1;
}

/**
 * Returns stats for the current round.
 * accuracy is 0 if no shots have been fired yet.
 */
export function getRoundStats() {
  const total    = hits + misses;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  return { hits, misses, accuracy };
}

/**
 * Saves the round's hit count if it's a new best, then resets counters.
 * Call this when the player reloads to start a fresh round.
 */
export function resetRound() {
  // Persist best score before wiping the round.
  const prev = getBestScore();
  if (hits > prev) {
    localStorage.setItem(STORAGE_KEY, String(hits));
  }
  hits   = 0;
  misses = 0;
}

/** Returns the all-time best hit count, or 0 if never set. */
export function getBestScore() {
  return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
}
