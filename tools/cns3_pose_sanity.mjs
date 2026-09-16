#!/usr/bin/env node
/**
 * cns3 pose-map sanity: neck/T1 must not saturate; T2/T3 walk still drives;
 * empty pools stay empty; no invented MNs.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const m = await import(pathToFileURL(path.join(ROOT, "web/poseMap.js")).href);
  const {
    softDrive, antagPair, antagonist, muscleFromEma, neckFromEma,
    walkDriveFromEma, LEG_SCALE, T1_MUSCLE_SCALE, NECK_SPAN, MUSCLE_SPAN,
    slipWeight, isForeleg,
  } = m;

  console.log("--- quiet pools stay limp ---");
  const qn = neckFromEma({ neck: 0, neckL: 0.02, neckR: 0.02 });
  console.log("quiet neck", qn);
  assert(qn.head < 0.02, "quiet neck must not pitch");
  assert(Math.abs(qn.headYaw) < 0.02, "quiet neck must not yaw");

  const qPair = antagPair(0, 0);
  assert(qPair.pos === 0 && qPair.neg === 0, "quiet antagPair");
  assert(antagonist(0, 0) === 0, "quiet antagonist");

  console.log("--- sparse neck does not saturate ---");
  const hot = neckFromEma({ neck: 0.35, neckL: 0.32, neckR: 0.38 });
  console.log("modest neck", hot);
  assert(hot.head < 0.55, "neck pitch must not peg from modest CvN EMA (was tanh(0.35*2.9)≈0.78)");
  assert(Math.abs(hot.headYaw) < 0.25, "small L/R neck delta must not thrash yaw");
  const noisy = neckFromEma({ neck: 0.22, neckL: 0.28, neckR: 0.18 });
  const yawRad = Math.abs(noisy.headYaw) * NECK_SPAN.yaw;
  console.log("noisy yaw rad", yawRad.toFixed(3));
  assert(yawRad < 0.12, "smoothed neck span must keep yaw under ~7° from modest noise");

  console.log("--- T1 (foreleg) calmer than T3 for the same EMAs ---");
  const ema = (muscle) => ({
    coxaProm: 0.45, coxaRem: 0.40, coxaRotA: 0.2, coxaRotP: 0.18,
    coxaAdd: 0.2, trFlex: 0.50, trExt: 0.55, feRed: 0.4,
    tiFlex: 0.35, tiExt: 0.30, taDep: 0.4, taLev: 0.35,
  }[muscle]);
  const t1 = muscleFromEma("L1", ema);
  const t3 = muscleFromEma("L3", ema);
  console.log("L1 trExt", t1.trExt.toFixed(3), "L3 trExt", t3.trExt.toFixed(3));
  console.log("L1 coxaProm", t1.coxaProm.toFixed(3), "L3 coxaProm", t3.coxaProm.toFixed(3));
  assert(t1.trExt < t3.trExt * 0.55, "T1 trExt (arm-up) must be well below T3");
  assert(t1.coxaProm < t3.coxaProm * 0.55, "T1 coxaProm must be well below T3");
  assert(LEG_SCALE.L1 < LEG_SCALE.L3, "LEG_SCALE T1 < T3");
  assert(T1_MUSCLE_SCALE.trExt < 0.4, "extra T1 trExt scale");
  assert(isForeleg("L1") && !isForeleg("L3"), "foreleg set");
  assert(slipWeight("L1") < slipWeight("L3") * 0.5, "T1 slip weight low");

  console.log("--- empty coxaProm stays 0; unipolar remotor does not slam ---");
  const emptyProm = muscleFromEma("L2", (m) => (m === "coxaRem" ? 0.45 : 0));
  assert(emptyProm.coxaProm === 0, "must not invent coxaProm on T2");
  assert(emptyProm.taDep === 0 && emptyProm.taLev === 0, "must not invent Ta* on T2");
  assert(emptyProm.coxaRem > 0 && emptyProm.coxaRem < 0.45, `unipolar remotor modest, got ${emptyProm.coxaRem}`);

  console.log("--- walk gate: T1 twitch ≠ walk; T2/T3 + DNa = walk ---");
  const twitch = walkDriveFromEma({ T1L: 0.55, T1R: 0.50, T2L: 0.04, T2R: 0.04, T3L: 0.03, T3R: 0.03, DNa: 0.02 });
  const walk = walkDriveFromEma({ T1L: 0.12, T1R: 0.10, T2L: 0.42, T2R: 0.40, T3L: 0.38, T3R: 0.36, DNa: 0.28 });
  const idle = walkDriveFromEma({ T1L: 0.05, T1R: 0.05, T2L: 0.04, T2R: 0.04, T3L: 0.03, T3R: 0.03, DNa: 0.02 });
  console.log({ twitch: twitch.toFixed(3), walk: walk.toFixed(3), idle: idle.toFixed(3) });
  assert(twitch < 0.22, "T1-only must not look like walking");
  assert(walk > 0.45, "T2/T3 + DNa must still walk");
  assert(idle < 0.08, "quiet MN idle");

  console.log("--- co-contraction winner-take-more ---");
  const both = antagPair(0.4, 0.38, 2.15);
  const flex = antagPair(0.55, 0.08, 2.15);
  console.log("co-con", both, "flex-wins", flex);
  assert(flex.pos > flex.neg * 2, "flex should dominate ext when clearly larger");
  assert(Math.abs(both.pos - both.neg) < 0.15, "near-equal co-con stays near balanced (rest-ish)");

  console.log("--- spans exist ---");
  assert(MUSCLE_SPAN["coxa-pitch"][2] <= 0.62, "calmer coxa-pitch span");
  assert(NECK_SPAN.yaw <= 0.28 && NECK_SPAN.pitch <= 0.22, "calmer neck spans");
  assert(softDrive(0, 2.15) === 0, "softDrive quiet");

  console.log("cns3 pose sanity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
