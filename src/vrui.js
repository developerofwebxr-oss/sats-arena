import * as THREE from 'three';
import { isRapidFire } from './upgrade.js';
import { getAvailableCharges, activateCharge } from './hud.js';

/**
 * vrui.js — in-world ACTIVATE panel for immersive VR.
 *
 * The DOM "✓ PAID — ACTIVATE" prompt isn't visible inside an immersive Quest
 * session, so this is its 3D counterpart: a head-locked panel that appears in
 * front of the player (lower-centre, out of the aim zone) when a charge is banked
 * and rapid-fire isn't running. Pointing a controller at it and pulling the
 * trigger activates the charge instead of firing a shot (xr.js gives this
 * precedence over shooting).
 *
 * Only shown while presenting (renderer.xr.isPresenting); flat/AR use the DOM prompt.
 *
 * Public API (returned by setupVrUI):
 *   updateVrUI()                       — call every frame; head-locks + shows/hides
 *   handleControllerSelect(origin,dir) — returns true if it consumed the trigger
 */

export function setupVrUI(scene, camera, renderer) {
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.45),
    new THREE.MeshBasicMaterial({ map: makePanelTexture(), transparent: true, side: THREE.DoubleSide }),
  );
  panel.visible = false;
  scene.add(panel);

  const raycaster = new THREE.Raycaster();
  // Reused so we don't allocate every frame.
  const _camPos  = new THREE.Vector3();
  const _camQuat = new THREE.Quaternion();
  const _offset  = new THREE.Vector3();

  // Head-locked position: ~2 m in front, dropped below the aim line.
  const OFFSET = new THREE.Vector3(0, -0.5, -2);

  function updateVrUI() {
    const show = renderer.xr.isPresenting && !isRapidFire() && getAvailableCharges() > 0;
    panel.visible = show;
    if (!show) return;

    // Place in front of the current head pose, facing the player.
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(_camPos);
    cam.getWorldQuaternion(_camQuat);
    _offset.copy(OFFSET).applyQuaternion(_camQuat);
    panel.position.copy(_camPos).add(_offset);
    panel.quaternion.copy(_camQuat);
  }

  function handleControllerSelect(origin, direction) {
    if (!panel.visible) return false;
    raycaster.set(origin, direction);
    if (raycaster.intersectObject(panel, false).length > 0) {
      activateCharge(); // consume a charge → grantRapidFire()
      return true;      // tell xr.js to swallow this trigger (no shot)
    }
    return false;
  }

  return { updateVrUI, handleControllerSelect };
}

// Canvas-texture label, same technique as the coins. Magenta on dark, on-brand.
function makePanelTexture() {
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Dark rounded background.
  ctx.fillStyle = 'rgba(8,8,14,0.92)';
  ctx.fillRect(0, 0, W, H);

  // Magenta glowing border.
  ctx.strokeStyle = '#b14bff';
  ctx.lineWidth = 8;
  ctx.shadowColor = '#b14bff';
  ctx.shadowBlur = 24;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#b14bff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 56px monospace';
  ctx.fillText('✓ PAID', W / 2, H * 0.36);
  ctx.font = 'bold 40px monospace';
  ctx.fillText('ACTIVATE RAPID FIRE', W / 2, H * 0.68);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
