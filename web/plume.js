/**
 * Lagrangian puff plume — Farrell / Murlis / Cardé style.
 * Odor is intermittent filaments, not a Gaussian bump. Antennae
 * see sparse hits; that is what Drosophila klinotaxes in.
 */
import * as THREE from "three";

const ARENA_R = 17.4;
const MAX_PUFFS = 560;

function makeSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, "rgba(255,255,255,0.85)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const SPRITE = makeSprite();

function windAt(x, z, t) {
  const mx = -1.05 + 0.35 * Math.sin(t * 0.19);
  const mz = -0.42 + 0.28 * Math.sin(t * 0.14 + 0.9);
  const e1 = 0.55 * Math.sin(0.31 * x + 1.3 * t);
  const e2 = 0.45 * Math.cos(0.27 * z - 1.1 * t);
  const e3 = 0.32 * Math.sin(0.18 * (x + z) + 0.7 * t);
  return { x: mx + e1 + 0.5 * e3, z: mz + e2 - 0.4 * e3 };
}

class PuffField {
  constructor({ color, emitHz, mass, life, y0 }) {
    this.color = new THREE.Color(color);
    this.emitHz = emitHz;
    this.mass0 = mass;
    this.life = life;
    this.y0 = y0;
    this.puffs = [];
    this.acc = 0;
    this.pos = new Float32Array(MAX_PUFFS * 3);
    this.col = new Float32Array(MAX_PUFFS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      map: SPRITE, transparent: true, depthWrite: false, vertexColors: true,
      blending: THREE.AdditiveBlending, opacity: 0.85, size: 22, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(x, y, z, wind, n = 1) {
    for (let i = 0; i < n && this.puffs.length < MAX_PUFFS; i++) {
      this.puffs.push({
        x: x + (Math.random() - 0.5) * 0.12,
        y: y + (Math.random() - 0.5) * 0.08,
        z: z + (Math.random() - 0.5) * 0.12,
        u: wind.x + (Math.random() - 0.5) * 0.5,
        w: wind.z + (Math.random() - 0.5) * 0.5,
        v: (Math.random() - 0.35) * 0.25,
        sig: 0.07 + Math.random() * 0.04,
        q: this.mass0 * (0.7 + Math.random() * 0.6),
        age: 0,
      });
    }
  }

  step(dt, t) {
    const next = [];
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age > this.life || p.q < 0.02) continue;
      const wind = windAt(p.x, p.z, t);
      p.u += (wind.x - p.u) * 1.8 * dt + (Math.random() - 0.5) * 1.6 * dt;
      p.w += (wind.z - p.w) * 1.8 * dt + (Math.random() - 0.5) * 1.6 * dt;
      p.v += (0.02 - p.v) * 0.6 * dt;
      p.x += p.u * dt;
      p.y += p.v * dt;
      p.z += p.w * dt;
      p.sig += (0.10 + 0.04 * p.age) * dt;
      p.q *= Math.exp(-dt / (this.life * 0.55));
      if (p.x * p.x + p.z * p.z > ARENA_R * ARENA_R) continue;
      if (p.y < 0.05) { p.y = 0.05; p.v = Math.abs(p.v) * 0.2; }
      if (p.y > 2.4) p.y = 2.4;
      next.push(p);
    }
    this.puffs = next;
    this.sync();
  }

  sync() {
    const n = this.puffs.length;
    const cr = this.color.r, cg = this.color.g, cb = this.color.b;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[i];
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      const a = Math.min(1, p.q * 1.35);
      this.col[i * 3] = cr * a;
      this.col[i * 3 + 1] = cg * a;
      this.col[i * 3 + 2] = cb * a;
    }
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  sample(x, y, z) {
    // Dual-kernel: sharp filament core (klinotaxis L/R contrast) + soft halo.
    // Resolves ~antenna-spacing gradients without changing emission / bomb.
    let c = 0;
    for (const p of this.puffs) {
      const dx = x - p.x, dy = y - p.y, dz = z - p.z;
      const s2 = p.sig * p.sig;
      const r2 = dx * dx + dy * dy * 1.55 + dz * dz;
      if (r2 > s2 * 12) continue;
      const core = Math.exp(-r2 / (2 * s2 * 0.38));
      const halo = Math.exp(-r2 / (2 * s2));
      c += p.q * (0.72 * core + 0.38 * halo);
    }
    return c;
  }

  /** Multi-point sample around an antenna tip for denser local fidelity. */
  sampleProbe(x, y, z, heading, sideSign) {
    const s = Math.sin(heading), c = Math.cos(heading);
    // tip + slight lateral / forward offsets (~JO/ORN sensilla spread)
    const ox = -sideSign * 0.06 * c + 0.05 * s;
    const oz = sideSign * 0.06 * s + 0.05 * c;
    const a = this.sample(x, y, z);
    const b = this.sample(x + ox, y + 0.02, z + oz);
    const d = this.sample(x + 0.04 * s, y - 0.03, z + 0.04 * c);
    return 0.55 * a + 0.30 * b + 0.15 * d;
  }
}


function makeBombOrb() {
  const geo = new THREE.SphereGeometry(0.42, 28, 22);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffc14a,
    emissive: 0xff8a1a,
    emissiveIntensity: 1.35,
    roughness: 0.35,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92,
  });
  const core = new THREE.Mesh(geo, mat);
  const glowGeo = new THREE.SphereGeometry(0.62, 20, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffb040,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  const g = new THREE.Group();
  g.add(core, glow);
  g.name = "scentBomb";
  g.userData.isBomb = true;
  return g;
}

export class OdorWorld {
  constructor() {
    this.food = new PuffField({ color: 0xf0c040, emitHz: 22, mass: 1.15, life: 6.5, y0: 0.35 });
    this.pher = new PuffField({ color: 0xff4fd8, emitHz: 10, mass: 0.7, life: 4.8, y0: 1.15 });
    this.co2 = new PuffField({ color: 0x88a0c0, emitHz: 7, mass: 0.45, life: 3.6, y0: 1.2 });
    this.moist = new PuffField({ color: 0x4aa8ff, emitHz: 9, mass: 0.55, life: 5.5, y0: 0.3 });
    this.bitter = new PuffField({ color: 0x6a9a32, emitHz: 14, mass: 0.9, life: 5.8, y0: 0.35 });
    this.group = new THREE.Group();
    this.group.add(this.food.points, this.pher.points, this.co2.points, this.moist.points, this.bitter.points);
    this.t = 0;
    this.wind = { x: -1, z: -0.4 };
    // Sensory bomb — intense optional food (and light pher) puff emitter. Default OFF.
    this.bombEnabled = false;
    this.bombPos = { x: 0, y: 0.7, z: 0 };
    this._bombAcc = 0;
    this._bombPherAcc = 0;
    this.bombMesh = makeBombOrb();
    this.bombMesh.visible = false;
    this.group.add(this.bombMesh);
    this._showOdor = false;
    this._syncVis();
  }

  setBomb(on) {
    this.bombEnabled = !!on;
    this.bombMesh.visible = this.bombEnabled;
    this._syncVis();
  }

  setBombPos(x, y, z) {
    this.bombPos.x = x;
    this.bombPos.y = y;
    this.bombPos.z = z;
    this.bombMesh.position.set(x, y, z);
  }

  getBombPos() {
    return { x: this.bombPos.x, y: this.bombPos.y, z: this.bombPos.z };
  }

  setShowOdor(on) {
    this._showOdor = !!on;
    this._syncVis();
  }

  _syncVis() {
    const showPuffs = this._showOdor;
    for (const f of [this.food, this.pher, this.co2, this.moist, this.bitter]) {
      f.points.visible = showPuffs;
    }
    this.bombMesh.visible = this.bombEnabled;
    this.group.visible = showPuffs || this.bombEnabled;
  }

  step(dt, t, world) {
    this.t = t;
    const food = world.food;
    const water = world.water;
    const bitter = world.bitter;
    const flock = world.flies || [];
    this.wind = windAt(0, 0, t);
    this.food.acc += dt * this.food.emitHz;
    while (this.food.acc >= 1) {
      this.food.acc -= 1;
      this.food.emit(food.x, 0.32, food.z, this.wind);
    }
    this.moist.acc += dt * this.moist.emitHz;
    while (this.moist.acc >= 1) {
      this.moist.acc -= 1;
      this.moist.emit(water.x, 0.28, water.z, this.wind);
    }
    if (bitter) {
      this.bitter.acc += dt * this.bitter.emitHz;
      while (this.bitter.acc >= 1) {
        this.bitter.acc -= 1;
        this.bitter.emit(bitter.x, 0.32, bitter.z, this.wind);
      }
    }
    for (const fly of flock) {
      if (!fly || !fly.body) continue;
      // Male-only public sim: no female pheromone emitters. Scent bomb can still seed pher.
      this.co2.acc += dt * this.co2.emitHz * 0.45;
      if (this.co2.acc >= 1) {
        this.co2.acc -= 1;
        const p = fly.body.position;
        this.co2.emit(p.x, p.y + 1.2, p.z, this.wind);
      }
    }
    // Sensory bomb: many high-mass food puffs (+ light pher) at orb — Lagrangian only.
    if (this.bombEnabled) {
      const bx = this.bombPos.x, by = this.bombPos.y, bz = this.bombPos.z;
      this._bombAcc += dt * 90;
      while (this._bombAcc >= 1) {
        this._bombAcc -= 1;
        // ~8× sugar-drop mass, burst of filaments each tick
        const prevMass = this.food.mass0;
        this.food.mass0 = 8.5;
        this.food.emit(bx, by, bz, this.wind, 6);
        this.food.mass0 = prevMass;
      }
      this._bombPherAcc += dt * 12;
      while (this._bombPherAcc >= 1) {
        this._bombPherAcc -= 1;
        const prevMass = this.pher.mass0;
        this.pher.mass0 = 1.4;
        this.pher.emit(bx, by + 0.15, bz, this.wind, 2);
        this.pher.mass0 = prevMass;
      }
      // Soft pulse on the orb marker
      const s = 1.0 + 0.08 * Math.sin(t * 4.2);
      this.bombMesh.scale.setScalar(s);
    }
    this.food.step(dt, t);
    this.pher.step(dt, t);
    this.co2.step(dt, t);
    this.moist.step(dt, t);
    this.bitter.step(dt, t);
  }

  windAt(x, z) { return windAt(x, z, this.t); }

  sample(x, y, z) {
    return {
      food: this.food.sample(x, y, z),
      pher: this.pher.sample(x, y, z),
      co2: this.co2.sample(x, y, z),
      moist: this.moist.sample(x, y, z),
      bitter: this.bitter.sample(x, y, z),
    };
  }

  /** Antenna-local probe — denser spatial sampling for L/R gradient resolve. */
  sampleAntenna(x, y, z, heading, sideSign) {
    return {
      food: this.food.sampleProbe(x, y, z, heading, sideSign),
      pher: this.pher.sampleProbe(x, y, z, heading, sideSign),
      co2: this.co2.sampleProbe(x, y, z, heading, sideSign),
      moist: this.moist.sampleProbe(x, y, z, heading, sideSign),
      bitter: this.bitter.sampleProbe(x, y, z, heading, sideSign),
    };
  }
}

export { windAt };
