/**
 * Headless male-CNS LIF (subset of web/sim.worker.js) for lesion sweeps.
 * Sensory in → connectome → MN/effector rates out. No Three.js / joints.
 */
import fs from "fs";
import path from "path";

export function loadBins(dataDir) {
  const neu = fs.readFileSync(path.join(dataDir, "neurons.bin"));
  const csr = fs.readFileSync(path.join(dataDir, "connectome.bin"));
  const effectors = JSON.parse(fs.readFileSync(path.join(dataDir, "effectors.json"), "utf8"));
  const stim = JSON.parse(fs.readFileSync(path.join(dataDir, "stim.json"), "utf8"));
  return { neu: neu.buffer.slice(neu.byteOffset, neu.byteOffset + neu.byteLength),
           csr: csr.buffer.slice(csr.byteOffset, csr.byteOffset + csr.byteLength),
           effectors, stim };
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

export class LifEngine {
  constructor(neuBuf, csrBuf) {
    const nv = new DataView(neuBuf);
    if (String.fromCharCode(nv.getUint8(0), nv.getUint8(1), nv.getUint8(2), nv.getUint8(3)) !== "MCNS") {
      throw new Error("bad neurons.bin");
    }
    this.n = nv.getUint32(8, true);
    const xyzBytes = this.n * 3 * 4;
    this.xyz = new Float32Array(neuBuf, 12, this.n * 3);
    this.group = new Uint8Array(neuBuf, 12 + xyzBytes, this.n);
    this.nt = new Uint8Array(neuBuf, 12 + xyzBytes + this.n, this.n);

    const cv = new DataView(csrBuf);
    if (String.fromCharCode(cv.getUint8(0), cv.getUint8(1), cv.getUint8(2), cv.getUint8(3)) !== "MCSR") {
      throw new Error("bad connectome.bin");
    }
    const n2 = cv.getUint32(4, true);
    const nnz = cv.getUint32(8, true);
    if (n2 !== this.n) throw new Error("size mismatch");
    const offIp = 12;
    this.indptr = new Uint32Array(csrBuf, offIp, this.n + 1);
    const offIdx = offIp + (this.n + 1) * 4;
    this.indices = new Uint32Array(csrBuf, offIdx, nnz);
    const offW = offIdx + nnz * 4;
    this.weight = new Uint16Array(csrBuf, offW, nnz);

    const n = this.n;
    this.V = new Float32Array(n);
    this.I = new Float32Array(n);
    this.refrac = new Float32Array(n);
    this.spikes = new Uint8Array(n);
    this.drive = new Float32Array(n);
    this.adapt = new Float32Array(n);
    this.mDA = new Float32Array(n);
    this.mOA = new Float32Array(n);
    this.m5 = new Float32Array(n);
    this.uStd = new Float32Array(n);
    this.uStd.fill(1);
    this.gainOut = new Float32Array(n); this.gainOut.fill(1);
    this.edgeScale = new Float32Array(nnz); this.edgeScale.fill(1);
    this.delaySteps = new Int16Array(n);
    this.swapLR = new Int32Array(n); this.swapLR.fill(-1);
    this.hungerMod = 1;
    this.params = {
      dt: 0.5, tau: 20, tauSynFast: 4.5, tauSynInhib: 7, tauAdapt: 90, tauMod: 1400,
      tauStd: 220, vRest: 0, vReset: 0, vThresh: 1, refractory: 2,
      wScale: 0.012, inhibGain: 2.15, stimAmp: 0.11, stdUse: 0.12, facOA: 0.08,
    };
    this.sign = new Float32Array(n);
    this._rebuildSign();
    this.rngs = mulberry32(0xC0FFEE);
    this.channels = {};
    this.channelRate = {};
    this.effectorIds = {};
    this.effectorHits = {};
    this.t = 0;
    this.DELAY = 64;
    this.delayRing = Array.from({ length: this.DELAY }, () => []);
    this.delayPos = 0;
  }

  _rebuildSign() {
    const g = this.params.inhibGain;
    for (let i = 0; i < this.n; i++) {
      const k = this.nt[i];
      if (k === 5 || k === 6 || k === 7) this.sign[i] = 0;
      else this.sign[i] = (k === 2 || k === 3 || k === 4) ? -g : 1;
    }
  }

  bindEffectors(pools) {
    for (const name in pools) {
      this.effectorIds[name] = Uint32Array.from(pools[name] || []);
      this.effectorHits[name] = 0;
    }
  }

  bindChannels(channels) {
    for (const name in channels) {
      this.channels[name] = Uint32Array.from(channels[name] || []);
    }
  }

  setRates(rates) {
    Object.assign(this.channelRate, rates);
    this.drive.fill(0);
    for (const name in this.channels) {
      const ids = this.channels[name];
      const r = this.channelRate[name] || 0;
      if (r <= 0 || !ids) continue;
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        if (i < this.n && r > this.drive[i]) this.drive[i] = r;
      }
    }
  }

  clearLesion() {
    this.gainOut.fill(1);
    this.edgeScale.fill(1);
    this.delaySteps.fill(0);
    this.swapLR.fill(-1);
    this.hungerMod = 1;
    for (let i = 0; i < this.DELAY; i++) this.delayRing[i] = [];
  }

  applyLesion(ops) {
    this.clearLesion();
    const xyz = this.xyz;
    const n = this.n;
    for (const op of ops || []) {
      if (op.op === "silence") {
        for (const i of op.ids || []) if (i < n) this.gainOut[i] = 0;
      } else if (op.op === "boost") {
        const g = op.gain ?? 2;
        for (const i of op.ids || []) if (i < n) this.gainOut[i] = g;
      } else if (op.op === "cut") {
        const fromSet = new Uint8Array(n);
        const toSet = new Uint8Array(n);
        for (const i of op.fromIds || []) if (i < n) fromSet[i] = 1;
        for (const i of op.toIds || []) if (i < n) toSet[i] = 1;
        for (let i = 0; i < n; i++) {
          if (!fromSet[i]) continue;
          for (let k = this.indptr[i]; k < this.indptr[i + 1]; k++) {
            if (toSet[this.indices[k]]) this.edgeScale[k] = 0;
          }
        }
      } else if (op.op === "swapLR") {
        const ids = Array.from(op.ids || []);
        const unused = new Set(ids);
        for (const i of ids) {
          if (!unused.has(i)) continue;
          const xi = xyz[i * 3];
          let best = -1, bestD = 1e9;
          for (const j of unused) {
            if (j === i) continue;
            if (xi * xyz[j * 3] >= 0) continue;
            const d = Math.abs(Math.abs(xi) - Math.abs(xyz[j * 3]))
              + Math.abs(xyz[i * 3 + 1] - xyz[j * 3 + 1])
              + Math.abs(xyz[i * 3 + 2] - xyz[j * 3 + 2]);
            if (d < bestD) { bestD = d; best = j; }
          }
          if (best >= 0) {
            this.swapLR[i] = best; this.swapLR[best] = i;
            unused.delete(i); unused.delete(best);
          }
        }
      } else if (op.op === "delay") {
        const steps = Math.max(1, Math.round((op.ms ?? 40) / this.params.dt));
        for (const i of op.ids || []) if (i < n) this.delaySteps[i] = steps;
      } else if (op.op === "hunger") {
        this.hungerMod = op.level ?? 1;
      }
    }
  }

  reset() {
    this.V.fill(0); this.I.fill(0); this.refrac.fill(0); this.spikes.fill(0);
    this.adapt.fill(0); this.mDA.fill(0); this.mOA.fill(0); this.m5.fill(0);
    this.uStd.fill(1); this.t = 0;
    for (let i = 0; i < this.DELAY; i++) this.delayRing[i] = [];
  }

  step() {
    const p = this.params, n = this.n, dt = p.dt;
    const leak = dt / p.tau;
    const synDecay = 0.72 * Math.exp(-dt / p.tauSynFast) + 0.28 * Math.exp(-dt / p.tauSynInhib);
    const adaptDecay = Math.exp(-dt / p.tauAdapt);
    const modDecay = Math.exp(-dt / p.tauMod);
    const stdDecay = Math.exp(-dt / p.tauStd);
    for (let i = 0; i < n; i++) {
      this.I[i] *= synDecay;
      this.adapt[i] *= adaptDecay;
      this.mDA[i] *= modDecay; this.mOA[i] *= modDecay; this.m5[i] *= modDecay;
      this.uStd[i] += (1 - this.uStd[i]) * (1 - stdDecay);
    }
    for (let i = 0; i < n; i++) {
      if (!this.spikes[i]) continue;
      const knt = this.nt[i];
      let u = this.uStd[i];
      this.uStd[i] = Math.max(0.05, u * (1 - p.stdUse));
      const gOut = this.gainOut[i];
      if (gOut <= 0) continue;
      const src = this.swapLR[i] >= 0 ? this.swapLR[i] : i;
      const a = this.indptr[src], b = this.indptr[src + 1];
      const dly = this.delaySteps[i];
      if (knt === 5) {
        const h = 0.55 + 0.9 * this.hungerMod;
        for (let k = a; k < b; k++) {
          if (this.edgeScale[k] <= 0) continue;
          const j = this.indices[k];
          const v = this.mDA[j] + 0.012 * Math.sqrt(this.weight[k]) * u * gOut * this.edgeScale[k] * h;
          this.mDA[j] = v > 1.5 ? 1.5 : v;
        }
      } else if (knt === 6) {
        for (let k = a; k < b; k++) {
          if (this.edgeScale[k] <= 0) continue;
          const j = this.indices[k];
          const v = this.m5[j] + 0.010 * Math.sqrt(this.weight[k]) * u * gOut * this.edgeScale[k];
          this.m5[j] = v > 1.5 ? 1.5 : v;
        }
      } else if (knt === 7) {
        const h = 0.65 + 0.7 * this.hungerMod;
        for (let k = a; k < b; k++) {
          if (this.edgeScale[k] <= 0) continue;
          const j = this.indices[k];
          const v = this.mOA[j] + 0.014 * Math.sqrt(this.weight[k]) * u * gOut * this.edgeScale[k] * h;
          this.mOA[j] = v > 1.5 ? 1.5 : v;
        }
      } else if (dly > 0) {
        const slot = (this.delayPos + dly) % this.DELAY;
        this.delayRing[slot].push({ s: this.sign[i] * p.wScale * u * gOut, a, b });
      } else {
        const s = this.sign[i] * p.wScale * u * gOut;
        for (let k = a; k < b; k++) {
          if (this.edgeScale[k] <= 0) continue;
          this.I[this.indices[k]] += s * Math.sqrt(this.weight[k]) * this.edgeScale[k];
        }
      }
    }
    const due = this.delayRing[this.delayPos];
    for (const { s, a, b } of due) {
      for (let k = a; k < b; k++) {
        if (this.edgeScale[k] <= 0) continue;
        this.I[this.indices[k]] += s * Math.sqrt(this.weight[k]) * this.edgeScale[k];
      }
    }
    this.delayRing[this.delayPos] = [];
    this.delayPos = (this.delayPos + 1) % this.DELAY;

    const pScale = dt / 1000;
    for (let i = 0; i < n; i++) {
      const r = this.drive[i];
      if (r <= 0) continue;
      if (this.rngs() < Math.min(0.9, r * pScale)) {
        this.I[i] += p.stimAmp * (0.62 + 0.55 * Math.min(1, r / 100));
      }
    }
    this.spikes.fill(0);
    for (let i = 0; i < n; i++) {
      if (this.refrac[i] > 0) { this.refrac[i] -= dt; continue; }
      if (this.gainOut[i] <= 0) { this.V[i] = p.vRest; continue; }
      const g = (1 + 0.55 * this.mDA[i] + (0.65 + p.facOA) * this.mOA[i] - 0.42 * this.m5[i]);
      const thr = p.vThresh + 0.32 * this.m5[i] - 0.20 * this.mOA[i] + 0.12 * this.adapt[i];
      this.V[i] += leak * (p.vRest - this.V[i]) + g * this.I[i] - this.adapt[i];
      if (this.V[i] >= thr) {
        this.V[i] = p.vReset;
        this.refrac[i] = p.refractory;
        this.adapt[i] += 0.145;
        this.spikes[i] = 1;
      }
    }
    for (const name in this.effectorIds) {
      const ids = this.effectorIds[name];
      let h = 0;
      for (let k = 0; k < ids.length; k++) if (this.spikes[ids[k]]) h++;
      this.effectorHits[name] += h;
    }
    this.t += dt;
  }

  effectorHz(steps) {
    const out = {};
    const sec = (steps * this.params.dt) / 1000;
    for (const name in this.effectorIds) {
      const sz = this.effectorIds[name].length;
      const hits = this.effectorHits[name] || 0;
      out[name] = sz > 0 && sec > 0 ? hits / (sz * sec) : 0;
      this.effectorHits[name] = 0;
    }
    return out;
  }
}

export function resolvePools(poolMap, names) {
  const ids = new Set();
  for (const name of names || []) {
    for (const i of poolMap[name] || []) ids.add(i >>> 0);
  }
  return Array.from(ids);
}

export function mergePools(effectors, stim) {
  const pools = {};
  for (const map of [effectors.pools || {}, stim || {}]) {
    for (const [k, v] of Object.entries(map)) {
      if (Array.isArray(v) && v.length && !pools[k]) pools[k] = v;
    }
  }
  return pools;
}

export function expandLesionOps(cfg, poolMap) {
  const ops = [];
  for (const op of cfg.ops || []) {
    if (op.op === "silence" || op.op === "boost" || op.op === "swapLR" || op.op === "delay") {
      ops.push({ ...op, ids: resolvePools(poolMap, op.pools) });
    } else if (op.op === "cut") {
      ops.push({
        ...op,
        fromIds: resolvePools(poolMap, op.from),
        toIds: resolvePools(poolMap, op.to),
      });
    } else ops.push({ ...op });
  }
  return ops;
}
