import * as THREE from 'three';
import { createScene } from './scene.js';
import { setupXR } from './xr.js';
import { buildArena } from './arena.js';
import { spawnTargets, updateTargets } from './targets.js';
import { createHUD } from './hud.js';
import { setupInput } from './input.js';
import { setupShooter } from './shoot.js';
import { setupMovement } from './movement.js';
import { setupWeapon } from './weapon.js';
import { setupARMode } from './armode.js';
import { setSpawnMode } from './targets.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const { renderer, scene, camera, environment } = createScene();

// The first-person blaster. Captured as an object so armode can hide it on phone AR.
const weapon = setupWeapon(camera, renderer);

// setupShooter must come before setupXR because setupXR needs shootFromRay.
// weapon.flashMuzzle is the onFire callback — triggers the muzzle flash on each shot.
const { onShoot, shootFromRay, updateBursts } = setupShooter(camera, scene, weapon.flashMuzzle);

// setupXR now receives:
//   renderer     — so VRButton and xr.getController() work
//   scene        — so controller Groups are added to the scene graph
//   shootFromRay — so controller trigger events fire the same hit logic as mouse/touch
const { updateControllers } = setupXR(renderer, scene, shootFromRay);

// Walls + ceiling ring go into the environment group (with the radar floor) so
// AR mode can hide the whole fake world at once.
buildArena(environment);
spawnTargets(scene);
createHUD();

// AR coordinator — reconfigures the scene on AR session start/end.
setupARMode({ renderer, scene, environment, weapon, setSpawnMode });

// Wire mouse click and touch tap → onShoot (flat / non-VR mode).
// In VR mode, xr.js handles shooting via selectstart on the controllers.
setupInput(onShoot, renderer);

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
  weapon.updateWeapon(delta); // fade the muzzle flash
  updateControllers();    // refresh controller ray lines each frame

  renderer.render(scene, camera);
});
