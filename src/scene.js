import * as THREE from 'three';

/**
 * createScene() sets up and returns everything the renderer needs:
 * the WebGLRenderer, the Scene, and the Camera.
 *
 * Kept in its own module so main.js stays thin and other modules
 * (targets, input, xr) can import { scene, camera } without circular deps.
 */
export function createScene() {
  // ─── Renderer ────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // off for Quest 3 perf — the resolution is high enough without it
    alpha: false,     // we own the whole canvas, no need for transparency
  });

  // Cap pixel ratio to 1.5 — Quest 3 native DPR can be ~1.75+, which kills GPU perf.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // THREE must drive the loop via setAnimationLoop (not rAF) for WebXR to work.
  // We set the callback in main.js after everything is ready.
  renderer.xr.enabled = true;

  document.body.appendChild(renderer.domElement);

  // ─── Scene ───────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050508); // near-black with a hint of blue

  // Subtle fog gives depth without any expensive effects.
  scene.fog = new THREE.Fog(0x050508, 10, 40);

  // ─── Lighting ────────────────────────────────────────────────────────────
  // Ambient: low-level fill so nothing is pitch black.
  const ambient = new THREE.AmbientLight(0x111122, 1.5);
  scene.add(ambient);

  // One directional light from above-left — cheap, no shadow map.
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 10, 5);
  scene.add(sun);

  // ─── Camera ──────────────────────────────────────────────────────────────
  // In WebXR the headset overrides this camera's matrices, but it's still
  // used for the flat desktop view.
  const camera = new THREE.PerspectiveCamera(
    70,                                      // FOV
    window.innerWidth / window.innerHeight,  // aspect
    0.1,                                     // near clip
    100                                      // far clip
  );
  camera.position.set(0, 1.6, 0); // standing eye height in metres
  // Initial pitch (-0.2 tilt) is now set in movement.js so it owns all rotation state.

  // ─── Floor ───────────────────────────────────────────────────────────────
  // Single draw call. MeshLambertMaterial = no PBR, cheap on mobile GPUs.
  const floorGeo = new THREE.PlaneGeometry(30, 30);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x111118 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2; // lay flat
  scene.add(floor);

  // ─── Arena boundary grid (visual only) ───────────────────────────────────
  // A GridHelper gives spatial orientation without extra geometry.
  // It counts as one draw call.
  // Slightly visible grid lines — dark blue-purple so the floor reads as a surface.
  const grid = new THREE.GridHelper(30, 30, 0x223344, 0x1a2233);
  scene.add(grid);

  // ─── Camera laser ray (desktop + mobile only) ────────────────────────────
  // A thin line extending 8m forward from the camera along local -Z.
  // Attached as a child of the camera so it always points where the player aims.
  // Hidden automatically when a VR session starts (headset has its own controller rays).
  const laserGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0,  0,  -0.5),  // start slightly in front of the camera lens
    new THREE.Vector3(0,  0,  -8),    // extend 8m forward
  ]);
  const laserMat = new THREE.LineBasicMaterial({
    color: 0xf7931a,
    transparent: true,
    opacity: 0.5,
  });
  const cameraLaser = new THREE.Line(laserGeo, laserMat);
  camera.add(cameraLaser); // child of camera — moves with it, no per-frame update needed

  // Adding the camera to the scene is required when it has children.
  scene.add(camera);

  // Hide the laser while in VR — the controller ray lines take over there.
  renderer.xr.addEventListener('sessionstart', () => { cameraLaser.visible = false; });
  renderer.xr.addEventListener('sessionend',   () => { cameraLaser.visible = true;  });

  // ─── Resize handling ─────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}
