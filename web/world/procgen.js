/**
 * Procedural open world — chunks stream around the fly.
 * Flat ground tiles + seeded landmarks (food / water / bitter / perch / beacons).
 * MN-only body still decides where to go; we just stop caging him.
 */
import * as THREE from "three";

export const CHUNK_SIZE = 28;
export const LOAD_R = 2; // chebyshev chunks kept around fly
export const UNLOAD_R = 3;
export const WORLD_SOFT_LIMIT = 2400; // sanity only — not a playable rim

function hash2(cx, cz, salt = 0) {
  let h = (cx * 374761393 + cz * 668265263 + salt * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return h >>> 0;
}
function rand01(h) {
  return (h % 10000) / 10000;
}
function pick(h, n) {
  return h % n;
}

function makeFloorTexture(seed) {
  const chk = document.createElement("canvas");
  chk.width = 256;
  chk.height = 256;
  const cx = chk.getContext("2d");
  const n = 8;
  const a = 0x14 + (seed % 12);
  const b = 0x22 + ((seed >>> 8) % 18);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dark = (i + j) & 1;
      const v = dark ? a : b;
      cx.fillStyle = `rgb(${v + 8},${v + 10},${v + 18})`;
      cx.fillRect(i * 32, j * 32, 32, 32);
    }
  }
  // sparse grit
  cx.fillStyle = "rgba(200,210,230,0.06)";
  for (let k = 0; k < 40; k++) {
    const hx = hash2(seed, k, 9);
    cx.fillRect(hx % 256, (hx >>> 8) % 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(chk);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
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
  const light = new THREE.PointLight(emissive, 0.85, 6);
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

function makePerch(x, z) {
  const perch = new THREE.Group();
  perch.position.set(x, 0, z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.82 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3218, roughness: 0.85 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.15, 10), wood);
  pole.position.y = 1.08;
  pole.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), woodDark);
  cap.position.y = 2.18;
  cap.castShadow = true;
  perch.add(pole, cap);
  perch.userData = { x, z, r: 0.22, h: 2.18 };
  return perch;
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

/**
 * Seeded feature list for a chunk (world coords).
 */
export function featuresForChunk(cx, cz, size = CHUNK_SIZE) {
  const features = [];
  const ox = cx * size;
  const oz = cz * size;
  const h0 = hash2(cx, cz, 1);

  // Origin neighborhood: guarantee approachable food so spawn isn't empty.
  if (cx === 0 && cz === 0) {
    features.push({ kind: "food", x: 6.5, z: 4.2, beacon: true });
    features.push({ kind: "water", x: -5.5, z: -3.8 });
    features.push({ kind: "bitter", x: -7.2, z: 5.8 });
    features.push({ kind: "perch", x: 4.8, z: -7.4 });
  }

  const nFood = pick(h0, 3); // 0..2
  for (let i = 0; i < nFood; i++) {
    const h = hash2(cx, cz, 10 + i);
    if (cx === 0 && cz === 0 && i === 0) continue;
    const x = ox + 3 + rand01(h) * (size - 6);
    const z = oz + 3 + rand01(hash2(cx, cz, 40 + i)) * (size - 6);
    features.push({ kind: "food", x, z, beacon: rand01(h) > 0.55 });
  }
  if (rand01(hash2(cx, cz, 2)) > 0.45 && !(cx === 0 && cz === 0)) {
    const h = hash2(cx, cz, 3);
    features.push({
      kind: "water",
      x: ox + 4 + rand01(h) * (size - 8),
      z: oz + 4 + rand01(hash2(cx, cz, 4)) * (size - 8),
    });
  }
  if (rand01(hash2(cx, cz, 5)) > 0.62 && !(cx === 0 && cz === 0)) {
    const h = hash2(cx, cz, 6);
    features.push({
      kind: "bitter",
      x: ox + 4 + rand01(h) * (size - 8),
      z: oz + 4 + rand01(hash2(cx, cz, 7)) * (size - 8),
    });
  }
  if (rand01(hash2(cx, cz, 8)) > 0.72) {
    const h = hash2(cx, cz, 9);
    features.push({
      kind: "perch",
      x: ox + 5 + rand01(h) * (size - 10),
      z: oz + 5 + rand01(hash2(cx, cz, 11)) * (size - 10),
    });
  }
  // Occasional rock / visual clutter (eye sees as perch-ish dark)
  if (rand01(hash2(cx, cz, 12)) > 0.78) {
    const h = hash2(cx, cz, 13);
    features.push({
      kind: "rock",
      x: ox + 4 + rand01(h) * (size - 8),
      z: oz + 4 + rand01(hash2(cx, cz, 14)) * (size - 8),
    });
  }
  return features;
}

export class ProceduralWorld {
  constructor(opts = {}) {
    this.size = opts.chunkSize || CHUNK_SIZE;
    this.loadR = opts.loadR ?? LOAD_R;
    this.unloadR = opts.unloadR ?? UNLOAD_R;
    this.group = new THREE.Group();
    this.group.name = "procWorld";
    this.chunks = new Map();
    this._cx = null;
    this._cz = null;
    this._allFeatures = []; // flat list of live feature descriptors
    // Compat proxies — agent/eye/odor expect .position / perch.userData
    this.food = new THREE.Object3D();
    this.water = new THREE.Object3D();
    this.bitter = new THREE.Object3D();
    this.perch = new THREE.Object3D();
    this.perch.userData = { x: 4.8, z: -7.4, r: 0.22, h: 2.18 };
    this.food.position.set(6.5, 0.12, 4.2);
    this.water.position.set(-5.5, 0.12, -3.8);
    this.bitter.position.set(-7.2, 0.12, 5.8);
    this.group.userData = {
      food: this.food,
      water: this.water,
      bitter: this.bitter,
      perch: this.perch,
      procedural: true,
      world: this,
    };
    // Horizon disc underfoot so empty unload fringe isn't a void hole
    const horizon = new THREE.Mesh(
      new THREE.CircleGeometry(this.size * (this.loadR + 1.2) * 1.45, 64),
      new THREE.MeshStandardMaterial({
        color: 0x1a1e28,
        roughness: 0.95,
        metalness: 0.02,
        transparent: true,
        opacity: 0.92,
      })
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -0.04;
    horizon.receiveShadow = true;
    horizon.name = "horizon";
    this.horizon = horizon;
    this.group.add(horizon);
  }

  get root() {
    return this.group;
  }

  /** Build or refresh chunks around world (x,z). */
  update(x = 0, z = 0) {
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    if (this._cx === cx && this._cz === cz && this.chunks.size) {
      this._retargetNearest(x, z);
      this._moveHorizon(x, z);
      return;
    }
    this._cx = cx;
    this._cz = cz;
    const want = new Set();
    for (let dx = -this.loadR; dx <= this.loadR; dx++) {
      for (let dz = -this.loadR; dz <= this.loadR; dz++) {
        want.add(chunkKey(cx + dx, cz + dz));
        this._ensureChunk(cx + dx, cz + dz);
      }
    }
    for (const [k, ch] of this.chunks) {
      const [kx, kz] = k.split(",").map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > this.unloadR) {
        this.group.remove(ch.group);
        ch.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose?.();
          if (o.material) {
            if (o.material.map) o.material.map.dispose?.();
            o.material.dispose?.();
          }
        });
        this.chunks.delete(k);
      }
    }
    this._rebuildFeatureIndex();
    this._retargetNearest(x, z);
    this._moveHorizon(x, z);
  }

  _moveHorizon(x, z) {
    if (this.horizon) {
      this.horizon.position.x = x;
      this.horizon.position.z = z;
    }
  }

  _ensureChunk(cx, cz) {
    const k = chunkKey(cx, cz);
    if (this.chunks.has(k)) return;
    const g = new THREE.Group();
    g.name = `chunk_${k}`;
    const seed = hash2(cx, cz, 99);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size, this.size, 1, 1),
      new THREE.MeshStandardMaterial({
        map: makeFloorTexture(seed),
        color: 0xc8d0dc,
        roughness: 0.92,
        metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx * this.size + this.size * 0.5, 0, cz * this.size + this.size * 0.5);
    floor.receiveShadow = true;
    g.add(floor);

    // Soft grid lines for scale
    const grid = new THREE.GridHelper(this.size, 7, 0x2a3140, 0x1e2430);
    grid.position.copy(floor.position);
    grid.position.y = 0.015;
    g.add(grid);

    const feats = featuresForChunk(cx, cz, this.size);
    const built = [];
    for (const f of feats) {
      let obj = null;
      if (f.kind === "food") {
        obj = drop(0xffcc44, 0xff9900, f.x, f.z);
        obj.traverse((o) => {
          if (o.isMesh && o.material?.emissive) o.material.emissiveIntensity = 0.9;
          if (o.isLight) o.intensity = 1.6;
        });
        if (f.beacon) beaconAt(obj);
      } else if (f.kind === "water") {
        obj = drop(0x4aa8ff, 0x3388ff, f.x, f.z);
      } else if (f.kind === "bitter") {
        obj = drop(0x3d6b2e, 0x5a8f2a, f.x, f.z);
      } else if (f.kind === "perch") {
        obj = makePerch(f.x, f.z);
      } else if (f.kind === "rock") {
        obj = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.45 + rand01(hash2(cx, cz, 20)) * 0.35, 0),
          new THREE.MeshStandardMaterial({ color: 0x4a5060, roughness: 0.85 })
        );
        obj.position.set(f.x, 0.25, f.z);
        obj.castShadow = true;
      }
      if (obj) {
        g.add(obj);
        built.push({ ...f, object: obj });
      }
    }
    this.group.add(g);
    this.chunks.set(k, { group: g, features: built, cx, cz });
  }

  _rebuildFeatureIndex() {
    this._allFeatures = [];
    for (const ch of this.chunks.values()) {
      for (const f of ch.features) this._allFeatures.push(f);
    }
  }

  _retargetNearest(x, z) {
    const nearest = { food: null, water: null, bitter: null, perch: null };
    const best = { food: 1e9, water: 1e9, bitter: 1e9, perch: 1e9 };
    for (const f of this._allFeatures) {
      const d = (f.x - x) ** 2 + (f.z - z) ** 2;
      const k = f.kind === "rock" ? null : f.kind;
      if (!k || best[k] == null) continue;
      if (d < best[k]) {
        best[k] = d;
        nearest[k] = f;
      }
    }
    if (nearest.food) this.food.position.set(nearest.food.x, 0.12, nearest.food.z);
    if (nearest.water) this.water.position.set(nearest.water.x, 0.12, nearest.water.z);
    if (nearest.bitter) this.bitter.position.set(nearest.bitter.x, 0.12, nearest.bitter.z);
    if (nearest.perch) {
      this.perch.position.set(nearest.perch.x, 0, nearest.perch.z);
      this.perch.userData = { x: nearest.perch.x, z: nearest.perch.z, r: 0.22, h: 2.18 };
    }
  }

  /** Extra landmark hits for compound eye (beyond single nearest food). */
  landmarksNear(x, z, maxDist = 22) {
    const out = [];
    const md2 = maxDist * maxDist;
    for (const f of this._allFeatures) {
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 > md2) continue;
      if (f.kind === "food") out.push({ x: f.x, y: f.beacon ? 2.0 : 0.35, z: f.z, r: f.beacon ? 0.45 : 0.7, kind: "food" });
      else if (f.kind === "water") out.push({ x: f.x, y: 0.22, z: f.z, r: 0.42, kind: "water" });
      else if (f.kind === "bitter") out.push({ x: f.x, y: 0.22, z: f.z, r: 0.42, kind: "bitter" });
      else if (f.kind === "perch") out.push({ x: f.x, y: 1.1, z: f.z, r: 0.35, kind: "perch" });
      else if (f.kind === "rock") out.push({ x: f.x, y: 0.3, z: f.z, r: 0.5, kind: "perch" });
    }
    return out;
  }

  stats() {
    return {
      chunks: this.chunks.size,
      features: this._allFeatures.length,
      chunk: [this._cx, this._cz],
      softLimit: WORLD_SOFT_LIMIT,
    };
  }
}

/** Back-compat helper: build open world instead of petri dish. */
export function createOpenWorld() {
  const w = new ProceduralWorld();
  w.update(0, 0);
  return w;
}
