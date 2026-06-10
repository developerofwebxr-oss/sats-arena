import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

/**
 * xr.js — WebXR session button + Quest controller input.
 *
 * Responsibilities:
 *   1. Inject the "Enter VR" button (VRButton helper).
 *   2. Create controller objects for both hands and add them to the scene.
 *   3. Draw a pointing ray line from each active controller.
 *   4. On trigger pull (selectstart), call shootFromRay() with the
 *      controller's current world-space position and direction.
 *   5. Provide updateControllers() to be called every XR frame
 *      so ray line geometry stays accurate.
 *
 * Public API:
 *   setupXR(renderer, scene, shootFromRay) — call once at startup
 *   Returns { updateControllers }          — call in the animation loop
 */

// How long the visual ray line extends from the controller tip (metres).
const RAY_LENGTH = 5;

export function setupXR(renderer, scene, shootFromRay) {
  // ── VR button ─────────────────────────────────────────────────────────────
  const button = VRButton.createButton(renderer);
  document.body.appendChild(button);

  // ── Build both controllers ─────────────────────────────────────────────────
  // getController(0/1) returns a Group whose world matrix Three.js updates
  // automatically each XR frame to match the physical controller pose.
  // Index 0 = first controller to connect, 1 = second. We treat both identically.
  const controllers = [
    buildController(0, renderer, scene, shootFromRay),
    buildController(1, renderer, scene, shootFromRay),
  ];

  // ── updateControllers ─────────────────────────────────────────────────────
  // Called every frame from main.js. The ray line lives in controller local
  // space so it moves automatically, but we still refresh it each frame so
  // the geometry buffer stays in sync with the GPU.
  function updateControllers() {
    controllers.forEach(({ rayLine, connected }) => {
      if (!connected.value || !rayLine) return;
      // The line points from local origin along -Z; no position math needed here
      // because the Group's world matrix already encodes the controller's pose.
      // We just ensure needsUpdate is true so Three.js re-uploads the buffer.
      rayLine.geometry.attributes.position.needsUpdate = true;
    });
  }

  return { updateControllers };
}

// ── buildController ──────────────────────────────────────────────────────────
// Creates one controller group, its ray line, and wires events.
function buildController(index, renderer, scene, shootFromRay) {
  // getController returns a Group that Three.js XR manager updates each frame.
  const group = renderer.xr.getController(index);

  // Add to the scene so Three.js includes it in the scene graph and updates its pose.
  scene.add(group);

  // `connected` is a plain object so event callbacks and updateControllers
  // can both read/write it without complex closure wiring.
  const state = { group, rayLine: null, connected: { value: false } };

  // ── Ray line ──────────────────────────────────────────────────────────────
  // Two points in controller local space: tip (0,0,0) → forward (0,0,-RAY_LENGTH).
  // Because the line is a child of `group`, it automatically follows the controller.
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -RAY_LENGTH),
  ];
  const rayGeo  = new THREE.BufferGeometry().setFromPoints(points);
  const rayMat  = new THREE.LineBasicMaterial({
    color: 0xf7931a,
    transparent: true,
    opacity: 0.5, // matches camera laser opacity in scene.js
  });
  const rayLine = new THREE.Line(rayGeo, rayMat);
  rayLine.visible = false; // hidden until the controller physically connects
  group.add(rayLine);
  state.rayLine = rayLine;

  // Reusable vectors — allocated once here, not inside the event callback,
  // to avoid GC churn on every trigger pull.
  const _origin    = new THREE.Vector3();
  const _direction = new THREE.Vector3();

  // ── connected ─────────────────────────────────────────────────────────────
  // Fired when the headset detects this controller is present.
  group.addEventListener('connected', () => {
    state.connected.value = true;
    rayLine.visible = true;
  });

  // ── disconnected ──────────────────────────────────────────────────────────
  group.addEventListener('disconnected', () => {
    state.connected.value = false;
    rayLine.visible = false;
  });

  // ── selectstart ───────────────────────────────────────────────────────────
  // Fired on trigger press (or primary button) for this controller.
  // We extract world-space origin + direction from the controller's matrixWorld
  // and pass them to shootFromRay — the same hit logic used for mouse/touch.
  group.addEventListener('selectstart', () => {
    if (!state.connected.value) return;

    // Controller world position.
    _origin.setFromMatrixPosition(group.matrixWorld);

    // Controller points along its local -Z axis (WebXR convention).
    // transformDirection applies only the rotation part of the matrix.
    _direction.set(0, 0, -1).transformDirection(group.matrixWorld).normalize();

    // Clone so shootFromRay doesn't hold a reference to our reused vectors.
    shootFromRay(_origin.clone(), _direction.clone());
  });

  return state;
}
