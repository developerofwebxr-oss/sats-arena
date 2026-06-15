import * as THREE from 'three';
import { targetMeshes, removeTarget, removeSpecial } from './targets.js';
import { playHitSound, playMissSound, playSatoshiHitSound } from './audio.js';
import { recordHit, recordMiss } from './score.js';
import { isRapidFire, RAPID_BURST, RAPID_INTERVAL_MS } from './upgrade.js';

/**
 * shoot.js — raycasting, hit detection, and burst particles.
 *
 * Shooting is FREE and unlimited (free-to-play). Each trigger fires one shot,
 * unless the rapid-fire upgrade is active — then each trigger fires a quick
 * burst of RAPID_BURST shots (see upgrade.js).
 *
 * Public API:
 *   setupShooter(camera, scene, onFire) → { onShoot, shootFromRay, updateBursts }
 *   onShoot(ndcX, ndcY)          — call from input.js on every click/tap
 *   shootFromRay(origin, dir)    — call from xr.js for controller / handheld taps
 *   updateBursts(delta)          — call every frame to animate and expire bursts
 */

// How many particles per burst, and how long they live.
const BURST_PARTICLE_COUNT = 30;
const BURST_LIFETIME       = 0.6;  // seconds
const BURST_SPEED          = 2.5;  // outward metres per second

// Satoshi (special) hits get a big, explosive, star-shaped burst for max juice.
const SATOSHI_BURST_COUNT  = 120;
const SATOSHI_BURST_SPEED  = 5.5;

// Points awarded per hit.
const NORMAL_POINTS  = 1;
const SATOSHI_POINTS = 50;

// Rapid-fire coin hits get a bigger, faster, multi-colour burst (juice for the
// paid window). Normal (non-rapid) hits are unchanged.
const RAPID_BURST_COUNT = 50;
const RAPID_BURST_SPEED = 4.0;
const BURST_PALETTE = [0xf7931a, 0xb14bff, 0x00e5ff, 0xffd700] // orange, magenta, cyan, gold
  .map((c) => new THREE.Color(c));

// onFire — optional callback invoked on every shot fired (hit or miss),
// e.g. to trigger the weapon muzzle flash.
export function setupShooter(camera, scene, onFire) {
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2(); // reused for camera-space aiming

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

  // Satoshi hits — big gold STAR-shaped particles. The star comes from a
  // point-sprite texture (canvas ★ on transparent bg), not real geometry.
  // alphaTest keeps the star edges crisp and cheap (cut-out, not heavy blending).
  const satoshiStarMat = new THREE.PointsMaterial({
    map: createStarTexture(),
    color: 0xffd700,
    size: 0.28,
    sizeAttenuation: true,
    alphaTest: 0.5,
    transparent: true, // lets the existing opacity fade-out work
    depthWrite: false,
  });

  // Rapid-fire coin-hit burst — bigger particles, per-particle colours (palette).
  const rapidBurstMat = new THREE.PointsMaterial({
    size: 0.22,
    sizeAttenuation: true,
    vertexColors: true, // colour comes from the geometry's 'color' attribute
    transparent: true,
  });

  // ── onShoot ────────────────────────────────────────────────────────────────
  // Called by input.js for mouse click and touch tap.
  // ndcX/ndcY are Normalised Device Coordinates [-1, +1].
  function onShoot(ndcX, ndcY) {
    // setupRay aims the raycaster from the camera through the NDC point.
    // Captured in a closure so rapid-fire bursts re-aim the same way each shot.
    triggerFire(() => raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera));
  }

  // ── shootFromRay ───────────────────────────────────────────────────────────
  // Called by xr.js for Quest controller triggers and handheld screen taps.
  // origin/direction are world-space, captured at trigger time.
  function shootFromRay(origin, direction) {
    triggerFire(() => raycaster.set(origin, direction));
  }

  // ── triggerFire ──────────────────────────────────────────────────────────
  // One trigger event → one shot, OR a quick burst when rapid-fire is active.
  // setupRay() configures the raycaster for this trigger's aim; it's reused for
  // every shot in the burst so they all follow the same line.
  function triggerFire(setupRay) {
    doShot(setupRay); // first shot fires immediately

    if (isRapidFire()) {
      // Schedule the remaining burst shots a few ms apart for a rifle feel.
      for (let i = 1; i < RAPID_BURST; i++) {
        setTimeout(() => doShot(setupRay), i * RAPID_INTERVAL_MS);
      }
    }
  }

  // ── doShot ───────────────────────────────────────────────────────────────
  // Fire a single shot: aim, flash, raycast, resolve hit/miss. Free — no cost.
  function doShot(setupRay) {
    setupRay();

    // Announce the shot (muzzle flash etc.) — fires for both hits and misses.
    if (onFire) onFire();

    // Three's raycaster doesn't skip invisible objects, so a just-hit coin
    // (hidden during its respawn delay) could otherwise intercept the ray in
    // front of a visible one — swallowing the shot. Take the closest VISIBLE hit.
    const hits = raycaster.intersectObjects(targetMeshes);
    const hit = hits.find((h) => h.object.visible);

    if (hit) {
      if (hit.object.userData.special) {
        // Satoshi target — big points, explosive gold star burst, distinct sound.
        spawnBurst(hit.point, SATOSHI_BURST_COUNT, SATOSHI_BURST_SPEED, satoshiStarMat);
        removeSpecial();
        recordHit(SATOSHI_POINTS);
        playSatoshiHitSound();
      } else {
        // Normal coin. During rapid-fire, give it the spectacular multi-colour
        // burst; otherwise the standard orange one (unchanged).
        const hitIndex = targetMeshes.indexOf(hit.object);
        if (isRapidFire()) {
          spawnBurst(hit.point, RAPID_BURST_COUNT, RAPID_BURST_SPEED, rapidBurstMat);
        } else {
          spawnBurst(hit.point, BURST_PARTICLE_COUNT, BURST_SPEED, burstMat);
        }
        removeTarget(hitIndex);
        recordHit(NORMAL_POINTS);
        playHitSound();
      }
    } else {
      recordMiss();
      playMissSound();
    }
  }

  // ── spawnBurst ─────────────────────────────────────────────────────────────
  // count/speed/material let normal and Satoshi hits use different juice.
  function spawnBurst(origin, count, speed, material) {
    const positions  = new Float32Array(count * 3);
    const velocities = []; // plain JS array of THREE.Vector3

    for (let i = 0; i < count; i++) {
      // All particles start at the origin.
      positions[i * 3]     = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;

      // Random direction on the unit sphere, scaled by burst speed.
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize().multiplyScalar(speed);
      velocities.push(dir);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // For multi-colour bursts, give each particle a random palette colour.
    if (material.vertexColors) {
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const c = BURST_PALETTE[(Math.random() * BURST_PALETTE.length) | 0];
        colors[i * 3]     = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    const points = new THREE.Points(geo, material);
    scene.add(points);

    bursts.push({ points, velocities, age: 0, count });
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
      for (let p = 0; p < burst.count; p++) {
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

// ── Star point-sprite texture (drawn once, shared) ──────────────────────────────
// A white ★ on a transparent background. Tinted gold by the material's color.
function createStarTexture() {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, S, S); // transparent background
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(S * 0.9)}px serif`;
  ctx.fillText('★', S / 2, S / 2 + S * 0.04);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
