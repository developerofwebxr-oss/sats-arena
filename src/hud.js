import { getBalance, topUp } from './sats.js';
import { playReloadSound } from './audio.js';
import { getRoundStats, resetRound, getBestScore } from './score.js';

/**
 * hud.js — all DOM overlays.
 *
 * Manages:
 *   - Sat balance display (top-left)
 *   - End-of-round summary overlay (centre-screen, shown when balance = 0)
 *   - Lightning reload button (inside the summary)
 *   - White flash on reload confirm
 *   - Crosshair opacity
 */

const RELOAD_AMOUNT = 21; // sats per top-up — matches starting balance

let balanceEl;
let summaryOverlay;
let summaryContent;
let flashOverlay;
let crosshair;

// ── Inject CSS animations ──────────────────────────────────────────────────────
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes lightning-pulse {
      0%   { box-shadow: 0 0 12px rgba(247,147,26,0.4), 0 0 24px rgba(247,147,26,0.2); }
      50%  { box-shadow: 0 0 28px rgba(247,147,26,0.9), 0 0 56px rgba(247,147,26,0.5), 0 0 80px rgba(247,147,26,0.2); }
      100% { box-shadow: 0 0 12px rgba(247,147,26,0.4), 0 0 24px rgba(247,147,26,0.2); }
    }
    #reload-btn {
      animation: lightning-pulse 1.2s ease-in-out infinite;
    }
    #flash-overlay {
      transition: opacity 0.15s ease-out;
    }
    /* Divider line inside summary */
    .summary-divider {
      border: none;
      border-top: 1px solid rgba(247,147,26,0.3);
      margin: 14px 0;
    }
    /* Stat row: label left, value right */
    .summary-row {
      display: flex;
      justify-content: space-between;
      gap: 32px;
      margin: 6px 0;
      font-size: 16px;
      letter-spacing: 0.08em;
    }
    .summary-row .val {
      color: #fff;
    }
    .summary-best {
      font-size: 13px;
      letter-spacing: 0.12em;
      opacity: 0.6;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);
}

// ── createHUD ─────────────────────────────────────────────────────────────────

export function createHUD() {
  injectStyles();

  // ── Balance display ────────────────────────────────────────────────────────
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    color: #f7931a;
    font-family: monospace;
    font-size: 18px;
    letter-spacing: 0.08em;
    pointer-events: none;
    user-select: none;
    text-shadow: 0 0 8px #f7931a;
  `;
  balanceEl = document.createElement('div');
  hud.appendChild(balanceEl);
  document.body.appendChild(hud);

  // ── Round summary + reload button (combined overlay) ──────────────────────
  // Hidden until balance hits 0. Contains two sections:
  //   1. Stats summary (hits / misses / accuracy / best)
  //   2. Lightning reload button
  summaryOverlay = document.createElement('div');
  summaryOverlay.id = 'summary-overlay';
  summaryOverlay.style.cssText = `
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: 300px;
    background: rgba(0,0,0,0.92);
    border: 1px solid rgba(247,147,26,0.5);
    color: #f7931a;
    font-family: monospace;
    text-align: center;
    padding: 28px 36px 24px;
    z-index: 100;
    box-shadow: 0 0 40px rgba(247,147,26,0.15);
  `;

  // Stats section — content written dynamically in showRoundSummary().
  summaryContent = document.createElement('div');
  summaryOverlay.appendChild(summaryContent);

  // Divider between stats and reload button.
  const divider = document.createElement('hr');
  divider.className = 'summary-divider';
  summaryOverlay.appendChild(divider);

  // Reload button — lives inside the summary overlay.
  const reloadBtn = document.createElement('button');
  reloadBtn.id = 'reload-btn';
  reloadBtn.innerHTML = `
    <div style="font-size:20px; letter-spacing:0.12em;">⚡ LIGHTNING TOP UP</div>
    <div style="font-size:13px; letter-spacing:0.18em; margin-top:6px; opacity:0.75;">${RELOAD_AMOUNT} SATS &nbsp;·&nbsp; TAP TO CONFIRM</div>
  `;
  reloadBtn.style.cssText = `
    width: 100%;
    margin-top: 4px;
    padding: 16px 24px;
    background: rgba(0,0,0,0.0);
    color: #f7931a;
    border: 1px solid #f7931a;
    font-family: monospace;
    text-align: center;
    cursor: pointer;
    text-shadow: 0 0 10px #f7931a;
  `;

  reloadBtn.addEventListener('mouseenter', () => {
    reloadBtn.style.background = 'rgba(247,147,26,0.12)';
  });
  reloadBtn.addEventListener('mouseleave', () => {
    reloadBtn.style.background = 'rgba(0,0,0,0.0)';
  });

  reloadBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't let the click bubble to the canvas shoot handler

    summaryOverlay.style.display = 'none';
    triggerFlash();
    playReloadSound();

    // Save best score and reset round counters before crediting sats.
    resetRound();
    topUp(RELOAD_AMOUNT);
    updateHUD();
  });

  summaryOverlay.appendChild(reloadBtn);
  document.body.appendChild(summaryOverlay);

  // ── Flash overlay ──────────────────────────────────────────────────────────
  flashOverlay = document.createElement('div');
  flashOverlay.id = 'flash-overlay';
  flashOverlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: white;
    opacity: 0;
    pointer-events: none;
    z-index: 99;
  `;
  document.body.appendChild(flashOverlay);

  // ── Crosshair reference ───────────────────────────────────────────────────
  crosshair = document.getElementById('crosshair');

  updateHUD();
}

// ── showRoundSummary ──────────────────────────────────────────────────────────

function showRoundSummary() {
  const { hits, misses, accuracy } = getRoundStats();
  const best = getBestScore();

  // Build the stats section HTML.
  summaryContent.innerHTML = `
    <div style="font-size:13px; letter-spacing:0.22em; opacity:0.6; margin-bottom:16px;">ROUND OVER</div>

    <div class="summary-row">
      <span>Hits</span>
      <span class="val">${hits}</span>
    </div>
    <div class="summary-row">
      <span>Misses</span>
      <span class="val">${misses}</span>
    </div>
    <div class="summary-row">
      <span>Accuracy</span>
      <span class="val">${accuracy}%</span>
    </div>

    <div class="summary-divider" style="margin-top:14px; margin-bottom:10px;"></div>

    <div class="summary-row summary-best">
      <span>Best&nbsp;score</span>
      <span class="val">${Math.max(hits, best)} hits ⚡</span>
    </div>
  `;

  summaryOverlay.style.display = 'block';
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

// ── updateHUD ─────────────────────────────────────────────────────────────────

export function updateHUD() {
  const bal = getBalance();

  if (bal === 0) {
    balanceEl.textContent      = '⚡ 0 sats';
    balanceEl.style.color      = '#ff4444';
    balanceEl.style.textShadow = '0 0 8px #ff4444';

    if (crosshair) crosshair.style.opacity = '0.25';

    // Show the round summary (which contains the reload button).
    showRoundSummary();

  } else {
    balanceEl.textContent = `⚡ ${bal} sat${bal === 1 ? '' : 's'}`;

    summaryOverlay.style.display = 'none';

    if (crosshair) crosshair.style.opacity = '1';

    if (bal <= 5) {
      // Low warning threshold raised slightly for 21-sat rounds
      balanceEl.style.color      = '#ffaa00';
      balanceEl.style.textShadow = '0 0 8px #ffaa00';
    } else {
      balanceEl.style.color      = '#f7931a';
      balanceEl.style.textShadow = '0 0 8px #f7931a';
    }
  }
}
