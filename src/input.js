/**
 * input.js — desktop mouse and mobile touch shooting input.
 *
 * Desktop: fires on 'click', but only if movement.js is not in drag mode.
 *   A short click = shoot. A drag = look around (handled in movement.js).
 *
 * Mobile: fires on 'touchend'. The joystick in movement.js claims its own
 *   touch by identifier, so only non-joystick touches reach here.
 *
 * XR: controller trigger / handheld screen tap → xr.js → shootFromRay.
 *   The flat path below is disabled during any immersive session so it can't
 *   double-fire or raycast with the wrong (flat) camera in VR/AR.
 */

import { isDragging } from './movement.js';

export function setupInput(onShoot, renderer) {
  // True while in an immersive XR session (VR or AR). In that case shooting is
  // owned by xr.js, so the flat mouse/touch handlers must stand down.
  const inXR = () => renderer.xr.isPresenting;

  // ── Mouse click (desktop) ─────────────────────────────────────────────────
  window.addEventListener('click', (e) => {
    if (inXR()) return;

    // If the mouse was dragged to rotate the camera, don't shoot.
    // isDragging() is set by movement.js based on the 4px movement threshold.
    if (isDragging()) return;

    const ndcX =  (e.clientX / window.innerWidth)  * 2 - 1;
    const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
    onShoot(ndcX, ndcY);
  });

  // ── Touch tap (mobile) ────────────────────────────────────────────────────
  // preventDefault stops the browser firing a synthetic 'click' after touchend.
  window.addEventListener('touchend', (e) => {
    if (inXR()) return; // handheld AR taps are handled by xr.js (screen input)

    e.preventDefault();
    const touch = e.changedTouches[0];
    const ndcX =  (touch.clientX / window.innerWidth)  * 2 - 1;
    const ndcY = -(touch.clientY / window.innerHeight) * 2 + 1;
    onShoot(ndcX, ndcY);
  }, { passive: false });
}
