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
 *               → droneSetpoints  → { pitch, yaw, strafe, throttle } quadrotor
 *
 * A real robot consumes `chassisSetpoints()` (or `stubRobotDriver()`):
 *   v     — forward speed (m/s-ish units in sim; map to your drive train)
 *   omega — yaw rate (rad/s-ish); positive = turn right in body frame
 * A quadrotor consumes `droneSetpoints()`:
 *   pitch    — from portable forward (walk / DNa / T1–T3)
 *   yaw/omega — from yawRate (T1L vs T1R)
 *   strafe   — T2L/T2R (+ mild vision asym)
 *   throttle — hover ~1.45 + climb (DLM/DVM/ADMN + DNa)
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
  // Amplify yaw from MN imbalance; gate forward while |yaw| high (turn-then-approach).
  const yawRate = clamp(Math.tanh(turn * 1.55), -1, 1);
  const mis = Math.abs(yawRate);
  const align = Math.pow(Math.max(0, 1 - mis), 1.25);
  const forward = clamp01(walk * (0.18 + 0.82 * align));
  const salFoodL = num(sal.salFoodL, 0);
  const salFoodR = num(sal.salFoodR, 0);
  const salTarget = num(sal.salTarget, 0.5 * (salFoodL + salFoodR));
  const asymFood = num(sal.asymFood, salFoodR - salFoodL);
  // Drone extras (do not change cube forward/yawRate / beacon-chase gains):
  // T2 L/R imbalance → strafe; mild vision Δ as a hint only.
  const t2L = e.T2L || 0;
  const t2R = e.T2R || 0;
  const t2sum = t2L + t2R + 0.045;
  const strafe = clamp(Math.tanh(((t2R - t2L) / t2sum) * 1.85 + asymFood * 0.12), -1, 1);
  // Wing power MNs + DNa → climb above hover (throttle baseline applied in droneSetpoints).
  const wingMean = mean([cmd.wing?.dlm ?? e.DLM, cmd.wing?.dvm ?? e.DVM, cmd.wing?.admn ?? e.ADMN]);
  const climb = clamp(Math.tanh(wingMean * 1.55 + dna * 0.6 + clamp01(cmd.fly) * 0.45), -0.35, 1);
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
      strafe,
      climb,
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
  return chassisSetpoints(controls, { vGain: 0.12, yawGain: 1.35 });
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
export function chassisSetpoints(controls, { vGain = 2.35, yawGain = 9.4 } = {}) {
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

/**
 * Map portable MN steering → quadrotor axes (stim-map / drone chassis).
 * Does not change cube chassisSetpoints gains (beacon-chase path untouched).
 *
 *   walk / DNa / T1–T3  → steering.forward → pitch (+ forward v)
 *   turn (T1L vs T1R)   → steering.yawRate → yaw
 *   T2L/T2R (+ mild Δ)  → steering.strafe  → lateral
 *   DLM/DVM/ADMN + DNa  → steering.climb   → throttle above hover ~1.45
 */
export function droneSetpoints(controls, {
  pitchGain = 0.55,
  vGain = 2.35,
  yawGain = 9.4,
  strafeGain = 2.15,
  climbGain = 1.15,
  hoverThrottle = 1.45,
} = {}) {
  const c = controls || {};
  const forward = c.steering?.forward ?? 0;
  const yawRate = c.steering?.yawRate ?? 0;
  const strafe = c.steering?.strafe ?? 0;
  const climb = c.steering?.climb ?? 0;
  const pitch = clamp(forward * pitchGain, -0.85, 0.85);
  const v = forward * vGain;
  const omega = yawRate * yawGain;
  const vx = strafe * strafeGain;
  const vy = climb * climbGain;
  const throttle = hoverThrottle + climb * climbGain;
  return {
    forward,
    yawRate,
    pitch,
    yaw: yawRate,
    strafe,
    climb,
    v,
    omega,
    vx,
    vy,
    strafeV: vx,
    throttle,
    hoverThrottle,
    hoverZ: 1.45,
    salTarget: c.vision?.salTarget ?? 0,
    asymFood: c.vision?.asymFood ?? 0,
    source: "fruitflybrain.drone",
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
  "steering.strafe/climb": "Drone extras: T2 L/R strafe; wing MN + DNa climb",
  "neuromod.hunger/OA/DAN": "Slow state / modulator dials",
  "chassis.v / omega": "stubRobotDriver / chassisSetpoints output for hardware",
  "drone.pitch/yaw/throttle": "droneSetpoints: forward→pitch/v, yawRate→omega, T2→strafe/vx, wings→climb/vy, hover throttle ~1.45",
};

export const ROBOT_HOWTO = `
Robot controller (connectome-only)
==================================
Pipeline: eye → optic/visionL/R Hz → LIF → leg/descending MNs → cmd.walk/turn
          → steering.forward/yawRate → { v, omega }           (cube / robot)
          → droneSetpoints { pitch, v, omega, vx, vy, throttle }  (optional ?body=drone)

Browser:
  const snap = ffbPortable.snapshot();
  const drive = ffbPortable.stub();  // { v, omega, forward, yawRate, salTarget }
  const quad = ffbPortable.drone();  // { pitch, v, omega, vx, vy, throttle, … }

Hardware:
  Publish drive.v / drive.omega to your base (differential drive / holonomic),
  or quad.pitch / yaw / strafe / throttle to a quadrotor.
  Quiet MNs ⇒ near-zero command. Do not add a bearing-to-target PID that
  bypasses the brain.

Sanity: silence:HS or silence optic pools should weaken beacon-directed yaw.
Default embodiment: fly body (NeuroMechFly mesh + MN drive). Optional ?body=cube|drone.
Cache-bust ?v=cns2. Follow-me (optional): follow.html?v=follow1. hΔ lab: hdelta.html?v=lab1. Default home: fly utopia garden.
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
