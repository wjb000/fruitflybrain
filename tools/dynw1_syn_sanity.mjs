#!/usr/bin/env node
/**
 * dynw1: connectome weights are not unit hits; TM STD fades repeated drive;
 * tonic abdomen/walk (same circuit every frame) go quiet.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const stp = await import(pathToFileURL(path.join(ROOT, "web/stp.js")).href);
  const pose = await import(pathToFileURL(path.join(ROOT, "web/poseMap.js")).href);
  const { chemWeight, ntSign, tmTransmit, recoverU, recoverX, tmSteadyEff, NT_STP, HDELTA_PLASTIC_IDS } = stp;
  const { abdomenFromEma, walkDriveFromEma, ABD_POSE_GATE, IDLE_WALK_GATE } = pose;

  console.log("--- connectome weights are not unit hits ---");
  const w5 = chemWeight(5), w80 = chemWeight(80), w200 = chemWeight(200);
  console.log("chemWeight 5/80/200", w5.toFixed(3), w80.toFixed(3), w200.toFixed(3));
  assert(w80 > w5 * 3.5, "strong edges must outweigh min-weight hits (was sqrt-flat)");
  assert(w200 > w80, "hubs still ordered");
  assert(ntSign(1, 2.15) === 1, "ACh excitatory");
  assert(ntSign(2, 2.15) === -2.15, "GABA inhibitory");
  assert(ntSign(3, 2.15) === -2.15, "GluCl inhibitory");
  assert(ntSign(5, 2.15) === 0, "DA slow, not EPSP");
  assert(HDELTA_PLASTIC_IDS.length === 45, "45 traced hΔ cells");

  console.log("--- TM: repeated ACh spikes depress; pause recovers ---");
  const ach = NT_STP[1];
  let u = 0, x = 1;
  const first = tmTransmit(u, x, ach.U);
  u = first.uOn; x = first.xNext;
  const firstEff = first.eff;
  for (let s = 0; s < 25; s++) {
    u = recoverU(u, 20, ach.tauF);
    x = recoverX(x, 20, ach.tauD);
    const tr = tmTransmit(u, x, ach.U);
    u = tr.uOn; x = tr.xNext;
  }
  const late = tmTransmit(recoverU(u, 20, ach.tauF), recoverX(x, 20, ach.tauD), ach.U);
  const lateEff = late.eff;
  console.log("first/late ACh @50Hz", firstEff.toFixed(3), lateEff.toFixed(3));
  assert(firstEff > 0.35, "first ACh spike uses U≈0.40");
  assert(lateEff < firstEff * 0.45, "repeated ACh must depress (STD underused before)");
  u = recoverU(u, 800, ach.tauF);
  x = recoverX(x, 800, ach.tauD);
  const rec = tmTransmit(u, x, ach.U);
  assert(rec.eff > lateEff * 1.8, "efficacy recovers after a quiet interval");
  const ss = tmSteadyEff(ach.U, ach.tauD, ach.tauF, 20);
  console.log("analytic 50Hz ACh eff", ss.toFixed(3));
  assert(ss < 0.12, "steady 50Hz ACh is strongly depressed");

  console.log("--- OA facilitates across a short burst ---");
  const oa = NT_STP[7];
  u = 0; x = 1;
  const oa1 = tmTransmit(u, x, oa.U);
  u = oa1.uOn; x = oa1.xNext;
  u = recoverU(u, 15, oa.tauF);
  x = recoverX(x, 15, oa.tauD);
  const oa2 = tmTransmit(u, x, oa.U);
  assert(oa2.uOn > oa1.uOn, "OA utilization builds (facilitation)");

  console.log("--- tonic abdomen / walk fade (same circuit every frame) ---");
  const qAbd = abdomenFromEma({ abdomen: 0.18, abdomen12: 0.16 }, 0);
  assert(qAbd.curl === 0, "idle abdomen still (dead-zone)");
  const burst = abdomenFromEma({ abdomen: 0.72, abdomen12: 0.55, abdomen3: 0.60 }, 0);
  assert(burst.curl > ABD_POSE_GATE * 0.4, "phasic abdomen may curl");
  const st = { abdTonic: 0, walkTonic: 0 };
  let lastCurl = 1;
  for (let i = 0; i < 90; i++) {
    lastCurl = abdomenFromEma({ abdomen: 0.55, abdomen12: 0.50, abdomen3: 0.48 }, 0, st, 0.032).curl;
  }
  console.log("tonic abdomen after 90 frames", lastCurl);
  assert(lastCurl === 0, "constant abdomen pool must not keep lifting the butt");

  const walk0 = walkDriveFromEma({ T2L: 0.45, T2R: 0.44, T3L: 0.40, T3R: 0.39, DNa: 0.30, T1L: 0.1, T1R: 0.1 });
  assert(walk0 >= IDLE_WALK_GATE, "changing T2/T3 without state still walks");
  const wst = { walkTonic: 0 };
  let lastWalk = 1;
  for (let i = 0; i < 120; i++) {
    lastWalk = walkDriveFromEma(
      { T2L: 0.45, T2R: 0.44, T3L: 0.40, T3R: 0.39, DNa: 0.30 },
      wst, 0.032
    );
  }
  console.log("tonic T2/T3 walk after 120 frames", lastWalk);
  assert(lastWalk === 0, "saturated T2/T3 must not be a constant slip push");
  const pulse = walkDriveFromEma(
    { T2L: 0.70, T2R: 0.68, T3L: 0.62, T3R: 0.60, DNa: 0.50 },
    wst, 0.032
  );
  assert(pulse > lastWalk, "a new T2/T3 burst can walk again");

  const bins = path.join(ROOT, "web/data/neurons.bin");
  const csr = path.join(ROOT, "web/data/connectome.bin");
  if (fs.existsSync(bins) && fs.existsSync(csr)) {
    console.log("--- live LIF: efficacy drops under repeated sensory drive ---");
    const { LifEngine, loadBins } = await import(pathToFileURL(path.join(ROOT, "tools/lib/lif_engine.mjs")).href);
    const data = loadBins(path.join(ROOT, "web/data"));
    const eng = new LifEngine(data.neu, data.csr);
    const ach = [];
    for (let i = 0; i < eng.n && ach.length < 120; i++) {
      if (eng.nt[i] === 1 && (eng.indptr[i + 1] - eng.indptr[i]) >= 20) ach.push(i);
    }
    assert(ach.length >= 40, "ACh cells with outgoing edges");
    eng.bindChannels({ ach });
    eng.setRates({ ach: 180 });
    let early = [], mid = [], minX = 1, maxEdges = 0;
    for (let t = 0; t < 120; t++) {
      eng.step();
      const s = eng.synStats();
      if (s.nEdges > 200) {
        if (t < 22) early.push(s.meanEff);
        if (t > 28 && t < 70) mid.push(s.meanEff);
        if (s.meanX < minX) minX = s.meanX;
        if (s.nEdges > maxEdges) maxEdges = s.nEdges;
      }
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const firstMean = early.length ? avg(early) : null;
    const lateMean = mid.length ? avg(mid) : null;
    const syn = eng.synStats();
    console.log("LIF ACh meanEff early/mid", firstMean, lateMean, "minX", minX, "maxEdges", maxEdges);
    assert(firstMean != null && lateMean != null, "synapses transmitted");
    assert(lateMean < firstMean * 0.85 || minX < 0.70, "network STD must fade repeated ACh drive");
    assert(minX < 0.85, "per-edge resources x depress");
  } else {
    console.log("(skip live LIF — bins missing)");
  }

  console.log("dynw1 synaptic sanity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
