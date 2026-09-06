import * as THREE from "three";
import { stepLife, applyPhysicsPose } from "./fly.js?v=cube1";
import { CompoundEye } from "./eye.js?v=cube1";
import { physics, setCommand, spawnPhysics, despawnPhysics, resetPhysics } from "./physics.js?v=cube1";
import { mergePoolMaps, normalizeLesion, resolvePools } from "./lesion.js?v=cube1";
import { portableControls, stubRobotDriver, chassisSetpoints } from "./controller/portable.js?v=cube1";

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
const OPTIC_TYPES = [
  "R16", "R7", "R8", "L1", "L2", "L3",
  "T4a", "T4b", "T4c", "T4d", "T5a", "T5b", "T5c", "T5d", "HS", "VS",
];
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

function hzVis(v, gain = 70, base = 3) {
  return Math.max(0, Math.min(110, base + v * gain));
}

/** Soft-saturating map from effector EMA (0–1, already Hz-decoded) → drive.
 *  Honest: quiet pools stay near 0; mid rates become visible without hard clip.
 */
function softDrive(v, gain = 3.25) {
  const x = Math.max(0, v || 0);
  return Math.tanh(x * gain);
}

/** Antagonist pair from real pool EMAs. Quiet×quiet → 0.
 *  Winner-take-more breaks co-contraction so stance-slip can translate
 *  (calm2 left both sides mid-fire → net DoF≈0 twitch). No CPG clock.
 */
function antagPair(posEma, negEma, gain = 3.25) {
  const p = softDrive(posEma, gain);
  const n = softDrive(negEma, gain);
  const mag = p + n;
  if (mag < 1e-4) return { pos: 0, neg: 0 };
  const raw = (p - n) / (mag + 0.045);
  const d = Math.tanh(raw * 2.15);
  const lose = 0.48; // suppress loser so flex/ext do not cancel
  return {
    pos: Math.max(0, Math.min(1, p * (1 - lose * Math.max(0, -d)) + Math.max(0, d) * 0.32)),
    neg: Math.max(0, Math.min(1, n * (1 - lose * Math.max(0, d)) + Math.max(0, -d) * 0.32)),
  };
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
  // Filament onsets remain informative; ceilings stay below receptor saturation.
  const a = 1 - Math.exp(-dt / 0.22);
  filt[key] = slow + (c - slow) * a;
  const onset = Math.max(0, c - filt[key]);
  // Log-compressed tonic + moderate phasic — clear world, not epileptic.
  const tonic = Math.log1p(Math.max(0, c) * 4.5) * 28;
  return Math.min(140, 4 + onset * 280 + tonic + c * 16);
}

/** Amplify L/R concentration contrast for klinotaxis (sensory only). */
function lrKlinotaxis(hzL, hzR, gain = 0.38) {
  const mid = 0.5 * (hzL + hzR);
  const d = hzL - hzR;
  const g = 0.5 + gain;
  return {
    L: Math.max(0, Math.min(140, mid + d * g)),
    R: Math.max(0, Math.min(140, mid - d * g)),
  };
}

function gradedContact(dist, reach, peak = 100) {
  if (dist >= reach) return 0;
  const u = 1 - dist / reach;
  return peak * u * u;
}

const ARENA_R = 18; // small pad radius (matches world/procgen.js)
const OPEN_WORLD = true; // soft XY clamp only — no hard cage walls
const WORLD_SOFT_LIMIT = 15.8; // soft pad rim (~ARENA_R - 2.2)
/** Flight translation OFF by default — walking-focused. Re-enable with ?flight=1 */
function flightEnabledFromUrl() {
  try {
    const q = new URLSearchParams(location.search).get("flight");
    return q === "1" || q === "true" || q === "on";
  } catch (_) {
    return false;
  }
}
export const FLIGHT_ENABLED = typeof location !== "undefined" && flightEnabledFromUrl();
function bodyModeFromUrl() {
  try {
    const q = new URLSearchParams(location.search).get("body");
    if (q === "fly" || q === "nmf" || q === "mujoco") return "fly";
    return "cube";
  } catch (_) {
    return "cube";
  }
}
export const BODY_MODE = typeof location !== "undefined" ? bodyModeFromUrl() : "cube";
const READOUT_POOLS = [
  // Optic / descending readouts for assay + portable controller (not muscles).
  "HS", "VS", "R16", "L1", "L2", "L3",
  "T4a", "T4b", "T4c", "T4d", "T5a", "T5b", "T5c", "T5d",
];
const POOL_KEYS = [
  "T1L", "T1R", "T2L", "T2R", "T3L", "T3R",
  "DLM", "DVM", "ADMN", "MN9", "proboscis", "neck", "neckL", "neckR",
  "DNa", "DNg02", "DNp01", "DNp", "aIPg", "pIP1", "fru", "abdomen",
  ...CLOCK_KEYS,
  ...JOINT_POOLS,
  ...READOUT_POOLS,
];

export class EmbodiedFly {
  constructor({
    sex, body, neuBuf, csrBuf, stim, effectors, brainBuf, vncBuf, skelJson, scene, x, z, yaw,
    onReady, onFrame,
  }) {
    this.sex = "male"; // public sim: male CNS only
    this.body = body;
    // Default cube chassis; ?body=fly restores NeuroMechFly / MuJoCo path.
    this.bodyMode = (body && body.userData && body.userData.plantMode) || BODY_MODE || "cube";
    this.plantLabel = this.bodyMode === "cube" ? "cube chassis" : "fly";
    this.lastSteering = { forward: 0, yawRate: 0, v: 0, omega: 0 };
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
    this.life = { hunger: 0.7, crop: 0.2, energy: 1, sleep: 0.1, arousal: 0, mode: "walk" };
    this.cmd = { walk: 0, turn: 0, fly: 0, feed: 0, court: 0, groom: 0, escape: 0, rest: 0, head: 0, headYaw: 0, abdomen: 0, muscle: {} };
    this.motEma = Object.fromEntries(POOL_KEYS.map((k) => [k, 0]));
    this.opticEma = { HS_L: 0, HS_R: 0, VS_L: 0, VS_R: 0 };
    this.poolMap = mergePoolMaps(effectors, stim);
    this._stim = stim;
    this._effectors = effectors;
    this.lesionMeta = { id: "none", applied: [] };
    this.world = { food: { x: 6.5, z: 4.2 }, water: { x: -5.5, z: -3.8 }, other: null };

    body.position.set(x, this.y, z);
    body.rotation.y = this.heading;
    scene.add(body);

    this.neu = parseNeurons(neuBuf);
    this.activity = new Float32Array(this.neu.n);
    const P = effectors.pools || {};
    this.poolSets = {};
    for (const k of POOL_KEYS) {
      const ids = P[k] || stim[k] || [];
      this.poolSets[k] = new Set(ids);
    }
    this.stim = stim;
    this.smell = splitLR(stim.smell || [], this.neu.xyz);
    this.visionLR = splitLR(stim.vision || [], this.neu.xyz);
    this.ppk = splitLR(stim.ppk23 || P.ppk23 || [], this.neu.xyz);
    this.ppk25 = splitLR(stim.ppk25 || P.ppk25 || [], this.neu.xyz);
    this.ir52b = splitLR(stim.IR52b || P.IR52b || [], this.neu.xyz);
    this.optic = {};
    for (const k of OPTIC_TYPES) {
      this.optic[k] = sectorize(stim[k] || P[k] || [], this.neu.xyz);
    }
    this.eye = new CompoundEye();
    this.odor = {};
    for (const k of ODOR_TYPES) this.odor[k] = splitLR(stim[k] || P[k] || [], this.neu.xyz);
    this.ornFilt = { foodL: 0, foodR: 0, pherL: 0, pherR: 0, co2L: 0, co2R: 0, moistL: 0, moistR: 0, avL: 0, avR: 0 };
    this.propFilt = {}; // phasic-tonic state for load/stance/flex channels
    this.onPerch = false;
    this.physId = `${sex}-${Math.random().toString(36).slice(2, 8)}`;
    this.mjPose = null;
    this._ensurePlant = () => {
      if (this.bodyMode === "cube") return; // cube chassis: no MuJoCo plant
      if (!physics.ok) return;
      spawnPhysics(this.physId, this.body.position.x, this.body.position.z, this.heading).then((pose) => {
        if (!pose) return;
        this.mjPose = pose;
        // Align visual standZ to measured MuJoCo thorax height (was fixed 1.3 → mesh/plant skew).
        if (pose.y != null && Number.isFinite(pose.y)) {
          this.body.userData.standZ = pose.y;
          this.y = pose.y;
        }
      }).catch(() => {});
    };
    this._ensurePlant();
    this._onPhysicsResume = () => this._ensurePlant();
    if (typeof window !== "undefined" && this.bodyMode !== "cube") {
      window.addEventListener("ffb-physics-resume", this._onPhysicsResume);
    }
    this.lastOdor = { foodL: 0, foodR: 0, pherL: 0, pherR: 0 };
    this.prevDistO = 99;

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
        color: 0x3a78e8,
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
    const hue = [0.23, 0.47, 0.91];
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
          ppk25L: this.ppk25.L,
          ppk25R: this.ppk25.R,
          IR52bL: this.ir52b.L,
          IR52bR: this.ir52b.R,
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
        // No walkL/walkR aggregate effectors — locomotion from annotated MN pools only.
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
    if (typeof window !== "undefined" && this._onPhysicsResume) {
      window.removeEventListener("ffb-physics-resume", this._onPhysicsResume);
    }
    despawnPhysics(this.physId);
    if (this.body && this.body.parent) this.body.parent.remove(this.body);
  }

  setCnsVisible(on) {
    this.xray = on;
    this.points.visible = on;
    this.brainMesh.visible = on;
    this.vncMesh.visible = on;
    const vis = this.body?.userData?.body;
    if (!vis || !vis.traverse) return;
    vis.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.opacity === undefined) return;
      const m = o.material;
      if (m.userData._baseOpacity == null) m.userData._baseOpacity = m.opacity;
      const base = m.userData._baseOpacity;
      m.transparent = on || base < 0.99;
      m.opacity = on ? Math.min(0.22, base) : base;
      m.depthWrite = !on && base > 0.5;
    });
  }

  setRun(on) { this.worker.postMessage({ type: "run", on }); }

  /**
   * Apply a lesion config on the LIF connectome path (not joints).
   * Resolves named pools via effectors/stim maps, then posts to the worker.
   */
  applyLesion(cfg) {
    const lesion = normalizeLesion(cfg);
    const ops = [];
    for (const op of lesion.ops) {
      if (op.op === "silence" || op.op === "boost" || op.op === "swapLR" || op.op === "delay") {
        const { ids, missing } = resolvePools(this.poolMap, op.pools || []);
        if (missing.length) console.warn("[lesion] missing pools", missing);
        ops.push({ ...op, ids: Array.from(ids) });
      } else if (op.op === "cut") {
        const fr = resolvePools(this.poolMap, op.from || []);
        const to = resolvePools(this.poolMap, op.to || []);
        if (fr.missing.length || to.missing.length) {
          console.warn("[lesion] cut missing", fr.missing, to.missing);
        }
        ops.push({
          ...op,
          fromIds: Array.from(fr.ids),
          toIds: Array.from(to.ids),
        });
      } else if (op.op === "hunger") {
        ops.push({ ...op });
        // Also nudge life hunger so agent-side sampling matches dial.
        if (op.level != null) this.life.hunger = Math.max(0, Math.min(1.5, op.level));
      } else {
        ops.push({ ...op });
      }
    }
    const payload = { type: "lesion", lesion: { id: lesion.id, ops }, clear: true };
    this.worker.postMessage(payload);
    this.lesionMeta = { id: lesion.id, applied: ops.map((o) => o.op) };
    return lesion;
  }

  clearLesion() {
    this.worker.postMessage({ type: "clearLesion" });
    this.lesionMeta = { id: "none", applied: [] };
  }

  /** Robot-facing vision→steering snapshot (+ stub chassis setpoints). */
  getPortableControls() {
    return portableControls(this);
  }

  getRobotStub() {
    return stubRobotDriver(portableControls(this));
  }

  resetPose(x, z, yaw) {
    this.worker.postMessage({ type: "reset" });
    this.heading = yaw != null ? yaw : Math.random() * Math.PI * 2;
    this.y = this.body.userData.standZ || 1.3; this.vy = 0;
    this.body.position.set(x, this.y, z);
    this.body.rotation.set(0, this.heading, 0);
    this.life.hunger = 0.7;
    this.life.crop = 0.2; this.life.energy = 1; this.life.sleep = 0.1;
    if (physics.ok && this.bodyMode !== "cube") {
      resetPhysics(this.physId, x, z, this.heading).then((pose) => {
        if (pose) this.mjPose = pose;
      }).catch(() => {});
    }
  }

  applyFrame(m) {
    const sp = m.spikes;
    for (let i = 0; i < this.activity.length; i++) this.activity[i] *= 0.78;
    for (let k = 0; k < sp.length; k++) {
      const i = sp[k];
      this.activity[i] = 1;
    }
    const raw = m.eff || {};
    for (const name of POOL_KEYS) {
      const f = raw[name] != null ? raw[name] : 0;
      this.motEma[name] = this.motEma[name] * 0.15 + f * 0.85;
    }
    // Portable controller optic channels — true L/R from eye write-in (Hz→0–1), not collapsed pool.
    const o = this.lastOptic || {};
    const nHz = (hz) => Math.max(0, Math.min(1, (hz || 0) / 110));
    this.opticEma.HS_L = this.opticEma.HS_L * 0.25 + nHz(o.HSL) * 0.75;
    this.opticEma.HS_R = this.opticEma.HS_R * 0.25 + nHz(o.HSR) * 0.75;
    this.opticEma.VS_L = this.opticEma.VS_L * 0.25 + nHz(o.VSL) * 0.75;
    this.opticEma.VS_R = this.opticEma.VS_R * 0.25 + nHz(o.VSR) * 0.75;
    if (m.hungerMod != null && this.life) {
      // Worker neuromod hunger dial — blend into life.hunger gently.
      this.life.hunger = this.life.hunger * 0.85 + Math.max(0, Math.min(1.5, m.hungerMod)) * 0.15;
    }
    if (m.lesion) this.lesionMeta = m.lesion;
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
    const legs = (e.T1L + e.T1R + e.T2L + e.T2R + e.T3L + e.T3R) / 6;
    const cmd = this.cmd;
    // Body commands are ONLY annotated MN / effector readout.
    // walk/turn are UI mode labels — never free-joint thrusters or class-aggregate cheats.
    const legL = (e.T1L + e.T2L + e.T3L) / 3;
    const legR = (e.T1R + e.T2R + e.T3R) / 3;
    cmd.walk = THREE.MathUtils.clamp(
      softDrive(legs * 1.05 + e.DNa * 0.55, 2.9), 0, 1
    );
    // Turn from bilateral leg MN pools only (no walkL/R / descending-class spike thruster).
    const lrTurn = (legR - legL) * 2.0;
    cmd.turn = THREE.MathUtils.clamp(Math.tanh(lrTurn * 1.35), -1, 1);
    // Wing power MNs only (DLM / DVM / ADMN) — no cosmetic baseline flap.
    const wingRaw = e.DLM * 1.05 + e.DVM * 0.95 + e.ADMN * 0.8;
    cmd.fly = softDrive(wingRaw, 2.7);
    cmd.wing = {
      dlm: softDrive(e.DLM, 3.1),
      dvm: softDrive(e.DVM, 3.1),
      admn: softDrive(e.ADMN, 2.9),
    };
    cmd.feed = softDrive(e.MN9 * 1.1 + e.proboscis * 0.9, 2.9);
    cmd.court = softDrive(
      e.aIPg * 0.95 + e.pIP1 * 1.0 + e.DNg02 * 0.8,
      2.7
    );
    cmd.groom = softDrive((e.T1L + e.T1R) * 0.65, 2.6);
    cmd.escape = softDrive(e.DNp01 * 2.0, 2.9);
    cmd.rest = THREE.MathUtils.clamp(1 - cmd.walk - cmd.fly * 0.8 - cmd.escape * 0.8 - cmd.court * 0.4, 0, 1);
    const neckMag = Math.max(e.neck || 0, 0.5 * ((e.neckL || 0) + (e.neckR || 0)));
    cmd.head = softDrive(neckMag, 2.9);
    // Neck L/R asymmetry → yaw (annotated CvN sides); quiet → 0.
    cmd.headYaw = THREE.MathUtils.clamp(
      Math.tanh(((e.neckR || 0) - (e.neckL || 0)) * 2.6), -1, 1
    );
    cmd.abdomen = softDrive(e.abdomen * 0.9 + e.aIPg * 0.2 + cmd.court * 0.1, 2.8);
    // Honest MN→muscle: empty annotation pools stay quiet (no neuromere fill-in).
    // Male T2/T3 coxaProm & Ta* are absent in FlyEM type labels — leave them 0.
    // Antagonist pairs get contrast from real pool asymmetries only.
    cmd.muscle = {};
    for (const name of LEG_NAMES) {
      const ema = (muscle) => e[`${name}_${muscle}`] || 0;
      const coxa = antagPair(ema("coxaProm"), ema("coxaRem"), 3.35);
      const rot = antagPair(ema("coxaRotA"), ema("coxaRotP"), 3.2);
      const add = antagPair(ema("coxaAdd"), ema("coxaRem") * 0.55, 3.3);
      const tr = antagPair(ema("trFlex"), ema("trExt"), 3.45);
      const ti = antagPair(ema("tiFlex"), ema("tiExt"), 3.45);
      const ta = antagPair(ema("taDep"), ema("taLev"), 3.4);
      cmd.muscle[name] = {
        coxaProm: coxa.pos,
        coxaRem: Math.max(coxa.neg, add.neg * 0.35),
        coxaRotA: rot.pos,
        coxaRotP: rot.neg,
        coxaAdd: add.pos,
        trFlex: tr.pos,
        trExt: tr.neg,
        feRed: softDrive(ema("feRed"), 2.9),
        tiFlex: ti.pos,
        tiExt: ti.neg,
        taDep: ta.pos,
        taLev: ta.neg,
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

    if (this.bodyMode === "cube") {
      // Cube chassis: MN/descending → portable steering → kinematic translate/yaw.
      // No MuJoCo, no nmf mesh posing, no thrusters that bypass the brain.
      this.stepCubeChassis(dt);
    } else if (physics.ok) {
      // Brain fires motor neurons only. MuJoCo is the flesh.
      // walk/turn are UI mode labels only — never free-joint plant cheats.
      setCommand(this.physId, {
        muscle: cmd.muscle,
        dlm: cmd.wing?.dlm ?? (e.DLM || 0),
        dvm: cmd.wing?.dvm ?? (e.DVM || 0),
        admn: cmd.wing?.admn ?? (e.ADMN || 0),
        // allow_flight gates free-joint lift/thrust in physics.py (default off).
        allow_flight: FLIGHT_ENABLED,
        fly: FLIGHT_ENABLED ? (cmd.fly || 0) : 0,
        x: this.body.position.x,
        z: this.body.position.z,
        yaw: this.heading,
      });
      const pose = physics.poses.get(this.physId);
      if (pose) this.applyMujoco(pose, cmd, dt);
      else stepLife(this.body, dt, this.clock, cmd);
    } else {
      // Kinematic fallback if the plant is down: MN → leg pose → stance slip.
      // No cmd.walk thruster — ground motion from foot slip only.
      // Flight translation gated (default OFF); wing mesh still follows wing MNs in poseSoftParts.
      const stand = this.body.userData.standZ || 1.3;
      const ttmn = (e.L1_trExt || 0) + (e.R1_trExt || 0);
      if (this.y < stand + 0.08 && ttmn > 0.55) this.vy = 2.6 * Math.min(1, ttmn);
      const flying = FLIGHT_ENABLED && cmd.fly > 0.58;
      if (flying) {
        this.vy += (2.5 + stand - this.y) * 2.8 * dt * cmd.fly;
        this.vy *= 0.9;
      } else this.vy -= 18 * dt;
      this.y = Math.max(stand, this.y + this.vy * dt);
      if (this.y === stand && !flying) this.vy = 0;
      stepLife(this.body, dt, this.clock, cmd);
      const slip = this.body.userData.slip;
      if (flying) {
        const step = 4.2 * cmd.fly * dt;
        this.body.position.x += Math.sin(this.heading) * step;
        this.body.position.z += Math.cos(this.heading) * step;
        this.heading += this.turnS * 1.3 * dt;
      } else if (slip && slip.n > 0) {
        // Stance-slip from MN foot motion (no thruster / CPG). Scale with leg MN
        // asymmetry so quiet co-contraction does not thrash XY.
        const asym = Math.min(1.4, Math.abs(legR - legL) * 2.2 + softDrive(legs, 2.4));
        const slipGain = 2.2 + 1.6 * asym;
        const sx = (slip.x / slip.n) * slipGain;
        const sz = (slip.z / slip.n) * slipGain;
        this.body.position.x += sx;
        this.body.position.z += sz;
        this.heading += (slip.yawR - slip.yawL) * (1.2 + 0.6 * asym);
        this.lastSlipAbs = Math.hypot(sx, sz);
      } else {
        this.lastSlipAbs = 0;
      }
      const slipMag = slip && slip.n
        ? (slip.meanAbs != null ? slip.meanAbs : Math.hypot(slip.x, slip.z) / slip.n)
        : 0;
      this.slipMeanAbs = (this.slipMeanAbs || 0) * 0.88 + slipMag * 0.12;
      this.speedS = this.speedS * 0.3 + Math.min(1.4, slip && slip.n
        ? slipMag / 0.035
        : cmd.fly) * 0.7;
      // Open world: no dish rim. Sanity clip only if somehow past WORLD_SOFT_LIMIT.
      if (OPEN_WORLD) {
        const rad = Math.hypot(this.body.position.x, this.body.position.z);
        if (rad > WORLD_SOFT_LIMIT && rad > 1e-6) {
          const s = (WORLD_SOFT_LIMIT - 1) / rad;
          this.body.position.x *= s;
          this.body.position.z *= s;
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

  /**
   * Kinematic cube plant from portable MN steering (forward + yawRate).
   * Gains scale readability only — velocity source is connectome MNs.
   */
  stepCubeChassis(dt) {
    const snap = portableControls(this);
    const drive = chassisSetpoints(snap, { vGain: 2.8, yawGain: 2.5 });
    const forward = drive.forward || 0;
    const yawRate = drive.yawRate || 0;
    const v = drive.v || 0;
    const omega = drive.omega || 0;
    this.lastSteering = { forward, yawRate, v, omega };
    this.heading += omega * dt;
    this.body.position.x += Math.sin(this.heading) * v * dt;
    this.body.position.z += Math.cos(this.heading) * v * dt;
    if (OPEN_WORLD) {
      const rad = Math.hypot(this.body.position.x, this.body.position.z);
      if (rad > WORLD_SOFT_LIMIT && rad > 1e-6) {
        const s = (WORLD_SOFT_LIMIT - 0.6) / rad;
        this.body.position.x *= s;
        this.body.position.z *= s;
        // Soft bounce: reflect heading slightly outward
        const nx = this.body.position.x / Math.max(1e-6, Math.hypot(this.body.position.x, this.body.position.z));
        const nz = this.body.position.z / Math.max(1e-6, Math.hypot(this.body.position.x, this.body.position.z));
        const inward = Math.atan2(-nx, -nz);
        this.heading = this.heading * 0.7 + inward * 0.3;
      }
    }
    const stand = this.body.userData.standZ || 0.42;
    this.y = stand;
    this.vy = 0;
    this.body.position.y = stand;
    this.body.rotation.set(0, this.heading, 0);
    this.speedS = this.speedS * 0.25 + Math.min(1.4, Math.abs(v) / 2.5) * 0.75;
    this.plantLabel = "cube chassis";
    this.planted = true;
    this.plantNLeg = 0;
    this.onPerch = false;
    this.lastSlipAbs = Math.abs(v) * dt;
    this.slipMeanAbs = (this.slipMeanAbs || 0) * 0.88 + Math.abs(v) * 0.12;
  }

  applyMujoco(pose, cmd, dt) {
    this.mjPose = pose;
    this.heading = pose.yaw;
    // Visual root == plant thorax (XYZ). Never leave mesh at nmf.standZ while
    // MuJoCo walks — that was the suspended-mesh / offset-shadow bug.
    const py = pose.y;
    this.y = py;
    this.vy = 0;
    if (pose.planted && pose.y != null && Number.isFinite(pose.y)) {
      this.body.userData.standZ = this.body.userData.standZ * 0.9 + pose.y * 0.1;
    }
    let px = pose.x, pz = pose.z;
    const rad = Math.hypot(px, pz);
    if (rad > WORLD_SOFT_LIMIT && rad > 1e-6) {
      const s = (WORLD_SOFT_LIMIT - 1) / rad;
      px *= s;
      pz *= s;
    }
    this.body.position.set(px, py, pz);
    this.body.rotation.set(0, pose.yaw, 0);
    applyPhysicsPose(this.body, pose, dt, this.clock, cmd);
    this.speedS = this.speedS * 0.3 + Math.min(1.4, (pose.speed || 0) / 8) * 0.7;
    this.plantNLeg = pose.n_leg != null ? pose.n_leg : 0;
    this.planted = !!pose.planted;
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
    const hungerGain = 0.45 + 1.0 * this.life.hunger;
    // Antenna-local multi-point sampling resolves plume gradients for klinotaxis.
    const sampL = odors
      ? (odors.sampleAntenna
        ? odors.sampleAntenna(_antL.x, _antL.y, _antL.z, this.heading, -1)
        : odors.sample(_antL.x, _antL.y, _antL.z))
      : { food: 0, pher: 0, co2: 0, moist: 0, bitter: 0 };
    const sampR = odors
      ? (odors.sampleAntenna
        ? odors.sampleAntenna(_antR.x, _antR.y, _antR.z, this.heading, 1)
        : odors.sample(_antR.x, _antR.y, _antR.z))
      : { food: 0, pher: 0, co2: 0, moist: 0, bitter: 0 };
    const foodL = sampL.food * hungerGain;
    const foodR = sampR.food * hungerGain;
    const pherL = sampL.pher, pherR = sampR.pher;
    const co2L = sampL.co2, co2R = sampR.co2;
    const moistL = sampL.moist || 0, moistR = sampR.moist || 0;
    let smellL = phasicTonic(this.ornFilt, "foodL", foodL);
    let smellR = phasicTonic(this.ornFilt, "foodR", foodR);
    let pherHzL = phasicTonic(this.ornFilt, "pherL", pherL);
    let pherHzR = phasicTonic(this.ornFilt, "pherR", pherR);
    let co2HzL = phasicTonic(this.ornFilt, "co2L", co2L);
    let co2HzR = phasicTonic(this.ornFilt, "co2R", co2R);
    let avL = phasicTonic(this.ornFilt, "avL", sampL.bitter || 0);
    let avR = phasicTonic(this.ornFilt, "avR", sampR.bitter || 0);
    // Mild bilateral contrast — keep L/R asymmetry without pegging receptors.
    ({ L: smellL, R: smellR } = lrKlinotaxis(smellL, smellR, 0.40));
    ({ L: pherHzL, R: pherHzR } = lrKlinotaxis(pherHzL, pherHzR, 0.34));
    ({ L: co2HzL, R: co2HzR } = lrKlinotaxis(co2HzL, co2HzR, 0.30));
    ({ L: avL, R: avR } = lrKlinotaxis(avL, avR, 0.32));
    this.lastSmellL = smellL;
    this.lastSmellR = smellR;
    this.lastOdor = { foodL: smellL, foodR: smellR, pherL: pherHzL, pherR: pherHzR, co2L: co2HzL, co2R: co2HzR };
    const windL = odors ? odors.windAt(_antL.x, _antL.z) : { x: 0, z: 0 };
    const windR = odors ? odors.windAt(_antR.x, _antR.z) : { x: 0, z: 0 };
    // Body-frame wind: side = left+, forward along heading.
    const sideL = windL.x * c - windL.z * s;
    const sideR = windR.x * c - windR.z * s;
    const fwdL = windL.x * s + windL.z * c;
    const fwdR = windR.x * s + windR.z * c;
    const spdL = Math.hypot(windL.x, windL.z), spdR = Math.hypot(windR.x, windR.z);
    let joL = 5 + spdL * 28 + Math.max(0, -sideL) * 24 + Math.max(0, fwdL) * 8;
    let joR = 5 + spdR * 28 + Math.max(0, sideR) * 24 + Math.max(0, fwdR) * 8;
    ({ L: joL, R: joR } = lrKlinotaxis(joL, joR, 0.28));
    const distF = Math.hypot(this.world.food.x - x, this.world.food.z - z);
    const distW = Math.hypot(this.world.water.x - x, this.world.water.z - z);
    const other = this.world.other;
    const distQ = other ? Math.hypot(other.body.position.x - x, other.body.position.z - z) : 99;
    this.prevDistO = distQ;
    const day = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.012));
    this.day = day;
    const head = this.body.userData.head;
    if (head) head.getWorldPosition(_head);
    else _head.set(x + Math.sin(this.heading) * 0.7, this.y + 1.28, z + Math.cos(this.heading) * 0.7);
    const bombPos = odors && odors.bombEnabled ? odors.getBombPos() : null;
    const eye = this.eye.sample({
      origin: { x: _head.x, y: _head.y, z: _head.z },
      heading: this.heading,
      day,
      t,
      food: this.world.food,
      water: this.world.water,
      bitter: this.world.bitter,
      perch: this.world.perch,
      bomb: bombPos,
      // Procgen landmarks — required for vision→walk toward chunk targets.
      landmarks: this.world.landmarks || [],
      other: other ? { pos: other.body.position, heading: other.heading } : null,
      otherColor: [0.23, 0.47, 0.91],
      others: (this.world.others || []).map((o) => ({
        pos: o.body.position,
        heading: o.heading,
        color: [0.23, 0.47, 0.91],
      })),
    });
    // Annotated clock / neuromod pools — calm world→Hz (day, hunger, arousal, sleep).
    // Quiet life state → near-baseline rates; never invented neurons.
    const night = 1 - day;
    const aro = this.life.arousal || 0;
    const hung = this.life.hunger || 0;
    const slp = this.life.sleep || 0;
    const esc = this.cmd.escape || 0;
    const clockRates = {
      lLNv: 3 + day * 22,
      sLNv: 3 + day * 18 + Math.max(0, Math.sin(t * 0.012)) * 5,
      LNd: 2 + day * 11 + night * 7,
      DN1a: 2 + night * 14,
      DN1p: 2 + night * 16 + slp * 10,
      DAN: 2 + aro * 8 + (1 - hung) * 3,
      OA: 2 + aro * 12 + esc * 8,
      HT: 2 + slp * 10 + night * 5,
      pep: 2 + hung * 10,
    };
    const extraV = (this.extra && this.extra.vision) || 0;
    const opticRates = this.opticRates(eye, extraV);
    this.lastOptic = opticRates;
    // Broad visionL/R pools were bound but never eye-driven (only UI `vision` button).
    // Fill them from compound-eye salience so connectome sees L/R visual asymmetry.
    const visFromEye = (side) => {
      const e = eye[side] || {};
      const sal = (e.sal || 0) + (e.salFood || 0) * 1.35 + (e.salFly || 0) * 0.9 + (e.salWater || 0) * 0.7;
      const mot = Math.abs(e.hs || 0) + Math.abs(e.vs || 0);
      return hzVis((e.lum || 0) * 0.45 + sal * 1.15 + mot * 0.55 + (e.on || 0) * 1.2, 100, 4);
    };
    let visionL = visFromEye("L") + extraV;
    let visionR = visFromEye("R") + extraV;
    ({ L: visionL, R: visionR } = lrKlinotaxis(visionL, visionR, 0.40));
    const stand = this.body.userData.standZ || 1.3;
    const nearFloor = this.y < stand + 0.36;
    // Graded GRN / ppk contact — not binary on/off.
    const sweetHz = nearFloor ? gradedContact(distF, 1.35, 70) : gradedContact(distF, 0.7, 16);
    const distB = this.world.bitter
      ? Math.hypot(this.world.bitter.x - x, this.world.bitter.z - z) : 99;
    const bitterHz = nearFloor ? gradedContact(distB, 1.35, 65) : 0;
    const taste = Math.max(sweetHz, bitterHz * 0.85);
    const hygroL = 4 + moistL * 40 + (distW < 1.2 && nearFloor ? gradedContact(distW, 1.2, 35) : 0);
    const hygroR = 4 + moistR * 40 + (distW < 1.2 && nearFloor ? gradedContact(distW, 1.2, 35) : 0);
    const hygro = 0.5 * (hygroL + hygroR);
    // ppk courtship / contact — graded by proximity + slight L/R from bearing.
    const bOth = other ? bearingTo(other.body.position.x, other.body.position.z, x, z, c, s) : 0;
    const ppkBase = gradedContact(distQ, 1.55, 75);
    const ppkL = Math.min(120, ppkBase * (1 + Math.max(0, -bOth) * 0.28));
    const ppkR = Math.min(120, ppkBase * (1 + Math.max(0, bOth) * 0.28));
    // ppk25: contact pheromone; IR52b: food/leg contact — annotated receptor pools.
    const foodContact = nearFloor ? gradedContact(distF, 1.4, 55) : 0;
    const ppk25L = Math.min(110, ppkBase * 0.85 * (1 + Math.max(0, -bOth) * 0.22));
    const ppk25R = Math.min(110, ppkBase * 0.85 * (1 + Math.max(0, bOth) * 0.22));
    const irL = Math.min(110, foodContact * (1 + Math.max(0, -bearingTo(this.world.food.x, this.world.food.z, x, z, c, s)) * 0.2) + ppkBase * 0.15);
    const irR = Math.min(110, foodContact * (1 + Math.max(0, bearingTo(this.world.food.x, this.world.food.z, x, z, c, s)) * 0.2) + ppkBase * 0.15);
    const grounded = this.y < stand + 0.18 || this.onPerch;
    // Open world: no cage wall mechanosensation.
    const wall = 0;
    const touch = wall + (grounded ? 8 + this.speedS * 24 : 3) + ppkBase * 0.12;

    const proprio = this.readProprio(wall, grounded);
    const extra = this.extra || {};
    this.worker.postMessage({
      type: "rates",
      rates: {
        // Keep symmetric `vision` for UI stim button only — L/R eye goes through visionL/R.
        vision: extraV,
        visionL,
        visionR,
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
        ppk25L, ppk25R,
        IR52bL: irL,
        IR52bR: irR,
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
      // Sector photoreceptors: R1–R6 = luminance, R7 = UV, R8 = mixed.
      // Object/salience gain raised so static landmarks still write into lamina/LP.
      const meanL = e.lum || 0.001;
      const meanU = e.uv || 0.001;
      const sFood = e.sectorsFood || [0, 0, 0, 0];
      const sWater = e.sectorsWater || [0, 0, 0, 0];
      const sFly = e.sectorsFly || [0, 0, 0, 0];
      for (let s = 0; s < 4; s++) {
        const cL = (e.sectors[s] - meanL) / (meanL + 0.06);
        const cU = (e.sectorsUV[s] - meanU) / (meanU + 0.06);
        const contrast = Math.max(0, Math.abs(cL));
        const uvContrast = Math.max(0, Math.abs(cU));
        // Front-ish sectors (1–2) get a touch more object weight for approach.
        const frontBias = (s === 1 || s === 2) ? 1.15 : 1.0;
        const obj = ((sFood[s] || 0) * 1.15 + (sWater[s] || 0) * 0.7 + (sFly[s] || 0) * 0.95) * frontBias;
        r["R16" + side + s] = hzVis(e.sectors[s] + contrast * 0.4 + obj * 0.55, 110, 4) + extraV * 0.6;
        r["R7" + side + s] = hzVis(
          e.sectorsUV[s] + uvContrast * 0.4 + (sWater[s] || 0) * 0.45, 110, 3
        ) + extraV * 0.35;
        r["R8" + side + s] = hzVis(
          e.sectors[s] * 0.4 + e.sectorsUV[s] * 0.55 + contrast * 0.2 + obj * 0.35, 105, 3
        ) + extraV * 0.3;
      }
      // L1 ON / L2 OFF / L3 — temporal contrast + object salience (static targets matter).
      const on = e.on || 0, off = e.off || 0;
      const mot = Math.abs(e.hs || 0) + Math.abs(e.vs || 0);
      const sal = (e.sal || 0) + (e.salFood || 0) * 1.25 + (e.salFly || 0) * 0.95;
      const salObj = sal + (e.salWater || 0) * 0.6;
      const t4 = (e.t4a || 0) + (e.t4b || 0) + (e.t4c || 0) + (e.t4d || 0);
      const t5 = (e.t5a || 0) + (e.t5b || 0) + (e.t5c || 0) + (e.t5d || 0);
      r["L1" + side] = hzVis(on * 2.35 + t4 * 1.3 + mot * 0.55 + salObj * 0.85, 125, 3);
      r["L2" + side] = hzVis(off * 2.35 + t5 * 1.3 + mot * 0.5 + salObj * 0.7, 125, 3);
      r["L3" + side] = hzVis(e.uv * 1.0 + on * 0.85 + (e.salWater || 0) * 1.05 + sal * 0.2, 105, 3);
      // Direction-selective T4/T5 — HR arms + mild salience so loom/object edges couple.
      const salT = salObj * 0.35;
      r["T4a" + side] = hzVis((e.t4a || 0) + salT * 0.25, 125, 2);
      r["T4b" + side] = hzVis((e.t4b || 0) + salT * 0.25, 125, 2);
      r["T4c" + side] = hzVis((e.t4c || 0) + salT * 0.2, 125, 2);
      r["T4d" + side] = hzVis((e.t4d || 0) + salT * 0.2, 125, 2);
      r["T5a" + side] = hzVis((e.t5a || 0) + salT * 0.25, 125, 2);
      r["T5b" + side] = hzVis((e.t5b || 0) + salT * 0.25, 125, 2);
      r["T5c" + side] = hzVis((e.t5c || 0) + salT * 0.2, 125, 2);
      r["T5d" + side] = hzVis((e.t5d || 0) + salT * 0.2, 125, 2);
      // Wide-field HS/VS — motion + object presence (fixation still drives LP via connectome).
      r["HS" + side] = hzVis(Math.abs(e.hs || 0) * 1.2 + salObj * 0.75 + (e.salFly || 0) * 0.4, 125, 2);
      r["VS" + side] = hzVis(Math.abs(e.vs || 0) * 1.15 + on * 0.35 + salObj * 0.4, 125, 2);
    }
    // Sensory L/R contrast (same idea as odor klinotaxis) — not a body thruster.
    // Lets optic flow / landmark asymmetry reach descending→leg paths via the connectome.
    const pairKeys = [
      "L1", "L2", "L3", "HS", "VS",
      "T4a", "T4b", "T4c", "T4d", "T5a", "T5b", "T5c", "T5d",
    ];
    for (const base of pairKeys) {
      const pair = lrKlinotaxis(r[base + "L"] || 0, r[base + "R"] || 0, 0.38);
      r[base + "L"] = pair.L;
      r[base + "R"] = pair.R;
    }
    return r;
  }

  readProprio(wall, grounded) {
    if (this.mjPose) return this.readProprioMj(wall, grounded);
    const legs = this.body.userData.legs || [];
    const byName = Object.fromEntries(legs.map((l) => [l.name, l]));
    const filt = this.propFilt;
    const ang = (leg) => {
      if (!leg) return 0;
      let s = 0;
      for (const h of Object.values(leg.hinges || {})) {
        s += Math.abs((h.userData.angle ?? h.userData.rest) - (h.userData.rest || 0));
      }
      return s;
    };
    const jointFlex = (leg, keys) => {
      if (!leg) return 0;
      let s = 0, n = 0;
      for (const k of keys) {
        const h = leg.hinges?.[k];
        if (!h) continue;
        s += Math.abs((h.userData.angle ?? h.userData.rest) - (h.userData.rest || 0));
        n++;
      }
      return n ? s / n : 0;
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
      let a = 0, v = 0, st = 0, load = 0, slipV = 0;
      for (const leg of pairLegs) {
        const aa = ang(leg), vv = vel(leg), ss = stance(leg);
        const cox = jointFlex(leg, ["coxa-yaw", "coxa-pitch", "coxa-roll"]);
        const fem = jointFlex(leg, ["trochanterfemur-pitch", "trochanterfemur-roll"]);
        const tib = jointFlex(leg, ["tibia-pitch"]);
        const tar = jointFlex(leg, ["tarsus1-pitch"]);
        const flex = 0.35 * cox + 0.35 * fem + 0.2 * tib + 0.1 * tar;
        const ld = ss * (0.4 + Math.min(1.2, vv * 0.08));
        a += flex; v += vv; st += ss; load += ld; slipV += ss ? vv : 0;
        const lr = leg.name[0];
        // Phasic onset on stance/load so the connectome sees step edges.
        const stHz = phasicTonic(filt, `st${seg}${lr}`, ss, 0.032);
        const ldHz = phasicTonic(filt, `ld${seg}${lr}`, ld, 0.032);
        const flexHz = phasicTonic(filt, `fx${seg}${lr}`, flex, 0.032);
        const choL = Math.min(120, 6 + flex * 38 + flexHz * 0.16 + vv * 5);
        const tactL = Math.min(110, stHz * 0.4 + ss * 40 + wall * 0.4 + (grounded ? 6 : 1));
        rates[`cho${seg}${lr}`] = choL;
        rates[`tact${seg}${lr}`] = tactL;
      }
      const nLeg = Math.max(1, pairLegs.length);
      a /= nLeg; v /= nLeg; st /= nLeg; load /= nLeg; slipV /= nLeg;
      const stP = phasicTonic(filt, `st${seg}`, st, 0.032);
      const ldP = phasicTonic(filt, `ld${seg}`, load, 0.032);
      const cho = Math.min(120, 6 + a * 38 + v * 5 + (stP - 6) * 0.1);
      const hp = Math.min(90, 5 + a * 22 + (stP - 6) * 0.05);
      const csa = Math.min(120, 5 + st * 38 + ldP * 0.28 + slipV * 3.2 + (grounded ? this.speedS * 12 : 0));
      const tact = Math.min(110, st * 42 + wall * 0.4 + (grounded ? 6 : 1) + (stP - 6) * 0.22);
      const prop = cho * 0.5 + hp * 0.22 + csa * 0.28;
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
    const filt = this.propFilt;
    const rates = {};
    let propSum = 0, choSum = 0, hpSum = 0, csaSum = 0;
    const spd = pose.speed || 0;
    for (const seg of ["T1", "T2", "T3"]) {
      const names = LEG_NAMES.filter((n) => LEG_NEUROMERE[n] === seg);
      let flex = 0, st = 0, fz = 0, slipV = 0;
      for (const name of names) {
        const fl = pose.flex?.[name] || 0;
        const ss = pose.contact?.[name] ? 1 : 0;
        const ff = pose.force?.[name] || 0;
        // Approximate slip velocity from force change / speed when planted.
        const sv = ss ? Math.min(8, spd * 0.6 + ff * 0.02) : 0;
        flex += fl; st += ss; fz += ff; slipV += sv;
        const lr = name[0];
        const stHz = phasicTonic(filt, `mjst${seg}${lr}`, ss, 0.032);
        const ldHz = phasicTonic(filt, `mjld${seg}${lr}`, Math.min(1.5, ff * 0.04 + ss * 0.5), 0.032);
        const fxHz = phasicTonic(filt, `mjfx${seg}${lr}`, fl, 0.032);
        rates[`cho${seg}${lr}`] = Math.min(120, 6 + fl * 28 + fxHz * 0.14 + spd * 3);
        rates[`tact${seg}${lr}`] = Math.min(110, stHz * 0.4 + ss * 40 + wall * 0.4 + (grounded ? 6 : 1));
      }
      const nLeg = Math.max(1, names.length);
      flex /= nLeg; st /= nLeg; fz /= nLeg; slipV /= nLeg;
      const stP = phasicTonic(filt, `mjst${seg}`, st, 0.032);
      const ldP = phasicTonic(filt, `mjld${seg}`, Math.min(1.5, fz * 0.03 + st * 0.5), 0.032);
      const cho = Math.min(120, 6 + flex * 28 + spd * 3 + (stP - 6) * 0.1);
      const hp = Math.min(90, 5 + flex * 14 + (stP - 6) * 0.05);
      const csa = Math.min(120, 5 + st * 38 + ldP * 0.3 + fz * 1.1 + slipV * 3.5 + (grounded ? this.speedS * 12 : 0));
      const tact = Math.min(110, st * 42 + wall * 0.4 + (grounded ? 6 : 1) + (stP - 6) * 0.22);
      const prop = cho * 0.5 + hp * 0.22 + csa * 0.28;
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
