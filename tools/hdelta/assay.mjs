/**
 * Shared hΔ fast-weight assay (real hDeltaH/A/I/G outgoing edges only).
 * Does not reopen CVA-SST Exp0/Exp1 or M1–M3.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LifEngine, loadBins, mergePools } from "../lib/lif_engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const DATA = path.join(ROOT, "web", "data");
export const OUT = path.join(ROOT, "results", "hdelta");
export const PARAMS = JSON.parse(fs.readFileSync(path.join(ROOT, "params/hdelta/v1.json"), "utf8"));

export function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  if (v == null || v.startsWith("--")) return true;
  return v;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

export function sd(xs) {
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
}

export function loadSeeds(n) {
  const p = path.join(ROOT, "params/hdelta/seeds.txt");
  return fs.readFileSync(p, "utf8").split(/\s+/).filter(Boolean).map(Number).slice(0, n);
}

export function loadHdeltaPools() {
  const p = path.join(ROOT, "params/hdelta/pools.json");
  if (!fs.existsSync(p)) {
    throw new Error("missing params/hdelta/pools.json — run python3 tools/hdelta/build_pools.py");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function cueEye(x, z, heading, cue) {
  const dx = cue.x - x, dz = cue.z - z;
  const dist = Math.hypot(dx, dz) + 1e-6;
  const c = Math.cos(heading), s = Math.sin(heading);
  const bearing = Math.atan2(dx * c - dz * s, dx * s + dz * c);
  const on = Math.abs(bearing) < 1.45;
  const loom = Math.max(0, 1.2 - dist / 9);
  return { bearing, dist, on, loom };
}

export function headingBump(cells, heading, peakHz) {
  const rates = new Map();
  for (const c of cells) {
    const nCol = (c.column || 1) > 8 ? 12 : 8;
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

export function injectBump(engine, bump) {
  for (const [i, hz] of bump) {
    if (i < engine.n && hz > engine.drive[i]) engine.drive[i] = hz;
  }
}

export function setGoalTarget(engine, pfl3L, pfl3R, goal) {
  const tgt = new Float32Array(engine.n);
  const gL = goal < 0 ? 1 : -1;
  const gR = goal > 0 ? 1 : -1;
  for (const j of pfl3L) tgt[j] = gL;
  for (const j of pfl3R) tgt[j] = gR;
  engine.setFastWTarget(tgt);
}

export function decodeFastWTurn(engine, pfl3L, pfl3R) {
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

export function decodedGoalLabel(fwTurn, thresh = 0.12) {
  if (fwTurn < -thresh) return "A (left)";
  if (fwTurn > thresh) return "B (right)";
  return "undecided";
}

export function runPhase(engine, poolMap, hd, opts) {
  const { scene, drive, steering, ticks, steps, context, goal, spawn, plastic, hebbFromDrive } = opts;
  engine.setFastWPlastic(plastic);
  if (opts.eta != null) engine.setFastWParams({ eta: opts.eta });
  if (opts.decay != null) engine.setFastWParams({ decay: opts.decay });
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
  let nHebb = 0;

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

  engine.setRates({
    vision: drive.vision * 0.5,
    smell: context === "A" ? drive.smellA : 2,
    pher: context === "B" ? drive.smellB : 2,
    touch: 4,
  });
  injectBump(engine, headingBump(hCells, heading, drive.hDeltaBump));
  injectBump(engine, headingBump(epgBumpCells, heading, drive.headingBump));
  if (hebbFromDrive && plastic) {
    for (let h = 0; h < 10; h++) nHebb += engine.hebbFromDrive(1 / 28) || 0;
  }

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
    injectBump(engine, headingBump(hCells, heading, drive.hDeltaBump));
    injectBump(engine, headingBump(epgBumpCells, heading, drive.headingBump));
    if (hebbFromDrive && plastic) {
      const reps = tick < (opts.learnTicks ?? scene.learnTicks ?? 0) ? 3 : 1;
      for (let h = 0; h < reps; h++) nHebb += engine.hebbFromDrive(1 / 40) || 0;
    }
    for (let s = 0; s < steps; s++) engine.step();
    const hz = engine.effectorHz(steps);
    const legsL = ((hz.T1L || 0) + (hz.T2L || 0) + (hz.T3L || 0)) / 3;
    const legsR = ((hz.T1R || 0) + (hz.T2R || 0) + (hz.T3R || 0)) / 3;
    const mnTurn = Math.tanh((legsR - legsL) / 12);
    const pflTurn = Math.tanh(((hz.PFL3_R || 0) - (hz.PFL3_L || 0)) / 3);
    const fwTurn = decodeFastWTurn(engine, hd.PFL3_L, hd.PFL3_R);
    let turn = steering.kMN * mnTurn + steering.kPFL * pflTurn + steering.kFW * Math.tanh(fwTurn);
    let walk = 0.55 + 0.45 * Math.tanh((legsL + legsR) / 28);
    const gNow = cueEye(x, z, heading, goalCue);
    if (gNow.dist < scene.approachR) {
      turn *= 0.22;
      walk *= 0.32;
    } else if (Math.abs(gNow.bearing) < 0.45) {
      turn *= 0.55;
    }
    const learnTicks = opts.learnTicks ?? scene.learnTicks ?? 0;
    const walkMul = tick < learnTicks ? 0.12 : 1;
    heading += turn * steering.turnGain * scene.dtBody;
    const step = walk * steering.walkGain * scene.dtBody * walkMul;
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
  const stats = engine.fastWStats();
  const fwMean = mean(fwHist.slice(-evalLast));
  return {
    context, goal, plastic,
    correct, wrong, delta: correct - wrong,
    fracOrientGoal: evalN ? orientGoal / evalN : 0,
    fracNearGoal: evalN ? nearGoal / evalN : 0,
    fracOrientOther: evalN ? orientOther / evalN : 0,
    fracNearOther: evalN ? nearOther / evalN : 0,
    displacement: disp,
    finalX: x, finalZ: z, heading,
    fwMean,
    pflMean: mean(pflHist.slice(-evalLast)),
    fastWNorm: engine.fastWNorm(),
    meanAbsDw: stats.meanAbs,
    nEdges: stats.nEdges,
    nNonzero: stats.nNonzero,
    nHebbUpdates: nHebb,
    decodedGoal: decodedGoalLabel(fwMean),
    headingError: Math.abs(cueEye(x, z, heading, goalCue).bearing),
    hDeltaHz: 0,
  };
}

export function summarize(rows, key) {
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

export function loadGraph() {
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
  return { hd, poolMap, engine, fwMeta };
}

export function w1Verdict(plastic, frozen) {
  const gap = plastic.meanCorrectB - frozen.meanCorrectB;
  const frozenFailsB = frozen.meanCorrectB < 0.38 && frozen.meanCorrectB < plastic.meanCorrectB - 0.12;
  const plasticRemaps = plastic.meanCorrectB >= 0.35 && gap > 0.15;
  const pass = frozenFailsB && plasticRemaps;
  const verdict = pass
    ? "PASS: frozen fails on context B; plastic remaps"
    : "FAIL: frozen vs plastic contrast on context B not shown";
  return { gapB: gap, frozenFailsB, plasticRemaps, pass, verdict };
}

export function runW1({ engine, hd, poolMap, n, ticks, steps, smoke = false, seeds }) {
  const learnTicks = PARAMS.scene.learnTicks || 6;
  const evalLast = Math.max(4, Math.floor((ticks - learnTicks) / 2) + Math.floor(learnTicks / 8));
  const scene = { ...PARAMS.scene, ticks, evalLast, learnTicks };
  const spawn = { ...scene.spawn };
  const rows = [];
  const usedSeeds = seeds || loadSeeds(n);

  for (const seed of usedSeeds) {
    engine.rngs = mulberry32(seed >>> 0);
    engine.reset();
    engine.clearFastW();
    engine.clearLesion();
    engine.setFastWParams({ eta: PARAMS.fastW.eta, decay: PARAMS.fastW.decay, clip: PARAMS.fastW.clip });

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

    rows.push({ seed, condition: "plastic", A, B: Bplastic });
    rows.push({ seed, condition: "frozen", A, B: Bfrozen });
    const mark = Bplastic.correct > Bfrozen.correct + 0.08 ? "+" : ".";
    process.stdout.write(
      `${mark} W1 seed=${seed}  A=${A.correct.toFixed(2)}  Bplas=${Bplastic.correct.toFixed(2)}  Bfrz=${Bfrozen.correct.toFixed(2)}  fwA=${A.fastWNorm.toFixed(1)} fwB=${Bplastic.fastWNorm.toFixed(1)}\n`,
    );
  }

  const plastic = summarize(rows, "plastic");
  const frozen = summarize(rows, "frozen");
  const v = w1Verdict(plastic, frozen);
  return {
    name: PARAMS.name,
    version: PARAMS.version,
    experiment: "W1",
    claim: PARAMS.claim,
    falsifier: PARAMS.falsifier,
    not_this_experiment: PARAMS.not_this_experiment,
    smoke,
    n: usedSeeds.length, ticks, steps,
    plastic_types: PARAMS.plastic_types,
    n_plastic: hd.n_plastic,
    n_plastic_out_edges: hd.n_plastic_out_edges,
    n_PFL3: hd.n_PFL3,
    fastW: PARAMS.fastW,
    scene: { ticks, steps, evalLast, left: scene.left, right: scene.right },
    plastic, frozen,
    ...v,
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
      meanAbsDwB: r.B.meanAbsDw,
      nNonzeroB: r.B.nNonzero,
      decodedGoalB: r.B.decodedGoal,
    })),
  };
}
