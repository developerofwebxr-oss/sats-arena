/**
 * sats.js — the entire sat economy lives here.
 *
 * This module is intentionally isolated from all game logic.
 * Phase 3 (shooting) will call deductSat() before firing.
 * A future Lightning integration only needs to implement topUp()
 * — nothing else in the codebase changes.
 */

// Internal balance — not exported directly so nothing can mutate it
// accidentally. All reads and writes go through the functions below.
let balance = 21;

/** Return the current sat balance. */
export function getBalance() {
  return balance;
}

/**
 * Spend 1 sat. Returns true if the shot is allowed, false if broke.
 * The caller decides what to do on false (e.g. block the shot, show UI).
 */
export function deductSat() {
  if (balance <= 0) return false;
  balance -= 1;
  return true;
}

/**
 * Add sats to the balance.
 * Stub for now — a real Lightning payment would call this after
 * a successful invoice settlement.
 *
 * @param {number} amount  Number of sats to credit.
 */
export function topUp(amount) {
  // TODO: verify a real Lightning payment receipt before crediting.
  console.log(`Lightning payment would go here. Would top up ${amount} sats.`);
  balance += amount;
}
