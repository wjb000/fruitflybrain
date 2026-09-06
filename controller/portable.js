/**
 * Robot controller API — vision → steering from the male CNS connectome.
 *
 * Control law (no food-bearing cheat):
 *   compound eye salience (L/R)
 *     → optic / visionL/R sensory write-in (Hz)
 *       → LIF connectome (sim.worker)
 *         → descending + leg MN pool EMAs
 *           → cmd.walk / cmd.turn (agent.js)
 *             → steering.forward / yawRate
 *               → chassisSetpoints → { v, omega } for a robot or cube plant
 *
 * A real robot consumes `chassisSetpoints()` (or `stubRobotDriver()`):
 *   v     — forward speed (m/s-ish units in sim; map to your drive train)
 *   omega — yaw rate (rad/s-ish); positive = turn right in body frame
 * Do NOT invent a "point at food" thruster — if MNs are quiet, v/omega stay near 0.
 *
 * Browser helpers: window.ffbPortable.snapshot() / .stub()
 */

/**
 * Build a robot-facing snapshot from an EmbodiedFly (or compatible object).
 */
export function portableControls(fly) {
  const e = fly?.motEma || {};
  const cmd = fly?.cmd || {};
  const eye = fly?.eye;
  const sal = fly?.lastVisionSal || eye?.lastSummary || {};
  const hsL = num(fly?.opticEma?.HS_L, e.HS);
  const hsR = num(fly?.opticEma?.HS_R, e.HS);
  const vsL = num(fly?.opticEma?.VS_L, e.VS);
  const vsR = num(fly?.opticEma?.VS_R, e.VS);
  const legsL = mean([e.T1L, e.T2L, e.T3L]);
  const legsR = mean([e.T1R, e.T2R, e.T3R]);
  // Prefer agent cmd (already MN→softDrive from T1–T3 + DNa); fall back to pools.
  const walk = clamp01(cmd.walk ?? soft(legsL * 0.5 + legsR * 0.5));
  const turn = clamp(cmd.turn ?? Math.tanh((legsR - legsL) * 2), -1, 1);
  const dna = e.DNa || 0;
  const dnp = e.DNp || 0;
  const dng = e.DNg02 || 0;
  // Chassis commands = MN-derived walk/turn only (no vision bypass).
  const forward = walk;
  const yawRate = turn;
  const salFoodL = num(sal.salFoodL, 0);
  const salFoodR = num(sal.salFoodR, 0);
  const salTarget = num(sal.salTarget, 0.5 * (salFoodL + salFoodR));
  const asymFood = num(sal.asymFood, salFoodR - salFoodL);
  return {
    t: fly?.clock ?? 0,
    heading: fly?.heading ?? 0,
    position: {
      x: fly?.body?.position?.x ?? 0,
      y: fly?.y ?? fly?.body?.position?.y ?? 0,
      z: fly?.body?.position?.z ?? 0,
    },
    vision: {
      HS_L: hsL,
      HS_R: hsR,
      VS_L: vsL,
      VS_R: vsR,
      opticMean: mean([hsL, hsR, vsL, vsR, e.T4a, e.T5a]),
      salFoodL,
      salFoodR,
      salTarget,
      asymFood,
      eyeHint: eye
        ? { ready: true, sectors: eye.lastSummary || null }
        : { ready: false },
    },
    descending: {
      DNa: dna,
      DNp: dnp,
      DNp01: e.DNp01 || 0,
      DNg02: dng,
    },
    motor: {
      walk,
      turn,
      fly: clamp01(cmd.fly || 0),
      legsL,
      legsR,
      wing: {
        dlm: cmd.wing?.dlm ?? e.DLM ?? 0,
        dvm: cmd.wing?.dvm ?? e.DVM ?? 0,
        admn: cmd.wing?.admn ?? e.ADMN ?? 0,
      },
    },
    steering: {
      forward,
      yawRate,
      mode: fly?.life?.mode || "rest",
    },
    neuromod: {
      hunger: fly?.life?.hunger ?? 0,
      arousal: fly?.life?.arousal ?? 0,
      OA: e.OA || 0,
      DAN: e.DAN || 0,
    },
  };
}

/**
 * Stub robot driver — maps portable steering → chassis velocities.
 * Conservative gains for hardware experiments; cube plant uses higher gains
 * via chassisSetpoints(..., { vGain, yawGain }) in agent.stepCubeChassis.
 */
export function stubRobotDriver(controls) {
  return chassisSetpoints(controls, { vGain: 0.15, yawGain: 0.9 });
}

/**
 * Map MN-derived steering → kinematic chassis velocities.
 * Gains are readability / hardware scale only; source is always portableControls.
 *
 * Real robot how-to:
 *   1. Each tick: snap = portableControls(fly)  // or ffbPortable.snapshot()
 *   2. set = chassisSetpoints(snap)             // or stubRobotDriver(snap)
 *   3. apply set.v to differential-drive base; set.omega to yaw
 *   4. If you silence optic pools (e.g. silence:HS), expect weaker yaw toward beacons
 */
export function chassisSetpoints(controls, { vGain = 3.8, yawGain = 4.2 } = {}) {
  const c = controls || {};
  const forward = c.steering?.forward ?? 0;
  const yawRate = c.steering?.yawRate ?? 0;
  return {
    forward,
    yawRate,
    v: forward * vGain,
    omega: yawRate * yawGain,
    salTarget: c.vision?.salTarget ?? 0,
    asymFood: c.vision?.asymFood ?? 0,
    source: "fruitflybrain.portable",
    t: c.t ?? 0,
  };
}

export const PORTABLE_SIGNAL_DOC = {
  "vision.HS_L/R": "Horizontal system pool rates (L/R) from eye write-in → LIF",
  "vision.VS_L/R": "Vertical system pool rates (L/R)",
  "vision.salTarget / asymFood": "Compound-eye food/beacon salience (diagnostic; not a thruster)",
  "descending.*": "Descending neuron pool EMAs",
  "motor.walk/turn/fly": "MN-derived body labels (not free-joint thrusters)",
  "steering.forward/yawRate": "Clean chassis commands for a robot driver (−1…1 yaw)",
  "neuromod.hunger/OA/DAN": "Slow state / modulator dials",
  "chassis.v / omega": "stubRobotDriver / chassisSetpoints output for hardware",
};

export const ROBOT_HOWTO = `
Robot controller (connectome-only)
==================================
Pipeline: eye → optic/visionL/R Hz → LIF → leg/descending MNs → cmd.walk/turn
          → steering.forward/yawRate → { v, omega }

Browser:
  const snap = ffbPortable.snapshot();
  const drive = ffbPortable.stub(); // { v, omega, forward, yawRate, salTarget }

Hardware:
  Publish drive.v / drive.omega to your base (differential drive / holonomic).
  Quiet MNs ⇒ near-zero command. Do not add a bearing-to-target PID that
  bypasses the brain.

Sanity: silence:HS or silence optic pools should weaken beacon-directed yaw.
Default embodiment: cube chassis (?body=cube). Cache-bust ?v=robot1.
`.trim();

function num(a, b) {
  if (a != null && Number.isFinite(a)) return a;
  return b || 0;
}
function mean(arr) {
  let s = 0, n = 0;
  for (const v of arr) {
    if (v == null) continue;
    s += v;
    n++;
  }
  return n ? s / n : 0;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v || 0));
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function soft(v) {
  return Math.tanh(Math.max(0, v || 0) * 2.8);
}
