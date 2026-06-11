import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

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
  const vrButton = VRButton.createButton(renderer);
  document.body.appendChild(vrButton);

  // ── AR button ──────────────────────────────────────────────────────────────
  // Only added if the device actually supports immersive-ar, so it auto-hides
  // on desktop / iPhone / non-AR devices (rather than showing a disabled label).
  //
  // optionalFeatures:
  //   'dom-overlay'  — lets HTML (crosshair / HUD) render over passthrough on
  //                    handheld Android AR. Quest ignores what it doesn't use.
  //   'local-floor'  — floor-relative reference space.
  // domOverlay.root = document.body so the existing crosshair + HUD show through
  // on phone AR. UNTESTED — verify dom-overlay crosshair on Android tomorrow.
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      if (!supported) return;
      const arButton = ARButton.createButton(renderer, {
        optionalFeatures: ['dom-overlay', 'local-floor'],
        domOverlay: { root: document.body },
      });
      document.body.appendChild(arButton);

      // The two buttons both anchor bottom-centre by default and would overlap —
      // nudge VR left and AR right so they sit side by side.
      vrButton.style.left = 'calc(50% - 110px)';
      arButton.style.left = 'calc(50% + 10px)';
    });
  }

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
  const state = { group, rayLine: null, connected: { value: false }, inputSource: null };

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
  // Fired when an input source appears. event.data is the XRInputSource.
  // On a Quest controller this is a 'tracked-pointer'. On a handheld phone tap
  // it's a transient 'screen' input source (appears on touch, gone on release).
  group.addEventListener('connected', (event) => {
    state.connected.value = true;
    state.inputSource = event.data || null;

    // Show the aim ray only for tracked controllers, not for a phone screen tap
    // (a floating ray from a tap point would look wrong). UNTESTED — verify the
    // handheld tap does NOT draw a stray ray on Android tomorrow.
    const isScreen = state.inputSource && state.inputSource.targetRayMode === 'screen';
    rayLine.visible = !isScreen;
  });

  // ── disconnected ──────────────────────────────────────────────────────────
  group.addEventListener('disconnected', () => {
    state.connected.value = false;
    rayLine.visible = false;
  });

  // ── selectstart ───────────────────────────────────────────────────────────
  // Fired on trigger press (Quest controller) OR screen tap (handheld AR).
  // Both reuse shootFromRay — only the ray source differs:
  //   tracked-pointer → ray from the controller pose.
  //   screen (phone)  → ray from the XR camera centre, so the phone aims like a
  //                     gun and a centre crosshair is the aim point.
  group.addEventListener('selectstart', () => {
    if (!state.connected.value) return;

    const isScreen = state.inputSource && state.inputSource.targetRayMode === 'screen';

    if (isScreen) {
      // Handheld: fire straight out of the phone (XR camera forward).
      // UNTESTED — verify handheld tap aims from screen centre on Android tomorrow.
      const xrCam = renderer.xr.getCamera();
      _origin.setFromMatrixPosition(xrCam.matrixWorld);
      _direction.set(0, 0, -1).transformDirection(xrCam.matrixWorld).normalize();
    } else {
      // Tracked controller: fire from the controller pose.
      _origin.setFromMatrixPosition(group.matrixWorld);
      _direction.set(0, 0, -1).transformDirection(group.matrixWorld).normalize();
    }

    // Clone so shootFromRay doesn't hold a reference to our reused vectors.
    shootFromRay(_origin.clone(), _direction.clone());
  });

  return state;
}
