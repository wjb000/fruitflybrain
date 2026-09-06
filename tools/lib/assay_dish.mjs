/**
 * Dish v2 — see → remember → dark/reorient → dark-retrieve (headless).
 *
 * Phases:
 *   encode   — lights ON, landmark visible; fly may approach/fix
 *   dark     — lights OUT; vision drive 0; network state may persist
 *   yaw      — reorient the ANIMAL (heading += π); landmark stays fixed
 *   retrieve — lights stay OUT / landmark hidden; score approach from memory
 *
 * Honest rule: post-yaw success with lights out requires memory of bearing/place,
 * not visual reacquisition. No ground-truth bearing cheat into the body.
 *
 * Vision: retinotopic L/R landmark channels from geometry (resolvable blob).
 * Steering: MN L/R tank-steer + HS_L/R optic (lights-on only) — MN-only body.
 * Arena: soft wall so rim-pile does not dominate scores.
 * Spawn: fixed pose (stable across lesions).
 *
 * Failure labels: blindness | motor | memory_heading | null (task OK).
 * "memory_heading" = sensoryOK && motorOK && !taskOK — candidate hit only.
 */

export const DISH = {
  arenaR: 11,
  wallStart: 8.5,
  targetR: 6.5,
  spawnR: 2.2,
  spawnAng: Math.PI * 0.35, // fixed
  approachRadius: 2.2,
  // Long enough that intact can lock-on / approach during encode when vision→MN works.
  encodeTicks: 100,
  darkTicks: 12,
  retrieveTicks: 80,
  rotateRad: Math.PI,
  dtBody: 0.05,
  stepsPerTick: 8,
  motorDispMin: 0.55,
  motorLegMin: 0.025,
  sensoryOpticMin: 0.025,
  // Dark-retrieve chance floor (random walk after yaw); calibrated by probe.
  chanceApproach: 0.08,
  taskMargin: 0.04,
  landmarkContrast: 1.0,
  landmarkSize: 1.35,
  // Retrieve with lights out (true memory). Set false only for legacy reacquisition.
  darkRetrieve: true,
};

/** Split pool neuron ids by brain x (L = x<0, R = x>=0). */
export function splitPoolLR(ids, xyz) {
  const L = [], R = [];
  for (const i of ids || []) {
    const x = xyz[i * 3];
    if (x < 0) L.push(i);
    else R.push(i);
  }
  return { L, R };
}

export function soft(hz) {
  if (hz <= 0) return 0;
  return Math.min(1, 1 - Math.exp(-hz / 18));
}

/**
 * Retinotopic L/R landmark response. Distinct bright blob the "eyes" resolve.
 * Returns rates (Hz-ish) for left/right vision channels + loom.
 */
export function landmarkEye(fly, target, lightsOn, opts = DISH) {
  if (!lightsOn) {
    return { L: 0, R: 0, optic: 0, bearing: 0, loom: 0, onRetina: false, dist: Math.hypot(target.x - fly.x, target.z - fly.z) };
  }
  const dx = target.x - fly.x;
  const dz = target.z - fly.z;
  const dist = Math.hypot(dx, dz) + 1e-6;
  const c = Math.cos(fly.heading), s = Math.sin(fly.heading);
  // Body-frame bearing: 0 = ahead, + = right, − = left
  const bearing = Math.atan2(dx * c - dz * s, dx * s + dz * c);
  const loom = Math.max(0, 1.15 - dist / 9);
  const half = opts.landmarkSize;
  const onRetina = Math.abs(bearing) < 1.45;
  const bright = opts.landmarkContrast * (75 + loom * 90);
  const L = onRetina
    ? bright * Math.exp(-((bearing + 0.55) ** 2) / (2 * (half * 0.55) ** 2))
    : 2;
  const R = onRetina
    ? bright * Math.exp(-((bearing - 0.55) ** 2) / (2 * (half * 0.55) ** 2))
    : 2;
  const optic = (L + R) * 0.5;
  return { L, R, optic, bearing, loom, onRetina, dist };
}

function wallPush(x, z, opts = DISH) {
  const r = Math.hypot(x, z);
  if (r < opts.wallStart) return { ax: 0, az: 0 };
  const over = (r - opts.wallStart) / (opts.arenaR - opts.wallStart + 1e-6);
  const mag = Math.min(1, over) * 2.8;
  return { ax: -(x / (r + 1e-6)) * mag, az: -(z / (r + 1e-6)) * mag };
}

export function makeTarget(opts = DISH) {
  const ang = opts.spawnAng;
  return {
    x: Math.sin(ang) * opts.targetR,
    z: Math.cos(ang) * opts.targetR,
    ang,
    r: opts.targetR,
  };
}

export function makeSpawn(opts = DISH) {
  const ang = opts.spawnAng;
  return {
    x: -Math.sin(ang) * opts.spawnR,
    z: -Math.cos(ang) * opts.spawnR,
    // step uses (sin(h), cos(h)); target lies along +ang from spawn → heading=ang
    heading: ang,
  };
}

/** @deprecated target-rotate inflated post-yaw scores; yaw the animal instead. */
export function rotateTarget(target, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const x = target.x * c - target.z * s;
  const z = target.x * s + target.z * c;
  target.x = x;
  target.z = z;
  target.ang = Math.atan2(x, z);
  return target;
}

/** Reorient the animal (idiothetic yaw); landmark stays fixed in world frame. */
export function yawAnimal(pose, rad) {
  pose.heading = (pose.heading || 0) + rad;
  return pose;
}

/**
 * Bind L/R vision + HS channels on engine from poolMap + xyz.
 */
export function bindDishChannels(engine, poolMap) {
  const xyz = engine.xyz;
  const vision = poolMap.vision || poolMap.R16 || [];
  const HS = poolMap.HS || [];
  const VS = poolMap.VS || [];
  const foodORN = poolMap.foodORN || [];
  const vLR = splitPoolLR(vision, xyz);
  const hsLR = splitPoolLR(HS, xyz);
  const vsLR = splitPoolLR(VS, xyz);
  engine.bindChannels({
    visionL: vLR.L,
    visionR: vLR.R,
    HS_L: hsLR.L,
    HS_R: hsLR.R,
    VS_L: vsLR.L,
    VS_R: vsLR.R,
    vision,
    HS,
    VS,
    foodORN,
  });
  const effectorNames = [
    "T1L", "T1R", "T2L", "T2R", "T3L", "T3R",
    "HS", "VS", "HS_L", "HS_R", "VS_L", "VS_R",
    "DNa", "DNp", "DLM", "DVM", "ADMN", "DAN", "OA",
  ];
  const pools = {};
  for (const k of effectorNames) {
    if (k === "HS_L") pools[k] = hsLR.L;
    else if (k === "HS_R") pools[k] = hsLR.R;
    else if (k === "VS_L") pools[k] = vsLR.L;
    else if (k === "VS_R") pools[k] = vsLR.R;
    else pools[k] = poolMap[k] || [];
  }
  engine.bindEffectors(pools);
  return { vLR, hsLR, vsLR };
}

/**
 * Run one trial on the dish. Returns scored row (same schema as sweep).
 */
export function runDishAssay(engine, poolMap, lesionCfg, expandLesionOps, lesionSummary, opts = {}) {
  const D = { ...DISH, ...opts };
  const totalTicks = D.encodeTicks + D.darkTicks + D.retrieveTicks;
  const yawAt = D.encodeTicks + D.darkTicks; // reorient at end of dark
  const darkRetrieve = D.darkRetrieve !== false;

  const ops = expandLesionOps(lesionCfg, poolMap);
  engine.reset();
  engine.applyLesion(ops);
  bindDishChannels(engine, poolMap);

  const target = makeTarget(D);
  const spawn = makeSpawn(D);
  let x = spawn.x, z = spawn.z, heading = spawn.heading;
  let opticPeak = 0;
  let displacement = 0;
  let lx = x, lz = z;
  let encodeSaw = false;
  let encodeLocked = false; // approached during encode
  const samples = [];

  for (let tick = 0; tick < totalTicks; tick++) {
    let phase = "encode";
    let lightsOn = true;
    if (tick >= D.encodeTicks && tick < yawAt) {
      phase = "dark";
      lightsOn = false;
    } else if (tick === yawAt) {
      phase = "yaw";
      lightsOn = false;
      // Reorient animal; landmark FIXED (allocentric place unchanged).
      heading += D.rotateRad;
    } else if (tick > yawAt) {
      phase = "retrieve";
      lightsOn = darkRetrieve ? false : true;
    }

    const eye = landmarkEye({ x, z, heading }, target, lightsOn, D);
    if (eye.onRetina && lightsOn && phase === "encode") encodeSaw = true;
    if (eye.optic > opticPeak) opticPeak = soft(eye.optic);

    const food = lightsOn ? 8 + eye.loom * 18 : 0;
    engine.setRates({
      visionL: eye.L,
      visionR: eye.R,
      vision: (eye.L + eye.R) * 0.5,
      HS_L: lightsOn ? 6 + eye.L * 0.45 : 0,
      HS_R: lightsOn ? 6 + eye.R * 0.45 : 0,
      HS: lightsOn ? 6 + eye.optic * 0.4 : 0,
      VS_L: lightsOn ? 5 + eye.loom * 15 : 0,
      VS_R: lightsOn ? 5 + eye.loom * 15 : 0,
      VS: lightsOn ? 5 + eye.loom * 18 : 0,
      foodORN: food,
    });

    for (let si = 0; si < D.stepsPerTick; si++) engine.step();
    const hz = engine.effectorHz(D.stepsPerTick);

    const legsL = soft(((hz.T1L || 0) + (hz.T2L || 0) + (hz.T3L || 0)) / 3);
    const legsR = soft(((hz.T1R || 0) + (hz.T2R || 0) + (hz.T3R || 0)) / 3);
    const legs = (legsL + legsR) / 2;

    const hsL = soft(hz.HS_L || 0);
    const hsR = soft(hz.HS_R || 0);
    const opticRead = hsL + hsR + soft(hz.VS_L || 0) + soft(hz.VS_R || 0);
    if (opticRead > opticPeak) opticPeak = opticRead;

    // Walk from MN legs; mild optic arousal when lights on (LIF HS/VS readout, not GT).
    const walk = Math.tanh(legs * 3.4 + (lightsOn ? opticRead * 0.4 : 0));

    // Steering: MN asymmetry + HS only while landmark is visible.
    const turn =
      Math.tanh((legsR - legsL) * 2.15) +
      Math.tanh((hsR - hsL) * 1.35) * (lightsOn ? 1 : 0.05);

    heading += turn * 1.15 * D.dtBody;
    const step = walk * 3.1 * D.dtBody;
    let nx = x + Math.sin(heading) * step;
    let nz = z + Math.cos(heading) * step;
    const push = wallPush(nx, nz, D);
    nx += push.ax * D.dtBody;
    nz += push.az * D.dtBody;
    const rr = Math.hypot(nx, nz);
    if (rr > D.arenaR) {
      nx *= D.arenaR / rr;
      nz *= D.arenaR / rr;
    }
    x = nx; z = nz;
    displacement += Math.hypot(x - lx, z - lz);
    lx = x; lz = z;

    const dist = Math.hypot(target.x - x, target.z - z);
    samples.push({
      t: tick * D.dtBody,
      tick,
      phase,
      lightsOn,
      dist,
      legs,
      walk,
      turn,
      optic: opticRead,
      eyeL: eye.L,
      eyeR: eye.R,
      bearing: eye.bearing,
      x,
      z,
      heading,
    });
  }

  const after = samples.filter((s) => s.tick >= yawAt);
  const startPost = after[0]?.dist ?? samples[0].dist;
  const endPost = after.at(-1)?.dist ?? samples.at(-1).dist;
  const approachFrac = startPost > 1e-3 ? Math.max(0, (startPost - endPost) / startPost) : 0;
  const postRotateApproach = approachFrac;
  const reached = endPost <= D.approachRadius;
  const motorOK = displacement >= D.motorDispMin || (samples.at(-1)?.legs ?? 0) >= D.motorLegMin;
  const sensoryOK = opticPeak >= D.sensoryOpticMin && encodeSaw;
  const betterThanChance = approachFrac > D.chanceApproach + D.taskMargin || reached;
  const taskOK = betterThanChance;
  let failure = null;
  if (!sensoryOK) failure = "blindness";
  else if (!motorOK) failure = "motor";
  else if (!taskOK) failure = "memory_heading";
  const interesting = sensoryOK && motorOK && !taskOK;

  const enc = samples.filter((s) => s.phase === "encode");
  const encodeApproach = enc.length > 1
    ? Math.max(0, (enc[0].dist - enc.at(-1).dist) / (enc[0].dist + 1e-6))
    : 0;
  encodeLocked = encodeApproach > 0.05;

  return {
    id: lesionCfg.id,
    lesion: lesionCfg,
    lesionSummary: lesionSummary(lesionCfg),
    dish: {
      version: "dish_v2_dark_retrieve",
      encodeTicks: D.encodeTicks,
      darkTicks: D.darkTicks,
      retrieveTicks: D.retrieveTicks,
      rotateRad: D.rotateRad,
      yawMode: "animal_heading",
      darkRetrieve,
      spawnAng: D.spawnAng,
      targetR: D.targetR,
      chanceApproach: D.chanceApproach,
    },
    metrics: {
      finalDist: endPost,
      postRotateStartDist: startPost,
      postRotateEndDist: endPost,
      approachFrac,
      postRotateApproach,
      encodeApproach,
      encodeLocked,
      chanceApproach: D.chanceApproach,
      displacement,
      opticPeak,
      reached,
      motorOK,
      sensoryOK,
      seeOK: sensoryOK,
      taskOK,
      betterThanChance,
      encodeSaw,
      darkRetrieve,
    },
    failure,
    interesting,
    portable: {
      steering: { forward: samples.at(-1)?.walk ?? 0, yawRate: samples.at(-1)?.turn ?? 0 },
      vision: { opticPeak, encodeSaw },
    },
    ticks: totalTicks,
    rotateAt: yawAt,
  };
}

/**
 * Chance calibration for dark-retrieve: intact network, landmark fixed, animal yawed,
 * retrieve in dark (no vision). Floor = random walk approach after reorientation.
 */
export function runChanceProbe(engine, poolMap, expandLesionOps, lesionSummary, opts = {}) {
  const D = {
    ...DISH,
    ...opts,
    darkTicks: 8,
    encodeTicks: 40,
    retrieveTicks: 60,
    darkRetrieve: true,
  };
  const lesionCfg = { id: "chance-probe", ops: [] };
  const ops = expandLesionOps(lesionCfg, poolMap);
  engine.reset();
  engine.applyLesion(ops);
  bindDishChannels(engine, poolMap);
  const target = makeTarget(D);
  const spawn = makeSpawn(D);
  let x = spawn.x, z = spawn.z, heading = spawn.heading;
  let opticPeak = 0, displacement = 0, lx = x, lz = z;
  const samples = [];
  const total = D.encodeTicks + D.darkTicks + D.retrieveTicks;
  const yawAt = D.encodeTicks + D.darkTicks;
  for (let tick = 0; tick < total; tick++) {
    let lightsOn = tick < D.encodeTicks;
    if (tick === yawAt) heading += D.rotateRad;
    // Always dark after encode for chance floor (no reacquisition).
    if (tick >= D.encodeTicks) lightsOn = false;
    const eye = landmarkEye({ x, z, heading }, target, lightsOn, D);
    engine.setRates({
      visionL: eye.L, visionR: eye.R, vision: (eye.L + eye.R) * 0.5,
      HS_L: lightsOn ? 6 + eye.L * 0.45 : 0,
      HS_R: lightsOn ? 6 + eye.R * 0.45 : 0,
      HS: lightsOn ? 6 + eye.optic * 0.4 : 0,
      VS_L: lightsOn ? 5 + eye.loom * 15 : 0,
      VS_R: lightsOn ? 5 + eye.loom * 15 : 0,
      VS: lightsOn ? 5 + eye.loom * 18 : 0,
      foodORN: lightsOn ? 8 + eye.loom * 18 : 0,
    });
    for (let si = 0; si < D.stepsPerTick; si++) engine.step();
    const hz = engine.effectorHz(D.stepsPerTick);
    const legsL = soft(((hz.T1L || 0) + (hz.T2L || 0) + (hz.T3L || 0)) / 3);
    const legsR = soft(((hz.T1R || 0) + (hz.T2R || 0) + (hz.T3R || 0)) / 3);
    const legs = (legsL + legsR) / 2;
    const hsL = soft(hz.HS_L || 0), hsR = soft(hz.HS_R || 0);
    const opticRead = hsL + hsR + soft(hz.VS_L || 0) + soft(hz.VS_R || 0);
    if (opticRead > opticPeak) opticPeak = opticRead;
    const walk = Math.tanh(legs * 3.4 + (lightsOn ? opticRead * 0.4 : 0));
    const turn =
      Math.tanh((legsR - legsL) * 2.15) +
      Math.tanh((hsR - hsL) * 1.35) * (lightsOn ? 1 : 0.05);
    heading += turn * 1.15 * D.dtBody;
    const step = walk * 3.1 * D.dtBody;
    let nx = x + Math.sin(heading) * step;
    let nz = z + Math.cos(heading) * step;
    const push = wallPush(nx, nz, D);
    nx += push.ax * D.dtBody; nz += push.az * D.dtBody;
    const rr = Math.hypot(nx, nz);
    if (rr > D.arenaR) { nx *= D.arenaR / rr; nz *= D.arenaR / rr; }
    x = nx; z = nz;
    displacement += Math.hypot(x - lx, z - lz);
    lx = x; lz = z;
    samples.push({
      tick,
      dist: Math.hypot(target.x - x, target.z - z),
      legs,
      phase: tick < D.encodeTicks ? "encode" : tick < yawAt ? "dark" : "retrieve",
    });
  }
  const retr = samples.filter((s) => s.tick >= yawAt);
  const startPost = retr[0]?.dist ?? 5;
  const endPost = retr.at(-1)?.dist ?? 5;
  const approachFrac = startPost > 1e-3 ? Math.max(0, (startPost - endPost) / startPost) : 0;
  const enc = samples.filter((s) => s.phase === "encode");
  const encodeApproach = enc.length > 1
    ? Math.max(0, (enc[0].dist - enc.at(-1).dist) / (enc[0].dist + 1e-6))
    : 0;
  return {
    id: "chance-probe",
    lesionSummary: "chance-probe(dark-retrieve-after-yaw)",
    metrics: {
      approachFrac,
      postRotateApproach: approachFrac,
      encodeApproach,
      displacement,
      opticPeak,
      motorOK: displacement >= D.motorDispMin,
      sensoryOK: opticPeak >= D.sensoryOpticMin,
      darkRetrieve: true,
    },
    failure: null,
    interesting: false,
  };
}
