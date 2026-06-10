import * as THREE from 'three';

/**
 * targets.js — spawns and animates Bitcoin coin targets.
 *
 * Public API:
 *   spawnTargets(scene)          — call once at startup
 *   updateTargets(time)          — call every frame, pass elapsed seconds
 *   removeTarget(index, scene)   — hide a hit target, schedule respawn
 *   targetMeshes                 — array for raycasting in shoot.js
 */

const MAX_TARGETS      = 12;
const SPAWN_RADIUS_MIN = 3;
const SPAWN_RADIUS_MAX = 7;
const SPAWN_HEIGHT_MIN = 1.0;
const SPAWN_HEIGHT_MAX = 3.0;
const RESPAWN_DELAY_MS = 800;

// ── Coin geometry ──────────────────────────────────────────────────────────────
// CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
// 0.28m radius, 0.06m thick — a chunky coin. 32 segments = smooth edge.
const COIN_GEO = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 32);

// ── Coin texture — drawn once, shared across all coins ────────────────────────
// Using a plain <canvas> for maximum browser compatibility.
// OffscreenCanvas works too but isn't supported in all WebXR browsers (e.g. Wolvic).
function createCoinTexture() {
  const SIZE = 256; // texture resolution in pixels — enough for a crisp ₿
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r  = SIZE / 2;

  // ── Background circle — Bitcoin orange ──────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f7931a';
  ctx.fill();

  // ── Inner accent ring — slightly lighter, gives coin depth ──────────────
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 6;
  ctx.stroke();

  // ── ₿ symbol — white, centred ───────────────────────────────────────────
  // Font size tuned so the symbol fills the coin face without clipping.
  ctx.fillStyle = 'white';
  ctx.font      = `bold ${Math.floor(SIZE * 0.58)}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  // The ₿ glyph has optical weight that sits slightly above centre — nudge down.
  ctx.fillText('₿', cx, cy + SIZE * 0.04);

  // Wrap in a Three.js texture. needsUpdate = true uploads the pixels to GPU.
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const COIN_TEXTURE = createCoinTexture();

// ── Materials ──────────────────────────────────────────────────────────────────
// CylinderGeometry has three material group indices:
//   0 = curved side (the rim/edge)
//   1 = top cap (front face)
//   2 = bottom cap (back face)
// We pass an array of three — same faceMat instance for both caps (zero extra memory).
const RIM_MAT  = new THREE.MeshBasicMaterial({ color: 0xc4660a }); // darker orange rim
const FACE_MAT = new THREE.MeshBasicMaterial({ map: COIN_TEXTURE, side: THREE.FrontSide });
const COIN_MATS = [RIM_MAT, FACE_MAT, FACE_MAT];

// ── Target array (exported for raycasting in shoot.js) ────────────────────────
export const targetMeshes = [];

// Animation state — kept parallel to targetMeshes (same index).
const targetData = [];

// ── Helpers ────────────────────────────────────────────────────────────────────

function randomTargetPosition() {
  const angle  = Math.random() * Math.PI * 2;
  const radius = SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    SPAWN_HEIGHT_MIN + Math.random() * (SPAWN_HEIGHT_MAX - SPAWN_HEIGHT_MIN),
    Math.sin(angle) * radius,
  );
}

function makeTargetData(mesh) {
  return {
    bobSpeed:  0.5 + Math.random() * 0.8,
    bobAmp:    0.15 + Math.random() * 0.2,
    bobOffset: Math.random() * Math.PI * 2,
    driftX:    (Math.random() - 0.5) * 0.004,
    driftZ:    (Math.random() - 0.5) * 0.004,
    baseY:     mesh.position.y,
    spinY:     (Math.random() - 0.5) * 0.02,   // slow wobble left or right
    spinZ:     0.006 + Math.random() * 0.016,   // forward spin, always positive, varied speed
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * spawnTargets(scene) — create all coin targets and add them to the scene.
 */
export function spawnTargets(scene) {
  for (let i = 0; i < MAX_TARGETS; i++) {
    const mesh = new THREE.Mesh(COIN_GEO, COIN_MATS);

    // Rotate so the flat coin face points forward (world -Z) instead of up.
    // CylinderGeometry's caps face ±Y by default; rotating 90° on X makes them face ±Z.
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.y = Math.random() * Math.PI * 2; // random initial facing
    mesh.rotation.z = Math.random() * Math.PI * 2; // random initial tilt

    mesh.position.copy(randomTargetPosition());
    scene.add(mesh);
    targetMeshes.push(mesh);
    targetData.push(makeTargetData(mesh));
  }
}

/**
 * removeTarget(index) — hide a hit target and respawn at a new position.
 */
export function removeTarget(index) {
  const mesh = targetMeshes[index];
  mesh.visible = false;

  setTimeout(() => {
    mesh.position.copy(randomTargetPosition());
    targetData[index] = makeTargetData(mesh);
    mesh.visible = true;
  }, RESPAWN_DELAY_MS);
}

/**
 * updateTargets(time) — animate all visible coin targets each frame.
 * time = elapsed seconds from the Three.js clock.
 */
export function updateTargets(time) {
  for (let i = 0; i < targetMeshes.length; i++) {
    const mesh = targetMeshes[i];
    if (!mesh.visible) continue;

    const data = targetData[i];

    // Vertical bob.
    mesh.position.y = data.baseY + Math.sin(time * data.bobSpeed + data.bobOffset) * data.bobAmp;

    // Slow horizontal drift with arena boundary bounce.
    mesh.position.x += data.driftX;
    mesh.position.z += data.driftZ;
    const dist = Math.sqrt(mesh.position.x ** 2 + mesh.position.z ** 2);
    if (dist > SPAWN_RADIUS_MAX) {
      data.driftX *= -1;
      data.driftZ *= -1;
    }

    // Each coin has its own spin speeds so they all look distinct.
    // spinZ = primary face-spin (like a clock hand), always forward, varied pace.
    // spinY = slight wobble left/right, can go either direction.
    mesh.rotation.z += data.spinZ;
    mesh.rotation.y += data.spinY;
  }
}
