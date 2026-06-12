import QRCode from 'qrcode';
import { playReloadSound } from './audio.js';
import { grantRapidFire, isRapidFire, getRemainingSeconds } from './upgrade.js';
import { isLightningEnabled, getSessionCode, createInvoice } from './lightning.js';

/**
 * hud.js — all DOM overlays.
 *
 * Free-to-play HUD (no balance / currency):
 *   - RAPID FIRE purchase button (top-right) → one tap buys 60s of rapid-fire
 *   - Rapid-fire countdown (top-left) while active
 *   - White flash on activation
 *   - On-screen SHOOT button (bottom-right)
 *
 * Shooting is free and unlimited. The upgrade purchase IS the upgrade — there's
 * nothing to deduct from.
 */

const RAPID_FIRE_PRICE = 21; // sats — display + (later) the Lightning invoice amount

let countdownEl;
let upgradeBtn;
let flashOverlay;
let payModal;       // payment QR overlay
let payModalQr;     // <img> for the QR
let payModalCode;   // session code line
let payModalStatus; // "waiting…" / error line
let lastShownSecond = -1; // so the countdown only re-renders when it changes

// ── Styles ─────────────────────────────────────────────────────────────────
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes lightning-pulse {
      0%   { box-shadow: 0 0 12px rgba(247,147,26,0.4), 0 0 24px rgba(247,147,26,0.2); }
      50%  { box-shadow: 0 0 28px rgba(247,147,26,0.9), 0 0 56px rgba(247,147,26,0.5); }
      100% { box-shadow: 0 0 12px rgba(247,147,26,0.4), 0 0 24px rgba(247,147,26,0.2); }
    }
    #upgrade-btn { animation: lightning-pulse 1.4s ease-in-out infinite; }
    #upgrade-btn.active {
      /* While rapid-fire is running, the button glows magenta to show it's live. */
      animation: none;
      border-color: #b14bff;
      color: #b14bff;
      text-shadow: 0 0 10px #b14bff;
      box-shadow: 0 0 24px rgba(177,75,255,0.6);
    }
    #flash-overlay { transition: opacity 0.15s ease-out; }

    /* Narrow phones: shrink the corner buttons so they don't crowd the top row
       or collide with the bottom controls. */
    @media (max-width: 480px) {
      #upgrade-btn { padding: 9px 12px; top: 12px; right: 12px; }
      #upgrade-btn > div:first-child { font-size: 14px !important; }
      #upgrade-btn > div:last-child  { font-size: 10px !important; }
      #shoot-btn { padding: 12px 18px; font-size: 16px; bottom: 92px; right: 14px; }
    }
  `;
  document.head.appendChild(style);
}

// ── createHUD ─────────────────────────────────────────────────────────────────

export function createHUD(onShoot) {
  injectStyles();

  // ── Rapid-fire countdown (top-left) ─────────────────────────────────────────
  // Hidden unless active. Magenta to match the upgrade.
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    font-family: monospace;
    pointer-events: none;
    user-select: none;
  `;

  countdownEl = document.createElement('div');
  countdownEl.style.cssText = `
    display: none;
    font-size: 15px;
    letter-spacing: 0.12em;
    color: #b14bff;
    text-shadow: 0 0 8px #b14bff;
  `;

  hud.append(countdownEl);
  document.body.appendChild(hud);

  // ── RAPID FIRE purchase button (top-right) ──────────────────────────────────
  // One tap = buy 60s of rapid-fire. Shows the price. Top-right keeps it clear of
  // the countdown (top-left), the mode switcher (bottom-centre) and the crosshair.
  upgradeBtn = document.createElement('button');
  upgradeBtn.id = 'upgrade-btn';
  upgradeBtn.innerHTML = `
    <div style="font-size:18px; letter-spacing:0.12em;">⚡ RAPID FIRE</div>
    <div style="font-size:12px; letter-spacing:0.16em; margin-top:5px; opacity:0.8;">${RAPID_FIRE_PRICE} sats &nbsp;·&nbsp; 60s</div>
  `;
  upgradeBtn.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    padding: 14px 22px;
    background: rgba(0,0,0,0.8);
    color: #f7931a;
    border: 1px solid #f7931a;
    font-family: monospace;
    text-align: center;
    cursor: pointer;
    text-shadow: 0 0 10px #f7931a;
    z-index: 200;
  `;

  upgradeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't let the click reach the canvas shoot handler
    purchaseRapidFire();
    upgradeBtn.blur();   // drop focus so SPACE shoots instead of re-clicking this
  });

  document.body.appendChild(upgradeBtn);

  // ── On-screen SHOOT button (bottom-right) ───────────────────────────────────
  // For mouse-less / touch play. Fires through the centre crosshair — NDC (0,0) —
  // reusing the same fire path as click/tap/space, so it respects rapid-fire too.
  const shootBtn = document.createElement('button');
  shootBtn.id = 'shoot-btn';
  shootBtn.textContent = '◎ SHOOT';
  // Raised above the bottom-centre mode switcher so they never overlap, even on
  // a ~390px portrait phone (switcher sits at bottom ~20–84px; SHOOT floats above).
  shootBtn.style.cssText = `
    position: fixed;
    bottom: 96px;
    right: 20px;
    padding: 16px 26px;
    background: rgba(0,0,0,0.8);
    color: #00e5ff;
    border: 1px solid #00e5ff;
    font-family: monospace;
    font-size: 18px;
    letter-spacing: 0.1em;
    cursor: pointer;
    text-shadow: 0 0 8px #00e5ff;
    z-index: 200;
  `;
  shootBtn.addEventListener('click', (e) => {
    e.stopPropagation();   // don't also fire via the window tap handler
    if (onShoot) onShoot(0, 0);
    shootBtn.blur();       // drop focus so SPACE doesn't re-click this button
  });
  document.body.appendChild(shootBtn);

  // ── Flash overlay ──────────────────────────────────────────────────────────
  flashOverlay = document.createElement('div');
  flashOverlay.id = 'flash-overlay';
  flashOverlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: white;
    opacity: 0;
    pointer-events: none;
    z-index: 199;
  `;
  document.body.appendChild(flashOverlay);

  buildPaymentModal();
}

// ── Payment modal (QR) ──────────────────────────────────────────────────────
// Shown when paying with real Lightning: QR + copyable invoice + waiting state.
function buildPaymentModal() {
  payModal = document.createElement('div');
  payModal.id = 'pay-modal';
  payModal.style.cssText = `
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.88);
    z-index: 300;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-family: monospace;
    color: #f7931a;
    text-align: center;
    padding: 24px;
  `;

  const title = document.createElement('div');
  title.textContent = '⚡ PAY 21 SATS';
  title.style.cssText = 'font-size: 20px; letter-spacing: 0.12em; text-shadow: 0 0 8px #f7931a;';

  payModalCode = document.createElement('div');
  payModalCode.style.cssText = 'font-size: 12px; letter-spacing: 0.18em; opacity: 0.7;';

  // White card behind the QR so it scans reliably.
  const qrCard = document.createElement('div');
  qrCard.style.cssText = 'background:#fff; padding:12px; border-radius:6px; line-height:0;';
  payModalQr = document.createElement('img');
  payModalQr.width = 240;
  payModalQr.height = 240;
  payModalQr.alt = 'Lightning invoice QR';
  qrCard.appendChild(payModalQr);

  payModalStatus = document.createElement('div');
  payModalStatus.textContent = '⏳ waiting for payment…';
  payModalStatus.style.cssText = 'font-size: 14px; letter-spacing: 0.08em;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.style.cssText = `
    margin-top: 6px; padding: 10px 20px; background: transparent;
    color: #888; border: 1px solid #555; font-family: monospace;
    letter-spacing: 0.1em; cursor: pointer;
  `;
  cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); closePaymentModal(); cancelBtn.blur(); });

  payModal.append(title, payModalCode, qrCard, payModalStatus, cancelBtn);
  document.body.appendChild(payModal);
}

async function showPaymentModal(invoice) {
  const code = getSessionCode();
  payModalCode.textContent = code ? `session ${code}` : '';
  payModalStatus.textContent = '⏳ waiting for payment…';
  payModalStatus.style.color = '#f7931a';
  payModal.style.display = 'flex';

  try {
    // Uppercase the bech32 invoice for QR alphanumeric mode → less dense, easier scan.
    payModalQr.src = await QRCode.toDataURL(invoice.toUpperCase(), { margin: 1, width: 240 });
  } catch {
    payModalStatus.textContent = 'could not render QR — invoice copied below';
  }
}

function closePaymentModal() {
  payModal.style.display = 'none';
}

// ── purchaseRapidFire ───────────────────────────────────────────────────────
// Flag OFF → instant fake grant (safe fallback / what ships until we flip it on).
// Flag ON  → real Lightning: create a 21-sat invoice, show the QR, and wait. The
//   lightning poll detects payment and calls handlePaymentConfirmed() (below).
async function purchaseRapidFire() {
  if (!isLightningEnabled()) {
    grantRapidFire();
    triggerFlash();
    playReloadSound();
    return;
  }

  try {
    const { payment_request } = await createInvoice();
    showPaymentModal(payment_request);
  } catch (err) {
    console.warn('purchase failed', err);
    if (payModalStatus) {
      payModal.style.display = 'flex';
      payModalStatus.textContent = 'could not reach payment server — try again';
      payModalStatus.style.color = '#ff4444';
    }
  }
}

// ── handlePaymentConfirmed ──────────────────────────────────────────────────
// Wired to lightning.js's onPaid. Same-device flow auto-activates on payment.
// grantRapidFire() stays the single entry point — real payment now drives it.
export function handlePaymentConfirmed() {
  closePaymentModal();
  grantRapidFire();
  triggerFlash();
  playReloadSound();
}

// ── triggerFlash ──────────────────────────────────────────────────────────────
function triggerFlash() {
  flashOverlay.style.transition = 'none';
  flashOverlay.style.opacity    = '0.85';
  requestAnimationFrame(() => {
    flashOverlay.style.transition = 'opacity 0.4s ease-out';
    flashOverlay.style.opacity    = '0';
  });
}

// ── updateRapidFireHUD ──────────────────────────────────────────────────────
// Called every frame from main.js. Shows/hides the countdown and toggles the
// upgrade button's active glow. Only re-renders text when the second changes.
export function updateRapidFireHUD() {
  const active = isRapidFire();

  upgradeBtn.classList.toggle('active', active);

  if (active) {
    const secs = getRemainingSeconds();
    if (secs !== lastShownSecond) {
      lastShownSecond = secs;
      const m = Math.floor(secs / 60);
      const s = String(secs % 60).padStart(2, '0');
      countdownEl.textContent = `▶ RAPID FIRE ${m}:${s}`;
    }
    countdownEl.style.display = 'block';
  } else if (lastShownSecond !== -1) {
    // Just expired — hide once.
    lastShownSecond = -1;
    countdownEl.style.display = 'none';
  }
}
