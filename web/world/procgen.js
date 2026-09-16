/**
 * Fly utopia — a lush garden home (not a dish, cage, or stick-prop pad).
 * Soft grass, warm sky, fruit on leaf beds, dew, shade canopy, blossoms.
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
export const UTOPIA_FOOD = { x: 2.2, z: 1.6 };
export const UTOPIA_WATER = { x: -1.8, z: 1.8 };
export const UTOPIA_PERCH = { x: -1.6, z: -2.2, r: 0.55, h: 1.35 };
export const UTOPIA_HOME = { x: 0.15, z: 0.2 };

const _leafGeo = new THREE.CircleGeometry(1, 11);
const _sphere = new THREE.SphereGeometry(1, 12, 10);
const _cyl = new THREE.CylinderGeometry(1, 1, 1, 8);

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
  chk.width = 512;
  chk.height = 512;
  const cx = chk.getContext("2d");
  cx.fillStyle = "#3d6a32";
  cx.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 340; k++) {
    const x = (k * 97 + 40) % 512;
    const y = (k * 53 + 18) % 512;
    const r = 10 + (k % 22);
    const g = cx.createRadialGradient(x, y, 1, x, y, r);
    const moss = k % 4 === 0 ? "rgba(92, 150, 58, 0.62)" : "rgba(58, 110, 42, 0.5)";
    g.addColorStop(0, moss);
    g.addColorStop(1, "rgba(45, 90, 38, 0)");
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, r, 0, Math.PI * 2);
    cx.fill();
  }
  cx.fillStyle = "rgba(210, 180, 70, 0.16)";
  for (let k = 0; k < 90; k++) {
    cx.fillRect((k * 131) % 512, (k * 79) % 512, 3, 3);
  }
  const tex = new THREE.CanvasTexture(chk);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.4, 3.4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function leafMat(color = 0x3f8a3a) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.58,
    side: THREE.DoubleSide,
  });
}

function addLeaf(parent, x, y, z, s, ang, mat) {
  const leaf = new THREE.Mesh(_leafGeo, mat);
  leaf.position.set(x, y, z);
  leaf.scale.set(s, s, s);
  leaf.rotation.set(-0.85 - (ang % 1) * 0.25, ang, 0.12);
  leaf.castShadow = true;
  parent.add(leaf);
  return leaf;
}

function fruitCluster(x, z, fruits) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const bed = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x3a6e32, roughness: 0.9 })
  );
  bed.position.y = 0.08;
  bed.scale.set(0.85, 0.12, 0.7);
  bed.receiveShadow = true;
  grp.add(bed);
  const lm = leafMat(0x4a9a40);
  addLeaf(grp, 0.35, 0.12, 0.1, 0.42, 0.4, lm);
  addLeaf(grp, -0.28, 0.11, 0.18, 0.38, 2.2, lm);
  addLeaf(grp, 0.05, 0.1, -0.32, 0.36, 3.8, lm);
  for (const f of fruits) {
    const mesh = new THREE.Mesh(
      _sphere,
      new THREE.MeshPhysicalMaterial({
        color: f.color,
        roughness: 0.34,
        metalness: 0.03,
        emissive: f.emissive,
        emissiveIntensity: 0.28,
      })
    );
    mesh.position.set(f.dx, f.y, f.dz);
    mesh.scale.set(f.r, f.r * 0.82, f.r);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
  }
  const light = new THREE.PointLight(fruits[0].emissive, 0.55, 6.2);
  light.position.y = 0.5;
  grp.add(light);
  return grp;
}

function dewPool(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 0.02, z);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0x5ec4d8,
      roughness: 0.06,
      metalness: 0.12,
      transparent: true,
      opacity: 0.82,
      emissive: 0x247a99,
      emissiveIntensity: 0.32,
    })
  );
  water.rotation.x = -Math.PI / 2;
  grp.add(water);
  const wet = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.45, 32),
    new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.92 })
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.y = 0.004;
  grp.add(wet);
  const light = new THREE.PointLight(0x7ad4ee, 0.42, 5.5);
  light.position.y = 0.32;
  grp.add(light);
  return grp;
}

function shadePlant(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const stem = new THREE.Mesh(
    _cyl,
    new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.86 })
  );
  stem.position.y = 0.55;
  stem.scale.set(0.07, 1.1, 0.07);
  stem.castShadow = true;
  grp.add(stem);
  const canopy = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x2f7a38, roughness: 0.78 })
  );
  canopy.position.y = 1.22;
  canopy.scale.set(0.85, 0.62, 0.85);
  canopy.castShadow = true;
  grp.add(canopy);
  const lm = leafMat(0x3d8c3a);
  const leaves = [
    [0.4, 1.05, 0.15, 0.55, 0.3],
    [-0.35, 1.12, 0.28, 0.5, 2.1],
    [0.12, 1.28, -0.4, 0.58, 3.4],
    [0.45, 0.92, -0.22, 0.46, 5.0],
    [-0.42, 0.98, -0.18, 0.48, 4.1],
    [0.05, 1.38, 0.32, 0.52, 1.2],
  ];
  for (const [lx, ly, lz, s, ang] of leaves) addLeaf(grp, lx, ly, lz, s, ang, lm);
  return grp;
}

function blossom(x, z, color, emissive) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const stem = new THREE.Mesh(
    _cyl,
    new THREE.MeshStandardMaterial({ color: 0x3a6a32, roughness: 0.8 })
  );
  stem.position.y = 0.32;
  stem.scale.set(0.028, 0.64, 0.028);
  grp.add(stem);
  const lm = leafMat(0x3f8a38);
  addLeaf(grp, 0.12, 0.22, 0.02, 0.22, 0.6, lm);
  addLeaf(grp, -0.1, 0.2, -0.04, 0.2, 2.5, lm);
  const petalMat = new THREE.MeshPhysicalMaterial({
    color,
    emissive,
    emissiveIntensity: 0.32,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(_leafGeo, petalMat);
    petal.position.set(Math.sin(a) * 0.12, 0.68, Math.cos(a) * 0.12);
    petal.scale.set(0.14, 0.14, 0.14);
    petal.rotation.set(-0.55, a, 0);
    petal.castShadow = true;
    grp.add(petal);
  }
  const center = new THREE.Mesh(
    _sphere,
    new THREE.MeshPhysicalMaterial({
      color: 0xf5e08a,
      emissive: 0xccaa44,
      emissiveIntensity: 0.4,
      roughness: 0.4,
    })
  );
  center.position.y = 0.7;
  center.scale.set(0.07, 0.07, 0.07);
  grp.add(center);
  return grp;
}

function mossTuft(x, z, s = 1) {
  const m = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x3d7a38, roughness: 0.92 })
  );
  m.position.set(x, 0.07 * s, z);
  m.scale.set(0.22 * s, 0.08 * s, 0.18 * s);
  m.castShadow = true;
  return m;
}

function hedgeClump(ang, R, s) {
  const g = new THREE.Group();
  const x = Math.sin(ang) * R;
  const z = Math.cos(ang) * R;
  g.position.set(x, 0, z);
  const bush = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({
      color: ang % 1 > 0.5 ? 0x3a6e34 : 0x4a823c,
      roughness: 0.84,
    })
  );
  bush.position.y = 0.42 * s;
  bush.scale.set(0.55 * s, 0.48 * s, 0.55 * s);
  bush.castShadow = true;
  g.add(bush);
  const top = new THREE.Mesh(
    _sphere,
    new THREE.MeshStandardMaterial({ color: 0x2f6a32, roughness: 0.8 })
  );
  top.position.set(0.12 * s, 0.72 * s, -0.08 * s);
  top.scale.set(0.38 * s, 0.32 * s, 0.38 * s);
  g.add(top);
  return g;
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
  const geo = new THREE.SphereGeometry(48, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xf3d7b0,
    side: THREE.BackSide,
    fog: true,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.position.y = -0.2;
  sky.name = "utopiaSky";
  return sky;
}

/** Garden features. Assay pole / bitter only when explicitly requested. */
export function featuresForChunk(_cx = 0, _cz = 0) {
  const assay = urlFlag("assay");
  const bitter = urlFlag("bitter");
  const feats = [
    { kind: "food", x: UTOPIA_FOOD.x, z: UTOPIA_FOOD.z, variant: "ripe", beacon: assay },
    { kind: "food", x: 3.4, z: -1.15, variant: "berries" },
    { kind: "water", x: UTOPIA_WATER.x, z: UTOPIA_WATER.z },
    { kind: "perch", x: UTOPIA_PERCH.x, z: UTOPIA_PERCH.z },
    { kind: "flower", x: 0.85, z: -1.7, color: 0xe878b8, emissive: 0xcc4488 },
    { kind: "flower", x: -0.7, z: -2.05, color: 0xf0c85a, emissive: 0xddaa33 },
    { kind: "flower", x: 1.55, z: 0.35, color: 0xe070b0, emissive: 0xbb3377 },
    { kind: "flower", x: -2.4, z: 0.4, color: 0xf4d070, emissive: 0xcc9933 },
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
    this.food = new THREE.Object3D();
    this.water = new THREE.Object3D();
    this.bitter = new THREE.Object3D();
    this.perch = new THREE.Object3D();
    this.foods = [];
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
    this.group.add(makeSkyDome());
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 80),
      new THREE.MeshStandardMaterial({
        map: makeFloorTexture(),
        color: 0xb8d48a,
        roughness: 0.92,
        metalness: 0.02,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2;
      const s = 0.85 + (i % 5) * 0.12;
      this.group.add(hedgeClump(ang, R - 0.15, s));
    }

    const tufts = [
      [1.1, 1.4, 1.15], [-0.9, 1.7, 1.0], [1.8, -0.9, 1.05],
      [-1.5, 0.6, 1.2], [0.4, -1.15, 0.85], [-0.35, -0.55, 0.7],
      [2.6, 0.55, 1.0], [-2.6, -0.8, 0.9], [0.9, 2.4, 0.95],
      [-2.1, 2.2, 0.8], [3.1, -2.0, 1.1], [-0.2, 2.8, 0.75],
      [1.7, 2.0, 0.88], [-3.0, 1.1, 1.05], [0.55, 0.7, 0.65],
    ];
    for (const [x, z, s] of tufts) this.group.add(mossTuft(x, z, s));

    const feats = featuresForChunk(0, 0);
    const built = [];
    for (const f of feats) {
      let obj = null;
      if (f.kind === "food" && f.variant === "ripe") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.48, dx: 0, y: 0.34, dz: 0, color: 0xe8a030, emissive: 0xcc7700 },
          { r: 0.34, dx: 0.38, y: 0.26, dz: 0.12, color: 0xd4782a, emissive: 0xaa4400 },
          { r: 0.3, dx: -0.3, y: 0.24, dz: 0.2, color: 0xf0c050, emissive: 0xcc9900 },
          { r: 0.24, dx: 0.08, y: 0.22, dz: -0.28, color: 0xe09028, emissive: 0xbb6600 },
        ]);
        this.food.position.set(f.x, 0.12, f.z);
        this.foods.push({ x: f.x, z: f.z });
        if (f.beacon) assayBeaconAt(obj);
      } else if (f.kind === "food") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.2, dx: 0, y: 0.2, dz: 0, color: 0xb03050, emissive: 0x881133 },
          { r: 0.17, dx: 0.22, y: 0.17, dz: 0.1, color: 0xc04060, emissive: 0x991144 },
          { r: 0.16, dx: -0.18, y: 0.16, dz: 0.14, color: 0x982848, emissive: 0x771122 },
          { r: 0.15, dx: 0.06, y: 0.16, dz: -0.2, color: 0xaa3858, emissive: 0x881133 },
        ]);
        this.foods.push({ x: f.x, z: f.z });
      } else if (f.kind === "water") {
        obj = dewPool(f.x, f.z);
        this.water.position.set(f.x, 0.12, f.z);
      } else if (f.kind === "perch") {
        obj = shadePlant(f.x, f.z);
        this.perch.position.set(f.x, 0, f.z);
        this.perch.userData = { x: f.x, z: f.z, r: UTOPIA_PERCH.r, h: UTOPIA_PERCH.h };
      } else if (f.kind === "flower") {
        obj = blossom(f.x, f.z, f.color, f.emissive);
      } else if (f.kind === "bitter") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.28, dx: 0, y: 0.2, dz: 0, color: 0x3d6b2e, emissive: 0x2a4a18 },
        ]);
        this.bitter.position.set(f.x, 0.12, f.z);
      }
      if (obj) {
        this.group.add(obj);
        built.push({ ...f, object: obj });
      }
    }
    this._allFeatures = built;
    this.group.userData.foods = this.foods;
    this.group.userData.assayBeacon = built.some((f) => f.beacon);
  }

  update(_x = 0, _z = 0) {
    // garden is static
  }

  landmarksNear(x, z, maxDist = 18) {
    const out = [];
    const md2 = maxDist * maxDist;
    for (const f of this._allFeatures) {
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 > md2) continue;
      if (f.kind === "food") {
        out.push({
          x: f.x, y: f.beacon ? 1.7 : 0.36, z: f.z,
          r: f.beacon ? 0.4 : (f.variant === "ripe" ? 0.62 : 0.36),
          kind: "food",
        });
      } else if (f.kind === "water") {
        out.push({ x: f.x, y: 0.12, z: f.z, r: 0.9, kind: "water" });
      } else if (f.kind === "perch") {
        out.push({ x: f.x, y: 1.1, z: f.z, r: 0.7, kind: "perch" });
      } else if (f.kind === "flower") {
        out.push({ x: f.x, y: 0.7, z: f.z, r: 0.28, kind: "flower" });
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
