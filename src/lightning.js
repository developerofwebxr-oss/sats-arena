/**
 * lightning.js — real Lightning payment controller (frontend side).
 *
 * Talks to the Sats Arena backend (which holds the LNbits Invoice key — never
 * here). Session-centric: a device gets a short code on load, creates invoices
 * against it, and polls for settled payments.
 *
 * Gated by the VITE_LIGHTNING flag so the deployed game stays in fake-grant mode
 * until we explicitly flip it on. Same-device flow for now (auto-activate on pay);
 * session-code pairing + activation gate come later.
 *
 * Public API:
 *   isLightningEnabled()        — is the flag on?
 *   getSessionCode()            — current 4-char code (or null)
 *   setupLightning(onPaid)      — create/rehydrate session + start polling
 *   createInvoice()             — POST a 21-sat invoice, returns { payment_request, payment_hash }
 */

const LIGHTNING_ON = import.meta.env.VITE_LIGHTNING === 'on';
const BACKEND_URL  = (import.meta.env.VITE_BACKEND_URL
  || 'https://sats-arena-production.up.railway.app').replace(/\/+$/, '');

const POLL_MS     = 2500;
const STORAGE_KEY = 'satsArena_sessionCode';

let code         = null;
let lastSeenPaid = 0;     // payments already credited locally — don't re-grant on rehydrate
let onPaidCb     = null;

export function isLightningEnabled() { return LIGHTNING_ON; }
export function getSessionCode() { return code; }

/**
 * setupLightning(onPaid) — call once at startup.
 * onPaid() is invoked once per newly-detected payment.
 */
export async function setupLightning(onPaid) {
  onPaidCb = onPaid;
  if (!LIGHTNING_ON) return;

  // Rehydrate a stored code if the backend still knows it; else make a new one.
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
    lastSeenPaid = 0;
    return data.code;
  } catch (err) {
    console.warn('Lightning: session create failed', err);
    return null;
  }
}

// Returns true if the code is still live; also seeds lastSeenPaid so previously
// counted payments aren't replayed after a reload.
async function sessionExists(c) {
  try {
    const res = await fetch(`${BACKEND_URL}/session/${c}`);
    const data = await res.json();
    if (data.exists) lastSeenPaid = data.paidCount || 0;
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
      if (data.exists && typeof data.paidCount === 'number' && data.paidCount > lastSeenPaid) {
        const newPayments = data.paidCount - lastSeenPaid;
        lastSeenPaid = data.paidCount;
        for (let i = 0; i < newPayments; i++) onPaidCb?.();
      }
    } catch {
      // transient — try again next tick
    }
  }, POLL_MS);
}
