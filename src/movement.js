/**
 * movement.js — camera rotation for desktop, mobile, and gyroscope.
 *
 * Desktop:
 *   - Mouse drag (click+drag) → yaw + pitch
 *   - Arrow keys → yaw + pitch (held, frame-rate independent)
 *
 * Mobile:
 *   - DeviceOrientation (gyroscope) → yaw + pitch
 *   - iOS requires a permission button on first gesture
 *   - Fallback virtual joystick if gyro unavailable or denied
 *
 * Quest:
 *   - No-op. WebXR head tracking overrides the camera automatically.
 *
 * Public API:
 *   setupMovement(camera, renderer) → { updateMovement(delta) }
 *   isDragging()                    → boolean — read by input.js to suppress shots during drag
 */

// ── Constants ──────────────────────────────────────────────────────────────────
const DRAG_THRESHOLD  = 4;       // pixels of mouse movement before drag mode engages
const MOUSE_SPEED     = 0.003;   // radians per pixel
const KEY_SPEED       = 1.2;     // radians per second for arrow keys
const JOYSTICK_SPEED  = 1.4;     // radians per second at full joystick deflection
const PITCH_MIN       = -0.7;    // radians — don't look too far down
const PITCH_MAX       = 0.7;     // radians — don't look too far up
const JOYSTICK_RADIUS = 48;      // px — half-width of the joystick base circle

// ── Shared camera state ────────────────────────────────────────────────────────
// We own yaw and pitch as plain numbers and write them to camera.rotation each frame.
// YXZ order = yaw around world Y first, then pitch around local X — standard FPS.
let yaw   = 0;
let pitch = -0.2; // matches the initial tilt that was in scene.js

// ── Drag flag (read by input.js) ───────────────────────────────────────────────
let _dragging = false;
export function isDragging() { return _dragging; }

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
    setupGyroOrJoystick(camera, updaters, renderer);
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

// ── Gyroscope or joystick (mobile) ────────────────────────────────────────────
function setupGyroOrJoystick(camera, updaters, renderer) {
  // Try gyroscope first. If iOS, we need a permission button.
  // If not available at all, fall straight through to joystick.

  if (typeof DeviceOrientationEvent === 'undefined') {
    // No gyro API — show joystick immediately.
    updaters.push(setupJoystick());
    return;
  }

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ — must request permission on a user gesture.
    showMotionButton(updaters);
  } else {
    // Android and others — no permission needed, start gyro directly.
    const gyroUpdater = setupGyro();
    if (gyroUpdater) {
      updaters.push(gyroUpdater);
    } else {
      updaters.push(setupJoystick());
    }
  }
}

// ── iOS motion permission button ───────────────────────────────────────────────
function showMotionButton(updaters) {
  const btn = document.createElement('button');
  btn.textContent = '⚡ Enable Motion Controls';
  btn.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    background: rgba(0,0,0,0.85);
    color: #f7931a;
    border: 1px solid #f7931a;
    font-family: monospace;
    font-size: 15px;
    letter-spacing: 0.08em;
    cursor: pointer;
    z-index: 100;
    text-shadow: 0 0 8px #f7931a;
  `;

  btn.addEventListener('click', async () => {
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      btn.remove();
      if (response === 'granted') {
        updaters.push(setupGyro());
      } else {
        // Permission denied — fall back to joystick.
        updaters.push(setupJoystick());
      }
    } catch {
      btn.remove();
      updaters.push(setupJoystick());
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
  let gotEvent  = false;

  window.addEventListener('deviceorientation', (e) => {
    if (e.beta === null) return; // sensor not available

    if (baseBeta === null) {
      // First event — store the natural resting position as the zero point.
      baseBeta  = e.beta;
      baseAlpha = e.alpha;
    }

    // beta  = device tilt forward/back (-180 to 180) → camera pitch
    // alpha = compass heading (0–360) → camera yaw
    // We use deltas from the calibration baseline so any holding angle is neutral.
    gyroPitch = ((e.beta  - baseBeta)  * Math.PI) / 180;
    gyroYaw   = ((e.alpha - baseAlpha) * Math.PI) / 180;

    gotEvent = true;
  });

  // Give it 300ms to see if events actually arrive (some devices report the API
  // but never fire events). If nothing comes, the caller can add joystick instead.
  // We return the updater immediately; it's a no-op until gotEvent = true.
  return (_delta) => {
    if (!gotEvent) return;
    // Write gyro values into the shared yaw/pitch that updateMovement() applies.
    yaw   = -gyroYaw;   // negate so turning right increases yaw correctly
    pitch = gyroPitch * 0.5; // scale down — raw beta range is too sensitive
  };
}

// ── Virtual joystick ──────────────────────────────────────────────────────────
function setupJoystick() {
  // Base circle (stationary) and knob (moves with thumb).
  const base = document.createElement('div');
  base.style.cssText = `
    position: fixed;
    bottom: 40px;
    left: 40px;
    width: ${JOYSTICK_RADIUS * 2}px;
    height: ${JOYSTICK_RADIUS * 2}px;
    border-radius: 50%;
    background: rgba(247,147,26,0.08);
    border: 1px solid rgba(247,147,26,0.4);
    touch-action: none;
    z-index: 100;
  `;

  const knob = document.createElement('div');
  knob.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(247,147,26,0.6);
    transform: translate(-50%, -50%);
    pointer-events: none;
  `;

  base.appendChild(knob);
  document.body.appendChild(base);

  // Joystick state — normalised direction [-1, 1] per axis.
  let joyX = 0;
  let joyY = 0;
  let activeTouchId = null; // track which touch finger owns the joystick

  base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    activeTouchId = touch.identifier;
    updateKnob(touch);
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (activeTouchId === null) return;
    for (const touch of e.changedTouches) {
      if (touch.identifier !== activeTouchId) continue;
      e.preventDefault();
      updateKnob(touch);
    }
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier !== activeTouchId) continue;
      activeTouchId = null;
      joyX = joyY = 0;
      // Return knob to centre.
      knob.style.transform = 'translate(-50%, -50%)';
    }
  });

  function updateKnob(touch) {
    const rect  = base.getBoundingClientRect();
    const centreX = rect.left + JOYSTICK_RADIUS;
    const centreY = rect.top  + JOYSTICK_RADIUS;
    let dx = touch.clientX - centreX;
    let dy = touch.clientY - centreY;

    // Clamp to joystick radius.
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > JOYSTICK_RADIUS) {
      dx *= JOYSTICK_RADIUS / dist;
      dy *= JOYSTICK_RADIUS / dist;
    }

    // Normalise to [-1, 1].
    joyX = dx / JOYSTICK_RADIUS;
    joyY = dy / JOYSTICK_RADIUS;

    // Move knob visually.
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  return (delta) => {
    yaw   -= joyX * JOYSTICK_SPEED * delta;
    pitch += joyY * JOYSTICK_SPEED * delta;
  };
}
