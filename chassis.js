/**
 * Simple cube/box chassis embodiment for Pages.
 * Male CNS still runs; plant motion is kinematic from portable MN steering only.
 * No NeuroMechFly mesh posing, no MuJoCo vault plant.
 */
import * as THREE from "three";

const STAND_Z = 0.42;

/**
 * Box + forward arrow with userData compatible with EmbodiedFly sensors.
 * Antenna tips + head marker for odor / compound-eye sampling.
 */
export function createCubeChassis({ color = 0xc4a35a } = {}) {
  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.45,
    metalness: 0.08,
    transparent: true,
    opacity: 0.95,
    depthWrite: true,
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a78e8,
    roughness: 0.35,
    metalness: 0.15,
    emissive: 0x1a3a80,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.98,
  });

  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 1.15), bodyMat);
  box.castShadow = true;
  box.receiveShadow = true;
  box.position.y = 0;
  visual.add(box);

  // Forward arrow (local +Z = head direction, matches fly convention).
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.55, 8),
    accentMat
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 0.08, 0.72);
  arrow.castShadow = true;
  visual.add(arrow);

  const head = new THREE.Group();
  head.position.set(0, 0.18, 0.55);
  visual.add(head);

  const antL = new THREE.Object3D();
  antL.position.set(-0.28, 0.12, 0.62);
  const tipL = new THREE.Object3D();
  tipL.position.set(0, 0, 0.15);
  antL.add(tipL);
  antL.userData.tip = tipL;
  visual.add(antL);

  const antR = new THREE.Object3D();
  antR.position.set(0.28, 0.12, 0.62);
  const tipR = new THREE.Object3D();
  tipR.position.set(0, 0, 0.15);
  antR.add(tipR);
  antR.userData.tip = tipR;
  visual.add(antR);

  root.userData = {
    plantMode: "cube",
    body: visual,
    head,
    thorax: box,
    abdomen: null,
    wings: [],
    legs: [],
    eyes: [],
    antennae: [antL, antR],
    proboscis: null,
    haustellum: null,
    gait: 0,
    hinges: {},
    nodes: {},
    standZ: STAND_Z,
  };
  return root;
}

/** Parse ?body= — default cube; ?body=fly restores NeuroMechFly / MuJoCo path. */
export function bodyModeFromUrl() {
  try {
    const q = new URLSearchParams(location.search).get("body");
    if (q === "fly" || q === "nmf" || q === "mujoco") return "fly";
    return "cube";
  } catch (_) {
    return "cube";
  }
}

export const CUBE_STAND_Z = STAND_Z;
