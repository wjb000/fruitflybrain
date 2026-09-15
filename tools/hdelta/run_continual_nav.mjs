#!/usr/bin/env node
/**
 * hΔ fast-weight continual navigation (headless).
 *
 * Context A: odor A, goal = left landmark.
 * Context B: odor B, goal = right landmark.
 * Plastic: online fast weights on hDeltaH/A/I/G outgoing edges through both contexts.
 * Frozen: learn A, then clamp those Δw — expected to fail B (still prefers A).
 *
 * Does not reopen CVA-SST Exp0/Exp1 or M1–M3.
 *
 *   node tools/hdelta/run_continual_nav.mjs
 *   node tools/hdelta/run_continual_nav.mjs --smoke
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LifEngine, loadBins, mergePools } from "../lib/lif_engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "web", "data");
const OUT = path.join(ROOT, "results", "hdelta");
const PARAMS = JSON.parse(fs.readFileSync(path.join(ROOT, "params/hdelta/v1.json"), "utf8"));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (v == null || v.startsWith("--")) return true;
  return v;
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

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function sd(xs) {
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
}

function loadSeeds(n) {
  const p = path.join(ROOT, "params/hdelta/seeds.txt");
  return fs.readFileSync(p, "utf8").split(/\s+/).filter(Boolean).map(Number).slice(0, n);
}

function loadHdeltaPools() {
  const p = path.join(ROOT, "params/hdelta/pools.json");
  if (!fs.existsSync(p)) {
    throw new Error("missing params/hdelta/pools.json — run python3 tools/hdelta/build_pools.py");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function cueEye(x, z, heading, cue) {
  const dx = cue.x - x, dz = cue.z - z;
  const dist = Math.hypot(dx, dz) + 1e-6;
  const c = Math.cos(heading), s = Math.sin(heading);
  const bearing = Math.atan2(dx * c - dz * s, dx * s + dz * c);
  const on = Math.abs(bearing) < 1.45;
  const loom = Math.max(0, 1.2 - dist / 9);
  return { bearing, dist, on, loom };
}

function headingBump(cells, heading, peakHz, nColDefault = 8) {
  const rates = new Map();
  for (const c of cells) {
    const nCol = nColDefault;
    const col = ((c.column || 1) - 1) % nCol;
    const pref = (col / nCol) * Math.PI * 2;
    let d = heading - pref;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const w = Math.max(0, Math.cos(d));
    rates.set(c.idx, peakHz * w * w);
  }
  return rates;
}

function injectBump(engine, bump) {
  for (const [i, hz] of bump) {
    if (i < engine.n && hz > engine.drive[i]) engine.drive[i] = hz;
  }
}

function setGoalTarget(engine, pfl3L, pfl3R, goal) {
  // goal -1 = left, +1 = right. Strengthen matching PFL3 laterality.
  const tgt = new Float32Array(engine.n);
  const gL = goal < 0 ? 1 : -1;
  const gR = goal > 0 ? 1 : -1;
  for (const j of pfl3L) tgt[j] = gL;
  for (const j of pfl3R) tgt[j] = gR;
  engine.setFastWTarget(tgt);
}

function decodeFastWTurn(engine, pfl3L, pfl3R) {
  if (!engine.fastW) return 0;
  const isL = new Uint8Array(engine.n);
  const isR = new Uint8Array(engine.n);
  for (const j of pfl3L) isL[j] = 1;
  for (const j of pfl3R) isR[j] = 1;
  let L = 0, R = 0, nE = 0;
  for (let p = 0; p < engine.fastWIds.length; p++) {
    const i = engine.fastWIds[p];
    const a = engine.indptr[i], b = engine.indptr[i + 1];
    for (let k = a; k < b; k++) {
      const j = engine.indices[k];
      if (isL[j]) { L += engine.fastW[k]; nE++; }
      else if (isR[j]) { R += engine.fastW[k]; nE++; }
    }
  }
  return nE ? (R - L) / nE : 0;
}

function runPhase(engine, poolMap, hd, opts) {
  const { scene, drive, steering, ticks, steps, context, goal, spawn, plastic, hebbFromDrive } = opts;
  engine.setFastWPlastic(plastic);
  setGoalTarget(engine, hd.PFL3_L, hd.PFL3_R, goal);
  let x = spawn.x, z = spawn.z, heading = spawn.heading;
  const left = scene.left, right = scene.right;
  const goalCue = goal < 0 ? left : right;
  const otherCue = goal < 0 ? right : left;
  const evalLast = opts.evalLast ?? scene.evalLast;
  let orientGoal = 0, orientOther = 0, nearGoal = 0, nearOther = 0, evalN = 0;
  let disp = 0, lx = x, lz = z;
  const fwHist = [];
  const pflHist = [];

  engine.bindChannels({
    vision: poolMap.vision || [],
    smell: poolMap.smell || poolMap.foodORN || [],
    pher: poolMap.pherORN || [],
    touch: poolMap.touch || [],
  });
  engine.bindEffectors({
    T1L: poolMap.T1L || [], T1R: poolMap.T1R || [],
    T2L: poolMap.T2L || [], T2R: poolMap.T2R || [],
    T3L: poolMap.T3L || [], T3R: poolMap.T3R || [],
    PFL3_L: hd.PFL3_L, PFL3_R: hd.PFL3_R,
    hDelta: hd.plastic_ids,
  });

  const hCells = PARAMS.plastic_types.flatMap((t) => hd.cells[t]);
  const epgBumpCells = (hd.EPG_cells || []).map((c) => ({
    idx: c.idx,
    column: c.column || 1,
  }));

  for (let tick = 0; tick < ticks; tick++) {
    const eyeL = cueEye(x, z, heading, left);
    const eyeR = cueEye(x, z, heading, right);
    const vis = drive.vision * (0.40 + 0.60 * Math.max(eyeL.loom, eyeR.loom));
    const smellA = context === "A" ? drive.smellA : 2;
    const smellB = context === "B" ? drive.smellB : 2;
    engine.setRates({
      vision: vis,
      smell: smellA,
      pher: smellB,
      touch: 4,
    });
    injectBump(engine, headingBump(hCells, heading, drive.hDeltaBump, 12));
    injectBump(engine, headingBump(epgBumpCells, heading, drive.headingBump, 8));
    if (hebbFromDrive && plastic) engine.hebbFromDrive(1 / 50);
    for (let s = 0; s < steps; s++) engine.step();
    const hz = engine.effectorHz(steps);
    const legsL = ((hz.T1L || 0) + (hz.T2L || 0) + (hz.T3L || 0)) / 3;
    const legsR = ((hz.T1R || 0) + (hz.T2R || 0) + (hz.T3R || 0)) / 3;
    const mnTurn = Math.tanh((legsR - legsL) / 12);
    const pflTurn = Math.tanh(((hz.PFL3_R || 0) - (hz.PFL3_L || 0)) / 3);
    const fwTurn = decodeFastWTurn(engine, hd.PFL3_L, hd.PFL3_R);
    const turn = steering.kMN * mnTurn + steering.kPFL * pflTurn + steering.kFW * Math.tanh(fwTurn * 4);
    const walk = 0.55 + 0.45 * Math.tanh((legsL + legsR) / 28);
    heading += turn * steering.turnGain * scene.dtBody;
    const step = walk * steering.walkGain * scene.dtBody;
    x += Math.sin(heading) * step;
    z += Math.cos(heading) * step;
    const r = Math.hypot(x, z);
    if (r > scene.arenaR) {
      x *= scene.arenaR / r;
      z *= scene.arenaR / r;
    }
    disp += Math.hypot(x - lx, z - lz);
    lx = x; lz = z;
    fwHist.push(fwTurn);
    pflHist.push(pflTurn);
    if (tick >= ticks - evalLast) {
      evalN++;
      const g = cueEye(x, z, heading, goalCue);
      const o = cueEye(x, z, heading, otherCue);
      if (Math.abs(g.bearing) < scene.orientRad) orientGoal++;
      if (Math.abs(o.bearing) < scene.orientRad) orientOther++;
      if (g.dist < scene.approachR) nearGoal++;
      if (o.dist < scene.approachR) nearOther++;
    }
  }
  const correct = evalN ? 0.6 * (orientGoal / evalN) + 0.4 * (nearGoal / evalN) : 0;
  const wrong = evalN ? 0.6 * (orientOther / evalN) + 0.4 * (nearOther / evalN) : 0;
  return {
    context, goal, plastic,
    correct, wrong, delta: correct - wrong,
    fracOrientGoal: evalN ? orientGoal / evalN : 0,
    fracNearGoal: evalN ? nearGoal / evalN : 0,
    fracOrientOther: evalN ? orientOther / evalN : 0,
    fracNearOther: evalN ? nearOther / evalN : 0,
    displacement: disp,
    finalX: x, finalZ: z, heading,
    fwMean: mean(fwHist.slice(-evalLast)),
    pflMean: mean(pflHist.slice(-evalLast)),
    fastWNorm: engine.fastWNorm(),
    hDeltaHz: 0,
  };
}

function summarize(rows, key) {
  const sub = rows.filter((r) => r.condition === key);
  const cA = sub.map((r) => r.A.correct);
  const cB = sub.map((r) => r.B.correct);
  const wB = sub.map((r) => r.B.wrong);
  return {
    condition: key,
    n: sub.length,
    meanCorrectA: mean(cA), sdCorrectA: sd(cA),
    meanCorrectB: mean(cB), sdCorrectB: sd(cB),
    meanWrongB: mean(wB),
    meanDeltaB: mean(sub.map((r) => r.B.delta)),
    meanFwB: mean(sub.map((r) => r.B.fwMean)),
  };
}

function main() {
  const smoke = !!arg("--smoke", false);
  const n = Number(arg("--n", smoke ? 2 : PARAMS.n_seeds_default));
  const ticks = Number(arg("--ticks", smoke ? 12 : PARAMS.scene.ticks));
  const steps = Number(arg("--steps", smoke ? 2 : PARAMS.scene.stepsPerTick));
  const evalLast = Math.max(4, Math.floor(ticks / 2));
  const seeds = loadSeeds(n);
  const hd = loadHdeltaPools();
  const { neu, csr, effectors, stim } = loadBins(DATA);
  const poolMap = mergePools(effectors, stim);
  const engine = new LifEngine(neu, csr);
  const fwMeta = engine.enableFastW({
    ids: hd.plastic_ids,
    eta: PARAMS.fastW.eta,
    decay: PARAMS.fastW.decay,
    clip: PARAMS.fastW.clip,
    plastic: true,
  });
  console.log(`hΔ fastW continual nav  n=${n} ticks=${ticks} steps=${steps}  plastic cells=${fwMeta.nPre} edges=${fwMeta.nEdges}`);
  console.log(`types ${PARAMS.plastic_types.join("/")}  PFL3 L/R ${hd.PFL3_L.length}/${hd.PFL3_R.length}`);

  const scene = { ...PARAMS.scene, ticks, evalLast };
  const spawn = { ...scene.spawn };
  const rows = [];

  for (const seed of seeds) {
    engine.rngs = mulberry32(seed >>> 0);
    engine.reset();
    engine.clearFastW();
    engine.clearLesion();

    const common = {
      scene, drive: PARAMS.drive_hz, steering: PARAMS.steering,
      ticks, steps, evalLast, spawn,
      hebbFromDrive: PARAMS.fastW.hebbFromDrive,
    };

    const A = runPhase(engine, poolMap, hd, { ...common, context: "A", goal: -1, plastic: true });
    const snap = engine.snapshotFastW();
    const poseA = { x: 0, z: 0, heading: spawn.heading + ((seed % 11) - 5) * 0.03 };

    engine.reset();
    engine.restoreFastW(snap);
    const Bplastic = runPhase(engine, poolMap, hd, {
      ...common, spawn: poseA, context: "B", goal: 1, plastic: true,
    });

    engine.reset();
    engine.restoreFastW({ ...snap, plastic: false });
    const Bfrozen = runPhase(engine, poolMap, hd, {
      ...common, spawn: poseA, context: "B", goal: 1, plastic: false,
    });

    rows.push({
      seed,
      condition: "plastic",
      A, B: Bplastic,
    });
    rows.push({
      seed,
      condition: "frozen",
      A, B: Bfrozen,
    });
    const mark = Bplastic.correct > Bfrozen.correct + 0.08 ? "+" : ".";
    process.stdout.write(
      `${mark} seed=${seed}  A=${A.correct.toFixed(2)}  Bplas=${Bplastic.correct.toFixed(2)}  Bfrz=${Bfrozen.correct.toFixed(2)}  fwA=${A.fastWNorm.toFixed(1)} fwB=${Bplastic.fastWNorm.toFixed(1)}\n`,
    );
  }

  const plastic = summarize(rows, "plastic");
  const frozen = summarize(rows, "frozen");
  const gap = plastic.meanCorrectB - frozen.meanCorrectB;
  const frozenFailsB = frozen.meanCorrectB < 0.42 && frozen.meanDeltaB < 0.05;
  const plasticRemaps = plastic.meanCorrectB > frozen.meanCorrectB + 0.12 && plastic.meanDeltaB > 0.08;
  const pass = frozenFailsB && plasticRemaps;
  const verdict = pass
    ? "PASS: frozen fails on context B; plastic remaps"
    : "FAIL: frozen vs plastic contrast on context B not shown";

  const summary = {
    name: PARAMS.name,
    version: PARAMS.version,
    claim: PARAMS.claim,
    falsifier: PARAMS.falsifier,
    not_this_experiment: PARAMS.not_this_experiment,
    smoke,
    n, ticks, steps,
    plastic_types: PARAMS.plastic_types,
    n_plastic: hd.n_plastic,
    n_plastic_out_edges: hd.n_plastic_out_edges,
    n_PFL3: hd.n_PFL3,
    fastW: PARAMS.fastW,
    scene: { ticks, steps, evalLast, left: scene.left, right: scene.right },
    plastic, frozen,
    gapB: gap,
    frozenFailsB, plasticRemaps, pass, verdict,
    rows: rows.map((r) => ({
      seed: r.seed,
      condition: r.condition,
      correctA: r.A.correct,
      correctB: r.B.correct,
      wrongB: r.B.wrong,
      deltaB: r.B.delta,
      fwA: r.A.fastWNorm,
      fwB: r.B.fastWNorm,
      fwMeanB: r.B.fwMean,
    })),
  };

  fs.mkdirSync(OUT, { recursive: true });
  const outName = smoke ? "continual_nav_smoke.json" : "continual_nav.json";
  fs.writeFileSync(path.join(OUT, outName), JSON.stringify(summary, null, 2));
  const slim = {
    name: summary.name, n, ticks, steps, plastic, frozen, gapB: gap,
    frozenFailsB, plasticRemaps, pass, verdict,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(slim, null, 2));
  fs.writeFileSync(path.join(DATA, "hdelta_summary.json"), JSON.stringify(slim, null, 2));
  console.log(verdict);
  console.log(`plastic B=${plastic.meanCorrectB.toFixed(3)}  frozen B=${frozen.meanCorrectB.toFixed(3)}  gap=${gap.toFixed(3)}`);
  console.log(`wrote results/hdelta/${outName}`);
  if (!pass && !smoke) process.exitCode = 1;
}

main();
