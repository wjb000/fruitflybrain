import * as THREE from "three";
import { stepLife, applyPhysicsPose } from "./fly.js";
import { CompoundEye } from "./eye.js";
import { physics, setCommand, spawnPhysics, despawnPhysics, resetPhysics } from "./physics.js";

const LEG_NAMES = ["L1", "R1", "L2", "R2", "L3", "R3"];
const MUSCLE_NAMES = [
  "coxaProm", "coxaRem", "coxaRotA", "coxaRotP", "coxaAdd",
  "trFlex", "trExt", "feRed", "tiFlex", "tiExt", "taDep", "taLev",
];
const JOINT_POOLS = LEG_NAMES.flatMap((leg) => MUSCLE_NAMES.map((m) => `${leg}_${m}`));
const PROPRIO_KEYS = [
  "proprio", "chordotonal", "hairplate", "campaniform",
  "choT1", "choT2", "choT3", "hpT1", "hpT2", "hpT3",
  "csaT1", "csaT2", "csaT3", "tactT1", "tactT2", "tactT3",
  "propT1", "propT2", "propT3",
  "choT1L", "choT1R", "choT2L", "choT2R", "choT3L", "choT3R",
  "tactT1L", "tactT1R", "tactT2L", "tactT2R", "tactT3L", "tactT3R",
];
const LEG_NEUROMERE = { L1: "T1", R1: "T1", L2: "T2", R2: "T2", L3: "T3", R3: "T3" };
const OPTIC_TYPES = ["R16", "R7", "R8", "L1", "L2"];
const OPTIC_SECTOR_TYPES = ["R16", "R7", "R8"];
const ODOR_TYPES = ["foodORN", "pherORN", "co2ORN", "JO", "aversiveORN"];
const CLOCK_KEYS = ["sLNv", "lLNv", "LNd", "DN1a", "DN1p", "DAN", "OA", "HT", "pep"];
const _head = new THREE.Vector3();
const _antL = new THREE.Vector3();
const _antR = new THREE.Vector3();

function sectorize(ids, xyz, n = 4) {
  const L = [], R = [];
  for (const i of ids || []) {
    if (xyz[i * 3] < 0) L.push(i);
    else R.push(i);
  }
  const bins = (arr) => {
    const scored = arr.map((i) => [xyz[i * 3 + 2], i]);
    scored.sort((a, b) => a[0] - b[0]);
    const out = Array.from({ length: n }, () => []);
    for (let k = 0; k < scored.length; k++) {
      out[Math.min(n - 1, (k * n / Math.max(1, scored.length)) | 0)].push(scored[k][1]);
    }
    return out;
  };
  return { L, R, Ls: bins(L), Rs: bins(R) };
}

function hzVis(v, gain = 120, base = 6) {
  return Math.max(0, Math.min(180, base + v * gain));
}


function parseNeurons(buf) {
  const v = new DataView(buf);
  const n = v.getUint32(8, true);
  const xyz = new Float32Array(buf, 12, n * 3);
  const off = 12 + n * 3 * 4;
  return {
    n,
    xyz,
    group: new Uint8Array(buf, off, n),
    nt: new Uint8Array(buf, off + n, n),
    flags: new Uint8Array(buf, off + 2 * n, n),
  };
}

function parseMesh(buf) {
  const v = new DataView(buf);
  const nv = v.getUint32(4, true);
  const nf = v.getUint32(8, true);
  const pos = new Float32Array(buf, 12, nv * 3);
  const idx = new Uint32Array(buf, 12 + nv * 3 * 4, nf * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

function splitLR(ids, xyz) {
  const L = [], R = [];
  for (const i of ids || []) {
    if (xyz[i * 3] < 0) L.push(i);
    else R.push(i);
  }
  return { L, R };
}

function bearingTo(tx, tz, x, z, c, s) {
  const dx = tx - x, dz = tz - z;
  return Math.atan2(dx * c - dz * s, dx * s + dz * c);
}

function phasicTonic(filt, key, c, dt = 0.032) {
  const slow = filt[key] || 0;
  const a = 1 - Math.exp(-dt / 0.28);
  filt[key] = slow + (c - slow) * a;
  const onset = Math.max(0, c - filt[key]);
  return 6 + onset * 480 + c * 50;
}

const ARENA_R = 17.4;
const POOL_KEYS = [
  "T1L", "T1R", "T2L", "T2R", "T3L", "T3R",
  "DLM", "DVM", "ADMN", "MN9", "proboscis", "neck",
  "DNa", "DNg02", "DNp01", "DNp", "aIPg", "pIP1", "fru", "abdomen",
  ...CLOCK_KEYS,
  ...JOINT_POOLS,
];

export class EmbodiedFly {
  constructor({
    sex, body, neuBuf, csrBuf, stim, effectors, brainBuf, vncBuf, skelJson, scene, x, z, yaw,
    onReady, onFrame,
  }) {
    this.sex = sex;
    this.body = body;
    this.onReady = onReady;
    this.onFrame = onFrame;
    this.heading = yaw != null ? yaw : Math.random() * Math.PI * 2;
    this.y = body.userData.standZ || 1.3;
    this.vy = 0;
    this.speedS = 0;
    this.turnS = 0;
    this.ready = false;
    this.xray = false;
    this.clock = 0;
    this.extra = {};
    this.lastSmellL = 0;
    this.lastSmellR = 0;
    this.life = { hunger: sex === "female" ? 0.45 : 0.7, crop: 0.2, energy: 1, sleep: 0.1, arousal: 0, mode: "walk" };
    this.cmd = { walk: 0, turn: 0, fly: 0, feed: 0, court: 0, groom: 0, escape: 0, rest: 0, head: 0, abdomen: 0, muscle: {} };
    this.motEma = Object.fromEntries(POOL_KEYS.map((k) => [k, 0]));
    this.world = { food: { x: 6.5, z: 4.2 }, water: { x: -5.5, z: -3.8 }, other: null };

    body.position.set(x, this.y, z);
    body.rotation.y = this.heading;
    scene.add(body);

    this.neu = parseNeurons(neuBuf);
    this.activity = new Float32Array(this.neu.n);
    const P = effectors.pools || {};
    this.poolSets = {};
    for (const k of POOL_KEYS) this.poolSets[k] = new Set(P[k] || []);
    this.stim = stim;
    this.smell = splitLR(stim.smell || [], this.neu.xyz);
    this.visionLR = splitLR(stim.vision || [], this.neu.xyz);
    this.ppk = splitLR(stim.ppk23 || P.ppk23 || [], this.neu.xyz);
    this.optic = {};
    for (const k of OPTIC_TYPES) {
      this.optic[k] = sectorize(stim[k] || P[k] || [], this.neu.xyz);
    }
    this.eye = new CompoundEye();
    this.odor = {};
    for (const k of ODOR_TYPES) this.odor[k] = splitLR(stim[k] || P[k] || [], this.neu.xyz);
    this.ornFilt = { foodL: 0, foodR: 0, pherL: 0, pherR: 0, co2L: 0, co2R: 0, moistL: 0, moistR: 0, avL: 0, avR: 0 };
    this.onPerch = false;
    this.physId = `${sex}-${Math.random().toString(36).slice(2, 8)}`;
    this.mjPose = null;
    if (physics.ok) {
      spawnPhysics(this.physId, x, z, this.heading).then((pose) => {
        if (pose) this.mjPose = pose;
      }).catch(() => {});
    }
    this.lastOdor = { foodL: 0, foodR: 0, pherL: 0, pherR: 0 };
    this.prevDistO = 99;
    this.walkL = [];
    this.walkR = [];
    for (let i = 0; i < this.neu.n; i++) {
      const g = this.neu.group[i];
      if (g !== 8 && g !== 12 && g !== 6) continue;
      if (this.neu.xyz[i * 3] < 0) this.walkL.push(i);
      else this.walkR.push(i);
    }

    this.cns = new THREE.Group();
    // neurons.bin / meshes are µm: X=LR, Y=brain-up/VNC-down, Z=dorsal.
    // NeuroMechFly is mm, X=right, Y=up, Z=forward (head).
    const um = 0.001;
    this.cns.rotation.order = "XYZ";
    this.cns.rotation.x = Math.PI / 2;
    this.cns.scale.set(um, um, -um);
    this.cns.position.set(0, 0.04, 0.12);
    const host = body.userData.head || body;
    host.add(this.cns);

    this.brainMesh = new THREE.Mesh(
      parseMesh(brainBuf),
      new THREE.MeshPhysicalMaterial({
        color: sex === "female" ? 0xff6eb4 : 0x3a78e8,
        transparent: true, opacity: 0.14, roughness: 0.35, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.vncMesh = new THREE.Mesh(
      parseMesh(vncBuf),
      new THREE.MeshPhysicalMaterial({
        color: 0x4d7cff, transparent: true, opacity: 0.14,
        roughness: 0.35, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.cns.add(this.brainMesh, this.vncMesh);

    const n = this.neu.n;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.neu.xyz, 3));
    const col = new Float32Array(n * 3);
    const hue = sex === "female" ? [1.0, 0.43, 0.71] : [0.23, 0.47, 0.91];
    for (let i = 0; i < n; i++) {
      col[i * 3] = hue[0]; col[i * 3 + 1] = hue[1]; col[i * 3 + 2] = hue[2];
    }
    this.actAttr = new Float32Array(n);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("act", new THREE.BufferAttribute(this.actAttr, 1));
    this.pointMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `
        attribute float act; attribute vec3 color;
        varying vec3 vCol; varying float vAct; uniform float uScale;
        void main() {
          vCol = color; vAct = act;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (2.2 + act * 7.0) * uScale * (200.0 / max(8.0, -mv.z));
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vAct;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float d = dot(p,p); if (d > 1.0) discard;
          gl_FragColor = vec4(mix(vCol, vec3(1.0), vAct*0.8), mix(0.18, 0.95, vAct) * exp(-d*2.4));
        }`,
    });
    this.points = new THREE.Points(geo, this.pointMat);
    this.cns.add(this.points);
    this.setCnsVisible(false);

    this.worker = new Worker("sim.worker.js");
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "ready") {
        this.ready = true;
        const channels = {
          vision: stim.vision || [],
          visionL: this.visionLR.L,
          visionR: this.visionLR.R,
          smellL: this.smell.L,
          smellR: this.smell.R,
          taste: stim.taste || [],
          touch: stim.touch || [],
          courtship: stim.courtship || [],
          escape: stim.escape || [],
          ppkL: this.ppk.L,
          ppkR: this.ppk.R,
          hygro: stim.hygro || P.hygrosensory || [],
        };
        for (const k of PROPRIO_KEYS) channels[k] = stim[k] || P[k] || [];
        for (const k of OPTIC_TYPES) {
          const o = this.optic[k];
          if (OPTIC_SECTOR_TYPES.includes(k)) {
            for (let s = 0; s < 4; s++) {
              channels[k + "L" + s] = o.Ls[s];
              channels[k + "R" + s] = o.Rs[s];
            }
          } else {
            channels[k + "L"] = o.L;
            channels[k + "R"] = o.R;
          }
        }
        for (const k of ODOR_TYPES) {
          channels[k + "L"] = this.odor[k].L;
          channels[k + "R"] = this.odor[k].R;
        }
        for (const k of CLOCK_KEYS) channels[k] = stim[k] || P[k] || [];
        channels.sweet = stim.sweet || P.sweet || [];
        channels.bitter = stim.bitter || P.bitter || [];
        this.worker.postMessage({ type: "bind", channels });
        const pools = {};
        for (const k of POOL_KEYS) pools[k] = [...this.poolSets[k]];
        pools.walkL = this.walkL;
        pools.walkR = this.walkR;
        this.worker.postMessage({ type: "bindEffectors", pools });
        this.worker.postMessage({ type: "run", on: true });
        if (this.onReady) this.onReady();
        return;
      }
      if (m.type === "frame") this.applyFrame(m);
    };
    this.worker.postMessage(
      { type: "init", neurons: neuBuf, connectome: csrBuf },
      [neuBuf.slice(0), csrBuf.slice(0)]
    );
  }

  dispose() {
    try { this.worker.terminate(); } catch (_) {}
    despawnPhysics(this.physId);
    if (this.body && this.body.parent) this.body.parent.remove(this.body);
  }

  setCnsVisible(on) {
    this.xray = on;
    this.points.visible = on;
    this.brainMesh.visible = on;
    this.vncMesh.visible = on;
    this.body.userData.body.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.opacity === undefined) return;
      const m = o.material;
      if (m.userData._baseOpacity == null) m.userData._baseOpacity = m.opacity;
      const base = m.userData._baseOpacity;
      m.transparent = on || base < 0.99;
      m.opacity = on ? Math.min(0.16, base) : base;
      m.depthWrite = !on && base > 0.5;
    });
  }

  setRun(on) { this.worker.postMessage({ type: "run", on }); }
  resetPose(x, z, yaw) {
    this.worker.postMessage({ type: "reset" });
    this.heading = yaw != null ? yaw : Math.random() * Math.PI * 2;
    this.y = this.body.userData.standZ || 1.3; this.vy = 0;
    this.body.position.set(x, this.y, z);
    this.body.rotation.set(0, this.heading, 0);
    this.life.hunger = this.sex === "female" ? 0.45 : 0.7;
    this.life.crop = 0.2; this.life.energy = 1; this.life.sleep = 0.1;
    if (physics.ok) {
      resetPhysics(this.physId, x, z, this.heading).then((pose) => {
        if (pose) this.mjPose = pose;
      }).catch(() => {});
    }
  }

  applyFrame(m) {
    const neu = this.neu;
    const sp = m.spikes;
    const hits = Object.fromEntries(POOL_KEYS.map((k) => [k, 0]));
    let lEff = 0, rEff = 0;
    for (let i = 0; i < this.activity.length; i++) this.activity[i] *= 0.78;
    for (let k = 0; k < sp.length; k++) {
      const i = sp[k];
      this.activity[i] = 1;
      const g = neu.group[i];
      if (g === 8 || g === 12 || g === 6) {
        if (neu.xyz[i * 3] < 0) lEff++; else rEff++;
      }
    }
    const raw = m.eff || {};
    for (const name of POOL_KEYS) {
      const f = raw[name] != null ? raw[name] : 0;
      this.motEma[name] = this.motEma[name] * 0.15 + f * 0.85;
    }
    const walkL = raw.walkL != null ? raw.walkL : 0;
    const walkR = raw.walkR != null ? raw.walkR : 0;
    if (this.xray) {
      this.actAttr.set(this.activity);
      this.points.geometry.attributes.act.needsUpdate = true;
    }

    const dt = 0.032;
    const x = this.body.position.x, z = this.body.position.z;
    const other = this.world.other;
    const ox = other ? other.body.position.x : 0;
    const oz = other ? other.body.position.z : 0;
    const distF = Math.hypot(this.world.food.x - x, this.world.food.z - z);
    const bitterPos = this.world.bitter;
    const distB = bitterPos ? Math.hypot(bitterPos.x - x, bitterPos.z - z) : 99;
    const distO = other ? Math.hypot(ox - x, oz - z) : 99;
    const standY = this.body.userData.standZ || 1.3;
    const onFood = distF < 0.95 && (this.y < standY + 0.25 || this.onPerch);
    const onBitter = distB < 0.95 && (this.y < standY + 0.25 || this.onPerch);
    const nearOther = distO < 2.4;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const oView = other && Math.abs(bearingTo(ox, oz, x, z, c, s)) < 0.75 && distO < 11;
    const e = this.motEma;
    const rates = m.rates || [];
    const dnHz = rates[8] || 0;
    const motHz = rates[12] || 0;
    const legs = (e.T1L + e.T1R + e.T2L + e.T2R + e.T3L + e.T3R) / 6;
    const cmd = this.cmd;
    // Body commands are ONLY connectome motor readout. No odor/vision shortcuts.
    cmd.walk = THREE.MathUtils.clamp((dnHz + motHz) / 22 + e.DNa * 1.1 + legs * 0.9, 0, 1);
    const lrTurn = (walkR - walkL) * 8 + (rEff - lEff) / (rEff + lEff + 8);
    cmd.turn = THREE.MathUtils.clamp(lrTurn * 1.8, -1, 1);
    cmd.fly = THREE.MathUtils.clamp(e.DLM * 2 + e.DVM * 1.8 + e.ADMN * 1.4, 0, 1);
    cmd.feed = THREE.MathUtils.clamp(e.MN9 * 3 + e.proboscis * 2.2, 0, 1);
    cmd.court = THREE.MathUtils.clamp(
      this.sex === "female" ? e.fru * 1.8 + e.abdomen * 0.5
        : e.aIPg * 2 + e.pIP1 * 2.2 + e.DNg02 * 1.6,
      0, 1
    );
    cmd.groom = THREE.MathUtils.clamp((e.T1L + e.T1R) * 1.3, 0, 1);
    cmd.escape = THREE.MathUtils.clamp(e.DNp01 * (this.sex === "female" ? 1.1 : 6), 0, 1);
    cmd.rest = THREE.MathUtils.clamp(1 - cmd.walk - cmd.fly * 0.8 - cmd.escape * 0.8 - cmd.court * 0.4, 0, 1);
    cmd.head = e.neck * 2.4;
    cmd.abdomen = e.abdomen;
    cmd.muscle = {};
    for (const name of LEG_NAMES) {
      const pick = (muscle) => THREE.MathUtils.clamp((e[`${name}_${muscle}`] || 0) * 2.4, 0, 1);
      cmd.muscle[name] = {
        coxaProm: pick("coxaProm"),
        coxaRem: pick("coxaRem"),
        coxaRotA: pick("coxaRotA"),
        coxaRotP: pick("coxaRotP"),
        coxaAdd: pick("coxaAdd"),
        trFlex: pick("trFlex"),
        trExt: pick("trExt"),
        feRed: pick("feRed"),
        tiFlex: pick("tiFlex"),
        tiExt: pick("tiExt"),
        taDep: pick("taDep"),
        taLev: pick("taLev"),
      };
    }

    this.turnS = this.turnS * 0.25 + cmd.turn * 0.75;

    const feeding = cmd.feed > 0.22 && onFood;
    this.life.hunger = THREE.MathUtils.clamp(this.life.hunger + dt * 0.012 - (feeding ? dt * 0.22 : 0), 0, 1);
    this.life.crop = THREE.MathUtils.clamp(this.life.crop + (feeding ? dt * 0.28 : -dt * 0.015), 0, 1);
    this.life.energy = THREE.MathUtils.clamp(this.life.energy + (cmd.fly > 0.28 ? -dt * 0.12 : dt * 0.04), 0.05, 1);
    const sleepP = THREE.MathUtils.clamp(
      (e.DN1p || 0) * 0.9 - (e.sLNv || 0) * 0.55 - (e.OA || 0) * 0.35,
      0, 1
    );
    this.life.sleep = this.life.sleep * 0.9 + sleepP * 0.1;
    this.life.arousal = THREE.MathUtils.clamp(
      this.life.arousal * 0.82 + (e.OA || 0) * 0.9 + (e.sLNv || 0) * 0.25,
      0, 1
    );
    if (cmd.escape > 0.4) this.life.arousal = Math.max(this.life.arousal, cmd.escape);
    this.worker.postMessage({ type: "mod", sleep: this.life.sleep, arousal: this.life.arousal });

    this.clock = m.t * 0.001;
    this.body.userData.perch = this.world.perch;

    if (physics.ok) {
      // Brain fires motor neurons only. MuJoCo is the flesh.
      // walk/turn are UI mode labels only — never free-joint plant cheats.
      setCommand(this.physId, {
        muscle: cmd.muscle,
        dlm: e.DLM || 0,
        dvm: e.DVM || 0,
        admn: e.ADMN || 0,
        fly: cmd.fly || 0,
        x: this.body.position.x,
        z: this.body.position.z,
        yaw: this.heading,
      });
      const pose = physics.poses.get(this.physId);
      if (pose) this.applyMujoco(pose, cmd, dt);
      else stepLife(this.body, dt, this.clock, cmd);
    } else {
      // Kinematic fallback if the plant is down: MN → leg pose → stance slip.
      // No cmd.walk thruster — ground motion from foot slip only; flight from wing MNs.
      const stand = this.body.userData.standZ || 1.3;
      const ttmn = (e.L1_trExt || 0) + (e.R1_trExt || 0);
      if (this.y < stand + 0.08 && ttmn > 0.28) this.vy = 5.2 * Math.min(1, ttmn);
      if (cmd.fly > 0.28) {
        this.vy += (2.5 + stand - this.y) * 5 * dt * cmd.fly;
        this.vy *= 0.9;
      } else this.vy -= 18 * dt;
      this.y = Math.max(stand, this.y + this.vy * dt);
      if (this.y === stand && cmd.fly < 0.28) this.vy = 0;
      stepLife(this.body, dt, this.clock, cmd);
      const slip = this.body.userData.slip;
      if (cmd.fly > 0.28) {
        const step = 8.5 * cmd.fly * dt;
        this.body.position.x += Math.sin(this.heading) * step;
        this.body.position.z += Math.cos(this.heading) * step;
        this.heading += this.turnS * 2.2 * dt;
      } else if (slip && slip.n > 0) {
        this.body.position.x += slip.x / slip.n;
        this.body.position.z += slip.z / slip.n;
        this.heading += (slip.yawR - slip.yawL) * 0.9;
      }
      this.speedS = this.speedS * 0.3 + Math.min(1.4, slip && slip.n
        ? Math.hypot(slip.x, slip.z) / slip.n / 0.04
        : cmd.fly) * 0.7;
      const rad = Math.hypot(this.body.position.x, this.body.position.z);
      if (rad > ARENA_R) {
        const nx = this.body.position.x / rad, nz = this.body.position.z / rad;
        this.body.position.x = nx * ARENA_R;
        this.body.position.z = nz * ARENA_R;
        const dx = Math.sin(this.heading), dz = Math.cos(this.heading);
        const dot = dx * nx + dz * nz;
        if (dot > 0) {
          this.heading = Math.atan2(dx - 2 * dot * nx, dz - 2 * dot * nz);
        }
      }
      const perch = this.world.perch;
      this.onPerch = false;
      if (perch) {
        const px = this.body.position.x, pz = this.body.position.z;
        const dp = Math.hypot(px - perch.x, pz - perch.z);
        const cap = 0.48, top = perch.h || 2.18;
        if (dp < cap && this.y > top - 0.55 && this.y < top + stand + 0.2 && cmd.fly < 0.28) {
          this.onPerch = true;
          this.vy = 0;
          this.y = top + stand - 0.05;
        }
      }
      this.body.position.y = this.y;
      this.body.rotation.y = this.heading;
    }

    let lead = "rest", leadV = cmd.rest;
    for (const k of ["walk", "fly", "feed", "court", "groom", "escape", "rest"]) {
      if ((cmd[k] || 0) > leadV) { leadV = cmd[k]; lead = k; }
    }
    this.life.mode = lead;
    this.hzMean = 0;
    if (m.rates) {
      let s = 0, w = 0;
      for (let i = 0; i < m.rates.length; i++) { s += m.rates[i]; w++; }
      this.hzMean = w ? s / w : 0;
    }
    if (this.onFrame) this.onFrame(this);
  }

  applyMujoco(pose, cmd, dt) {
    this.mjPose = pose;
    this.heading = pose.yaw;
    this.y = pose.y;
    this.vy = 0;
    const lim = ARENA_R - 1.4;
    let px = pose.x, pz = pose.z;
    const rad = Math.hypot(px, pz);
    if (rad > lim) {
      const s = lim / rad;
      px *= s;
      pz *= s;
    }
    this.body.position.set(px, pose.y, pz);
    // Yaw only on the root — pitch/roll from a converted quat was flipping flies.
    this.body.rotation.set(0, pose.yaw, 0);
    applyPhysicsPose(this.body, pose, dt, this.clock, cmd);
    this.speedS = this.speedS * 0.3 + Math.min(1.4, (pose.speed || 0) / 8) * 0.7;
    const perch = this.world.perch;
    this.onPerch = false;
    if (perch) {
      const dp = Math.hypot(pose.x - perch.x, pose.z - perch.z);
      const top = perch.h || 2.18;
      if (dp < 0.55 && pose.thoraxZ > top - 0.45) this.onPerch = true;
    }
  }

  pushWorldDrive() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const x = this.body.position.x, z = this.body.position.z;
    const t = this.clock;
    const ants = this.body.userData.antennae || [];
    const tipOf = (ant, out) => {
      const tip = ant && ant.userData && ant.userData.tip ? ant.userData.tip : ant;
      if (tip && tip.getWorldPosition) tip.getWorldPosition(out);
      else out.set(x, this.y + 1.35, z);
    };
    if (ants[0]) tipOf(ants[0], _antL); else _antL.set(x - 0.22 * c + 0.85 * s, this.y + 1.35, z + 0.22 * s + 0.85 * c);
    if (ants[1]) tipOf(ants[1], _antR); else _antR.set(x + 0.22 * c + 0.85 * s, this.y + 1.35, z - 0.22 * s + 0.85 * c);
    const odors = this.world.odors;
    const hungerGain = 0.35 + 1.2 * this.life.hunger;
    const sampL = odors ? odors.sample(_antL.x, _antL.y, _antL.z) : { food: 0, pher: 0, co2: 0, moist: 0, bitter: 0 };
    const sampR = odors ? odors.sample(_antR.x, _antR.y, _antR.z) : { food: 0, pher: 0, co2: 0, moist: 0, bitter: 0 };
    const foodL = sampL.food * hungerGain;
    const foodR = sampR.food * hungerGain;
    const pherL = sampL.pher, pherR = sampR.pher;
    const co2L = sampL.co2, co2R = sampR.co2;
    const smellL = phasicTonic(this.ornFilt, "foodL", foodL);
    const smellR = phasicTonic(this.ornFilt, "foodR", foodR);
    const pherHzL = phasicTonic(this.ornFilt, "pherL", pherL);
    const pherHzR = phasicTonic(this.ornFilt, "pherR", pherR);
    const co2HzL = phasicTonic(this.ornFilt, "co2L", co2L);
    const co2HzR = phasicTonic(this.ornFilt, "co2R", co2R);
    const avL = phasicTonic(this.ornFilt, "avL", sampL.bitter || 0);
    const avR = phasicTonic(this.ornFilt, "avR", sampR.bitter || 0);
    this.lastSmellL = smellL;
    this.lastSmellR = smellR;
    this.lastOdor = { foodL: smellL, foodR: smellR, pherL: pherHzL, pherR: pherHzR, co2L: co2HzL, co2R: co2HzR };
    const windL = odors ? odors.windAt(_antL.x, _antL.z) : { x: 0, z: 0 };
    const windR = odors ? odors.windAt(_antR.x, _antR.z) : { x: 0, z: 0 };
    const sideL = windL.x * c - windL.z * s;
    const sideR = windR.x * c - windR.z * s;
    const joL = 8 + Math.hypot(windL.x, windL.z) * 26 + Math.max(0, -sideL) * 18;
    const joR = 8 + Math.hypot(windR.x, windR.z) * 26 + Math.max(0, sideR) * 18;
    const distF = Math.hypot(this.world.food.x - x, this.world.food.z - z);
    const distW = Math.hypot(this.world.water.x - x, this.world.water.z - z);
    const other = this.world.other;
    const distQ = other ? Math.hypot(other.body.position.x - x, other.body.position.z - z) : 99;
    const closing = (this.prevDistO - distQ) / 0.032;
    this.prevDistO = distQ;
    const bOth = other ? bearingTo(other.body.position.x, other.body.position.z, x, z, c, s) : 0;
    const day = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.012));
    this.day = day;
    const head = this.body.userData.head;
    if (head) head.getWorldPosition(_head);
    else _head.set(x + Math.sin(this.heading) * 0.7, this.y + 1.28, z + Math.cos(this.heading) * 0.7);
    const eye = this.eye.sample({
      origin: { x: _head.x, y: _head.y, z: _head.z },
      heading: this.heading,
      day,
      food: this.world.food,
      water: this.world.water,
      bitter: this.world.bitter,
      perch: this.world.perch,
      other: other ? { pos: other.body.position, heading: other.heading } : null,
      otherColor: other && other.sex === "female" ? [1.0, 0.43, 0.71] : [0.23, 0.47, 0.91],
      others: (this.world.others || []).map((o) => ({
        pos: o.body.position,
        heading: o.heading,
        color: o.sex === "female" ? [1.0, 0.43, 0.71] : [0.23, 0.47, 0.91],
      })),
    });
    const clockRates = {
      lLNv: 5 + day * 55,
      pep: 4 + this.life.hunger * 22,
    };
    const extraV = (this.extra && this.extra.vision) || 0;
    const opticRates = this.opticRates(eye, extraV);
    this.lastOptic = opticRates;
    const stand = this.body.userData.standZ || 1.3;
    const onSweet = distF < 0.95 && this.y < stand + 0.28;
    const onBitterDrop = this.world.bitter
      && Math.hypot(this.world.bitter.x - x, this.world.bitter.z - z) < 0.95 && this.y < stand + 0.28;
    const taste = onSweet ? 90 : 0;
    const sweetHz = onSweet ? 95 : 0;
    const bitterHz = onBitterDrop ? 95 : 0;
    const hygro = 6 + (sampL.moist + sampR.moist) * 55
      + (distW < 1.05 && this.y < stand + 0.2 ? 40 : 0);
    const contact = distQ < 1.28;
    const ppkL = contact ? 95 : 0;
    const ppkR = contact ? 95 : 0;
    const radial = Math.hypot(x, z);
    const grounded = this.y < stand + 0.18 || this.onPerch;
    const wall = radial > ARENA_R - 1.15 ? 75 : 0;
    const touch = wall + (grounded ? 8 + this.speedS * 32 : 3);

    const proprio = this.readProprio(wall, grounded);
    const extra = this.extra || {};
    this.worker.postMessage({
      type: "rates",
      rates: {
        vision: extraV,
        L1L: 22, L1R: 22, L2L: 22, L2R: 22,
        smellL: Math.max(smellL, extra.smellL || 0),
        smellR: Math.max(smellR, extra.smellR || 0),
        foodORNL: smellL,
        foodORNR: smellR,
        pherORNL: pherHzL,
        pherORNR: pherHzR,
        co2ORNL: co2HzL,
        co2ORNR: co2HzR,
        aversiveORNL: avL,
        aversiveORNR: avR,
        JOL: joL,
        JOR: joR,
        taste: Math.max(taste, extra.taste || 0),
        sweet: Math.max(sweetHz, extra.taste || 0),
        bitter: bitterHz,
        touch: Math.max(touch, extra.touch || 0),
        hygro,
        ppkL, ppkR,
        courtship: extra.courtship || 0,
        escape: extra.escape || 0,
        ...clockRates,
        ...proprio,
        ...opticRates,
      },
    });
  }

  opticRates(eye, extraV) {
    const r = {};
    for (const side of ["L", "R"]) {
      const e = eye[side];
      for (let s = 0; s < 4; s++) {
        r["R16" + side + s] = hzVis(e.sectors[s], 140, 6) + extraV;
        r["R7" + side + s] = hzVis(e.sectorsUV[s], 150, 5) + extraV * 0.5;
        r["R8" + side + s] = hzVis(e.sectors[s] * 0.45 + e.sectorsUV[s] * 0.4, 130, 5) + extraV * 0.4;
      }
    }
    return r;
  }

  readProprio(wall, grounded) {
    if (this.mjPose) return this.readProprioMj(wall, grounded);
    const legs = this.body.userData.legs || [];
    const byName = Object.fromEntries(legs.map((l) => [l.name, l]));
    const ang = (leg) => {
      if (!leg) return 0;
      let s = 0;
      for (const h of Object.values(leg.hinges || {})) {
        s += Math.abs((h.userData.angle ?? h.userData.rest) - (h.userData.rest || 0));
      }
      return s;
    };
    const vel = (leg) => {
      if (!leg || !leg.foot) return 0;
      return Math.hypot(leg.foot.vx || 0, leg.foot.vz || 0, leg.foot.vy || 0);
    };
    const stance = (leg) => (leg && leg.foot && leg.foot.stance ? 1 : 0);
    const rates = {};
    let propSum = 0, choSum = 0, hpSum = 0, csaSum = 0;
    for (const seg of ["T1", "T2", "T3"]) {
      const pairLegs = LEG_NAMES.filter((n) => LEG_NEUROMERE[n] === seg).map((n) => byName[n]).filter(Boolean);
      let a = 0, v = 0, st = 0;
      for (const leg of pairLegs) {
        const aa = ang(leg), vv = vel(leg), ss = stance(leg);
        a += aa; v += vv; st += ss;
        const lr = leg.name[0];
        const choL = 12 + aa * 28 + vv * 6;
        const tactL = ss * 50 + wall * 0.35 + (grounded ? 6 : 1);
        rates[`cho${seg}${lr}`] = choL;
        rates[`tact${seg}${lr}`] = tactL;
      }
      const cho = 12 + a * 28 + v * 6;
      const hp = 8 + a * 20;
      const csa = 6 + st * 48 + (grounded ? this.speedS * 18 : 0);
      const tact = st * 50 + wall * 0.35 + (grounded ? 6 : 1);
      const prop = cho * 0.55 + hp * 0.25 + csa * 0.2;
      rates[`cho${seg}`] = cho;
      rates[`hp${seg}`] = hp;
      rates[`csa${seg}`] = csa;
      rates[`tact${seg}`] = tact;
      rates[`prop${seg}`] = prop;
      choSum += cho; hpSum += hp; csaSum += csa; propSum += prop;
    }
    rates.chordotonal = choSum / 3;
    rates.hairplate = hpSum / 3;
    rates.campaniform = csaSum / 3;
    rates.proprio = propSum / 3;
    return rates;
  }

  readProprioMj(wall, grounded) {
    const pose = this.mjPose;
    const rates = {};
    let propSum = 0, choSum = 0, hpSum = 0, csaSum = 0;
    for (const seg of ["T1", "T2", "T3"]) {
      const names = LEG_NAMES.filter((n) => LEG_NEUROMERE[n] === seg);
      let flex = 0, st = 0, fz = 0;
      for (const name of names) {
        const fl = pose.flex?.[name] || 0;
        const ss = pose.contact?.[name] ? 1 : 0;
        const ff = pose.force?.[name] || 0;
        flex += fl; st += ss; fz += ff;
        const lr = name[0];
        rates[`cho${seg}${lr}`] = 12 + fl * 18 + (pose.speed || 0) * 4;
        rates[`tact${seg}${lr}`] = ss * 50 + wall * 0.35 + (grounded ? 6 : 1);
      }
      const cho = 12 + flex * 18 + (pose.speed || 0) * 4;
      const hp = 8 + flex * 10;
      const csa = 6 + st * 48 + fz * 1.5 + (grounded ? this.speedS * 18 : 0);
      const tact = st * 50 + wall * 0.35 + (grounded ? 6 : 1);
      const prop = cho * 0.55 + hp * 0.25 + csa * 0.2;
      rates[`cho${seg}`] = cho;
      rates[`hp${seg}`] = hp;
      rates[`csa${seg}`] = csa;
      rates[`tact${seg}`] = tact;
      rates[`prop${seg}`] = prop;
      choSum += cho; hpSum += hp; csaSum += csa; propSum += prop;
    }
    rates.chordotonal = choSum / 3;
    rates.hairplate = hpSum / 3;
    rates.campaniform = csaSum / 3;
    rates.proprio = propSum / 3;
    return rates;
  }
}
