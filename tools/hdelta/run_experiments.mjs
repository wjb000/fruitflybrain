#!/usr/bin/env node
/**
 * hΔ fast-weight experiment pack (headless).
 *
 *   W1  plastic vs frozen (existing two-context remap)
 *   W2  η sweep in a small predeclared box
 *   W3  freeze mid-run after A, switch to B (must fail); unfreeze → recover
 *
 * Real hDeltaH/A/I/G outgoing chemical edges only. Does not reopen
 * CVA-SST Exp0/Exp1 or M1–M3. Does not invent neuron types.
 *
 *   node tools/hdelta/run_experiments.mjs
 *   node tools/hdelta/run_experiments.mjs --smoke
 */
import fs from "fs";
import path from "path";
import {
  PARAMS, OUT, arg, loadSeeds, loadGraph, runW1, runPhase, mean, sd, mulberry32,
} from "./assay.mjs";

function labBox() {
  return PARAMS.lab || {
    W1: { n: 4, ticks: 20, steps: 3 },
    W2: { etas: [0.02, 0.05, 0.10, 0.25], n: 3, ticks: 18, steps: 2 },
    W3: { n: 4, ticks: 18, steps: 2 },
  };
}

function slimPhase(p) {
  return {
    correct: p.correct,
    wrong: p.wrong,
    delta: p.delta,
    fwMean: p.fwMean,
    fastWNorm: p.fastWNorm,
    meanAbsDw: p.meanAbsDw,
    nNonzero: p.nNonzero,
    nEdges: p.nEdges,
    decodedGoal: p.decodedGoal,
    headingError: p.headingError,
    plastic: p.plastic,
    context: p.context,
    goal: p.goal,
  };
}

function runW2({ engine, hd, poolMap, cfg, smoke }) {
  const etas = cfg.etas;
  const n = cfg.n;
  const ticks = cfg.ticks;
  const steps = cfg.steps;
  const seeds = loadSeeds(n);
  const learnTicks = PARAMS.scene.learnTicks || 6;
  const evalLast = Math.max(4, Math.floor((ticks - learnTicks) / 2) + Math.floor(learnTicks / 8));
  const scene = { ...PARAMS.scene, ticks, evalLast, learnTicks };
  const spawn = { ...scene.spawn };
  const byEta = [];

  console.log(`W2 η sweep  etas=[${etas.join(", ")}] n=${n} ticks=${ticks} steps=${steps}`);
  for (const eta of etas) {
    const correctB = [];
    const wrongB = [];
    const correctA = [];
    const meanAbs = [];
    const rows = [];
    for (const seed of seeds) {
      engine.rngs = mulberry32(seed >>> 0);
      engine.reset();
      engine.clearFastW();
      engine.clearLesion();
      engine.setFastWParams({ eta, decay: PARAMS.fastW.decay, clip: PARAMS.fastW.clip, plastic: true });
      const common = {
        scene, drive: PARAMS.drive_hz, steering: PARAMS.steering,
        ticks, steps, evalLast, spawn, eta,
        hebbFromDrive: PARAMS.fastW.hebbFromDrive,
      };
      const A = runPhase(engine, poolMap, hd, { ...common, context: "A", goal: -1, plastic: true });
      const snap = engine.snapshotFastW();
      engine.reset();
      engine.restoreFastW(snap);
      engine.setFastWParams({ eta, plastic: true });
      const B = runPhase(engine, poolMap, hd, {
        ...common, spawn: { x: 0, z: 0, heading: spawn.heading },
        context: "B", goal: 1, plastic: true,
      });
      correctA.push(A.correct);
      correctB.push(B.correct);
      wrongB.push(B.wrong);
      meanAbs.push(B.meanAbsDw);
      rows.push({ seed, correctA: A.correct, correctB: B.correct, wrongB: B.wrong, meanAbsDwB: B.meanAbsDw, decodedGoalB: B.decodedGoal });
      process.stdout.write(`  η=${eta.toFixed(2)} seed=${seed}  A=${A.correct.toFixed(2)}  B=${B.correct.toFixed(2)}  |Δw|=${B.meanAbsDw.toFixed(3)}\n`);
    }
    const rec = {
      eta,
      n: seeds.length,
      meanCorrectA: mean(correctA),
      meanCorrectB: mean(correctB),
      sdCorrectB: sd(correctB),
      meanWrongB: mean(wrongB),
      meanAbsDwB: mean(meanAbs),
      remaps: mean(correctB) >= 0.35,
      rows,
    };
    byEta.push(rec);
  }

  const defaultEta = PARAMS.fastW.eta;
  const atDefault = byEta.find((r) => Math.abs(r.eta - defaultEta) < 1e-9) || null;
  const atLow = byEta[0];
  const defaultRemaps = !!(atDefault && atDefault.remaps);
  const lowestWeaker = atDefault && atLow
    ? atLow.meanCorrectB <= atDefault.meanCorrectB + 0.02
    : false;
  const verdict = defaultRemaps
    ? `W2: predeclared η box recorded; default η=${defaultEta} remaps B (correct=${(atDefault.meanCorrectB).toFixed(3)})`
    : `W2: default η=${defaultEta} did not remap in this box`;

  return {
    experiment: "W2",
    name: "hDelta-fastW-eta-sweep",
    box: { etas, n, ticks, steps },
    note: "Predeclared before looking at results. Plastic hDeltaH/A/I/G edges only; PFL3 laterality readout.",
    not_this_experiment: PARAMS.not_this_experiment,
    byEta,
    defaultEta,
    defaultRemaps,
    lowestWeaker,
    pass: defaultRemaps,
    verdict,
    smoke,
  };
}

function runW3({ engine, hd, poolMap, cfg, smoke }) {
  const n = cfg.n;
  const ticks = cfg.ticks;
  const steps = cfg.steps;
  const seeds = loadSeeds(n);
  const learnTicks = PARAMS.scene.learnTicks || 6;
  const evalLast = Math.max(4, Math.floor((ticks - learnTicks) / 2) + Math.floor(learnTicks / 8));
  const scene = { ...PARAMS.scene, ticks, evalLast, learnTicks };
  const spawn = { ...scene.spawn };
  const rows = [];

  console.log(`W3 freeze mid-run  n=${n} ticks=${ticks} steps=${steps}`);
  for (const seed of seeds) {
    engine.rngs = mulberry32(seed >>> 0);
    engine.reset();
    engine.clearFastW();
    engine.clearLesion();
    engine.setFastWParams({
      eta: PARAMS.fastW.eta, decay: PARAMS.fastW.decay, clip: PARAMS.fastW.clip, plastic: true,
    });
    const common = {
      scene, drive: PARAMS.drive_hz, steering: PARAMS.steering,
      ticks, steps, evalLast, spawn,
      hebbFromDrive: PARAMS.fastW.hebbFromDrive,
    };

    const A = runPhase(engine, poolMap, hd, { ...common, context: "A", goal: -1, plastic: true });
    const afterA = engine.fastWStats();

    engine.reset();
    engine.setFastWPlastic(false);
    const Bfrozen = runPhase(engine, poolMap, hd, {
      ...common, spawn: { x: 0, z: 0, heading: spawn.heading },
      context: "B", goal: 1, plastic: false,
    });

    engine.reset();
    engine.setFastWPlastic(true);
    const Brecover = runPhase(engine, poolMap, hd, {
      ...common, spawn: { x: 0, z: 0, heading: spawn.heading },
      context: "B", goal: 1, plastic: true,
    });

    rows.push({
      seed,
      A: slimPhase(A),
      Bfrozen: slimPhase(Bfrozen),
      Brecover: slimPhase(Brecover),
      meanAbsDwAfterA: afterA.meanAbs,
      nNonzeroAfterA: afterA.nNonzero,
    });
    const mark = Bfrozen.correct < 0.38 && Brecover.correct > Bfrozen.correct + 0.12 ? "+" : ".";
    process.stdout.write(
      `${mark} W3 seed=${seed}  A=${A.correct.toFixed(2)}  Bfrz=${Bfrozen.correct.toFixed(2)}  Brec=${Brecover.correct.toFixed(2)}\n`,
    );
  }

  const cA = rows.map((r) => r.A.correct);
  const cFrz = rows.map((r) => r.Bfrozen.correct);
  const cRec = rows.map((r) => r.Brecover.correct);
  const frozenFailsB = mean(cFrz) < 0.38 && mean(cFrz) < mean(cA) - 0.08;
  const unfreezeRecovers = mean(cRec) >= 0.35 && mean(cRec) > mean(cFrz) + 0.15;
  const pass = frozenFailsB && unfreezeRecovers;
  const verdict = pass
    ? "PASS: freeze after A, switch to B fails; unfreeze recovers remap"
    : "FAIL: freeze/unfreeze intervention did not show fail-then-recover";

  return {
    experiment: "W3",
    name: "hDelta-fastW-freeze-midrun",
    claim: "After learning A, freezing hΔ Δw and switching to B fails; unfreezing those same edges recovers the B remap.",
    not_this_experiment: PARAMS.not_this_experiment,
    n: seeds.length, ticks, steps,
    meanCorrectA: mean(cA), sdCorrectA: sd(cA),
    meanCorrectBfrozen: mean(cFrz), sdCorrectBfrozen: sd(cFrz),
    meanCorrectBrecover: mean(cRec), sdCorrectBrecover: sd(cRec),
    frozenFailsB, unfreezeRecovers, pass, verdict,
    rows,
    smoke,
  };
}

function main() {
  const argv = process.argv;
  const smoke = !!arg(argv, "--smoke", false);
  const box = labBox();
  const w1cfg = smoke
    ? { n: 2, ticks: 12, steps: 2 }
    : { n: box.W1.n, ticks: box.W1.ticks, steps: box.W1.steps };
  const w2cfg = smoke
    ? { etas: box.W2.etas, n: 2, ticks: 12, steps: 2 }
    : { ...box.W2 };
  const w3cfg = smoke
    ? { n: 2, ticks: 12, steps: 2 }
    : { ...box.W3 };

  const { hd, poolMap, engine, fwMeta } = loadGraph();
  console.log(`hΔ experiment pack  plastic cells=${fwMeta.nPre} edges=${fwMeta.nEdges}  types ${PARAMS.plastic_types.join("/")}`);
  console.log(`PFL3 L/R ${hd.PFL3_L.length}/${hd.PFL3_R.length}  smoke=${!!smoke}`);

  const W1 = runW1({
    engine, hd, poolMap,
    n: w1cfg.n, ticks: w1cfg.ticks, steps: w1cfg.steps,
    smoke, seeds: loadSeeds(w1cfg.n),
  });
  const W2 = runW2({ engine, hd, poolMap, cfg: w2cfg, smoke });
  const W3 = runW3({ engine, hd, poolMap, cfg: w3cfg, smoke });

  const pack = {
    name: "hDelta-fastW-experiment-lab",
    version: "lab1",
    plastic_types: PARAMS.plastic_types,
    n_plastic: hd.n_plastic,
    n_plastic_out_edges: hd.n_plastic_out_edges,
    n_PFL3: hd.n_PFL3,
    readout: PARAMS.readout,
    not_this_experiment: PARAMS.not_this_experiment,
    smoke,
    box: { W1: w1cfg, W2: w2cfg, W3: w3cfg },
    W1: {
      experiment: W1.experiment,
      n: W1.n, ticks: W1.ticks, steps: W1.steps,
      plastic: W1.plastic, frozen: W1.frozen,
      gapB: W1.gapB, frozenFailsB: W1.frozenFailsB,
      plasticRemaps: W1.plasticRemaps, pass: W1.pass, verdict: W1.verdict,
      rows: W1.rows,
    },
    W2,
    W3,
    pass: !!(W1.pass && W2.pass && W3.pass),
    verdict: [W1.verdict, W2.verdict, W3.verdict].join(" | "),
  };

  fs.mkdirSync(OUT, { recursive: true });
  const outName = smoke ? "experiments_smoke.json" : "experiments.json";
  fs.writeFileSync(path.join(OUT, outName), JSON.stringify(pack, null, 2));
  console.log(pack.verdict);
  console.log(`wrote results/hdelta/${outName}`);
  if (!pack.pass && !smoke) process.exitCode = 1;
}

main();
