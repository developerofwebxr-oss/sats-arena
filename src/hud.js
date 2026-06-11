import { getBalance, deductSats } from './sats.js';
import { playReloadSound } from './audio.js';
import { grantRapidFire, isRapidFire, getRemainingSeconds } from './upgrade.js';

/**
 * hud.js — all DOM overlays.
 *
 * Free-to-play HUD:
 *   - Upgrade-currency balance (top-left)
 *   - Persistent UPGRADE button (top-right) → buys rapid-fire
 *   - Rapid-fire countdown (top-left, under the balance) while active
 *   - White flash on upgrade activation
 *
 * No per-shot cost, no round-over, no reload — shooting is free and unlimited.
 */

const UPGRADE_COST = 21; // fake sats per rapid-fire activation

let balanceEl;
let countdownEl;
let upgradeBtn;
let flashOverlay;
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

  // ── Balance display (top-left) ──────────────────────────────────────────────
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    color: #f7931a;
    font-family: monospace;
    pointer-events: none;
    user-select: none;
    text-shadow: 0 0 8px #f7931a;
  `;

  balanceEl = document.createElement('div');
  balanceEl.style.cssText = 'font-size: 18px; letter-spacing: 0.08em;';

  const balanceLabel = document.createElement('div');
  balanceLabel.textContent = 'UPGRADE CURRENCY';
  balanceLabel.style.cssText = 'font-size: 10px; letter-spacing: 0.18em; opacity: 0.6; margin-top: 2px;';

  // Rapid-fire countdown — hidden unless active. Magenta to match the upgrade.
  countdownEl = document.createElement('div');
  countdownEl.style.cssText = `
    display: none;
    margin-top: 10px;
    font-size: 15px;
    letter-spacing: 0.12em;
    color: #b14bff;
    text-shadow: 0 0 8px #b14bff;
  `;

  hud.append(balanceEl, balanceLabel, countdownEl);
  document.body.appendChild(hud);

  // ── Upgrade button (top-right) ──────────────────────────────────────────────
  // Persistent and always available. Top-right keeps it clear of the balance
  // (top-left), the mode switcher (bottom-centre) and the crosshair (centre).
  upgradeBtn = document.createElement('button');
  upgradeBtn.id = 'upgrade-btn';
  upgradeBtn.innerHTML = `
    <div style="font-size:18px; letter-spacing:0.12em;">⚡ RAPID FIRE</div>
    <div style="font-size:12px; letter-spacing:0.16em; margin-top:5px; opacity:0.8;">${UPGRADE_COST} SATS &nbsp;·&nbsp; 60s</div>
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

    // Spend the fake currency (floors at 0 — testing is never blocked) and grant.
    deductSats(UPGRADE_COST);

    // >>> The single upgrade hook. Real Lightning will call grantRapidFire()
    //     from its payment-confirmation handler instead of this button. <<<
    grantRapidFire();

    triggerFlash();
    playReloadSound(); // reused as the upgrade-activated chime
    updateHUD();
    upgradeBtn.blur(); // drop focus so SPACE shoots instead of re-clicking this
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

  updateHUD();
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
// Refreshes the balance. Call after spending. (Balance no longer changes per
// shot, so the shoot path doesn't touch the HUD anymore.)
export function updateHUD() {
  const bal = getBalance();
  balanceEl.textContent = `⚡ ${bal} sat${bal === 1 ? '' : 's'}`;
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
