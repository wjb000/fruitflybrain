/**
 * Visual approach assay — see → remember (lights out) → reorient → retrieve.
 *
 * Scores distinguish:
 *   - blindness (optic pools never respond during encode)
 *   - motor failure (leg MNs / displacement dead)
 *   - memory_heading (senses + walks but post-yaw approach ≤ chance) ← interesting
 *
 * North star: tiny thought, not a twitch. Lesions on LIF path only.
 * MN-only body; no thrusters.
 */

import { lesionSummary, normalizeLesion } from "../lesion.js";
import { portableControls } from "../controller/portable.js";

export const ASSAY_DEFAULTS = {
  durationSec: 22,
  encodeSec: 7,
  darkSec: 2.5,
  rotateRad: Math.PI,
  targetR: 6.5,
  spawnR: 2.2,
  spawnAng: Math.PI * 0.35, // stable across trials
  approachRadius: 2.2,
  motorDispMin: 0.9,
  motorLegMin: 0.03,
  sensoryOpticMin: 0.03,
  chanceApproach: 0.12,
  taskMargin: 0.04,
};

/**
 * Place a bright visual landmark the compound eye can resolve.
 * Uses arena food marker; boosts emissive for salience.
 */
export function placeVisualTarget(arena, odors, angle = ASSAY_DEFAULTS.spawnAng, r = ASSAY_DEFAULTS.targetR) {
  const x = Math.sin(angle) * r;
  const z = Math.cos(angle) * r;
  const food = arena?.userData?.food;
  if (food?.position) {
    food.position.set(x, food.position.y, z);
    // Punch visual salience for the assay landmark.
    food.traverse?.((o) => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      if (m.emissive) {
        if (m.userData._assayEmissive == null) {
          m.userData._assayEmissive = m.emissive.clone();
          m.userData._assayEmissiveIntensity = m.emissiveIntensity;
        }
        m.emissive.setHex(0xffcc44);
        m.emissiveIntensity = 1.35;
      }
    });
    // Tall beacon child so eyes resolve above floor clutter.
    if (!food.userData.assayBeacon && food.parent) {
      // beacon attached in ensureAssayLandmark
    }
  }
  return { x, z, angle, r };
}

export function ensureAssayLandmark(arena) {
  // Beacon is created in createArena(); this just repositions/refreshes salience.
  return arena?.userData?.food?.userData?.assayBeacon || null;
}

export function setAssayLights(keyLight, ambient, lightsOn, opts = {}) {
  const day = lightsOn ? 1 : 0.04;
  if (keyLight) {
    if (keyLight.userData._assayBaseInt == null) keyLight.userData._assayBaseInt = keyLight.intensity;
    keyLight.intensity = lightsOn ? (keyLight.userData._assayBaseInt || 1.2) : 0.05;
  }
  if (ambient) {
    if (ambient.userData._assayBaseInt == null) ambient.userData._assayBaseInt = ambient.intensity;
    ambient.intensity = lightsOn ? (ambient.userData._assayBaseInt || 0.45) : 0.02;
  }
  return day;
}

export function rotateWorld(arena, cameraKey, rad, target) {
  if (target) {
    const c = Math.cos(rad), s = Math.sin(rad);
    const x = target.x * c - target.z * s;
    const z = target.x * s + target.z * c;
    target.x = x;
    target.z = z;
    target.angle = Math.atan2(x, z);
    if (arena?.userData?.food?.position) {
      arena.userData.food.position.x = x;
      arena.userData.food.position.z = z;
    }
  }
  if (cameraKey?.position) {
    const c = Math.cos(rad), s = Math.sin(rad);
    const lx = cameraKey.position.x, lz = cameraKey.position.z;
    cameraKey.position.x = lx * c - lz * s;
    cameraKey.position.z = lx * s + lz * c;
  }
  return target;
}

export function distToTarget(fly, target) {
  const x = fly.body.position.x, z = fly.body.position.z;
  return Math.hypot(target.x - x, target.z - z);
}

export function bearingToTarget(fly, target) {
  const x = fly.body.position.x, z = fly.body.position.z;
  const dx = target.x - x, dz = target.z - z;
  const c = Math.cos(fly.heading), s = Math.sin(fly.heading);
  return Math.atan2(dx * c - dz * s, dx * s + dz * c);
}

/**
 * Live trial: encode (lights on) → dark → yaw → retrieve (lights on).
 */
export class ApproachAssay {
  constructor(opts = {}) {
    this.opts = { ...ASSAY_DEFAULTS, ...opts };
    this.active = false;
    this.phase = "idle";
    this.t = 0;
    this.target = null;
    this.rotated = false;
    this.samples = [];
    this.opticPeak = 0;
    this.encodeSaw = false;
    this.startPos = { x: 0, z: 0 };
    this.preRotateDist = null;
    this.postRotateDist = null;
    this.displacement = 0;
    this._lastPos = null;
    this.lesion = normalizeLesion(opts.lesion);
    this.result = null;
    this.onComplete = opts.onComplete || null;
    this.arena = opts.arena || null;
    this.keyLight = opts.keyLight || null;
    this.ambient = opts.ambient || null;
    this.fly = opts.fly || null;
    this._dayOverride = null;
  }

  start(fly, arena, keyLight, lesionCfg) {
    this.fly = fly || this.fly;
    this.arena = arena || this.arena;
    this.keyLight = keyLight || this.keyLight;
    if (lesionCfg) this.lesion = normalizeLesion(lesionCfg);
    this.active = true;
    this.phase = "encode";
    this.t = 0;
    this.rotated = false;
    this.samples = [];
    this.opticPeak = 0;
    this.encodeSaw = false;
    this.displacement = 0;
    this.result = null;
    const ang = this.opts.spawnAng;
    this.target = placeVisualTarget(this.arena, null, ang, this.opts.targetR);
    ensureAssayLandmark(this.arena);
    setAssayLights(this.keyLight, this.ambient, true);
    this._dayOverride = 1;
    if (this.fly?.resetPose) {
      const sx = -Math.sin(ang) * this.opts.spawnR;
      const sz = -Math.cos(ang) * this.opts.spawnR;
      this.fly.resetPose(sx, sz, ang + Math.PI);
    }
    this.startPos = {
      x: this.fly.body.position.x,
      z: this.fly.body.position.z,
    };
    this._lastPos = { ...this.startPos };
    this.preRotateDist = distToTarget(this.fly, this.target);
    this.postRotateDist = null;
    return this;
  }

  stop() {
    this.active = false;
    this.phase = "idle";
    setAssayLights(this.keyLight, this.ambient, true);
    this._dayOverride = null;
  }

  tick(dt) {
    if (!this.active || !this.fly) return null;
    this.t += dt;
    const o = this.opts;
    const darkAt = o.encodeSec;
    const yawAt = o.encodeSec + o.darkSec;
    const fly = this.fly;

    // Phase machine
    if (this.phase === "encode" && this.t >= darkAt) {
      this.phase = "dark";
      setAssayLights(this.keyLight, this.ambient, false);
      this._dayOverride = 0.04;
      // Force eye day dim via fly if exposed
      if (fly.day != null) fly.day = 0.04;
    }
    if (!this.rotated && this.t >= yawAt) {
      this.preRotateDist = distToTarget(fly, this.target);
      rotateWorld(this.arena, this.keyLight, o.rotateRad, this.target);
      this.rotated = true;
      this.phase = "retrieve";
      setAssayLights(this.keyLight, this.ambient, true);
      this._dayOverride = 1;
      if (fly.day != null) fly.day = 1;
      this.postRotateDist = distToTarget(fly, this.target);
    }

    const d = distToTarget(fly, this.target);
    const e = fly.motEma || {};
    const optic = mean([e.HS, e.VS, e.T4a, e.T5a, e.L1, e.R16]);
    if (optic > this.opticPeak) this.opticPeak = optic;
    if (this.phase === "encode" && optic >= o.sensoryOpticMin) this.encodeSaw = true;

    const px = fly.body.position.x, pz = fly.body.position.z;
    if (this._lastPos) {
      this.displacement += Math.hypot(px - this._lastPos.x, pz - this._lastPos.z);
    }
    this._lastPos = { x: px, z: pz };
    const legs = mean([e.T1L, e.T1R, e.T2L, e.T2R, e.T3L, e.T3R]);

    this.samples.push({
      t: this.t,
      phase: this.phase,
      dist: d,
      bearing: bearingToTarget(fly, this.target),
      optic,
      legs,
      walk: fly.cmd?.walk || 0,
      turn: fly.cmd?.turn || 0,
      x: px,
      z: pz,
      heading: fly.heading,
    });

    if (this.t >= o.durationSec) {
      this.result = this.score();
      this.active = false;
      this.phase = "done";
      setAssayLights(this.keyLight, this.ambient, true);
      if (this.onComplete) this.onComplete(this.result);
      return this.result;
    }
    return null;
  }

  score() {
    const o = this.opts;
    const final = this.samples.length
      ? this.samples[this.samples.length - 1]
      : { dist: 99 };
    const after = this.samples.filter((s) => s.t >= o.encodeSec + o.darkSec);
    const startPost = after[0]?.dist ?? this.postRotateDist ?? final.dist;
    const endPost = after.length ? after[after.length - 1].dist : final.dist;
    const approachFrac = startPost > 1e-3
      ? Math.max(0, (startPost - endPost) / startPost)
      : 0;
    const enc = this.samples.filter((s) => s.phase === "encode");
    const encodeApproach = enc.length > 1
      ? Math.max(0, (enc[0].dist - enc[enc.length - 1].dist) / (enc[0].dist + 1e-6))
      : 0;
    const reached = final.dist <= o.approachRadius;
    const motorOK =
      this.displacement >= o.motorDispMin ||
      (final.legs ?? 0) >= o.motorLegMin ||
      mean(after.map((s) => s.legs)) >= o.motorLegMin;
    const sensoryOK = this.opticPeak >= o.sensoryOpticMin && this.encodeSaw;
    const betterThanChance = approachFrac > o.chanceApproach + o.taskMargin || reached;
    const taskOK = betterThanChance;
    let failure = null;
    if (!sensoryOK) failure = "blindness";
    else if (!motorOK) failure = "motor";
    else if (!taskOK) failure = "memory_heading";
    const interesting = sensoryOK && motorOK && !taskOK;
    const ctrl = portableControls(this.fly);
    return {
      id: `assay-${Date.now().toString(36)}`,
      lesion: this.lesion,
      lesionSummary: lesionSummary(this.lesion),
      durationSec: this.t,
      encodeSec: o.encodeSec,
      darkSec: o.darkSec,
      rotateRad: o.rotateRad,
      target: { ...this.target },
      metrics: {
        finalDist: final.dist,
        preRotateDist: this.preRotateDist,
        postRotateStartDist: startPost,
        postRotateEndDist: endPost,
        approachFrac,
        encodeApproach,
        chanceApproach: o.chanceApproach,
        displacement: this.displacement,
        opticPeak: this.opticPeak,
        reached,
        motorOK,
        sensoryOK,
        taskOK,
        betterThanChance,
        encodeSaw: this.encodeSaw,
      },
      failure,
      interesting,
      portable: {
        steering: ctrl.steering,
        vision: ctrl.vision,
        descending: ctrl.descending,
      },
      nSamples: this.samples.length,
      dish: "browser_assay_v1_see_remember_reorient_retrieve",
    };
  }
}

function mean(arr) {
  let s = 0, n = 0;
  for (const v of arr) {
    if (v == null || Number.isNaN(v)) continue;
    s += v;
    n++;
  }
  return n ? s / n : 0;
}

export function rankInteresting(rows) {
  return [...rows].sort((a, b) => {
    const ia = a.interesting ? 1 : 0;
    const ib = b.interesting ? 1 : 0;
    if (ib !== ia) return ib - ia;
    return (a.metrics?.approachFrac ?? 0) - (b.metrics?.approachFrac ?? 0);
  });
}
