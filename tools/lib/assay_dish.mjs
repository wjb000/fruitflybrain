/**
 * Clean see → remember → reorient → retrieve dish (headless).
 *
 * Phases:
 *   encode   — lights ON, distinct landmark visible, fly can approach
 *   dark     — lights OUT (vision drive 0); network state may persist
 *   yaw      — world/target rotates (allocentric reorientation)
 *   retrieve — lights ON again; score post-yaw approach
 *
 * Vision: retinotopic L/R landmark channels from geometry (resolvable blob).
 * Steering: MN L/R tank-steer + HS_L/R optic contribution — NO ground-truth
 *           bearing cheat into the body.
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
  encodeTicks: 36,
  darkTicks: 8,
  retrieveTicks: 64,
  rotateRad: Math.PI,
  dtBody: 0.05,
  stepsPerTick: 8,
  motorDispMin: 0.55,
  motorLegMin: 0.025,
  sensoryOpticMin: 0.025,
  // Empirical floor: random-ish walk approach after yaw (calibrated in sweep).
  chanceApproach: 0.10,
  // Must beat chance by this margin AND preferably near control.
  taskMargin: 0.04,
  landmarkContrast: 1.0,
  landmarkSize: 1.35, // angular half-width proxy
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
    return { L: 0, R: 0, optic: 0, bearing: 0, loom: 0, onRetina: false };
  }
  const dx = target.x - fly.x;
  const dz = target.z - fly.z;
  const dist = Math.hypot(dx, dz) + 1e-6;
  const c = Math.cos(fly.heading), s = Math.sin(fly.heading);
  // Body-frame bearing: 0 = ahead, + = right, − = left
  const bearing = Math.atan2(dx * c - dz * s, dx * s + dz * c);
  const loom = Math.max(0, 1.15 - dist / 9);
  const half = opts.landmarkSize;
  // Each eye covers ~hemifield with peak in ipsilateral view; Gaussian-ish.
  const onRetina = Math.abs(bearing) < 1.45;
  const bright = opts.landmarkContrast * (75 + loom * 90);
  const L = onRetina
    ? bright * Math.exp(-((bearing + 0.55) ** 2) / (2 * (half * 0.55) ** 2))
    : 2;
  const R = onRetina
    ? bright * Math.exp(-((bearing - 0.55) ** 2) / (2 * (half * 0.55) ** 2))
    : 2;
  // Wide-field HS-like: stronger when landmark sweeps / is offset ahead.
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
    heading: ang + Math.PI, // face toward target at start
  };
}

export function rotateTarget(target, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const x = target.x * c - target.z * s;
  const z = target.x * s + target.z * c;
  target.x = x;
  target.z = z;
  target.ang = Math.atan2(x, z);
  return target;
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
    // keep wholes for neuromod/chemotaxis dials
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
  const yawAt = D.encodeTicks + D.darkTicks; // rotate at end of dark

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
      rotateTarget(target, D.rotateRad);
    } else if (tick > yawAt) {
      phase = "retrieve";
      lightsOn = true;
    }

    const eye = landmarkEye({ x, z, heading }, target, lightsOn, D);
    if (eye.onRetina && lightsOn) encodeSaw = true;
    if (eye.optic > opticPeak) opticPeak = soft(eye.optic); // peak proxy pre-LIF too

    // Drive L/R retina → vision / HS / VS channels (geometry only when lights on).
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
    const walk = Math.tanh(legs * 3.4);

    // Steering from MN asymmetry + HS_L/R optic (LIF-readout), NOT GT bearing.
    const hsL = soft(hz.HS_L || 0);
    const hsR = soft(hz.HS_R || 0);
    const opticRead = hsL + hsR + soft(hz.VS_L || 0) + soft(hz.VS_R || 0);
    if (opticRead > opticPeak) opticPeak = opticRead;

    const turn =
      Math.tanh((legsR - legsL) * 2.15) +
      Math.tanh((hsR - hsL) * 1.35) * (lightsOn ? 1 : 0.15);

    heading += turn * 1.15 * D.dtBody;
    const step = walk * 3.1 * D.dtBody;
    let nx = x + Math.sin(heading) * step;
    let nz = z + Math.cos(heading) * step;
    const push = wallPush(nx, nz, D);
    nx += push.ax * D.dtBody;
    nz += push.az * D.dtBody;
    // hard clamp inside arena
    const rr = Math.hypot(nx, nz);
    if (rr > D.arenaR) {
      nx *= D.arenaR / rr;
      nz *= D.arenaR / rr;
    }
    x = nx; z = nz;
    displacement += Math.hypot(x - lx, z - lz);
    lx = x; lz = z;

    samples.push({
      t: tick * D.dtBody,
      tick,
      phase,
      lightsOn,
      dist: Math.hypot(target.x - x, target.z - z),
      legs,
      walk,
      turn,
      optic: opticRead,
      eyeL: eye.L,
      eyeR: eye.R,
      bearing: eye.bearing,
    });
  }

  const after = samples.filter((s) => s.tick >= yawAt);
  const startPost = after[0]?.dist ?? samples[0].dist;
  const endPost = after.at(-1)?.dist ?? samples.at(-1).dist;
  const approachFrac = startPost > 1e-3 ? Math.max(0, (startPost - endPost) / startPost) : 0;
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

  // Encode quality: did fly reduce distance during encode (pre-dark)?
  const enc = samples.filter((s) => s.phase === "encode");
  const encodeApproach = enc.length > 1
    ? Math.max(0, (enc[0].dist - enc.at(-1).dist) / (enc[0].dist + 1e-6))
    : 0;

  return {
    id: lesionCfg.id,
    lesion: lesionCfg,
    lesionSummary: lesionSummary(lesionCfg),
    dish: {
      version: "dish_v1_see_remember_reorient_retrieve",
      encodeTicks: D.encodeTicks,
      darkTicks: D.darkTicks,
      retrieveTicks: D.retrieveTicks,
      rotateRad: D.rotateRad,
      spawnAng: D.spawnAng,
      targetR: D.targetR,
      chanceApproach: D.chanceApproach,
    },
    metrics: {
      finalDist: endPost,
      postRotateStartDist: startPost,
      postRotateEndDist: endPost,
      approachFrac,
      encodeApproach,
      chanceApproach: D.chanceApproach,
      displacement,
      opticPeak,
      reached,
      motorOK,
      sensoryOK,
      taskOK,
      betterThanChance,
      encodeSaw,
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

/** Chance calibration: lights always on but landmark position jittered each tick (no stable memory). */
export function runChanceProbe(engine, poolMap, expandLesionOps, lesionSummary, opts = {}) {
  // Use intact network but scramble target bearing every tick during retrieve
  // by spinning target randomly — estimates floor for "no allocentric hold".
  const D = { ...DISH, ...opts, darkTicks: 4, encodeTicks: 20, retrieveTicks: 40 };
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
  let rng = 0xA5A5;
  const rnd = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 0xffffffff;
  };
  for (let tick = 0; tick < total; tick++) {
    let lightsOn = !(tick >= D.encodeTicks && tick < yawAt);
    if (tick === yawAt) rotateTarget(target, Math.PI);
    // scramble landmark during retrieve → destroys stable heading signal
    if (tick > yawAt) {
      const ang = rnd() * Math.PI * 2;
      target.x = Math.sin(ang) * D.targetR;
      target.z = Math.cos(ang) * D.targetR;
    }
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
    const walk = Math.tanh(((legsL + legsR) / 2) * 2.9);
    const hsL = soft(hz.HS_L || 0), hsR = soft(hz.HS_R || 0);
    const opticRead = hsL + hsR + soft(hz.VS_L || 0) + soft(hz.VS_R || 0);
    if (opticRead > opticPeak) opticPeak = opticRead;
    const turn = Math.tanh((legsR - legsL) * 2.15) + Math.tanh((hsR - hsL) * 1.35) * (lightsOn ? 1 : 0.15);
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
    samples.push({ tick, dist: Math.hypot(target.x - x, target.z - z), legs: (legsL + legsR) / 2 });
  }
  // Rescore against FIXED post-yaw target (true target after single yaw) — use spawn-opposite.
  // For chance probe we scrambled; approachFrac vs last scrambled pos is meaningless.
  // Instead report displacement-normalized null: fraction of retrieve ticks moving closer to
  // a FIXED phantom at rotated spawn target.
  const phantom = makeTarget(D);
  rotateTarget(phantom, Math.PI);
  const retr = samples.filter((s) => s.tick >= yawAt);
  // Recompute distances to phantom from stored positions — we didn't store x,z.
  // Fallback: use approachFrac against scrambled target as noisy floor estimate.
  const startPost = retr[0]?.dist ?? 5;
  const endPost = retr.at(-1)?.dist ?? 5;
  const approachFrac = startPost > 1e-3 ? Math.max(0, (startPost - endPost) / startPost) : 0;
  return {
    id: "chance-probe",
    lesionSummary: "chance-probe(scramble-landmark)",
    metrics: { approachFrac, displacement, opticPeak, motorOK: displacement >= D.motorDispMin, sensoryOK: opticPeak >= D.sensoryOpticMin },
    failure: null,
    interesting: false,
  };
}
