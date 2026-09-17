/**
 * Fly utopia — a lush garden home (not a dish, cage, or stick-prop pad).
 * Warm daylight, living moss, fruit, dew, shade, blossoms, gentle breeze.
 * Rim is a leafy hedge: bounce/redirect, never punish.
 * Bitter / assay beacon stay off unless ?bitter=1 / ?assay=1.
 */
import * as THREE from "three";

/** Garden clearing radius. Cozy to live in, enough room to wander. */
export const ARENA_R = 12.5;
export const WORLD_SOFT_LIMIT = ARENA_R - 1.7; // ~10.8
/** @deprecated open-world chunk constants kept for import compatibility */
export const CHUNK_SIZE = ARENA_R * 2;
export const LOAD_R = 0;
export const UNLOAD_R = 0;

/** Primary ripe fruit the fly faces at spawn (taste / ORN home). */
export const UTOPIA_FOOD = { x: 1.85, z: 1.35 };
export const UTOPIA_WATER = { x: -1.55, z: 1.55 };
export const UTOPIA_PERCH = { x: -1.45, z: -1.85, r: 0.72, h: 1.42 };
export const UTOPIA_HOME = { x: 0.12, z: 0.18 };

const _leafGeo = new THREE.CircleGeometry(1, 13);
const _sphere = new THREE.SphereGeometry(1, 14, 12);
const _cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
const _cone = new THREE.ConeGeometry(0.016, 0.12, 5);
const _dummy = new THREE.Object3D();

function urlFlag(name) {
  try {
    const q = new URLSearchParams(location.search).get(name);
    return q === "1" || q === "true" || q === "on";
  } catch {
    return false;
  }
}

function makeFloorTexture() {
  const chk = document.createElement("canvas");
  chk.width = 768;
  chk.height = 768;
  const cx = chk.getContext("2d");
  const g0 = cx.createRadialGradient(384, 384, 40, 384, 384, 420);
  g0.addColorStop(0, "#6a9a48");
  g0.addColorStop(0.45, "#4e8238");
  g0.addColorStop(1, "#3a6a30");
  cx.fillStyle = g0;
  cx.fillRect(0, 0, 768, 768);
  // Moss patches that read at fly scale.
  for (let k = 0; k < 520; k++) {
    const x = (k * 137 + 28) % 768;
    const y = (k * 89 + 51) % 768;
    const r = 8 + (k % 28);
    const g = cx.createRadialGradient(x, y, 1, x, y, r);
    const moss = k % 5 === 0 ? "rgba(120, 176, 72, 0.72)" : "rgba(62, 118, 48, 0.55)";
    g.addColorStop(0, moss);
    g.addColorStop(1, "rgba(48, 96, 40, 0)");
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, r, 0, Math.PI * 2);
    cx.fill();
  }
  // Blade strokes.
  cx.strokeStyle = "rgba(90, 150, 58, 0.35)";
  cx.lineWidth = 1.2;
  for (let k = 0; k < 900; k++) {
    const x = (k * 47 + 12) % 768;
    const y = (k * 113 + 7) % 768;
    cx.beginPath();
    cx.moveTo(x, y);
    cx.lineTo(x + ((k * 3) % 7) - 3, y - 6 - (k % 8));
    cx.stroke();
  }
  // Warm earth flecks + clover.
  cx.fillStyle = "rgba(214, 186, 92, 0.22)";
  for (let k = 0; k < 140; k++) {
    cx.fillRect((k * 151) % 768, (k * 97) % 768, 3, 3);
  }
  cx.fillStyle = "rgba(168, 214, 110, 0.45)";
  for (let k = 0; k < 80; k++) {
    const x = (k * 191 + 40) % 768;
    const y = (k * 73 + 22) % 768;
    cx.beginPath();
    cx.arc(x, y, 2.2, 0, Math.PI * 2);
    cx.fill();
  }
  const tex = new THREE.CanvasTexture(chk);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.6, 2.6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const cx = c.getContext("2d");
  const g = cx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#8ec8ee");
  g.addColorStop(0.38, "#f3d7b4");
  g.addColorStop(0.72, "#f7e2c4");
  g.addColorStop(1, "#ead4a8");
  cx.fillStyle = g;
  cx.fillRect(0, 0, 512, 256);
  // Soft sun glow on the warm side.
  const sun = cx.createRadialGradient(390, 78, 8, 390, 78, 110);
  sun.addColorStop(0, "rgba(255, 244, 210, 0.95)");
  sun.addColorStop(0.35, "rgba(255, 214, 140, 0.45)");
  sun.addColorStop(1, "rgba(255, 200, 120, 0)");
  cx.fillStyle = sun;
  cx.fillRect(0, 0, 512, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function leafMat(color = 0x3f8a3a) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.52,
    sheen: 0.35,
    sheenColor: 0xa8d878,
    side: THREE.DoubleSide,
  });
}

function addLeaf(parent, x, y, z, s, ang, mat, sway = []) {
  const leaf = new THREE.Mesh(_leafGeo, mat);
  leaf.position.set(x, y, z);
  leaf.scale.set(s, s, s);
  leaf.rotation.set(-0.85 - (ang % 1) * 0.25, ang, 0.12);
  leaf.castShadow = true;
  leaf.userData.sway = 0.045 + (s % 0.2) * 0.08;
  leaf.userData.swayPhase = ang * 1.7 + y;
  leaf.userData.baseRotX = leaf.rotation.x;
  leaf.userData.baseRotZ = leaf.rotation.z;
  parent.add(leaf);
  sway.push(leaf);
  return leaf;
}

function dewDrop(x, y, z, r = 0.035) {
  const d = new THREE.Mesh(
    _sphere,
    new THREE.MeshPhysicalMaterial({
      color: 0xc8f4ff,
      roughness: 0.04,
      metalness: 0.02,
      transmission: 0.55,
      thickness: 0.4,
      transparent: true,
      opacity: 0.78,
      emissive: 0x6ad4ee,
      emissiveIntensity: 0.18,
    })
  );
  d.position.set(x, y, z);
  d.scale.set(r, r * 1.15, r);
  return d;
}

function fruitCluster(x, z, fruits, sway) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const bed = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x3a6e32, roughness: 0.88 })
  );
  bed.position.y = 0.07;
  bed.scale.set(0.92, 0.11, 0.78);
  bed.receiveShadow = true;
  grp.add(bed);
  const lm = leafMat(0x4caa42);
  addLeaf(grp, 0.38, 0.13, 0.12, 0.46, 0.4, lm, sway);
  addLeaf(grp, -0.32, 0.12, 0.2, 0.42, 2.2, lm, sway);
  addLeaf(grp, 0.06, 0.11, -0.34, 0.4, 3.8, lm, sway);
  addLeaf(grp, 0.22, 0.1, -0.18, 0.28, 5.1, lm, sway);
  for (const f of fruits) {
    const mesh = new THREE.Mesh(
      _sphere,
      new THREE.MeshPhysicalMaterial({
        color: f.color,
        roughness: 0.28,
        metalness: 0.04,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
        emissive: f.emissive,
        emissiveIntensity: 0.34,
      })
    );
    mesh.position.set(f.dx, f.y, f.dz);
    mesh.scale.set(f.r, f.r * 0.84, f.r);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
    grp.add(dewDrop(f.dx + f.r * 0.35, f.y + f.r * 0.55, f.dz, 0.028));
  }
  const light = new THREE.PointLight(fruits[0].emissive, 0.62, 6.8);
  light.position.y = 0.48;
  grp.add(light);
  return grp;
}

function dewPool(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 0.018, z);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.88, 36),
    new THREE.MeshPhysicalMaterial({
      color: 0x6ad0e4,
      roughness: 0.04,
      metalness: 0.08,
      transmission: 0.28,
      thickness: 0.6,
      transparent: true,
      opacity: 0.86,
      emissive: 0x2a88aa,
      emissiveIntensity: 0.38,
    })
  );
  water.rotation.x = -Math.PI / 2;
  grp.add(water);
  const wet = new THREE.Mesh(
    new THREE.RingGeometry(0.88, 1.42, 36),
    new THREE.MeshStandardMaterial({ color: 0x4a7e3c, roughness: 0.9 })
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.y = 0.003;
  grp.add(wet);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    grp.add(dewDrop(Math.sin(a) * 1.05, 0.04, Math.cos(a) * 0.9, 0.03 + (i % 3) * 0.008));
  }
  const light = new THREE.PointLight(0x8ae4f6, 0.5, 5.8);
  light.position.y = 0.3;
  grp.add(light);
  return grp;
}

function shadePlant(x, z, sway) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const stem = new THREE.Mesh(
    _cyl,
    new THREE.MeshStandardMaterial({ color: 0x5c4830, roughness: 0.86 })
  );
  stem.position.y = 0.62;
  stem.scale.set(0.08, 1.24, 0.08);
  stem.castShadow = true;
  grp.add(stem);
  const canopy = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x2f7c38, roughness: 0.72 })
  );
  canopy.position.y = 1.38;
  canopy.scale.set(1.05, 0.72, 1.05);
  canopy.castShadow = true;
  grp.add(canopy);
  const lm = leafMat(0x3d9240);
  const leaves = [
    [0.48, 1.12, 0.18, 0.62, 0.3],
    [-0.42, 1.2, 0.32, 0.56, 2.1],
    [0.16, 1.42, -0.48, 0.64, 3.4],
    [0.52, 0.98, -0.26, 0.5, 5.0],
    [-0.5, 1.05, -0.22, 0.52, 4.1],
    [0.08, 1.55, 0.38, 0.58, 1.2],
    [-0.18, 1.48, -0.12, 0.48, 2.8],
    [0.32, 1.28, 0.42, 0.44, 0.7],
  ];
  for (const [lx, ly, lz, s, ang] of leaves) addLeaf(grp, lx, ly, lz, s, ang, lm, sway);
  // Hanging ripe fruit in the shade (taste + ORN, same food channel).
  const hang = new THREE.Mesh(
    _sphere,
    new THREE.MeshPhysicalMaterial({
      color: 0xe8a030,
      roughness: 0.3,
      emissive: 0xcc7700,
      emissiveIntensity: 0.28,
    })
  );
  hang.position.set(0.22, 0.82, 0.18);
  hang.scale.set(0.16, 0.14, 0.16);
  hang.castShadow = true;
  grp.add(hang);
  grp.add(dewDrop(0.28, 0.92, 0.18, 0.022));
  return grp;
}

function blossom(x, z, color, emissive, sway) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const stem = new THREE.Mesh(
    _cyl,
    new THREE.MeshStandardMaterial({ color: 0x3a6a32, roughness: 0.8 })
  );
  stem.position.y = 0.3;
  stem.scale.set(0.026, 0.6, 0.026);
  grp.add(stem);
  const lm = leafMat(0x3f8a38);
  addLeaf(grp, 0.12, 0.2, 0.02, 0.2, 0.6, lm, sway);
  addLeaf(grp, -0.1, 0.18, -0.04, 0.18, 2.5, lm, sway);
  const petalMat = new THREE.MeshPhysicalMaterial({
    color,
    emissive,
    emissiveIntensity: 0.38,
    roughness: 0.38,
    sheen: 0.55,
    sheenColor: color,
    side: THREE.DoubleSide,
  });
  const head = new THREE.Group();
  head.position.y = 0.64;
  head.userData.sway = 0.06;
  head.userData.swayPhase = x * 2 + z;
  head.userData.baseRotX = 0;
  head.userData.baseRotZ = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new THREE.Mesh(_leafGeo, petalMat);
    petal.position.set(Math.sin(a) * 0.13, 0.02, Math.cos(a) * 0.13);
    petal.scale.set(0.15, 0.15, 0.15);
    petal.rotation.set(-0.55, a, 0);
    petal.castShadow = true;
    head.add(petal);
  }
  const center = new THREE.Mesh(
    _sphere,
    new THREE.MeshPhysicalMaterial({
      color: 0xf7e48a,
      emissive: 0xccaa44,
      emissiveIntensity: 0.48,
      roughness: 0.36,
    })
  );
  center.scale.set(0.065, 0.065, 0.065);
  head.add(center);
  grp.add(head);
  sway.push(head);
  return grp;
}

function mossTuft(x, z, s = 1) {
  const m = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x3d7e38, roughness: 0.9 })
  );
  m.position.set(x, 0.065 * s, z);
  m.scale.set(0.24 * s, 0.085 * s, 0.2 * s);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function fern(x, z, sway) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const lm = leafMat(0x3a8a40);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    addLeaf(g, Math.sin(a) * 0.12, 0.16 + i * 0.02, Math.cos(a) * 0.12, 0.28, a, lm, sway);
  }
  return g;
}

function hedgeClump(ang, R, s, sway) {
  const g = new THREE.Group();
  const x = Math.sin(ang) * R;
  const z = Math.cos(ang) * R;
  g.position.set(x, 0, z);
  const bush = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({
      color: ang % 1 > 0.5 ? 0x3a7234 : 0x4a8a3c,
      roughness: 0.8,
    })
  );
  bush.position.y = 0.52 * s;
  bush.scale.set(0.68 * s, 0.58 * s, 0.68 * s);
  bush.castShadow = true;
  g.add(bush);
  const top = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x2f6e32, roughness: 0.76 })
  );
  top.position.set(0.14 * s, 0.88 * s, -0.1 * s);
  top.scale.set(0.44 * s, 0.38 * s, 0.44 * s);
  g.add(top);
  const lm = leafMat(0x458c3c);
  addLeaf(g, 0.28 * s, 0.62 * s, 0.1 * s, 0.42 * s, ang, lm, sway);
  addLeaf(g, -0.22 * s, 0.7 * s, -0.12 * s, 0.38 * s, ang + 1.4, lm, sway);
  return g;
}

function addGrassField(parent) {
  const n = 560;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4aa03c,
    roughness: 0.86,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(_cone, mat, n);
  mesh.receiveShadow = true;
  for (let i = 0; i < n; i++) {
    const ang = (i * 2.399963) % (Math.PI * 2);
    const r = 0.38 + ((i * 17) % 118) * 0.078;
    if (r > 9.6) {
      _dummy.scale.set(0, 0, 0);
    } else {
      // Short lawn blades at fly scale — not waist-high cones.
      _dummy.position.set(Math.sin(ang) * r, 0.055, Math.cos(ang) * r);
      _dummy.rotation.set(((i % 5) - 2) * 0.14, i * 0.7, ((i % 3) - 1) * 0.1);
      const sc = 0.7 + (i % 8) * 0.055;
      _dummy.scale.set(sc, 0.72 + (i % 5) * 0.1, sc);
    }
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  parent.add(mesh);
}

function assayBeaconAt(parent) {
  const beacon = new THREE.Group();
  beacon.name = "procBeacon";
  const pole = new THREE.Mesh(
    _cyl,
    new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xffaa33,
      emissiveIntensity: 0.55,
      roughness: 0.5,
    })
  );
  pole.position.y = 0.9;
  pole.scale.set(0.06, 1.4, 0.06);
  pole.castShadow = true;
  const ball = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({
      color: 0xffe088,
      emissive: 0xffcc44,
      emissiveIntensity: 0.7,
      roughness: 0.35,
    })
  );
  ball.position.y = 1.7;
  ball.scale.set(0.26, 0.26, 0.26);
  ball.castShadow = true;
  const glow = new THREE.PointLight(0xffcc66, 0.9, 7);
  glow.position.y = 1.7;
  beacon.add(pole, ball, glow);
  parent.add(beacon);
  parent.userData.assayBeacon = beacon;
  return beacon;
}

function makeSkyDome() {
  const geo = new THREE.SphereGeometry(52, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.54);
  const mat = new THREE.MeshBasicMaterial({
    map: makeSkyTexture(),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.position.y = -0.4;
  sky.name = "utopiaSky";
  return sky;
}

function makeSun() {
  const sun = new THREE.Mesh(
    _sphere,
    new THREE.MeshBasicMaterial({ color: 0xfff3c8, fog: false })
  );
  sun.position.set(18, 16, 12);
  sun.scale.setScalar(1.8);
  const halo = new THREE.PointLight(0xffe0a8, 0.55, 40);
  halo.position.copy(sun.position);
  const g = new THREE.Group();
  g.add(sun, halo);
  return g;
}

/** Garden features. Assay pole / bitter only when explicitly requested. */
export function featuresForChunk(_cx = 0, _cz = 0) {
  const assay = urlFlag("assay");
  const bitter = urlFlag("bitter");
  const feats = [
    { kind: "food", x: UTOPIA_FOOD.x, z: UTOPIA_FOOD.z, variant: "ripe", beacon: assay },
    { kind: "food", x: 2.85, z: -0.95, variant: "berries" },
    { kind: "food", x: -0.35, z: 2.35, variant: "ripe-small" },
    { kind: "water", x: UTOPIA_WATER.x, z: UTOPIA_WATER.z },
    { kind: "water", x: 1.15, z: -2.35, variant: "puddle" },
    { kind: "perch", x: UTOPIA_PERCH.x, z: UTOPIA_PERCH.z },
    { kind: "flower", x: 0.72, z: -1.35, color: 0xee7ab8, emissive: 0xcc4488 },
    { kind: "flower", x: -0.55, z: -1.72, color: 0xf2c85a, emissive: 0xddaa33 },
    { kind: "flower", x: 1.35, z: 0.42, color: 0xe878c0, emissive: 0xbb3377 },
    { kind: "flower", x: -2.05, z: 0.55, color: 0xf4d070, emissive: 0xcc9933 },
    { kind: "flower", x: 0.15, z: 1.65, color: 0xf0a0d0, emissive: 0xcc6699 },
    { kind: "flower", x: 2.15, z: 2.05, color: 0xffe08a, emissive: 0xddbb44 },
  ];
  if (bitter) feats.push({ kind: "bitter", x: 5.6, z: 5.2 });
  return feats;
}

export class ProceduralWorld {
  constructor(opts = {}) {
    this.radius = opts.radius || ARENA_R;
    this.softLimit = opts.softLimit ?? WORLD_SOFT_LIMIT;
    this.group = new THREE.Group();
    this.group.name = "flyUtopia";
    this._allFeatures = [];
    this._sway = [];
    this._t = 0;
    this.food = new THREE.Object3D();
    this.water = new THREE.Object3D();
    this.bitter = new THREE.Object3D();
    this.perch = new THREE.Object3D();
    this.foods = [];
    this.flowers = [];
    this.waters = [];
    this.perch.userData = { ...UTOPIA_PERCH };
    this.food.position.set(UTOPIA_FOOD.x, 0.12, UTOPIA_FOOD.z);
    this.water.position.set(UTOPIA_WATER.x, 0.12, UTOPIA_WATER.z);
    this.bitter.position.set(-99, 0.12, -99);
    this.group.userData = {
      food: this.food,
      water: this.water,
      bitter: this.bitter,
      perch: this.perch,
      foods: this.foods,
      flowers: this.flowers,
      waters: this.waters,
      procedural: true,
      smallArena: true,
      utopia: true,
      world: this,
    };
    this._build();
  }

  get root() {
    return this.group;
  }

  _build() {
    const R = this.radius;
    const sway = this._sway;
    this.group.add(makeSkyDome());
    this.group.add(makeSun());
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 80),
      new THREE.MeshStandardMaterial({
        map: makeFloorTexture(),
        color: 0xc4e094,
        roughness: 0.9,
        metalness: 0.02,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    addGrassField(this.group);

    for (let i = 0; i < 32; i++) {
      const ang = (i / 32) * Math.PI * 2;
      const s = 0.9 + (i % 5) * 0.11;
      this.group.add(hedgeClump(ang, R - 0.12, s, sway));
    }

    const tufts = [
      [1.0, 1.25, 1.15], [-0.8, 1.5, 1.0], [1.65, -0.75, 1.05],
      [-1.35, 0.55, 1.2], [0.35, -0.95, 0.85], [-0.28, -0.42, 0.7],
      [2.35, 0.5, 1.0], [-2.35, -0.7, 0.9], [0.82, 2.15, 0.95],
      [-1.85, 2.0, 0.8], [2.75, -1.7, 1.1], [-0.15, 2.5, 0.75],
      [1.5, 1.8, 0.88], [-2.7, 1.0, 1.05], [0.48, 0.62, 0.65],
      [0.9, -2.05, 0.78], [-0.9, -1.35, 0.7],
    ];
    for (const [x, z, s] of tufts) this.group.add(mossTuft(x, z, s));
    this.group.add(fern(-0.95, 0.85, sway));
    this.group.add(fern(1.55, -0.35, sway));
    this.group.add(fern(-2.15, -0.95, sway));

    const feats = featuresForChunk(0, 0);
    const built = [];
    for (const f of feats) {
      let obj = null;
      if (f.kind === "food" && f.variant === "ripe") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.46, dx: 0, y: 0.32, dz: 0, color: 0xe8a030, emissive: 0xcc7700 },
          { r: 0.32, dx: 0.36, y: 0.24, dz: 0.12, color: 0xd4782a, emissive: 0xaa4400 },
          { r: 0.28, dx: -0.28, y: 0.22, dz: 0.18, color: 0xf0c050, emissive: 0xcc9900 },
          { r: 0.22, dx: 0.08, y: 0.2, dz: -0.26, color: 0xe09028, emissive: 0xbb6600 },
        ], sway);
        this.food.position.set(f.x, 0.12, f.z);
        this.foods.push({ x: f.x, z: f.z, r: 0.62 });
        if (f.beacon) assayBeaconAt(obj);
      } else if (f.kind === "food" && f.variant === "ripe-small") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.26, dx: 0, y: 0.22, dz: 0, color: 0xf0b040, emissive: 0xcc8800 },
          { r: 0.18, dx: 0.2, y: 0.18, dz: 0.08, color: 0xe09028, emissive: 0xbb6600 },
        ], sway);
        this.foods.push({ x: f.x, z: f.z, r: 0.36 });
      } else if (f.kind === "food") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.18, dx: 0, y: 0.18, dz: 0, color: 0xb03050, emissive: 0x881133 },
          { r: 0.15, dx: 0.2, y: 0.16, dz: 0.1, color: 0xc04060, emissive: 0x991144 },
          { r: 0.14, dx: -0.16, y: 0.15, dz: 0.12, color: 0x982848, emissive: 0x771122 },
          { r: 0.13, dx: 0.05, y: 0.15, dz: -0.18, color: 0xaa3858, emissive: 0x881133 },
        ], sway);
        this.foods.push({ x: f.x, z: f.z, r: 0.32 });
      } else if (f.kind === "water") {
        if (f.variant === "puddle") {
          obj = dewPool(f.x, f.z);
          obj.scale.setScalar(0.55);
        } else {
          obj = dewPool(f.x, f.z);
          this.water.position.set(f.x, 0.12, f.z);
        }
        this.waters.push({ x: f.x, z: f.z });
      } else if (f.kind === "perch") {
        obj = shadePlant(f.x, f.z, sway);
        this.perch.position.set(f.x, 0, f.z);
        this.perch.userData = { x: f.x, z: f.z, r: UTOPIA_PERCH.r, h: UTOPIA_PERCH.h };
        this.foods.push({ x: f.x + 0.22, z: f.z + 0.18, r: 0.22 });
      } else if (f.kind === "flower") {
        obj = blossom(f.x, f.z, f.color, f.emissive, sway);
        this.flowers.push({ x: f.x, z: f.z });
      } else if (f.kind === "bitter") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.28, dx: 0, y: 0.2, dz: 0, color: 0x3d6b2e, emissive: 0x2a4a18 },
        ], sway);
        this.bitter.position.set(f.x, 0.12, f.z);
      }
      if (obj) {
        this.group.add(obj);
        built.push({ ...f, object: obj });
      }
    }
    this._allFeatures = built;
    this.group.userData.foods = this.foods;
    this.group.userData.flowers = this.flowers;
    this.group.userData.waters = this.waters;
    this.group.userData.assayBeacon = built.some((f) => f.beacon);
  }

  update(_x = 0, _z = 0, t = 0) {
    this._t = t || this._t;
    const tt = this._t;
    for (const o of this._sway) {
      const a = o.userData.sway || 0.04;
      const p = o.userData.swayPhase || 0;
      const bx = o.userData.baseRotX ?? o.rotation.x;
      const bz = o.userData.baseRotZ ?? 0;
      o.rotation.z = bz + Math.sin(tt * 0.85 + p) * a;
      o.rotation.x = bx + Math.sin(tt * 0.62 + p * 1.2) * a * 0.45;
    }
  }

  landmarksNear(x, z, maxDist = 18) {
    const out = [];
    const md2 = maxDist * maxDist;
    for (const f of this._allFeatures) {
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 > md2) continue;
      if (f.kind === "food") {
        out.push({
          x: f.x, y: f.beacon ? 1.7 : 0.32, z: f.z,
          r: f.beacon ? 0.4 : (f.variant === "ripe" ? 0.58 : 0.32),
          kind: "food",
        });
      } else if (f.kind === "water") {
        out.push({ x: f.x, y: 0.1, z: f.z, r: f.variant === "puddle" ? 0.5 : 0.85, kind: "water" });
      } else if (f.kind === "perch") {
        out.push({ x: f.x, y: 1.15, z: f.z, r: 0.85, kind: "perch" });
      } else if (f.kind === "flower") {
        out.push({ x: f.x, y: 0.64, z: f.z, r: 0.26, kind: "flower" });
      } else if (f.kind === "bitter") {
        out.push({ x: f.x, y: 0.22, z: f.z, r: 0.35, kind: "bitter" });
      }
    }
    return out;
  }

  stats() {
    return {
      chunks: 1,
      features: this._allFeatures.length,
      chunk: [0, 0],
      softLimit: this.softLimit,
      arenaR: this.radius,
      smallArena: true,
      utopia: true,
    };
  }
}

/** Garden home (name kept for app.js import). */
export function createOpenWorld() {
  return new ProceduralWorld();
}
