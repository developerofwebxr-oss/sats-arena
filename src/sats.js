/**
 * sats.js — the upgrade-currency balance.
 *
 * Free-to-play: shooting no longer costs sats. Sats are now UPGRADE CURRENCY,
 * spent to buy the rapid-fire upgrade (see upgrade.js / hud.js).
 *
 * Isolated from game logic. A future Lightning integration only needs to
 * implement topUp() — nothing else in the codebase changes.
 */

// Internal balance — not exported directly so nothing can mutate it
// accidentally. All reads and writes go through the functions below.
let balance = 21;

/** Return the current sat balance. */
export function getBalance() {
  return balance;
}

/**
 * Spend up to `amount` sats. Returns the amount actually deducted (floors at 0
 * so testing isn't blocked — the upgrade still grants even when broke).
 */
export function deductSats(amount) {
  const spent = Math.min(amount, balance);
  balance -= spent;
  return spent;
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
