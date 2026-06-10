import * as THREE from 'three';

/**
 * buildArena(scene) — adds purely decorative arena geometry.
 *
 * Four walls: each is a dark panel + a glowing neon edge outline.
 * Using MeshBasicMaterial and LineBasicMaterial — zero lighting cost.
 */
export function buildArena(scene) {
  const WALL_WIDTH  = 20;
  const WALL_HEIGHT = 6;
  const RADIUS      = 10; // half-distance from centre to wall face

  // Neon Bitcoin-orange for the edge glow; dark fill for the panel itself.
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xf7931a });
  const panelMat = new THREE.MeshBasicMaterial({
    color: 0x0a0a14,
    side: THREE.FrontSide,
    transparent: true,
    opacity: 0.55,
  });

  // Four cardinal directions: angle in radians, then we rotate each wall to face centre.
  const wallAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

  wallAngles.forEach((angle) => {
    // ── Panel ──────────────────────────────────────────────────────────────
    const geo   = new THREE.PlaneGeometry(WALL_WIDTH, WALL_HEIGHT);
    const panel = new THREE.Mesh(geo, panelMat);

    // Position at radius, then rotate to face inward.
    panel.position.set(
      Math.sin(angle) * RADIUS,
      WALL_HEIGHT / 2,            // raise so bottom sits on the floor
      Math.cos(angle) * RADIUS,
    );
    panel.rotation.y = angle;
    scene.add(panel);

    // ── Glowing edge outline ───────────────────────────────────────────────
    // EdgesGeometry extracts only the border edges — 1 draw call per wall.
    const edges    = new THREE.EdgesGeometry(geo);
    const outline  = new THREE.LineSegments(edges, edgeMat);

    // Copy the same transform as the panel so the outline sits exactly on it.
    outline.position.copy(panel.position);
    outline.rotation.copy(panel.rotation);
    scene.add(outline);
  });

  // ── Ceiling accent ring ────────────────────────────────────────────────────
  // A simple ring at the top of the walls gives a "dome" feel without geometry cost.
  const ringGeo = new THREE.RingGeometry(RADIUS - 0.05, RADIUS + 0.05, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf7931a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.3,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2; // lay flat
  ring.position.y = WALL_HEIGHT;
  scene.add(ring);
}
