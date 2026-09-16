#!/usr/bin/env node
/**
 * cns4sense: compound-eye → lamina → T4/T5 → HS/VS is ethological, not RGB/salience.
 * Also re-checks cns4 wing/mouth gates.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function gardenWorld(origin, heading, extra = {}) {
  return {
    origin,
    heading,
    day: 0.85,
    t: extra.t || 0,
    food: { x: 6.5, z: 4.2 },
    water: { x: -5.5, z: -3.8 },
    landmarks: [
      { x: 6.5, y: 0.35, z: 4.2, r: 0.55, kind: "food" },
      { x: -5.5, y: 0.22, z: -3.8, r: 0.42, kind: "water" },
    ],
    ego: extra.ego || { vx: 0, vy: 0, vz: 0, yawRate: 0, dt: 0.032 },
    ...extra,
  };
}

function magHS(sample) {
  return Math.abs(sample.L?.hs || 0) + Math.abs(sample.R?.hs || 0);
}
function magT4(sample) {
  let s = 0;
  for (const side of ["L", "R"]) {
    const e = sample[side] || {};
    s += (e.t4a || 0) + (e.t4b || 0) + (e.t4c || 0) + (e.t4d || 0);
  }
  return s;
}
function magLoom(sample) {
  return (sample.L?.loom || 0) + (sample.R?.loom || 0);
}

async function main() {
  const eyeMod = await import(pathToFileURL(path.join(ROOT, "web/eye.js")).href);
  const poseMod = await import(pathToFileURL(path.join(ROOT, "web/poseMap.js")).href);
  const { CompoundEye, encodeOpticRates } = eyeMod;
  const { wingFromEma, feedFromEma, WING_FLAP_GATE } = poseMod;

  const origin = { x: 0.4, y: 2.45, z: 0.2 };
  const heading = Math.atan2(6.5 - origin.x, 4.2 - origin.z); // face fruit

  console.log("--- static garden: photoreceptors live, motion quiet ---");
  const eye = new CompoundEye();
  const w0 = gardenWorld(origin, heading);
  eye.sample(w0);
  const still = eye.sample(w0);
  const stillRates = encodeOpticRates(still);
  console.log({
    r16L: still.L.r16.toFixed(3),
    r7L: still.L.r7.toFixed(3),
    r8L: still.L.r8.toFixed(3),
    on: still.L.on.toFixed(4),
    hs: magHS(still).toFixed(4),
    t4: magT4(still).toFixed(4),
    loom: magLoom(still).toFixed(4),
    HSL: stillRates.HSL.toFixed(1),
    L1L: stillRates.L1L.toFixed(1),
    salFood: still.L.salFood.toFixed(3),
  });
  assert(still.L.r16 > 0.02 && still.R.r16 > 0.02, "R1–R6 must see garden light");
  assert(still.L.r7 > 0 && still.L.r8 > 0, "R7/R8 spectral channels live");
  assert(magHS(still) < 0.35, "static scene must not drive HS as if it were a food blob");
  assert(magT4(still) < 1.2, "static T4 should stay near baseline (no salFood dump)");
  assert(stillRates.HSL < 25 && stillRates.HSR < 25, "static HS Hz must stay low despite fruit in view");
  assert(still.L.salFood > 0.001, "HUD fruit tag may still exist");
  // Salience must not be the thing that raises HS: if we zero motion, HS stays low
  // even with salFood present (already implied by stillRates.HSL).
  const l1fromOn = stillRates.L1L;
  const fakeSal = { ...still };
  fakeSal.L = { ...still.L, salFood: 5, sal: 5 };
  fakeSal.R = { ...still.R, salFood: 5, sal: 5 };
  const dumped = encodeOpticRates(fakeSal);
  assert(Math.abs(dumped.HSL - stillRates.HSL) < 0.01, "encodeOpticRates must ignore salFood for HS");
  assert(Math.abs(dumped.T4aL - stillRates.T4aL) < 0.01, "encodeOpticRates must ignore salFood for T4");
  assert(Math.abs(dumped.L1L - l1fromOn) < 0.01, "L1 is ON contrast, not salience");

  console.log("--- yaw: HS / T4 horizontal rise ---");
  const yawEye = new CompoundEye();
  yawEye.sample(gardenWorld(origin, heading, { ego: { vx: 0, vy: 0, vz: 0, yawRate: 0, dt: 0.032 } }));
  const yawed = yawEye.sample(gardenWorld(origin, heading, {
    ego: { vx: 0, vy: 0, vz: 0, yawRate: 2.2, dt: 0.032 },
  }));
  const yawRates = encodeOpticRates(yawed);
  console.log({ hs: magHS(yawed).toFixed(3), t4: magT4(yawed).toFixed(3), HSL: yawRates.HSL.toFixed(1), HSR: yawRates.HSR.toFixed(1) });
  assert(magHS(yawed) > magHS(still) * 3 + 0.15, "yaw must raise |HS| vs static");
  assert(yawRates.HSL < 110 && yawRates.HSR < 110, "yaw 2.2 rad/s must not peg HS at ceiling");
  assert(yawRates.HSL > stillRates.HSL + 8 || yawRates.HSR > stillRates.HSR + 8, "yaw writes Hz into HS pools");

  console.log("--- forward walk: motion parallax (floor texture + 1/depth flow) ---");
  const walkEye = new CompoundEye();
  const fwd = Math.sin(heading), fzd = Math.cos(heading);
  walkEye.sample(gardenWorld(origin, heading));
  const walked = walkEye.sample(gardenWorld(origin, heading, {
    ego: { vx: fwd * 1.6, vy: 0, vz: fzd * 1.6, yawRate: 0, dt: 0.032 },
  }));
  const walkRates = encodeOpticRates(walked);
  console.log({ t4: magT4(walked).toFixed(3), hs: magHS(walked).toFixed(3), T4aL: walkRates.T4aL.toFixed(1) });
  assert(magT4(walked) > magT4(still) + 0.08, "translation must raise T4 via parallax");

  console.log("--- approach fruit: loom / expansion ---");
  const loomEye = new CompoundEye();
  const far = { x: origin.x, y: origin.y, z: origin.z };
  const near = {
    x: origin.x + fwd * 1.8,
    y: origin.y,
    z: origin.z + fzd * 1.8,
  };
  loomEye.sample(gardenWorld(far, heading, { ego: { vx: 0, vy: 0, vz: 0, yawRate: 0, dt: 0.032 } }));
  const approaching = loomEye.sample(gardenWorld(near, heading, {
    t: 0.032,
    ego: { vx: fwd * 4.2, vy: 0, vz: fzd * 4.2, yawRate: 0, dt: 0.032 },
  }));
  const loomRates = encodeOpticRates(approaching);
  console.log({
    loomStill: magLoom(still).toFixed(3),
    loomApp: magLoom(approaching).toFixed(3),
    VSL: loomRates.VSL.toFixed(1),
    T4aL: loomRates.T4aL.toFixed(1),
    T4bL: loomRates.T4bL.toFixed(1),
  });
  assert(magLoom(approaching) > magLoom(still) + 0.05, "approaching fruit must loom");
  assert(loomRates.T4aL > 12 && loomRates.T4bL > 12, "loom expansion writes both T4a and T4b");
  assert(
    (approaching.L.t4a + approaching.L.t4b) > (still.L.t4a + still.L.t4b) + 0.02,
    "loom expansion should raise T4a+T4b"
  );

  console.log("--- spectral split: water (UV/blue) vs fruit (yellow) ---");
  const specEye = new CompoundEye();
  const nearFruit = { x: 5.2, y: 2.2, z: 3.3 };
  const faceFruit = Math.atan2(6.5 - nearFruit.x, 4.2 - nearFruit.z);
  specEye.sample(gardenWorld(nearFruit, faceFruit));
  const fruitClose = specEye.sample(gardenWorld(nearFruit, faceFruit));
  const nearWater = { x: -4.4, y: 2.2, z: -2.9 };
  const faceWater = Math.atan2(-5.5 - nearWater.x, -3.8 - nearWater.z);
  const wEye = new CompoundEye();
  wEye.sample(gardenWorld(nearWater, faceWater));
  const waterView = wEye.sample(gardenWorld(nearWater, faceWater));
  const waterUV = (waterView.L.r7 + waterView.R.r7) / Math.max(1e-6, waterView.L.r16 + waterView.R.r16);
  const fruitUV = (fruitClose.L.r7 + fruitClose.R.r7) / Math.max(1e-6, fruitClose.L.r16 + fruitClose.R.r16);
  const waterR8 = (waterView.L.r8 + waterView.R.r8) / Math.max(1e-6, waterView.L.r16 + waterView.R.r16);
  const fruitR8 = (fruitClose.L.r8 + fruitClose.R.r8) / Math.max(1e-6, fruitClose.L.r16 + fruitClose.R.r16);
  console.log({
    waterUV: waterUV.toFixed(3), fruitUV: fruitUV.toFixed(3),
    waterR8: waterR8.toFixed(3), fruitR8: fruitR8.toFixed(3),
    fruitR16: fruitClose.L.r16.toFixed(3), waterR7: waterView.L.r7.toFixed(3),
  });
  assert(waterUV > fruitUV, "dew should be more UV-weighted than ripe fruit");
  assert(waterR8 > fruitR8, "dew/blue R8 vs fruit yellow");
  assert(fruitClose.L.r16 !== fruitClose.L.r7, "R16 ≠ R7");

  console.log("--- pool keys are annotated types only ---");
  const keys = Object.keys(stillRates);
  const allowed = /^(R16|R7|R8)[LR][0-3]$|^(L1|L2|L3|HS|VS|T4a|T4b|T4c|T4d|T5a|T5b|T5c|T5d)[LR]$/;
  for (const k of keys) assert(allowed.test(k), "unexpected optic key " + k);

  console.log("--- earth-fly sense pools exist (no invented IDs) ---");
  const fs = await import("fs");
  const stim = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/stim.json"), "utf8"));
  for (const k of [
    "R16", "R7", "R8", "L1", "L2", "L3",
    "T4a", "T4b", "T4c", "T4d", "T5a", "T5b", "T5c", "T5d", "HS", "VS",
    "foodORN", "pherORN", "co2ORN", "aversiveORN", "JO",
    "hygro", "sweet", "bitter", "taste",
    "proprio", "chordotonal", "hairplate", "campaniform",
    "sLNv", "lLNv", "LNd", "DN1a", "DN1p", "DAN", "OA", "HT", "pep",
  ]) {
    assert(Array.isArray(stim[k]) && stim[k].length > 0, "missing annotated pool " + k);
  }

  console.log("--- cns4 wing/mouth gates still hold ---");
  const idleW = wingFromEma({ DLM: 0.18, DVM: 0.16, ADMN: 0.14 });
  const strongW = wingFromEma({ DLM: 0.82, DVM: 0.78, ADMN: 0.70 });
  assert(idleW.power === 0 && idleW.fly === 0, "idle wings stay folded");
  assert(strongW.power >= WING_FLAP_GATE, "strong wing MNs may still flap");
  assert(feedFromEma({ MN9: 0.40, proboscis: 0.12 }) === 0, "idle MN9 must not mouth");
  assert(feedFromEma({ MN9: 0.92, proboscis: 0.80 }) > 0.25, "sustained feed may still extend");

  console.log("cns4sense eye/optic sanity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
