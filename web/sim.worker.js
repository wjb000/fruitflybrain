/* LIF engine for the Male CNS connectome. Runs in a Web Worker. */

let n = 0;
let indptr, indices, weight, group, nt;
let V, I, refrac, spikes, drive, sign;
let adapt, mDA, mOA, m5;
let uStd; // per-neuron short-term synaptic resource (depression/facilitation)
let rngs;
let params = {
  dt: 0.5,
  tau: 20,
  tauSynFast: 4.5,   // ACh / fast EPSP
  tauSynInhib: 7.0,  // GABA / GluCl / histamine
  tauAdapt: 90,
  tauMod: 1400,      // slow neuromod (DA/OA/5HT)
  tauStd: 220,       // STD recovery (ms)
  vRest: 0,
  vReset: 0,
  vThresh: 1,
  refractory: 2,
  // Sqrt-compressed synapse weights (see step): mid edges matter more vs hubs.
  // Retuned so mean drive is slightly stronger than prior linear regime.
  wScale: 0.044,
  inhibGain: 2.15,
  stimAmp: 0.155,
  // Milder STD use → more reliable transmission while depression still present.
  stdUse: 0.14,
  // Mild facilitation for OA-ergic (arousal) — applied via mOA gain, not uStd.
  facOA: 0.08,
};
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
  uStd = new Float32Array(n);
  uStd.fill(1);
  rngs = mulberry32(0xC0FFEE);
  rebuildSign();
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
  for (const name in effectorIds) {
    const ids = effectorIds[name];
    let h = 0;
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k];
      if (i < n && spikes[i]) h++;
    }
    effectorHits[name] += h;
  }
}

/** Decode effector pools as mean spike rate (Hz) over the frame window,
 *  then map to a 0–1 `eff` the UI expects. Raw hits/(sz*steps) is ~0.01 and
 *  leaves muscles limp; 0–40 Hz → 0–1 (with soft exp) keeps sparse MN pools useful.
 */
function effectorFractions(steps) {
  const out = {};
  const hzOut = {};
  const s = Math.max(1, steps);
  const sec = (s * params.dt) / 1000;
  const HZ_SCALE = 40; // ~40 Hz mean → full drive
  for (const name in effectorIds) {
    const sz = effectorSize[name] || 0;
    const hits = effectorHits[name] || 0;
    const hz = sz > 0 && sec > 0 ? hits / (sz * sec) : 0;
    // Soft map: 1 - exp(-hz/18) ≈ linear near 0, ~0.89 at 40 Hz
    const norm = hz <= 0 ? 0 : Math.min(1, 1 - Math.exp(-hz / 18));
    // Also expose linear 0–40 Hz scale as a floor so mid rates stay visible
    const lin = Math.min(1, hz / HZ_SCALE);
    out[name] = Math.max(norm, lin * 0.85);
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
  const stdUse = params.stdUse;
  const facOA = params.facOA;

  // Dual synaptic current decay: fast EPSP vs slower inhibition, plus STD recover.
  // I holds net current; we decay with a blend favoring fast (majority ACh edges).
  // Lightweight: single I buffer, decay = weighted average of fast/inhib.
  const synDecay = 0.72 * synDecayFast + 0.28 * synDecayInhib;
  for (let i = 0; i < n; i++) {
    I[i] *= synDecay;
    adapt[i] *= adaptDecay;
    mDA[i] *= modDecay;
    mOA[i] *= modDecay;
    m5[i] *= modDecay;
    // Recover release probability toward 1
    uStd[i] += (1 - uStd[i]) * (1 - stdDecay);
  }

  for (let i = 0; i < n; i++) {
    if (!spikes[i]) continue;
    const knt = nt[i];
    const a = indptr[i], b = indptr[i + 1];
    const u = uStd[i];
    // Consume resources on spike (depression); OA gets mild facilitation bias via mOA.
    uStd[i] = Math.max(0.05, u * (1 - stdUse));
    if (knt === 5) {
      // Dopamine: slow gain / threshold modulate — stronger deposit than before.
      for (let k = a; k < b; k++) {
        const j = indices[k];
        const v = mDA[j] + 0.012 * Math.sqrt(weight[k]) * u;
        mDA[j] = v > 1.5 ? 1.5 : v;
      }
    } else if (knt === 6) {
      for (let k = a; k < b; k++) {
        const j = indices[k];
        const v = m5[j] + 0.010 * Math.sqrt(weight[k]) * u;
        m5[j] = v > 1.5 ? 1.5 : v;
      }
    } else if (knt === 7) {
      for (let k = a; k < b; k++) {
        const j = indices[k];
        const v = mOA[j] + 0.014 * Math.sqrt(weight[k]) * u;
        mOA[j] = v > 1.5 ? 1.5 : v;
      }
    } else {
      // Fast chemical: sqrt-compress huge synapse counts so mid-weight edges
      // stay expressive; STD resource u still gates reliability.
      const s = sign[i] * wScale * u;
      for (let k = a; k < b; k++) {
        const w = weight[k];
        I[indices[k]] += s * Math.sqrt(w);
      }
    }
  }

  const pScale = dt / 1000;
  for (let i = 0; i < n; i++) {
    const r = drive[i];
    if (r > 0 && rngs() < r * pScale) I[i] += stimAmp;
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
  if (m.type === "reset") {
    V.fill(0); I.fill(0); refrac.fill(0); spikes.fill(0); t = 0;
    if (adapt) { adapt.fill(0); mDA.fill(0); mOA.fill(0); m5.fill(0); }
    if (uStd) uStd.fill(1);
    sleepBias = 0; arousalGain = 1;
    recent.length = 0;
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
      { type: "frame", t, nSpikes, spikes: spikeArr, rates, eff, effHz },
      [spikeArr.buffer]
    );
  }
  setTimeout(frame, running ? 16 : 80);
}

frame();
