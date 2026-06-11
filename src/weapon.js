import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * weapon.js — a simple low-poly first-person blaster.
 *
 * Built from merged primitives (one draw call), with glowing cyan neon edges
 * (one draw call) and a muzzle flash (one draw call) = 3 draw calls total.
 *
 * Placement:
 *   Desktop / mobile → child of the camera, parked bottom-center-right.
 *   Quest VR         → reparented to controller 0 so it rides the hand.
 *
 * Public API:
 *   setupWeapon(camera, renderer) → { updateWeapon(delta), flashMuzzle() }
 */

// Muzzle flash fades from full to zero over this many seconds.
const FLASH_DURATION = 0.1;

// Where the gun sits when parented to the camera (flat desktop/mobile view).
const CAMERA_POS   = new THREE.Vector3(0.22, -0.20, -0.55);
const CAMERA_EULER = new THREE.Euler(0.05, -0.08, 0); // slight inward tilt
const CAMERA_SCALE = 1.0;

// Where the gun sits when parented to the controller in VR.
// Smaller and centred on the controller, pointing forward (−Z).
const VR_POS   = new THREE.Vector3(0, -0.02, -0.05);
const VR_EULER = new THREE.Euler(0, 0, 0);
const VR_SCALE = 0.7;

export function setupWeapon(camera, renderer) {
  // ── Build the merged gun body ───────────────────────────────────────────────
  // Each primitive's local transform is baked into its geometry before merging,
  // so the final result is a single static geometry → one draw call.

  // Main body block.
  const body = new THREE.BoxGeometry(0.12, 0.12, 0.34);
  body.translate(0, 0, -0.05);

  // Barrel — cylinder rotated to point forward along −Z.
  const barrel = new THREE.CylinderGeometry(0.035, 0.035, 0.28, 12);
  barrel.rotateX(Math.PI / 2); // default cylinder is along Y; align to Z
  barrel.translate(0, 0.02, -0.28);

  // Grip — angled down and back.
  const grip = new THREE.BoxGeometry(0.09, 0.20, 0.10);
  grip.rotateX(0.3);
  grip.translate(0, -0.15, 0.08);

  const gunGeo = mergeGeometries([body, barrel, grip], false);

  const gunMat = new THREE.MeshBasicMaterial({ color: 0x14141c }); // dark body
  const gunMesh = new THREE.Mesh(gunGeo, gunMat);

  // ── Neon edge outline ───────────────────────────────────────────────────────
  // One EdgesGeometry of the whole merged gun → a single LineSegments.
  const edges    = new THREE.EdgesGeometry(gunGeo, 25); // 25° threshold trims clutter
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x00e5ff }); // cyan
  const edgeLines = new THREE.LineSegments(edges, edgesMat);

  // ── Muzzle flash ────────────────────────────────────────────────────────────
  // A small flat plane at the barrel tip, additive orange, invisible until firing.
  const flashGeo = new THREE.PlaneGeometry(0.18, 0.18);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xf7931a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false, // additive glow shouldn't occlude things behind it
    side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.set(0, 0.02, -0.44); // just past the barrel tip
  flash.visible = false;

  // ── Group everything ────────────────────────────────────────────────────────
  const weapon = new THREE.Group();
  weapon.add(gunMesh, edgeLines, flash);

  // Start parented to the camera (flat mode).
  attachToCamera();

  function attachToCamera() {
    camera.add(weapon);
    weapon.position.copy(CAMERA_POS);
    weapon.rotation.copy(CAMERA_EULER);
    weapon.scale.setScalar(CAMERA_SCALE);
  }

  function attachToController() {
    // getController(0) returns the same Group xr.js already uses — Three caches it.
    const controller = renderer.xr.getController(0);
    controller.add(weapon);
    weapon.position.copy(VR_POS);
    weapon.rotation.copy(VR_EULER);
    weapon.scale.setScalar(VR_SCALE);
  }

  // Swap parenting when entering / leaving VR.
  renderer.xr.addEventListener('sessionstart', attachToController);
  renderer.xr.addEventListener('sessionend',   attachToCamera);

  // ── Muzzle flash state ──────────────────────────────────────────────────────
  let flashAge = FLASH_DURATION; // start "expired" so it's hidden

  /** Trigger the muzzle flash. Called on every shot fired. */
  function flashMuzzle() {
    flashAge = 0;
    flash.visible = true;
    flash.material.opacity = 1;
    // Random roll so repeated flashes don't look identical.
    flash.rotation.z = Math.random() * Math.PI;
  }

  /** Called every frame. Fades the muzzle flash out. */
  function updateWeapon(delta) {
    if (!flash.visible) return;

    flashAge += delta;
    if (flashAge >= FLASH_DURATION) {
      flash.visible = false;
      flash.material.opacity = 0;
    } else {
      flash.material.opacity = 1 - flashAge / FLASH_DURATION;
    }
  }

  /**
   * setHidden(bool) — hide/show the whole weapon.
   * Used to hide the blaster on handheld phone AR, where there's no hand or
   * controller for it to ride and it would just occlude the small screen.
   */
  function setHidden(hidden) {
    weapon.visible = !hidden;
  }

  return { updateWeapon, flashMuzzle, setHidden };
}
