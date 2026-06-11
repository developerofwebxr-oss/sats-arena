/**
 * movement.js — camera rotation for desktop, mobile, and gyroscope.
 *
 * Desktop:
 *   - Mouse drag (click+drag) → yaw + pitch
 *   - Arrow keys → yaw + pitch (held, frame-rate independent)
 *
 * Mobile:
 *   - Touch-drag to look — always available, so the phone is playable even
 *     before / without motion permission.
 *   - DeviceOrientation (gyroscope) → yaw + pitch, layered on top once granted.
 *   - iOS requires a permission button on first gesture; if denied or
 *     unavailable, touch-drag remains the look control.
 *
 * Quest:
 *   - No-op. WebXR head tracking overrides the camera automatically.
 *
 * Public API:
 *   setupMovement(camera, renderer) → { updateMovement(delta) }
 *   isDragging()                    → boolean — read by input.js to suppress shots during drag
 */

// ── Constants ──────────────────────────────────────────────────────────────────
const DRAG_THRESHOLD  = 4;       // pixels of movement before drag mode engages
const MOUSE_SPEED     = 0.003;   // radians per pixel (mouse)
const TOUCH_SPEED     = 0.004;   // radians per pixel (finger drag)
const KEY_SPEED       = 1.2;     // radians per second for arrow keys
const PITCH_MIN       = -0.7;    // radians — don't look too far down
const PITCH_MAX       = 0.7;     // radians — don't look too far up

// ── Shared camera state ────────────────────────────────────────────────────────
// We own yaw and pitch as plain numbers and write them to camera.rotation each frame.
// YXZ order = yaw around world Y first, then pitch around local X — standard FPS.
let yaw   = 0;
let pitch = -0.2; // matches the initial tilt that was in scene.js

// ── Drag flag (read by input.js) ───────────────────────────────────────────────
let _dragging = false;
export function isDragging() { return _dragging; }

// True once the gyroscope is actively driving the view. While true, touch-drag
// look stands down so the two don't fight over yaw/pitch.
let gyroActive = false;

// ── Main setup ─────────────────────────────────────────────────────────────────
export function setupMovement(camera, renderer) {
  // YXZ rotation order is required for correct FPS-style camera behaviour.
  // With default 'XYZ', yaw and pitch interact and produce roll — feels wrong.
  camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, yaw, 0);

  const isMobile = 'ontouchstart' in window;

  // Update functions collected here; called each frame by updateMovement().
  const updaters = [];

  if (!isMobile) {
    // ── Desktop ───────────────────────────────────────────────────────────────
    updaters.push(setupMouseDrag(camera));
    updaters.push(setupArrowKeys(camera));
  } else {
    // ── Mobile ────────────────────────────────────────────────────────────────
    // Touch-drag look is always on (the reliable fallback). Gyro layers on top
    // when available/granted and takes over via the gyroActive flag.
    updaters.push(setupTouchLook(renderer));
    setupMobileGyro(updaters, renderer);
  }

  function updateMovement(delta) {
    // Skip all movement handling while inside a VR session —
    // the XR manager drives the camera pose directly.
    if (renderer.xr.isPresenting) return;

    updaters.forEach(fn => fn(delta));

    // Clamp pitch and write final rotation to camera every frame.
    pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
    camera.rotation.set(pitch, yaw, 0);
  }

  return { updateMovement };
}

// ── Mouse drag ─────────────────────────────────────────────────────────────────
function setupMouseDrag(camera) {
  let mouseDown  = false;
  let startX     = 0;
  let startY     = 0;
  let lastX      = 0;
  let lastY      = 0;

  window.addEventListener('mousedown', (e) => {
    // Only left button.
    if (e.button !== 0) return;
    mouseDown = true;
    _dragging = false;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;

    const totalDX = e.clientX - startX;
    const totalDY = e.clientY - startY;

    // Promote to drag once the threshold is exceeded.
    if (!_dragging && Math.sqrt(totalDX * totalDX + totalDY * totalDY) >= DRAG_THRESHOLD) {
      _dragging = true;
    }

    if (_dragging) {
      // Delta from last frame's mouse position, not from drag start,
      // so rotation feels continuous rather than snapping.
      yaw   -= (e.clientX - lastX) * MOUSE_SPEED;
      pitch -= (e.clientY - lastY) * MOUSE_SPEED;
    }

    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    mouseDown = false;
    // Leave _dragging = true until the next frame so input.js's 'click'
    // handler (which fires after mouseup) can read it and skip the shot.
    // We reset it on the next mousedown instead.
  });

  // No per-frame work needed — all state is updated in event handlers above.
  return (_delta) => {};
}

// ── Arrow keys ─────────────────────────────────────────────────────────────────
function setupArrowKeys() {
  const keys = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };

  window.addEventListener('keydown', (e) => {
    if (e.code in keys) {
      keys[e.code] = true;
      e.preventDefault(); // stop the page from scrolling
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code in keys) keys[e.code] = false;
  });

  return (delta) => {
    if (keys.ArrowLeft)  yaw   += KEY_SPEED * delta;
    if (keys.ArrowRight) yaw   -= KEY_SPEED * delta;
    if (keys.ArrowUp)    pitch -= KEY_SPEED * delta;
    if (keys.ArrowDown)  pitch += KEY_SPEED * delta;
  };
}

// ── Touch-drag look (mobile, always available) ────────────────────────────────
// Drag a finger on the canvas to rotate the view — the reliable fallback that
// works with or without gyro. Stands down while gyroActive so they don't fight.
// Listeners are passive (no preventDefault) so they never suppress button taps.
function setupTouchLook(renderer) {
  let touchId = null;
  let startX = 0, startY = 0, lastX = 0, lastY = 0;

  window.addEventListener('touchstart', (e) => {
    if (renderer.xr.isPresenting || gyroActive) return;
    // Only look-drag on the game canvas — taps on UI buttons are left alone.
    if (e.target !== renderer.domElement) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    _dragging = false;
    startX = lastX = t.clientX;
    startY = lastY = t.clientY;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (touchId === null || gyroActive) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;

      // Promote to a drag once past the threshold (so a tap stays a tap = shot).
      const totalDX = t.clientX - startX;
      const totalDY = t.clientY - startY;
      if (!_dragging && Math.hypot(totalDX, totalDY) >= DRAG_THRESHOLD) {
        _dragging = true;
      }
      if (_dragging) {
        yaw   -= (t.clientX - lastX) * TOUCH_SPEED;
        pitch -= (t.clientY - lastY) * TOUCH_SPEED;
      }
      lastX = t.clientX;
      lastY = t.clientY;
    }
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;
      touchId = null;
      // Leave _dragging set until the next touchstart so input.js's touchend
      // (which runs in the same gesture) can read it and skip the shot.
    }
  });

  // All work happens in the event handlers; no per-frame update needed.
  return (_delta) => {};
}

// ── Mobile gyro setup ──────────────────────────────────────────────────────────
function setupMobileGyro(updaters, renderer) {
  if (typeof DeviceOrientationEvent === 'undefined') return; // touch-drag is the fallback

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ — must request permission from a user gesture (the button).
    showMotionButton(updaters);
  } else {
    // Android and others — no permission needed; start gyro directly.
    updaters.push(setupGyro());
  }
}

// ── iOS motion permission prompt ───────────────────────────────────────────────
// Centred prompt with a high z-index so nothing overlaps/steals the tap. Removed
// after the choice; if denied or it errors, touch-drag look remains in control.
function showMotionButton(updaters) {
  const btn = document.createElement('button');
  btn.id = 'motion-btn';
  btn.textContent = '⚡ Enable Motion Controls';
  btn.style.cssText = `
    position: fixed;
    top: 42%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 16px 26px;
    background: rgba(0,0,0,0.9);
    color: #f7931a;
    border: 1px solid #f7931a;
    font-family: monospace;
    font-size: 15px;
    letter-spacing: 0.08em;
    cursor: pointer;
    z-index: 300;
    text-shadow: 0 0 8px #f7931a;
    box-shadow: 0 0 24px rgba(247,147,26,0.3);
  `;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      btn.remove();
      if (response === 'granted') {
        updaters.push(setupGyro());
      }
      // If denied, do nothing — touch-drag look is already active.
    } catch {
      btn.remove(); // touch-drag look remains
    }
  });

  document.body.appendChild(btn);
}

// ── Gyroscope ──────────────────────────────────────────────────────────────────
function setupGyro() {
  let baseAlpha = null; // calibration baseline — set on first event
  let baseBeta  = null;
  let gyroYaw   = 0;
  let gyroPitch = 0;

  window.addEventListener('deviceorientation', (e) => {
    if (e.beta === null) return; // sensor not available

    if (baseBeta === null) {
      // First event — store the natural resting position as the zero point.
      baseBeta  = e.beta;
      baseAlpha = e.alpha;
    }

    // beta  = device tilt forward/back (-180 to 180) → camera pitch
    // alpha = compass heading (0–360) → camera yaw
    // Deltas from the calibration baseline so any holding angle is neutral.
    gyroPitch = ((e.beta  - baseBeta)  * Math.PI) / 180;
    gyroYaw   = ((e.alpha - baseAlpha) * Math.PI) / 180;

    // First real reading — gyro takes over; touch-drag look stands down.
    gyroActive = true;
  });

  // No-op until the first event arrives (gyroActive flips it on).
  return (_delta) => {
    if (!gyroActive) return;
    // Both axes inverted so phone motion matches scene motion naturally:
    // tilt left → scene goes left, tilt up → scene goes up.
    yaw   = gyroYaw;
    pitch = -gyroPitch * 0.5; // scale pitch down — raw beta range is too sensitive
  };
}
