import * as THREE from 'three';
import { targetMeshes, removeTarget } from './targets.js';
import { deductSat, getBalance } from './sats.js';
import { updateHUD } from './hud.js';
import { playHitSound, playMissSound } from './audio.js';
import { recordHit, recordMiss } from './score.js';

/**
 * shoot.js — raycasting, hit detection, sat deduction, and burst particles.
 *
 * Public API:
 *   setupShooter(camera, scene)  — call once at startup, returns { onShoot, updateBursts }
 *   onShoot(ndcX, ndcY)          — call from input.js on every click/tap
 *   updateBursts(delta)          — call every frame to animate and expire bursts
 */

// How many particles per burst, and how long they live.
const BURST_PARTICLE_COUNT = 30;
const BURST_LIFETIME       = 0.6;  // seconds
const BURST_SPEED          = 2.5;  // outward metres per second

// onFire — optional callback invoked on every shot actually fired (hit or miss),
// e.g. to trigger the weapon muzzle flash. Not called when out of sats.
export function setupShooter(camera, scene, onFire) {
  const raycaster = new THREE.Raycaster();

  // Active burst objects — each has { points, velocities, age }.
  // Kept small; bursts expire in ~0.35s so rarely more than 2–3 alive at once.
  const bursts = [];

  // ── Shared burst material ──────────────────────────────────────────────────
  // One material instance reused by all bursts — no extra GPU state changes.
  const burstMat = new THREE.PointsMaterial({
    color: 0xf7931a,
    size: 0.12,
    sizeAttenuation: true, // particles shrink with distance (perspective)
  });

  // ── onShoot ────────────────────────────────────────────────────────────────
  // Called by input.js for mouse click and touch tap.
  // ndcX/ndcY are Normalised Device Coordinates [-1, +1].
  function onShoot(ndcX, ndcY) {
    // Aim the raycaster from the camera through the NDC point.
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    fireRay();
  }

  // ── shootFromRay ───────────────────────────────────────────────────────────
  // Called by xr.js for Quest controller trigger pulls.
  // origin and direction are world-space THREE.Vector3 read from the controller pose.
  // Everything after the raycaster setup is shared with onShoot via fireRay().
  function shootFromRay(origin, direction) {
    // set(origin, direction) bypasses NDC — the ray starts in world space directly.
    raycaster.set(origin, direction);
    fireRay();
  }

  // ── fireRay ────────────────────────────────────────────────────────────────
  // Shared hit-detection logic used by both onShoot and shootFromRay.
  function fireRay() {
    // Block shooting when out of sats.
    if (getBalance() <= 0) return;

    // Spend the sat before anything else — a miss still costs.
    deductSat();
    updateHUD();

    // Announce the shot (muzzle flash etc.) — fires for both hits and misses.
    if (onFire) onFire();

    // Test against all visible target meshes.
    const hits = raycaster.intersectObjects(targetMeshes);

    if (hits.length > 0) {
      const hit = hits[0]; // closest target only
      const hitIndex = targetMeshes.indexOf(hit.object);

      // Spawn burst at the exact hit point on the sphere's surface.
      spawnBurst(hit.point, scene);

      // Hide target and schedule respawn.
      removeTarget(hitIndex, scene);

      recordHit();
      playHitSound();
    } else {
      recordMiss();
      playMissSound();
    }
  }

  // ── spawnBurst ─────────────────────────────────────────────────────────────
  function spawnBurst(origin, scene) {
    // Build a BufferGeometry with BURST_PARTICLE_COUNT points all starting
    // at the hit position. Each frame we move them outward along their velocity.
    const positions   = new Float32Array(BURST_PARTICLE_COUNT * 3);
    const velocities  = []; // plain JS array of THREE.Vector3

    for (let i = 0; i < BURST_PARTICLE_COUNT; i++) {
      // All particles start at the origin.
      positions[i * 3]     = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;

      // Random direction on the unit sphere, scaled by burst speed.
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize().multiplyScalar(BURST_SPEED);
      velocities.push(dir);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const points = new THREE.Points(geo, burstMat);
    scene.add(points);

    bursts.push({ points, velocities, age: 0 });
  }

  // ── updateBursts ──────────────────────────────────────────────────────────
  // Called every frame. delta = seconds since last frame.
  function updateBursts(delta) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const burst = bursts[i];
      burst.age += delta;

      if (burst.age >= BURST_LIFETIME) {
        // Burst has expired — remove from scene and free GPU memory.
        scene.remove(burst.points);
        burst.points.geometry.dispose();
        bursts.splice(i, 1);
        continue;
      }

      // Move each particle outward along its velocity.
      const posAttr = burst.points.geometry.attributes.position;
      for (let p = 0; p < BURST_PARTICLE_COUNT; p++) {
        posAttr.setXYZ(
          p,
          posAttr.getX(p) + burst.velocities[p].x * delta,
          posAttr.getY(p) + burst.velocities[p].y * delta,
          posAttr.getZ(p) + burst.velocities[p].z * delta,
        );
      }
      // Tell Three.js the positions changed this frame.
      posAttr.needsUpdate = true;

      // Fade out as the burst ages (0 → full opacity, 1 → gone).
      burst.points.material.opacity = 1 - burst.age / BURST_LIFETIME;
      burst.points.material.transparent = true;
    }
  }

  return { onShoot, shootFromRay, updateBursts };
}
