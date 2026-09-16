/**
 * Fly utopia — a cozy garden home (not a dish, cage, or aggression arena).
 * Soft moss floor, warm light, fruit + dew + shade + blossoms.
 * Rim is a garden hedge: bounce/redirect, never punish.
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
export const UTOPIA_FOOD = { x: 3.4, z: 2.1 };
export const UTOPIA_WATER = { x: -3.2, z: 2.5 };
export const UTOPIA_PERCH = { x: -2.4, z: -3.4, r: 0.42, h: 1.12 };
export const UTOPIA_HOME = { x: 0.2, z: 0.35 };

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
  // Warm earth base
  cx.fillStyle = "#6a5c40";
  cx.fillRect(0, 0, 512, 512);
  // Moss dapples
  for (let k = 0; k < 220; k++) {
    const x = (k * 97 + 40) % 512;
    const y = (k * 53 + 18) % 512;
    const r = 12 + (k % 17);
    const g = cx.createRadialGradient(x, y, 1, x, y, r);
    const moss = k % 3 === 0 ? "rgba(92, 132, 62, 0.50)" : "rgba(110, 112, 52, 0.38)";
    g.addColorStop(0, moss);
    g.addColorStop(1, "rgba(58, 51, 36, 0)");
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, r, 0, Math.PI * 2);
    cx.fill();
  }
  // Soft gold flecks (fallen pollen / sun)
  cx.fillStyle = "rgba(232, 196, 110, 0.14)";
  for (let k = 0; k < 80; k++) {
    cx.fillRect((k * 131) % 512, (k * 79) % 512, 3, 3);
  }
  const tex = new THREE.CanvasTexture(chk);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 2.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fruitCluster(x, z, fruits) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  for (const f of fruits) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(f.r, 14, 12),
      new THREE.MeshPhysicalMaterial({
        color: f.color,
        roughness: 0.38,
        metalness: 0.04,
        emissive: f.emissive,
        emissiveIntensity: 0.22,
      })
    );
    mesh.position.set(f.dx, f.y, f.dz);
    mesh.scale.set(1, 0.78, 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
  }
  const light = new THREE.PointLight(fruits[0].emissive, 0.48, 5.5);
  light.position.y = 0.45;
  grp.add(light);
  return grp;
}

function dewPool(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 0.02, z);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.78, 28),
    new THREE.MeshPhysicalMaterial({
      color: 0x4aa8c8,
      roughness: 0.08,
      metalness: 0.18,
      transparent: true,
      opacity: 0.78,
      emissive: 0x226688,
      emissiveIntensity: 0.26,
    })
  );
  water.rotation.x = -Math.PI / 2;
  grp.add(water);
  const wet = new THREE.Mesh(
    new THREE.RingGeometry(0.78, 1.12, 28),
    new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.92 })
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.y = 0.004;
  grp.add(wet);
  const light = new THREE.PointLight(0x66ccee, 0.38, 4.8);
  light.position.y = 0.28;
  grp.add(light);
  return grp;
}

function shadePlant(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.09, 1.15, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.86 })
  );
  stem.position.y = 0.58;
  stem.castShadow = true;
  grp.add(stem);
  const leafMat = new THREE.MeshPhysicalMaterial({
    color: 0x3d6b3a,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  const leaves = [
    [0.25, 1.08, 1.0],
    [2.15, 0.96, 0.88],
    [-1.55, 1.14, 0.92],
  ];
  for (const [ang, y, s] of leaves) {
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.58 * s, 12), leafMat);
    leaf.position.set(Math.sin(ang) * 0.28, y, Math.cos(ang) * 0.28);
    leaf.rotation.set(-0.95, ang, 0.18);
    leaf.castShadow = true;
    grp.add(leaf);
  }
  return grp;
}

function blossom(x, z, color, emissive) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.032, 0.72, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a6a32, roughness: 0.8 })
  );
  stem.position.y = 0.36;
  grp.add(stem);
  const bloom = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 10, 8),
    new THREE.MeshPhysicalMaterial({
      color,
      emissive,
      emissiveIntensity: 0.38,
      roughness: 0.42,
    })
  );
  bloom.position.y = 0.78;
  bloom.castShadow = true;
  grp.add(bloom);
  return grp;
}

function mossTuft(x, z, s = 1) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.16 * s, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a6a38, roughness: 0.92 })
  );
  m.position.set(x, 0.06 * s, z);
  m.scale.set(1.4, 0.45, 1.1);
  m.castShadow = true;
  return m;
}

function assayBeaconAt(parent) {
  const beacon = new THREE.Group();
  beacon.name = "procBeacon";
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 1.4, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xffaa33,
      emissiveIntensity: 0.55,
      roughness: 0.5,
    })
  );
  pole.position.y = 0.9;
  pole.castShadow = true;
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshStandardMaterial({
      color: 0xffe088,
      emissive: 0xffcc44,
      emissiveIntensity: 0.7,
      roughness: 0.35,
    })
  );
  ball.position.y = 1.7;
  ball.castShadow = true;
  const glow = new THREE.PointLight(0xffcc66, 0.9, 7);
  glow.position.y = 1.7;
  beacon.add(pole, ball, glow);
  parent.add(beacon);
  parent.userData.assayBeacon = beacon;
  return beacon;
}

/** Garden features. Assay pole / bitter only when explicitly requested. */
export function featuresForChunk(_cx = 0, _cz = 0) {
  const assay = urlFlag("assay");
  const bitter = urlFlag("bitter");
  const feats = [
    { kind: "food", x: UTOPIA_FOOD.x, z: UTOPIA_FOOD.z, variant: "ripe", beacon: assay },
    { kind: "food", x: 4.8, z: -1.6, variant: "berries" },
    { kind: "water", x: UTOPIA_WATER.x, z: UTOPIA_WATER.z },
    { kind: "perch", x: UTOPIA_PERCH.x, z: UTOPIA_PERCH.z },
    { kind: "flower", x: 1.0, z: -4.0, color: 0xe070b0, emissive: 0xcc4488 },
    { kind: "flower", x: -4.4, z: -1.2, color: 0xf0d060, emissive: 0xddaa33 },
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
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 80),
      new THREE.MeshStandardMaterial({
        map: makeFloorTexture(),
        color: 0xd4c49a,
        roughness: 0.94,
        metalness: 0.02,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Garden hedge — visual soft rim, not a cage wall.
    const hedge = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.22, 8, 80),
      new THREE.MeshStandardMaterial({ color: 0x4a5c38, roughness: 0.82 })
    );
    hedge.rotation.x = Math.PI / 2;
    hedge.position.y = 0.12;
    this.group.add(hedge);
    const berm = new THREE.Mesh(
      new THREE.TorusGeometry(R - 0.15, 0.1, 6, 64),
      new THREE.MeshStandardMaterial({ color: 0x6b7a48, roughness: 0.88 })
    );
    berm.rotation.x = Math.PI / 2;
    berm.position.y = 0.22;
    this.group.add(berm);

    // A few moss tufts so the clearing isn't empty dirt.
    const tufts = [
      [1.6, 3.4, 1.1], [-1.2, 4.1, 0.9], [2.8, -3.2, 1.0],
      [-5.2, 1.6, 1.2], [6.2, 0.4, 0.85], [-0.8, -2.2, 0.7],
      [5.4, 3.6, 0.95], [-4.0, 4.4, 0.8],
    ];
    for (const [x, z, s] of tufts) this.group.add(mossTuft(x, z, s));

    const feats = featuresForChunk(0, 0);
    const built = [];
    for (const f of feats) {
      let obj = null;
      if (f.kind === "food" && f.variant === "ripe") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.38, dx: 0, y: 0.28, dz: 0, color: 0xe8a030, emissive: 0xcc7700 },
          { r: 0.26, dx: 0.32, y: 0.22, dz: 0.1, color: 0xd4782a, emissive: 0xaa4400 },
          { r: 0.22, dx: -0.24, y: 0.2, dz: 0.18, color: 0xf0c050, emissive: 0xcc9900 },
        ]);
        this.food.position.set(f.x, 0.12, f.z);
        this.foods.push({ x: f.x, z: f.z });
        if (f.beacon) assayBeaconAt(obj);
      } else if (f.kind === "food") {
        obj = fruitCluster(f.x, f.z, [
          { r: 0.16, dx: 0, y: 0.16, dz: 0, color: 0xb03050, emissive: 0x881133 },
          { r: 0.14, dx: 0.18, y: 0.14, dz: 0.08, color: 0xc04060, emissive: 0x991144 },
          { r: 0.13, dx: -0.14, y: 0.13, dz: 0.12, color: 0x982848, emissive: 0x771122 },
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
          x: f.x, y: f.beacon ? 1.7 : 0.32, z: f.z,
          r: f.beacon ? 0.4 : (f.variant === "ripe" ? 0.55 : 0.32),
          kind: "food",
        });
      } else if (f.kind === "water") {
        out.push({ x: f.x, y: 0.12, z: f.z, r: 0.72, kind: "water" });
      } else if (f.kind === "perch") {
        out.push({ x: f.x, y: 0.9, z: f.z, r: 0.5, kind: "perch" });
      } else if (f.kind === "flower") {
        out.push({ x: f.x, y: 0.78, z: f.z, r: 0.22, kind: "flower" });
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
