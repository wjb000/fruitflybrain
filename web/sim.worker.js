/* LIF engine for the Male CNS connectome. Runs in a Web Worker.
 *
 * This is the primary brain: ~166k Traced cells, real chemical synapses
 * (connectome edge weights, NT-aware sign), Poisson stim, Tsodyks–Markram
 * short-term depression/facilitation on chemical edges, slow neuromod.
 * Optional tiny hΔ Δw on the 45 traced hDelta cells — not the hΔ demo.
 * Gap-fill lives outside (eye/ORN/proprio Hz write-in, plant adhesion).
 * Do not add a behavior tree or CPG here.
 */

let n = 0;
let indptr, indices, weight, group, nt;
let V, I, refrac, spikes, drive, sign;
let adapt, mDA, mOA, m5;
let uFac;            // per-neuron TM utilization (facilitation)
let xStd;            // per-edge TM resource (depression) — time-varying efficacy
let tLastStd;        // last spike time of pre (ms) for lazy x/u recovery
let rngs;
// NT → Tsodyks–Markram (must match web/stp.js NT_STP).
const NT_U = new Float32Array([0.22, 0.40, 0.30, 0.34, 0.10, 0.16, 0.14, 0.10]);
const NT_TAUD = new Float32Array([260, 420, 320, 360, 90, 400, 480, 200]);
const NT_TAUF = new Float32Array([90, 48, 70, 60, 40, 180, 220, 520]);
function chemWeight(w) {
  return 0.68 * Math.sqrt(w) + 0.040 * w;
}
let params = {
  dt: 0.5,
  tau: 20,
  tauSynFast: 4.5,   // ACh / fast EPSP
  tauSynInhib: 7.0,  // GABA / GluCl / histamine
  tauAdapt: 90,
  tauMod: 1400,      // slow neuromod (DA/OA/5HT)
  tauStd: 420,       // legacy alias (ACh tau_d); TM uses NT_TAUD
  vRest: 0,
  vReset: 0,
  vThresh: 1,
  refractory: 2,
  // Connectome weights via chemWeight (√w + linear), not unit hits.
  // Scaled so a first ACh spike (U≈0.40) matches the old sqrt·wScale regime.
  wScale: 0.028,
  inhibGain: 2.15,
  stimAmp: 0.11,
  // Legacy stdUse kept for params messages; TM uses NT_U.
  stdUse: 0.40,
  facOA: 0.08,
};
// Optional hΔ fast weights (additive Δw on traced hDelta outgoing edges only).
let fastW = null;
let fastWPre = null;
let fastWEdges = null;
let fastWIds = null;
let fastWPlastic = false;
let fastWEta = 0.012;
let fastWDecay = 0.9985;
let fastWClip = 2.5;
let synAcc = { sumU: 0, sumX: 0, sumEff: 0, sumW: 0, nEdge: 0, nDep: 0, nPre: 0 };
// Keep legacy tauSyn alias for params messages
params.tauSyn = params.tauSynFast;
let t = 0;
let synDecayFast = Math.exp(-params.dt / params.tauSynFast);
let synDecayInhib = Math.exp(-params.dt / params.tauSynInhib);
let adaptDecay = Math.exp(-params.dt / params.tauAdapt);
let modDecay = Math.exp(-params.dt / params.tauMod);
let stdDecay = Math.exp(-params.dt / params.tauStd);
let sleepBias = 0;
let arousalGain = 1;
let running = false;
let stepsPerFrame = 10;

// --- Lesion harness (connectome path only; never joint hacks) ---
let gainOut = null;       // per-neuron outgoing synapse scale (silence/boost)
let edgeScale = null;     // per-edge scale (cut bundles); null = all 1
let delaySteps = null;    // per-neuron extra synaptic delay in steps
let delayQueues = null;   // Map-like: neuron -> queue of {left, targets packed}
let delayRing = null;     // ring buffer of pending spike deliveries
let delayRingPos = 0;
let delayRingLen = 0;
const DELAY_RING_MAX = 64;
let swapLR = null;        // Int32Array remap: i -> partner, or -1
let hungerMod = 1;        // neuromod hunger dial (scales DA deposit + arousal bias)
let lesionMeta = { id: "none", applied: [] };

function ensureLesionBuffers() {
  if (!n) return;
  if (!gainOut || gainOut.length !== n) {
    gainOut = new Float32Array(n);
    gainOut.fill(1);
  }
  if (!delaySteps || delaySteps.length !== n) {
    delaySteps = new Int16Array(n);
  }
  if (!swapLR || swapLR.length !== n) {
    swapLR = new Int32Array(n);
    swapLR.fill(-1);
  }
  if (!edgeScale || edgeScale.length !== weight.length) {
    edgeScale = new Float32Array(weight.length);
    edgeScale.fill(1);
  }
  if (!delayRing) {
    delayRing = Array.from({ length: DELAY_RING_MAX }, () => []);
    delayRingPos = 0;
    delayRingLen = DELAY_RING_MAX;
  }
}

function clearLesion() {
  lesionMeta = { id: "none", applied: [] };
  hungerMod = 1;
  if (!n) return;
  ensureLesionBuffers();
  gainOut.fill(1);
  delaySteps.fill(0);
  swapLR.fill(-1);
  edgeScale.fill(1);
  for (let i = 0; i < delayRing.length; i++) delayRing[i] = [];
}

function buildSwapLR(ids, xyz) {
  // Pair each selected neuron with nearest opposite-x partner in the same set.
  const arr = Array.from(ids);
  const unused = new Set(arr);
  for (const i of arr) {
    if (!unused.has(i)) continue;
    const xi = xyz[i * 3];
    let best = -1, bestD = 1e9;
    for (const j of unused) {
      if (j === i) continue;
      const xj = xyz[j * 3];
      if (xi * xj >= 0) continue; // need opposite side
      const dy = xyz[i * 3 + 1] - xyz[j * 3 + 1];
      const dz = xyz[i * 3 + 2] - xyz[j * 3 + 2];
      const d = Math.abs(Math.abs(xi) - Math.abs(xj)) + Math.abs(dy) + Math.abs(dz);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best >= 0) {
      swapLR[i] = best;
      swapLR[best] = i;
      unused.delete(i);
      unused.delete(best);
    }
  }
}

function applyLesionMessage(m) {
  ensureLesionBuffers();
  if (m.clear) clearLesion();
  const cfg = m.lesion || m;
  const ops = cfg.ops || [];
  lesionMeta = { id: cfg.id || "lesion", applied: [] };
  const xyz = m.xyz || null; // optional Float32Array for swapLR
  for (const op of ops) {
    if (op.op === "silence") {
      const ids = op.ids || [];
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        if (i >= 0 && i < n) gainOut[i] = 0;
      }
      lesionMeta.applied.push("silence:" + ids.length);
    } else if (op.op === "boost") {
      const g = op.gain != null ? op.gain : 2;
      const ids = op.ids || [];
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        if (i >= 0 && i < n) gainOut[i] = g;
      }
      lesionMeta.applied.push("boost:" + ids.length + "x" + g);
    } else if (op.op === "cut") {
      const fromSet = new Uint8Array(n);
      const toSet = new Uint8Array(n);
      for (const i of op.fromIds || []) if (i < n) fromSet[i] = 1;
      for (const i of op.toIds || []) if (i < n) toSet[i] = 1;
      let cutN = 0;
      for (let i = 0; i < n; i++) {
        if (!fromSet[i]) continue;
        const a = indptr[i], b = indptr[i + 1];
        for (let k = a; k < b; k++) {
          if (toSet[indices[k]]) {
            edgeScale[k] = 0;
            cutN++;
          }
        }
      }
      lesionMeta.applied.push("cut:" + cutN);
    } else if (op.op === "swapLR") {
      const ids = op.ids || [];
      if (xyz && xyz.length >= n * 3) buildSwapLR(ids, xyz);
      else {
        // Fallback: pairwise sort by |x| within pool using group only — no-op without xyz
        lesionMeta.applied.push("swapLR:need-xyz");
      }
      lesionMeta.applied.push("swapLR:" + ids.length);
    } else if (op.op === "delay") {
      const ms = op.ms != null ? op.ms : 40;
      const steps = Math.max(1, Math.round(ms / params.dt));
      const ids = op.ids || [];
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        if (i >= 0 && i < n) delaySteps[i] = steps;
      }
      lesionMeta.applied.push("delay:" + ids.length + "@" + ms + "ms");
    } else if (op.op === "hunger") {
      hungerMod = op.level != null ? op.level : 1;
      lesionMeta.applied.push("hunger:" + hungerMod);
    }
  }
  postMessage({ type: "lesionApplied", meta: lesionMeta, hungerMod });
}

function rebuildSign() {
  sign = new Float32Array(n);
  const g = params.inhibGain;
  for (let i = 0; i < n; i++) {
    const k = nt[i];
    // Fast: ACh excitatory. GABA, glutamate (GluCl), and histamine
    // (photoreceptors → L1/L2) inhibitory. DA/5HT/OA are slow, not EPSPs.
    if (k === 5 || k === 6 || k === 7) sign[i] = 0;
    else sign[i] = (k === 2 || k === 3 || k === 4) ? -g : 1;
  }
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function init(bufNeurons, bufCsr) {
  const nv = new DataView(bufNeurons);
  const magic = String.fromCharCode(nv.getUint8(0), nv.getUint8(1), nv.getUint8(2), nv.getUint8(3));
  if (magic !== "MCNS") throw new Error("bad neurons.bin");
  n = nv.getUint32(8, true);
  const xyzBytes = n * 3 * 4;
  const offG = 12 + xyzBytes;
  group = new Uint8Array(bufNeurons, offG, n);
  nt = new Uint8Array(bufNeurons, offG + n, n);

  const cv = new DataView(bufCsr);
  const cm = String.fromCharCode(cv.getUint8(0), cv.getUint8(1), cv.getUint8(2), cv.getUint8(3));
  if (cm !== "MCSR") throw new Error("bad connectome.bin");
  const n2 = cv.getUint32(4, true);
  const nnz = cv.getUint32(8, true);
  if (n2 !== n) throw new Error("neuron/connectome size mismatch");
  const offIp = 12;
  indptr = new Uint32Array(bufCsr, offIp, n + 1);
  const offIdx = offIp + (n + 1) * 4;
  indices = new Uint32Array(bufCsr, offIdx, nnz);
  const offW = offIdx + nnz * 4;
  weight = new Uint16Array(bufCsr, offW, nnz);

  V = new Float32Array(n);
  I = new Float32Array(n);
  refrac = new Float32Array(n);
  spikes = new Uint8Array(n);
  drive = new Float32Array(n);
  adapt = new Float32Array(n);
  mDA = new Float32Array(n);
  mOA = new Float32Array(n);
  m5 = new Float32Array(n);
  uFac = new Float32Array(n); // TM utilization; 0 at rest (first spike → U)
  xStd = new Float32Array(nnz);
  xStd.fill(1);
  tLastStd = new Float32Array(n);
  tLastStd.fill(-1e6);
  rngs = mulberry32(0xC0FFEE);
  rebuildSign();
  // Neuron xyz lives in neurons.bin; keep a view for swapLR lesions.
  self._xyz = new Float32Array(bufNeurons, 12, n * 3);
  clearLesion();
  synDecayFast = Math.exp(-params.dt / params.tauSynFast);
  synDecayInhib = Math.exp(-params.dt / params.tauSynInhib);
  adaptDecay = Math.exp(-params.dt / params.tauAdapt);
  modDecay = Math.exp(-params.dt / params.tauMod);
  stdDecay = Math.exp(-params.dt / params.tauStd);
}

const channels = {};
const channelRate = {};
const effectorIds = {};
const effectorSize = {};
const effectorHits = {};

function bindEffectors(pools) {
  for (const name in pools) {
    const ids = Uint32Array.from(pools[name] || []);
    effectorIds[name] = ids;
    effectorSize[name] = ids.length;
    effectorHits[name] = 0;
  }
}

function tallyEffectors() {
  // Weight each MN spike by incoming |I| so weakly driven Poisson is not a
  // unit hit. Strong connectome current (weighted, time-varying) counts more.
  for (const name in effectorIds) {
    const ids = effectorIds[name];
    let h = 0;
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k];
      if (i < n && spikes[i]) {
        const wHit = Math.min(2.2, 0.22 + Math.abs(I[i]) * 7);
        h += wHit;
      }
    }
    effectorHits[name] += h;
  }
}

/** Decode effector pools as mean spike rate (Hz) over the frame window,
 *  then map to a 0–1 `eff` the UI expects. Raw hits/(sz*steps) is ~0.01 and
 *  leaves muscles limp; ~40 Hz → 0–1 (with soft exp) keeps sparse MN pools useful
 *  without saturating every effector every frame.
 */
function effectorFractions(steps) {
  const out = {};
  const hzOut = {};
  const s = Math.max(1, steps);
  const sec = (s * params.dt) / 1000;
  const HZ_SCALE = 52; // ~52 Hz mean → full drive (small pools were saturating at 40)
  for (const name in effectorIds) {
    const sz = effectorSize[name] || 0;
    const hits = effectorHits[name] || 0;
    const hz = sz > 0 && sec > 0 ? hits / (sz * sec) : 0;
    // Tiny pools (neck=25, coxaProm=4) have high Poisson variance — do not
    // treat a handful of spikes as tetanus. Larger pools keep the old map.
    const tau = sz > 0 && sz < 8 ? 30 : sz < 22 ? 24 : 20;
    const hzFull = sz > 0 && sz < 8 ? 80 : sz < 22 ? 62 : HZ_SCALE;
    const norm = hz <= 0 ? 0 : Math.min(1, 1 - Math.exp(-hz / tau));
    const lin = Math.min(1, hz / hzFull);
    out[name] = Math.max(norm, lin * 0.80);
    hzOut[name] = hz;
    effectorHits[name] = 0;
  }
  out._hz = hzOut;
  return out;
}

function applyDrive() {
  drive.fill(0);
  for (const name in channels) {
    const ids = channels[name];
    const r = channelRate[name] || 0;
    if (r <= 0 || !ids) continue;
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k];
      if (i >= 0 && i < n) {
        if (r > drive[i]) drive[i] = r;
      }
    }
  }
}

function setStim(ids, rateHz) {
  channels.user = ids ? Uint32Array.from(ids) : new Uint32Array(0);
  channelRate.user = rateHz || 0;
  applyDrive();
}

function enableFastW(opts) {
  const ids = Array.from(opts.ids || []).filter((i) => i >= 0 && i < n);
  fastWIds = Uint32Array.from(ids);
  fastWPre = new Uint8Array(n);
  const edges = [];
  for (const i of ids) {
    fastWPre[i] = 1;
    for (let k = indptr[i]; k < indptr[i + 1]; k++) edges.push(k);
  }
  fastWEdges = Uint32Array.from(edges);
  if (!fastW || fastW.length !== weight.length) fastW = new Float32Array(weight.length);
  else fastW.fill(0);
  fastWEta = opts.eta != null ? opts.eta : 0.012;
  fastWDecay = opts.decay != null ? opts.decay : 0.9985;
  fastWClip = opts.clip != null ? opts.clip : 2.5;
  fastWPlastic = opts.plastic !== false;
  return { nPre: ids.length, nEdges: edges.length };
}

function fastWStats() {
  if (!fastW || !fastWEdges) return { nEdges: 0, nNonzero: 0, meanAbs: 0 };
  const nEdges = fastWEdges.length;
  let sumAbs = 0, nNonzero = 0;
  for (let e = 0; e < nEdges; e++) {
    const v = Math.abs(fastW[fastWEdges[e]]);
    sumAbs += v;
    if (v > 1e-6) nNonzero++;
  }
  return { nEdges, nNonzero, meanAbs: nEdges ? sumAbs / nEdges : 0 };
}

function synStats() {
  const nE = synAcc.nEdge || 0;
  const nP = synAcc.nPre || 0;
  return {
    meanU: nP ? synAcc.sumU / nP : 0,
    meanX: nE ? synAcc.sumX / nE : 1,
    meanEff: nE ? synAcc.sumEff / nE : 1,
    meanW: nE ? synAcc.sumW / nE : 0,
    nDepressed: synAcc.nDep,
    nEdges: nE,
    nPre: nP,
    fastW: fastWStats(),
  };
}

function step() {
  const dt = params.dt;
  const leak = dt / params.tau;
  const wScale = params.wScale;
  const stimAmp = params.stimAmp;
  const thr0 = params.vThresh + sleepBias;
  const reset = params.vReset;
  const rest = params.vRest;
  const ref0 = params.refractory;
  const gAro = arousalGain;
  const facOA = params.facOA;

  const synDecay = 0.72 * synDecayFast + 0.28 * synDecayInhib;
  for (let i = 0; i < n; i++) {
    I[i] *= synDecay;
    adapt[i] *= adaptDecay;
    mDA[i] *= modDecay;
    mOA[i] *= modDecay;
    m5[i] *= modDecay;
  }
  if (fastW && fastWPlastic && fastWEdges && fastWDecay < 1) {
    const dcy = fastWDecay;
    for (let e = 0; e < fastWEdges.length; e++) fastW[fastWEdges[e]] *= dcy;
  }

  synAcc.sumU = 0; synAcc.sumX = 0; synAcc.sumEff = 0; synAcc.sumW = 0;
  synAcc.nEdge = 0; synAcc.nDep = 0; synAcc.nPre = 0;

  for (let i = 0; i < n; i++) {
    if (!spikes[i]) continue;
    const knt = nt[i] || 0;
    const U = NT_U[knt] || 0.22;
    const tauD = NT_TAUD[knt] || 260;
    const tauF = NT_TAUF[knt] || 90;
    const isi = t - tLastStd[i];
    tLastStd[i] = t;
    // Recover u toward 0, then TM jump on this spike.
    let u = uFac[i] * Math.exp(-Math.max(0, isi) / tauF);
    const uOn = u + U * (1 - u);
    uFac[i] = uOn;
    const recX = Math.exp(-Math.max(0, isi) / tauD);
    const beta = 1 - uOn;
    synAcc.sumU += uOn;
    synAcc.nPre++;
    const gOut = gainOut ? gainOut[i] : 1;
    if (gOut <= 0) continue;
    const src = (swapLR && swapLR[i] >= 0) ? swapLR[i] : i;
    const a2 = indptr[src], b2 = indptr[src + 1];
    const dly = delaySteps ? delaySteps[i] : 0;
    const useFW = fastW && fastWPre && fastWPre[i];
    const hebb = useFW && fastWPlastic;

    if (knt === 5) {
      const h = 0.55 + 0.9 * hungerMod;
      const s = 0.012 * uOn * gOut * h;
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        let x = 1 - (1 - xStd[k]) * recX;
        const v = mDA[indices[k]] + s * chemWeight(weight[k]) * x * esc;
        mDA[indices[k]] = v > 1.5 ? 1.5 : v;
        xStd[k] = Math.max(0.06, x * beta);
      }
    } else if (knt === 6) {
      const s = 0.010 * uOn * gOut;
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        let x = 1 - (1 - xStd[k]) * recX;
        const v = m5[indices[k]] + s * chemWeight(weight[k]) * x * esc;
        m5[indices[k]] = v > 1.5 ? 1.5 : v;
        xStd[k] = Math.max(0.06, x * beta);
      }
    } else if (knt === 7) {
      const h = 0.65 + 0.7 * hungerMod;
      const s = 0.014 * uOn * gOut * h;
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        let x = 1 - (1 - xStd[k]) * recX;
        const v = mOA[indices[k]] + s * chemWeight(weight[k]) * x * esc;
        mOA[indices[k]] = v > 1.5 ? 1.5 : v;
        xStd[k] = Math.max(0.06, x * beta);
      }
    } else if (dly > 0) {
      const slot = (delayRingPos + dly) % delayRingLen;
      delayRing[slot].push({ s: sign[i] * wScale * uOn * gOut, a: a2, b: b2, recX, beta, uOn });
    } else {
      const s = sign[i] * wScale * gOut;
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        let x = 1 - (1 - xStd[k]) * recX;
        const wc = chemWeight(weight[k]);
        const fw = useFW ? fastW[k] : 0;
        const eff = uOn * x;
        I[indices[k]] += s * (wc + fw) * eff * esc;
        xStd[k] = Math.max(0.06, x * beta);
        synAcc.sumX += x;
        synAcc.sumEff += eff;
        synAcc.sumW += wc;
        synAcc.nEdge++;
        if (eff < 0.18) synAcc.nDep++;
        if (hebb && spikes[indices[k]]) {
          let v = fastW[k] + fastWEta;
          if (v > fastWClip) v = fastWClip;
          else if (v < -fastWClip) v = -fastWClip;
          fastW[k] = v;
        }
      }
    }
  }

  if (delayRing) {
    const due = delayRing[delayRingPos];
    for (let p = 0; p < due.length; p++) {
      const { s, a: aa, b: bb, recX, beta, uOn } = due[p];
      const rX = recX != null ? recX : 1;
      const bt = beta != null ? beta : 0.6;
      const u = uOn != null ? uOn : 0.4;
      for (let k = aa; k < bb; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        let x = 1 - (1 - xStd[k]) * rX;
        const wc = chemWeight(weight[k]);
        I[indices[k]] += s * wc * u * x * esc;
        xStd[k] = Math.max(0.06, x * bt);
      }
    }
    delayRing[delayRingPos] = [];
    delayRingPos = (delayRingPos + 1) % delayRingLen;
  }

  const pScale = dt / 1000;
  for (let i = 0; i < n; i++) {
    const r = drive[i];
    if (r <= 0) continue;
    // Soft-cap Poisson + rate-scaled current: mid/high sensory Hz transmit cleaner.
    const p = Math.min(0.90, r * pScale);
    if (rngs() < p) I[i] += stimAmp * (0.62 + 0.55 * Math.min(1, r / 100));
  }

  spikes.fill(0);
  let nSpikes = 0;
  for (let i = 0; i < n; i++) {
    if (refrac[i] > 0) {
      refrac[i] -= dt;
      continue;
    }
    // Conductance-like gain from slow neuromod; OA also mild facilitation.
    const g = (1 + 0.55 * mDA[i] + (0.65 + facOA) * mOA[i] - 0.42 * m5[i]) * gAro;
    // Adaptive threshold: serotonin raises, OA lowers; denser drive → slightly stronger adapt.
    const thr = thr0 + 0.32 * m5[i] - 0.20 * mOA[i] + 0.12 * adapt[i];
    // Silenced cells cannot spike (ablation-like).
    if (gainOut && gainOut[i] <= 0) {
      V[i] = rest;
      continue;
    }
    V[i] += leak * (rest - V[i]) + g * I[i] - adapt[i];
    if (V[i] >= thr) {
      V[i] = reset;
      refrac[i] = ref0;
      adapt[i] += 0.145;
      spikes[i] = 1;
      nSpikes++;
    }
  }
  t += dt;
  return nSpikes;
}

function collectSpikes(maxOut) {
  const out = [];
  for (let i = 0; i < n && out.length < maxOut; i++) {
    if (spikes[i]) out.push(i);
  }
  return out;
}

function groupRates(windowSpikes, nGroups) {
  const counts = new Float32Array(nGroups);
  const nInG = new Float32Array(nGroups);
  for (let i = 0; i < n; i++) {
    const g = group[i] === 255 ? nGroups - 1 : group[i];
    nInG[g]++;
  }
  for (let s = 0; s < windowSpikes.length; s++) {
    const idx = windowSpikes[s];
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const g = group[i] === 255 ? nGroups - 1 : group[i];
      counts[g]++;
    }
  }
  const steps = Math.max(1, windowSpikes.length);
  const sec = (steps * params.dt) / 1000;
  const hz = new Float32Array(nGroups);
  for (let g = 0; g < nGroups; g++) {
    hz[g] = nInG[g] > 0 ? counts[g] / (nInG[g] * sec) : 0;
  }
  return hz;
}

const recent = [];
const NGROUPS = 14;

onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "init") {
    init(m.neurons, m.connectome);
    postMessage({ type: "ready", n, nnz: indices.length });
    return;
  }
  if (m.type === "params") {
    Object.assign(params, m.params);
    if (params.tauSyn && !m.params.tauSynFast) params.tauSynFast = params.tauSyn;
    synDecayFast = Math.exp(-params.dt / params.tauSynFast);
    synDecayInhib = Math.exp(-params.dt / (params.tauSynInhib || 7));
    adaptDecay = Math.exp(-params.dt / params.tauAdapt);
    modDecay = Math.exp(-params.dt / params.tauMod);
    stdDecay = Math.exp(-params.dt / (params.tauStd || 220));
    rebuildSign();
    if (m.stepsPerFrame) stepsPerFrame = m.stepsPerFrame;
    return;
  }
  if (m.type === "mod") {
    sleepBias = m.sleep != null ? m.sleep * 0.22 : sleepBias;
    arousalGain = m.arousal != null ? 0.82 + 0.45 * m.arousal : arousalGain;
    return;
  }
  if (m.type === "stim") {
    setStim(m.ids, m.rate || 0);
    return;
  }
  if (m.type === "bind") {
    for (const name in m.channels) {
      channels[name] = Uint32Array.from(m.channels[name] || []);
    }
    applyDrive();
    return;
  }
  if (m.type === "bindEffectors") {
    bindEffectors(m.pools || {});
    return;
  }
  if (m.type === "rates") {
    Object.assign(channelRate, m.rates);
    applyDrive();
    return;
  }
  if (m.type === "lesion") {
    if (!m.xyz && self._xyz) m.xyz = self._xyz;
    applyLesionMessage(m);
    return;
  }
  if (m.type === "clearLesion") {
    clearLesion();
    postMessage({ type: "lesionApplied", meta: lesionMeta, hungerMod });
    return;
  }
  if (m.type === "enableFastW") {
    const info = enableFastW(m);
    postMessage({ type: "fastWReady", ...info, eta: fastWEta, decay: fastWDecay });
    return;
  }
  if (m.type === "fastW") {
    if (m.plastic != null) fastWPlastic = !!m.plastic;
    if (m.eta != null) fastWEta = Number(m.eta);
    if (m.decay != null) fastWDecay = Number(m.decay);
    if (m.clear && fastW) fastW.fill(0);
    return;
  }
  if (m.type === "reset") {
    V.fill(0); I.fill(0); refrac.fill(0); spikes.fill(0); t = 0;
    if (adapt) { adapt.fill(0); mDA.fill(0); mOA.fill(0); m5.fill(0); }
    if (uFac) uFac.fill(0);
    if (xStd) xStd.fill(1);
    if (tLastStd) tLastStd.fill(-1e6);
    sleepBias = 0; arousalGain = 1;
    recent.length = 0;
    if (delayRing) for (let i = 0; i < delayRing.length; i++) delayRing[i] = [];
    if (m.clearLesion) clearLesion();
    return;
  }
  if (m.type === "run") running = !!m.on;
  if (m.type === "tick" || (m.type === "run" && running)) {
    // fall through to a frame if tick
  }
};

function frame() {
  if (!n) {
    setTimeout(frame, 50);
    return;
  }
  if (running) {
    let nSpikes = 0;
    let last = [];
    for (let s = 0; s < stepsPerFrame; s++) {
      nSpikes += step();
      tallyEffectors();
      last = collectSpikes(8000);
      recent.push(last);
      if (recent.length > 20) recent.shift();
    }
    const rates = groupRates(recent, NGROUPS);
    const eff = effectorFractions(stepsPerFrame);
    const effHz = eff._hz || {};
    delete eff._hz;
    const spikeArr = new Uint32Array(last);
    postMessage(
      {
        type: "frame", t, nSpikes, spikes: spikeArr, rates, eff, effHz,
        hungerMod, lesion: lesionMeta, syn: synStats(),
      },
      [spikeArr.buffer]
    );
  }
  setTimeout(frame, running ? 16 : 80);
}

frame();
