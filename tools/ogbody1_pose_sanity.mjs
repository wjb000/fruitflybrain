#!/usr/bin/env node
/**
 * ogbody1: NeuroMechFly as OG body — anatomical axes, NMF joint limits,
 * stance plant helpers. No invented MNs / CPG / thrusters.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hypot3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

async function main() {
  const pose = await import(pathToFileURL(path.join(ROOT, "web/poseMap.js")).href);
  const {
    anatomicalLegAxes, tarsusTipOffset, nmfJointLimit, clampJointDelta,
    NMF_JOINT_LIMIT, GROUND_Y, EMPTY_MALE_MUSCLE_POOLS, embodyMuscle,
    muscleFromEma, walkDriveFromEma, antagonist,
    LEG_NEUROMERE,
  } = pose;

  const nmf = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/nmf.json"), "utf8"));
  const segs = Object.fromEntries(nmf.segments.map((s) => [s.name, s]));
  const codes = nmf.legs;

  console.log("--- anatomical axes from NMF rest (L/R mirrored, unit length) ---");
  const axesOf = (our) => {
    const code = codes[our];
    const p = {
      coxa: segs[`${code}_coxa`].restPos,
      femur: segs[`${code}_trochanterfemur`].restPos,
      tibia: segs[`${code}_tibia`].restPos,
      tarsus: segs[`${code}_tarsus1`].restPos,
    };
    return anatomicalLegAxes(our.startsWith("L") ? -1 : 1, p);
  };
  const aL1 = axesOf("L1");
  const aR1 = axesOf("R1");
  const aL3 = axesOf("L3");
  for (const key of Object.keys(aL1)) {
    assert(Math.abs(hypot3(aL1[key]) - 1) < 0.04, `${key} L1 must be unit`);
    assert(Math.abs(hypot3(aR1[key]) - 1) < 0.04, `${key} R1 must be unit`);
  }
  // Ipsilateral lateral pitch: L coxa-pitch x is negative, R positive.
  console.log({
    L1pitchX: aL1["coxa-pitch"][0].toFixed(3),
    R1pitchX: aR1["coxa-pitch"][0].toFixed(3),
    L3pitchX: aL3["coxa-pitch"][0].toFixed(3),
    L1yawY: aL1["coxa-yaw"][1].toFixed(3),
  });
  assert(aL1["coxa-pitch"][0] < 0, "left coxa-pitch points left");
  assert(aR1["coxa-pitch"][0] > 0, "right coxa-pitch points right");
  assert(aL1["coxa-pitch"][0] * aR1["coxa-pitch"][0] < 0, "L/R pitch mirrored");
  assert(aL1["coxa-yaw"][1] > 0.4, "coxa yaw is mostly thorax-up");
  // Mid/hind pitch is not world-X (that's the puppet tell).
  assert(Math.abs(aL3["coxa-pitch"][0]) > 0.15, "T3 pitch has a lateral component");
  assert(Math.abs(aL3["tibia-pitch"][2]) > 0.15 || Math.abs(aL3["tibia-pitch"][0]) > 0.15,
    "T3 tibia pitch is in the hind-leg plane");

  console.log("--- tarsus claw offset is distal, not mesh origin ---");
  const lf4 = segs.lf_tarsus4.restPos;
  const lf5 = segs.lf_tarsus5.restPos;
  const tip = tarsusTipOffset(lf4, lf5);
  assert(hypot3(tip) > 0.04, "claw offset has length");
  assert(tip[1] < 0, "claw continues downward from tarsus5");

  console.log("--- NMF joint limits: T1 < T3, clamp holds ---");
  assert(nmfJointLimit("L1", "coxa-pitch") < nmfJointLimit("L3", "coxa-pitch"),
    "T1 coxa pitch smaller than T3");
  assert(nmfJointLimit("L1", "tibia-pitch") <= nmfJointLimit("L3", "tibia-pitch"));
  assert(clampJointDelta("L3", "tibia-pitch", 9) === NMF_JOINT_LIMIT.T3["tibia-pitch"]);
  assert(clampJointDelta("L1", "coxa-yaw", -9) === -NMF_JOINT_LIMIT.T1["coxa-yaw"]);
  assert(GROUND_Y === 0.05, "moss contact plane");
  assert(LEG_NEUROMERE.R2 === "T2");

  console.log("--- quiet idle still planted; empty pools stay empty ---");
  const idleWalk = walkDriveFromEma({ T1L: 0.4, T2L: 0.04, T2R: 0.04, T3L: 0.03, T3R: 0.03, DNa: 0.02 });
  const l2 = embodyMuscle("L2", muscleFromEma("L2", (m) => ({ trFlex: 0.2 }[m] || 0)), { walkDrive: idleWalk });
  assert(l2.trFlex === 0 && l2._stance === true, "idle planted");
  assert(EMPTY_MALE_MUSCLE_POOLS.length === 12, "do not invent T2/T3 Ta*/prom");
  assert(antagonist(0, 0) === 0, "quiet hinges at anatomical rest");

  console.log("--- rest tarsi sit near the floor once thorax is at standZ ---");
  const stand = nmf.standZ || 1.3;
  const feet = ["lf", "lm", "lh", "rf", "rm", "rh"].map((c) => {
    const y = segs[`${c}_tarsus5`].restPos[1];
    return { c, worldY: stand + y };
  });
  console.log(feet.map((f) => `${f.c}:${f.worldY.toFixed(3)}`).join(" "));
  const hind = feet.filter((f) => f.c.endsWith("h"));
  assert(hind.every((f) => f.worldY < 0.12), "hind tarsi already near moss at NMF rest");

  console.log("ogbody1 pose sanity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
