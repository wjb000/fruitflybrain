/**
 * Small simple arena — compact pad (~old dish scale), few landmarks.
 * No infinite chunk streaming. Soft XY rim so the fly doesn't walk off forever.
 */
import * as THREE from "three";

/** Playable pad radius (world units). Soft clamp slightly inside. */
export const ARENA_R = 18;
export const WORLD_SOFT_LIMIT = ARENA_R - 2.2; // ~15.8
/** @deprecated open-world chunk constants kept for import compatibility */
export const CHUNK_SIZE = ARENA_R * 2;
export const LOAD_R = 0;
export const UNLOAD_R = 0;

function makeFloorTexture() {
  const chk = document.createElement("canvas");
  chk.width = 512;
  chk.height = 512;
  const cx = chk.getContext("2d");
  const n = 16;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dark = (i + j) & 1;
      cx.fillStyle = dark ? "#1c2230" : "#141820";
      cx.fillRect(i * 32, j * 32, 32, 32);
    }
  }
  cx.fillStyle = "rgba(200,210,230,0.05)";
  for (let k = 0; k < 60; k++) {
    cx.fillRect((k * 97) % 512, (k * 53) % 512, 2, 2);
  }
  const tex = new THREE.CanvasTexture(chk);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drop(color, emissive, x, z, y = 0.12) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 14, 10),
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.15,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
      emissive,
      emissiveIntensity: 0.35,
    })
  );
  mesh.scale.set(1, 0.55, 1);
  mesh.castShadow = true;
  grp.add(mesh);
  const light = new THREE.PointLight(emissive, 0.95, 7);
  light.position.y = 0.4;
  grp.add(light);
  return grp;
}

function beaconAt(parent) {
  const beacon = new THREE.Group();
  beacon.name = "procBeacon";
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 1.7, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffaa22,
      emissive: 0xff7700,
      emissiveIntensity: 1.0,
      roughness: 0.45,
    })
  );
  pole.position.y = 1.0;
  pole.castShadow = true;
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 10),
    new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffaa00,
      emissiveIntensity: 1.45,
      roughness: 0.3,
    })
  );
  ball.position.y = 1.95;
  ball.castShadow = true;
  const glow = new THREE.PointLight(0xffaa33, 1.8, 9);
  glow.position.y = 1.95;
  beacon.add(pole, ball, glow);
  parent.add(beacon);
  parent.userData.assayBeacon = beacon;
  return beacon;
}

/** Fixed tiny feature set — food+beacon, water, one rock. */
export function featuresForChunk(_cx = 0, _cz = 0) {
  return [
    { kind: "food", x: 6.5, z: 4.2, beacon: true },
    { kind: "water", x: -5.5, z: -3.8 },
    { kind: "rock", x: 3.8, z: -6.2 },
  ];
}

export class ProceduralWorld {
  constructor(opts = {}) {
    this.radius = opts.radius || ARENA_R;
    this.softLimit = opts.softLimit ?? WORLD_SOFT_LIMIT;
    this.group = new THREE.Group();
    this.group.name = "procWorld";
    this._allFeatures = [];
    this.food = new THREE.Object3D();
    this.water = new THREE.Object3D();
    this.bitter = new THREE.Object3D(); // unused in small arena; keep API
    this.perch = new THREE.Object3D();
    this.perch.userData = { x: 3.8, z: -6.2, r: 0.45, h: 0.5 };
    this.food.position.set(6.5, 0.12, 4.2);
    this.water.position.set(-5.5, 0.12, -3.8);
    this.bitter.position.set(-99, 0.12, -99);
    this.group.userData = {
      food: this.food,
      water: this.water,
      bitter: this.bitter,
      perch: this.perch,
      procedural: true,
      smallArena: true,
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
      new THREE.CircleGeometry(R, 72),
      new THREE.MeshStandardMaterial({
        map: makeFloorTexture(),
        color: 0xc8d0dc,
        roughness: 0.92,
        metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Soft visual rim (not a hard cage collider).
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.14, 8, 80),
      new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.65 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.14;
    this.group.add(rim);

    const grid = new THREE.GridHelper(R * 2, 18, 0x2a3140, 0x1e2430);
    grid.position.y = 0.012;
    this.group.add(grid);

    const feats = featuresForChunk(0, 0);
    const built = [];
    for (const f of feats) {
      let obj = null;
      if (f.kind === "food") {
        obj = drop(0xffcc44, 0xff9900, f.x, f.z);
        obj.traverse((o) => {
          if (o.isMesh && o.material?.emissive) o.material.emissiveIntensity = 0.95;
          if (o.isLight) o.intensity = 1.8;
        });
        if (f.beacon) beaconAt(obj);
      } else if (f.kind === "water") {
        obj = drop(0x4aa8ff, 0x3388ff, f.x, f.z);
      } else if (f.kind === "rock") {
        obj = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.55, 0),
          new THREE.MeshStandardMaterial({ color: 0x4a5060, roughness: 0.85 })
        );
        obj.position.set(f.x, 0.28, f.z);
        obj.castShadow = true;
        this.perch.position.set(f.x, 0, f.z);
        this.perch.userData = { x: f.x, z: f.z, r: 0.45, h: 0.55 };
      }
      if (obj) {
        this.group.add(obj);
        built.push({ ...f, object: obj });
      }
    }
    this._allFeatures = built;
  }

  /** Soft-rim helper for callers; world itself is static. */
  update(_x = 0, _z = 0) {
    // fixed scene — nothing to stream
  }

  landmarksNear(x, z, maxDist = 22) {
    const out = [];
    const md2 = maxDist * maxDist;
    for (const f of this._allFeatures) {
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 > md2) continue;
      if (f.kind === "food") out.push({ x: f.x, y: f.beacon ? 2.0 : 0.35, z: f.z, r: f.beacon ? 0.45 : 0.7, kind: "food" });
      else if (f.kind === "water") out.push({ x: f.x, y: 0.22, z: f.z, r: 0.42, kind: "water" });
      else if (f.kind === "rock") out.push({ x: f.x, y: 0.3, z: f.z, r: 0.5, kind: "perch" });
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
    };
  }
}

/** Small fixed arena (name kept for app.js import). */
export function createOpenWorld() {
  return new ProceduralWorld();
}
