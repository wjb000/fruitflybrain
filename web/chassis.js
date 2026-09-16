/**
 * Optional chassis embodiments (cube box, visual quadrotor).
 * Homepage default is the NeuroMechFly mesh (`?body=fly` / omitted).
 * Cube/drone: male CNS still runs; motion is kinematic from portable MN steering.
 * No MuJoCo on cube/drone — those stay ?body=cube / ?body=drone.
 */
import * as THREE from "three";

const CUBE_Z = 0.42;
/** Hover rest height — matches droneSetpoints hoverThrottle baseline. */
const DRONE_Z = 1.45;
const HOVER_Z = 1.45;

function attachAntennae(visual, y, z, spread) {
  const antL = new THREE.Object3D();
  antL.position.set(-spread, y, z);
  const tipL = new THREE.Object3D();
  tipL.position.set(0, 0, 0.15);
  antL.add(tipL);
  antL.userData.tip = tipL;
  visual.add(antL);

  const antR = new THREE.Object3D();
  antR.position.set(spread, y, z);
  const tipR = new THREE.Object3D();
  tipR.position.set(0, 0, 0.15);
  antR.add(tipR);
  antR.userData.tip = tipR;
  visual.add(antR);
  return [antL, antR];
}

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

  const antennae = attachAntennae(visual, 0.12, 0.62, 0.28);

  root.userData = {
    plantMode: "cube",
    body: visual,
    head,
    thorax: box,
    abdomen: null,
    wings: [],
    legs: [],
    eyes: [],
    antennae,
    rotors: [],
    proboscis: null,
    haustellum: null,
    gait: 0,
    hinges: {},
    nodes: {},
    standZ: CUBE_Z,
  };
  return root;
}

/**
 * Visual quadrotor — male CNS + stim-map still run; kinematics from droneSetpoints.
 * Local +Z = nose (same as cube/fly). Four rotors in X layout.
 */
export function createDroneChassis({ color = 0x3d4654 } = {}) {
  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.38,
    metalness: 0.35,
    transparent: true,
    opacity: 0.96,
    depthWrite: true,
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: 0x4de4ff,
    roughness: 0.3,
    metalness: 0.2,
    emissive: 0x1a6a80,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.98,
  });
  const armMat = new THREE.MeshPhysicalMaterial({
    color: 0x1c222c,
    roughness: 0.5,
    metalness: 0.25,
  });
  const rotorMat = new THREE.MeshPhysicalMaterial({
    color: 0x88c8e8,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const hubMat = new THREE.MeshPhysicalMaterial({
    color: 0x2a3340,
    roughness: 0.4,
    metalness: 0.45,
  });

  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.78), bodyMat);
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  visual.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 8), accentMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.02, 0.52);
  nose.castShadow = true;
  visual.add(nose);

  const skidGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8);
  for (const x of [-0.16, 0.16]) {
    const skid = new THREE.Mesh(skidGeo, armMat);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(x, -0.16, 0.02);
    skid.castShadow = true;
    visual.add(skid);
  }

  const armLen = 0.72;
  const armOff = 0.36;
  const rotors = [];
  const armGeo = new THREE.BoxGeometry(0.055, 0.04, armLen);
  const hubGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 10);
  const diskGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.012, 24);

  // X-layout: FL, FR, RL, RR (local +Z forward, +X right).
  const hubs = [
    { x: -armOff, z: armOff },
    { x: armOff, z: armOff },
    { x: -armOff, z: -armOff },
    { x: armOff, z: -armOff },
  ];
  for (const h of hubs) {
    const yaw = Math.atan2(h.x, h.z);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.rotation.y = yaw;
    arm.position.set(h.x * 0.5, 0.02, h.z * 0.5);
    arm.castShadow = true;
    visual.add(arm);

    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.set(h.x, 0.06, h.z);
    visual.add(hub);

    const disk = new THREE.Mesh(diskGeo, rotorMat);
    disk.position.set(h.x, 0.09, h.z);
    visual.add(disk);
    rotors.push(disk);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.08, 0.38);
  visual.add(head);

  const antennae = attachAntennae(visual, 0.06, 0.48, 0.14);

  root.userData = {
    plantMode: "drone",
    body: visual,
    head,
    thorax: fuselage,
    abdomen: null,
    wings: [],
    legs: [],
    eyes: [],
    antennae,
    rotors,
    proboscis: null,
    haustellum: null,
    gait: 0,
    hinges: {},
    nodes: {},
    standZ: DRONE_Z,
    hoverZ: HOVER_Z,
  };
  return root;
}

/**
 * Spin X-quadrotor disks from throttle (hover ~1.45 still turns rotors).
 * Alternate signs match a typical X-layout torque pair.
 */
export function spinRotors(body, dt, throttle = HOVER_Z) {
  const rotors = body?.userData?.rotors;
  if (!rotors || !rotors.length) return;
  const w = (0.45 + Math.max(0.2, throttle) * 0.9) * 26 * (dt || 0);
  const signs = [1, -1, -1, 1];
  for (let i = 0; i < rotors.length; i++) {
    const r = rotors[i];
    if (!r) continue;
    r.rotation.y += w * (signs[i] ?? (i % 2 ? -1 : 1));
  }
}

/**
 * Parse ?body= — default fly (NeuroMechFly mesh + MN drive).
 * ?body=cube keeps the box plant; ?body=drone the quadrotor.
 */
export function bodyModeFromUrl() {
  try {
    const q = new URLSearchParams(location.search).get("body");
    if (q === "drone" || q === "quad" || q === "quadrotor") return "drone";
    if (q === "cube" || q === "box") return "cube";
    return "fly";
  } catch (_) {
    return "fly";
  }
}

/** Cube and drone skip MuJoCo / NMF posing. */
export function isKinematicChassis(mode) {
  return mode === "drone" || mode === "cube";
}

export const CUBE_STAND_Z = CUBE_Z;
export const DRONE_STAND_Z = DRONE_Z;
export const DRONE_HOVER_Z = HOVER_Z;
