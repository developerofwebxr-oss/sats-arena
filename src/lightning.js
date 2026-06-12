/**
 * lightning.js — real Lightning payment controller (frontend side).
 *
 * Talks to the Sats Arena backend (which holds the LNbits Invoice key — never
 * here). Session-centric: a device gets a short code on load, creates invoices
 * against it, and polls the backend for the session's settled-payment count.
 *
 * It only TRACKS payments (getPaidCount). The charge/activation model in hud.js
 * decides when to grant rapid-fire — payments are banked, not auto-fired.
 *
 * Gated by the VITE_LIGHTNING flag.
 *
 * Public API:
 *   isLightningEnabled()   — is the flag on?
 *   getSessionCode()       — current 4-char code (or null)
 *   getPaidCount()         — total settled payments the backend has seen for this code
 *   setupLightning()       — create/rehydrate session + start polling
 *   createInvoice()        — POST a 21-sat invoice, returns { payment_request, payment_hash }
 */

const LIGHTNING_ON = import.meta.env.VITE_LIGHTNING === 'on';
const BACKEND_URL  = (import.meta.env.VITE_BACKEND_URL
  || 'https://sats-arena-production.up.railway.app').replace(/\/+$/, '');

const POLL_MS     = 2500;
const STORAGE_KEY = 'satsArena_sessionCode';

let code      = null;
let paidCount = 0; // latest from the backend for this code

export function isLightningEnabled() { return LIGHTNING_ON; }
export function getSessionCode() { return code; }
export function getPaidCount() { return paidCount; }

/** setupLightning() — call once at startup. Creates/rehydrates a session + polls. */
export async function setupLightning() {
  if (!LIGHTNING_ON) return;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && await sessionExists(stored)) {
    code = stored;
  } else {
    code = await createSession();
    if (code) localStorage.setItem(STORAGE_KEY, code);
  }

  if (code) startPolling();
}

export async function createInvoice() {
  if (!code) throw new Error('no session');
  const res = await fetch(`${BACKEND_URL}/session/${code}/invoice`, { method: 'POST' });
  if (!res.ok) throw new Error(`invoice failed (${res.status})`);
  return res.json(); // { payment_hash, payment_request }
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function createSession() {
  try {
    const res = await fetch(`${BACKEND_URL}/session`, { method: 'POST' });
    const data = await res.json();
    paidCount = 0;
    return data.code;
  } catch (err) {
    console.warn('Lightning: session create failed', err);
    return null;
  }
}

// Returns true if the code is still live; seeds paidCount from the backend.
async function sessionExists(c) {
  try {
    const res = await fetch(`${BACKEND_URL}/session/${c}`);
    const data = await res.json();
    if (data.exists) paidCount = data.paidCount || 0;
    return !!data.exists;
  } catch {
    return false;
  }
}

function startPolling() {
  setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/session/${code}`);
      const data = await res.json();
      if (data.exists && typeof data.paidCount === 'number') {
        paidCount = data.paidCount;
      }
    } catch {
      // transient — try again next tick
    }
  }, POLL_MS);
}
