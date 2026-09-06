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
  // Calm regime: enough network drive for MN readout, not seizure/spastic.
  wScale: 0.012,
  inhibGain: 2.15,
  stimAmp: 0.11,
  // Keep STD; quiet resting tone without silencing the network.
  stdUse: 0.12,
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
  uStd = new Float32Array(n);
  uStd.fill(1);
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
 *  leaves muscles limp; ~40 Hz → 0–1 (with soft exp) keeps sparse MN pools useful
 *  without saturating every effector every frame.
 */
function effectorFractions(steps) {
  const out = {};
  const hzOut = {};
  const s = Math.max(1, steps);
  const sec = (s * params.dt) / 1000;
  const HZ_SCALE = 40; // ~40 Hz mean → full drive (less saturated effectors)
  for (const name in effectorIds) {
    const sz = effectorSize[name] || 0;
    const hits = effectorHits[name] || 0;
    const hz = sz > 0 && sec > 0 ? hits / (sz * sec) : 0;
    // Soft map: 1 - exp(-hz/18) ≈ linear near 0, saturates ~50–60 Hz
    const norm = hz <= 0 ? 0 : Math.min(1, 1 - Math.exp(-hz / 18));
    // Linear 0–HZ_SCALE floor so mid rates stay visible without pegging
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
    const gOut = gainOut ? gainOut[i] : 1;
    if (gOut <= 0) continue; // silenced — no outgoing transmission
    const src = (swapLR && swapLR[i] >= 0) ? swapLR[i] : i;
    const a2 = indptr[src], b2 = indptr[src + 1];
    const dly = delaySteps ? delaySteps[i] : 0;
    if (knt === 5) {
      // Dopamine: slow gain / threshold modulate — hunger dial scales deposit.
      const h = 0.55 + 0.9 * hungerMod;
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        const j = indices[k];
        const v = mDA[j] + 0.012 * Math.sqrt(weight[k]) * u * gOut * esc * h;
        mDA[j] = v > 1.5 ? 1.5 : v;
      }
    } else if (knt === 6) {
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        const j = indices[k];
        const v = m5[j] + 0.010 * Math.sqrt(weight[k]) * u * gOut * esc;
        m5[j] = v > 1.5 ? 1.5 : v;
      }
    } else if (knt === 7) {
      const h = 0.65 + 0.7 * hungerMod;
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        const j = indices[k];
        const v = mOA[j] + 0.014 * Math.sqrt(weight[k]) * u * gOut * esc * h;
        mOA[j] = v > 1.5 ? 1.5 : v;
      }
    } else if (dly > 0) {
      // Queue fast chemical delivery for later steps (synaptic delay lesion).
      const slot = (delayRingPos + dly) % delayRingLen;
      const s = sign[i] * wScale * u * gOut;
      const payload = { s, a: a2, b: b2 };
      delayRing[slot].push(payload);
    } else {
      // Fast chemical: sqrt-compress; STD + lesion scales.
      const s = sign[i] * wScale * u * gOut;
      for (let k = a2; k < b2; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        I[indices[k]] += s * Math.sqrt(weight[k]) * esc;
      }
    }
  }

  // Deliver delayed synaptic events due this step.
  if (delayRing) {
    const due = delayRing[delayRingPos];
    for (let p = 0; p < due.length; p++) {
      const { s, a: aa, b: bb } = due[p];
      for (let k = aa; k < bb; k++) {
        const esc = edgeScale ? edgeScale[k] : 1;
        if (esc <= 0) continue;
        I[indices[k]] += s * Math.sqrt(weight[k]) * esc;
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
  if (m.type === "reset") {
    V.fill(0); I.fill(0); refrac.fill(0); spikes.fill(0); t = 0;
    if (adapt) { adapt.fill(0); mDA.fill(0); mOA.fill(0); m5.fill(0); }
    if (uStd) uStd.fill(1);
    sleepBias = 0; arousalGain = 1;
    recent.length = 0;
    if (delayRing) for (let i = 0; i < delayRing.length; i++) delayRing[i] = [];
    // Lesions persist across reset unless m.clearLesion
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
      { type: "frame", t, nSpikes, spikes: spikeArr, rates, eff, effHz, hungerMod, lesion: lesionMeta },
      [spikeArr.buffer]
    );
  }
  setTimeout(frame, running ? 16 : 80);
}

frame();
