// ─────────────────────────────────────────────────────────────────────────────
// Sats Arena — Lightning payment backend
//
// A thin, stateless-ish proxy in front of a hosted LNbits wallet. It holds the
// LNbits Invoice/read key (from an env var — NEVER in the repo) and exposes a
// small session-centric API the game frontend talks to. The frontend never sees
// the LNbits key or talks to LNbits directly.
//
// Endpoints:
//   GET  /health                  → { ok: true }
//   POST /session                 → { code }                     create a session
//   GET  /session/:code           → { exists, paidCount }        poll status
//   POST /session/:code/invoice   → { payment_hash, payment_request }  new invoice
//
// State is in-memory (a Map). Good enough for a demo; a restart wipes sessions,
// so avoid redeploying mid-event. A TTL sweep retires idle sessions.
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';

// ── Config (all from env; sensible defaults for everything except the secret) ──
const PORT           = process.env.PORT || 8080;
const LNBITS_URL     = (process.env.LNBITS_URL || '').replace(/\/+$/, ''); // strip trailing slash
const INVOICE_KEY    = process.env.LNBITS_INVOICE_KEY || '';
const INVOICE_AMOUNT = parseInt(process.env.INVOICE_AMOUNT || '21', 10);
// Comma-separated list of allowed browser origins. Defaults to the live game.
// Add http(s)://localhost:5173 here in Railway while testing from a dev server.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://developerofwebxr-oss.github.io')
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!LNBITS_URL || !INVOICE_KEY) {
  console.warn('⚠  LNBITS_URL and/or LNBITS_INVOICE_KEY are not set — invoice routes will fail until they are.');
}

// ── Session store ──────────────────────────────────────────────────────────────
// code → { code, createdAt, lastSeen, paidCount, openInvoices: [hash...] }
const sessions = new Map();
// payment_hash → code (handy for debugging / a future webhook path)
const paymentToCode = new Map();

const TTL_MS       = 2 * 60 * 60 * 1000; // 2h of inactivity before a session is dropped
const SWEEP_MS     = 60 * 1000;          // run the cleanup once a minute

// 4-char codes from an unambiguous alphabet (no 0/O/1/I/L). ~31^4 ≈ 920k codes.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (sessions.has(code)); // guarantee uniqueness among live sessions
  return code;
}

// ── LNbits helpers ─────────────────────────────────────────────────────────────
async function lnbitsCreateInvoice(amount, memo) {
  const res = await fetch(`${LNBITS_URL}/api/v1/payments`, {
    method: 'POST',
    headers: { 'X-Api-Key': INVOICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ out: false, amount, memo }),
  });
  if (!res.ok) {
    throw new Error(`LNbits create invoice failed (${res.status}): ${await res.text()}`);
  }
  // → { payment_hash, payment_request, checking_id, ... }
  return res.json();
}

async function lnbitsIsPaid(paymentHash) {
  const res = await fetch(`${LNBITS_URL}/api/v1/payments/${paymentHash}`, {
    headers: { 'X-Api-Key': INVOICE_KEY },
  });
  if (!res.ok) {
    throw new Error(`LNbits check failed (${res.status})`);
  }
  const data = await res.json(); // → { paid: bool, ... }
  return data.paid === true;
}

// ── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors({
  origin(origin, cb) {
    // Allow same-origin / non-browser callers (curl, wallets) which send no Origin.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin not allowed: ${origin}`));
  },
}));

app.get('/', (_req, res) => res.type('text').send('Sats Arena backend — ok'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Create a new session → returns its 4-char code.
app.post('/session', (_req, res) => {
  const code = makeCode();
  const now = Date.now();
  sessions.set(code, { code, createdAt: now, lastSeen: now, paidCount: 0, openInvoices: [] });
  res.json({ code });
});

// Poll a session's status. Side-effect: checks LNbits for any open invoices and
// bumps paidCount for the ones that settled. This is how repeat payments are seen.
app.get('/session/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const session = sessions.get(code);
  if (!session) return res.json({ exists: false });

  session.lastSeen = Date.now();

  // Check each still-open invoice; move settled ones out and count them.
  const stillOpen = [];
  for (const hash of session.openInvoices) {
    try {
      if (await lnbitsIsPaid(hash)) {
        session.paidCount += 1;
      } else {
        stillOpen.push(hash);
      }
    } catch (err) {
      // On a transient LNbits error, keep the invoice open and try again next poll.
      console.error('check error', err.message);
      stillOpen.push(hash);
    }
  }
  session.openInvoices = stillOpen;

  res.json({ exists: true, paidCount: session.paidCount });
});

// Create a 21-sat invoice tied to a session code.
app.post('/session/:code/invoice', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const session = sessions.get(code);
  if (!session) return res.status(404).json({ error: 'session not found' });

  try {
    const inv = await lnbitsCreateInvoice(INVOICE_AMOUNT, `Sats Arena rapid-fire (${code})`);
    session.openInvoices.push(inv.payment_hash);
    session.lastSeen = Date.now();
    paymentToCode.set(inv.payment_hash, code);
    res.json({ payment_hash: inv.payment_hash, payment_request: inv.payment_request });
  } catch (err) {
    console.error('invoice error', err.message);
    res.status(502).json({ error: 'failed to create invoice' });
  }
});

// ── TTL sweep ──────────────────────────────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [code, s] of sessions) {
    if (s.lastSeen < cutoff) {
      for (const hash of s.openInvoices) paymentToCode.delete(hash);
      sessions.delete(code);
    }
  }
}, SWEEP_MS);

app.listen(PORT, () => console.log(`Sats Arena backend listening on :${PORT}`));
