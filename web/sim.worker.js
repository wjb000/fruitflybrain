/* LIF engine for the Male CNS connectome. Runs in a Web Worker. */

let n = 0;
let indptr, indices, weight, group, nt;
let V, I, refrac, spikes, drive, sign;
let adapt, mDA, mOA, m5;
let rngs;
let params = {
  dt: 0.5,
  tau: 20,
  tauSyn: 5,
  tauAdapt: 80,
  tauMod: 1600,
  vRest: 0,
  vReset: 0,
  vThresh: 1,
  refractory: 2,
  wScale: 0.0095,
  inhibGain: 2.4,
  stimAmp: 0.13,
};
let t = 0;
let synDecay = Math.exp(-params.dt / params.tauSyn);
let adaptDecay = Math.exp(-params.dt / params.tauAdapt);
let modDecay = Math.exp(-params.dt / params.tauMod);
let sleepBias = 0;
let arousalGain = 1;
let running = false;
let stepsPerFrame = 8;

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
  rngs = mulberry32(0xC0FFEE);
  rebuildSign();
  synDecay = Math.exp(-params.dt / params.tauSyn);
  adaptDecay = Math.exp(-params.dt / params.tauAdapt);
  modDecay = Math.exp(-params.dt / params.tauMod);
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

function effectorFractions(steps) {
  const out = {};
  const s = Math.max(1, steps);
  for (const name in effectorIds) {
    const sz = effectorSize[name] || 0;
    out[name] = sz > 0 ? effectorHits[name] / (sz * s) : 0;
    effectorHits[name] = 0;
  }
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

  for (let i = 0; i < n; i++) {
    I[i] *= synDecay;
    adapt[i] *= adaptDecay;
    mDA[i] *= modDecay;
    mOA[i] *= modDecay;
    m5[i] *= modDecay;
  }

  for (let i = 0; i < n; i++) {
    if (!spikes[i]) continue;
    const knt = nt[i];
    const a = indptr[i], b = indptr[i + 1];
    if (knt === 5) {
      for (let k = a; k < b; k++) {
        const j = indices[k];
        const v = mDA[j] + 0.0022 * weight[k];
        mDA[j] = v > 1.4 ? 1.4 : v;
      }
    } else if (knt === 6) {
      for (let k = a; k < b; k++) {
        const j = indices[k];
        const v = m5[j] + 0.0020 * weight[k];
        m5[j] = v > 1.4 ? 1.4 : v;
      }
    } else if (knt === 7) {
      for (let k = a; k < b; k++) {
        const j = indices[k];
        const v = mOA[j] + 0.0028 * weight[k];
        mOA[j] = v > 1.4 ? 1.4 : v;
      }
    } else {
      const s = sign[i] * wScale;
      for (let k = a; k < b; k++) I[indices[k]] += s * weight[k];
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
    const g = (1 + 0.5 * mDA[i] + 0.6 * mOA[i] - 0.4 * m5[i]) * gAro;
    const thr = thr0 + 0.28 * m5[i] - 0.18 * mOA[i];
    V[i] += leak * (rest - V[i]) + g * I[i] - adapt[i];
    if (V[i] >= thr) {
      V[i] = reset;
      refrac[i] = ref0;
      adapt[i] += 0.13;
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
    synDecay = Math.exp(-params.dt / params.tauSyn);
    adaptDecay = Math.exp(-params.dt / params.tauAdapt);
    modDecay = Math.exp(-params.dt / params.tauMod);
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
    const spikeArr = new Uint32Array(last);
    postMessage(
      { type: "frame", t, nSpikes, spikes: spikeArr, rates, eff },
      [spikeArr.buffer]
    );
  }
  setTimeout(frame, running ? 16 : 80);
}

frame();
