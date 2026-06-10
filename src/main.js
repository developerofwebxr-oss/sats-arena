import * as THREE from 'three';
import { createScene } from './scene.js';
import { setupXR } from './xr.js';
import { buildArena } from './arena.js';
import { spawnTargets, updateTargets } from './targets.js';
import { createHUD } from './hud.js';
import { setupInput } from './input.js';
import { setupShooter } from './shoot.js';
import { setupMovement } from './movement.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const { renderer, scene, camera } = createScene();

// setupShooter must come before setupXR because setupXR needs shootFromRay.
const { onShoot, shootFromRay, updateBursts } = setupShooter(camera, scene);

// setupXR now receives:
//   renderer     — so VRButton and xr.getController() work
//   scene        — so controller Groups are added to the scene graph
//   shootFromRay — so controller trigger events fire the same hit logic as mouse/touch
const { updateControllers } = setupXR(renderer, scene, shootFromRay);

buildArena(scene);
spawnTargets(scene);
createHUD();

// Wire mouse click and touch tap → onShoot (flat / non-VR mode).
// In VR mode, xr.js handles shooting via selectstart on the controllers.
setupInput(onShoot);

// setupMovement owns all camera rotation:
//   desktop  → mouse drag + arrow keys
//   mobile   → gyroscope (with iOS permission flow) or virtual joystick fallback
//   Quest VR → no-op (WebXR head tracking takes over)
const { updateMovement } = setupMovement(camera, renderer);

// ─── Clock ────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

// ─── Animation loop ───────────────────────────────────────────────────────────
// setAnimationLoop is XR-aware: on desktop it acts like rAF; in VR it's driven
// by the headset refresh (72–120 Hz) and receives an XRFrame as the second arg.
renderer.setAnimationLoop(function animate() {
  const delta   = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  updateMovement(delta);  // rotate camera from mouse/keys/gyro/joystick
  updateTargets(elapsed);
  updateBursts(delta);
  updateControllers();    // refresh controller ray lines each frame

  renderer.render(scene, camera);
});
