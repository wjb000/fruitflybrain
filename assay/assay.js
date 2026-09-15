/**
 * Visual approach assay v2 — see → remember → dark/reorient → dark-retrieve.
 *
 * Phases:
 *   encode   — lights ON, landmark visible; fly may approach/fix
 *   dark     — lights OUT; landmark hidden
 *   yaw      — reorient the ANIMAL (heading += π); landmark stays fixed
 *   retrieve — lights stay OUT / landmark hidden; success requires memory
 *
 * Scores distinguish:
 *   - blindness (optic pools never respond during encode)
 *   - motor failure (leg MNs / displacement dead)
 *   - memory_heading (senses + walks but post-yaw dark approach ≤ chance) ← interesting
 *
 * North star: tiny thought, not a twitch. Lesions on LIF path only.
 * MN-only body; no thrusters.
 */

import { lesionSummary, normalizeLesion } from "../lesion.js";
import { portableControls } from "../controller/portable.js";

export const ASSAY_DEFAULTS = {
  durationSec: 32,
  encodeSec: 12,
  darkSec: 3,
  rotateRad: Math.PI,
  targetR: 6.5,
  spawnR: 2.2,
  spawnAng: Math.PI * 0.35, // stable across trials
  approachRadius: 2.2,
  motorDispMin: 0.9,
  motorLegMin: 0.03,
  sensoryOpticMin: 0.03,
  chanceApproach: 0.08,
  taskMargin: 0.04,
  darkRetrieve: true,
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
  }
  return { x, z, angle, r };
}

export function ensureAssayLandmark(arena) {
  return arena?.userData?.food?.userData?.assayBeacon || null;
}

/** Hide/show landmark for dark-retrieve (no visual reacquisition). */
export function setLandmarkVisible(arena, visible) {
  const food = arena?.userData?.food;
  if (!food) return;
  food.visible = !!visible;
  const beacon = food.userData?.assayBeacon;
  if (beacon) beacon.visible = !!visible;
}

export function setAssayLights(keyLight, ambient, lightsOn, opts = {}) {
  if (keyLight) {
    if (keyLight.userData._assayBaseInt == null) keyLight.userData._assayBaseInt = keyLight.intensity;
    keyLight.intensity = lightsOn ? (keyLight.userData._assayBaseInt || 1.2) : 0.05;
  }
  if (ambient) {
    if (ambient.userData._assayBaseInt == null) ambient.userData._assayBaseInt = ambient.intensity;
    ambient.intensity = lightsOn ? (ambient.userData._assayBaseInt || 0.45) : 0.02;
  }
  return lightsOn ? 1 : 0.04;
}

/**
 * Reorient the animal in place. Landmark stays fixed (allocentric place unchanged).
 * Old target-rotate path inflated post-yaw scores when fly sat between spawn and food.
 */
export function yawAnimal(fly, rad) {
  if (!fly) return;
  fly.heading = (fly.heading || 0) + rad;
  if (fly.body?.rotation) fly.body.rotation.y = fly.heading;
  // Keep MuJoCo plant in sync if present.
  if (typeof fly.syncPhysicsYaw === "function") fly.syncPhysicsYaw();
  else if (fly.physId && fly.body?.position) {
    // best-effort: resetPose preserves x,z
    if (typeof fly.resetPose === "function") {
      fly.resetPose(fly.body.position.x, fly.body.position.z, fly.heading);
    }
  }
  return fly;
}

/** @deprecated use yawAnimal — target rotate was visual-reacquisition biased */
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
 * Live trial: encode (lights on) → dark → yaw animal → retrieve (DARK).
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
    setLandmarkVisible(this.arena, true);
    setAssayLights(this.keyLight, this.ambient, true);
    this._dayOverride = 1;
    if (this.fly?.resetPose) {
      const sx = -Math.sin(ang) * this.opts.spawnR;
      const sz = -Math.cos(ang) * this.opts.spawnR;
      // Face toward landmark (heading=ang); yaw phase will add π.
      this.fly.resetPose(sx, sz, ang);
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
    setLandmarkVisible(this.arena, true);
    setAssayLights(this.keyLight, this.ambient, true);
    this._dayOverride = null;
    if (this.fly?.day != null) this.fly.day = 1;
  }

  tick(dt) {
    if (!this.active || !this.fly) return null;
    this.t += dt;
    const o = this.opts;
    const darkAt = o.encodeSec;
    const yawAt = o.encodeSec + o.darkSec;
    const fly = this.fly;
    const darkRetrieve = o.darkRetrieve !== false;

    // Phase machine
    if (this.phase === "encode" && this.t >= darkAt) {
      this.phase = "dark";
      setAssayLights(this.keyLight, this.ambient, false);
      setLandmarkVisible(this.arena, false);
      this._dayOverride = 0.04;
      if (fly.day != null) fly.day = 0.04;
    }
    if (!this.rotated && this.t >= yawAt) {
      this.preRotateDist = distToTarget(fly, this.target);
      // Reorient animal; landmark stays put (no target jump artifact).
      yawAnimal(fly, o.rotateRad);
      this.rotated = true;
      this.phase = "retrieve";
      // DARK retrieve — no lights, landmark stays hidden.
      if (darkRetrieve) {
        setAssayLights(this.keyLight, this.ambient, false);
        setLandmarkVisible(this.arena, false);
        this._dayOverride = 0.04;
        if (fly.day != null) fly.day = 0.04;
      } else {
        setAssayLights(this.keyLight, this.ambient, true);
        setLandmarkVisible(this.arena, true);
        this._dayOverride = 1;
        if (fly.day != null) fly.day = 1;
      }
      this.postRotateDist = distToTarget(fly, this.target);
    }

    // Keep day override applied during assay (app.js may fight it).
    if (this._dayOverride != null && fly.day != null) fly.day = this._dayOverride;

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
      lightsOn: this.phase === "encode",
    });

    if (this.t >= o.durationSec) {
      this.result = this.score();
      this.active = false;
      this.phase = "done";
      setLandmarkVisible(this.arena, true);
      setAssayLights(this.keyLight, this.ambient, true);
      if (fly.day != null) fly.day = 1;
      this._dayOverride = null;
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
    const postRotateApproach = approachFrac;
    const enc = this.samples.filter((s) => s.phase === "encode");
    const encodeApproach = enc.length > 1
      ? Math.max(0, (enc[0].dist - enc[enc.length - 1].dist) / (enc[0].dist + 1e-6))
      : 0;
    const encodeLocked = encodeApproach > 0.05;
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
      yawMode: "animal_heading",
      darkRetrieve: o.darkRetrieve !== false,
      target: { ...this.target },
      metrics: {
        finalDist: final.dist,
        preRotateDist: this.preRotateDist,
        postRotateStartDist: startPost,
        postRotateEndDist: endPost,
        approachFrac,
        postRotateApproach,
        encodeApproach,
        encodeLocked,
        chanceApproach: o.chanceApproach,
        displacement: this.displacement,
        opticPeak: this.opticPeak,
        reached,
        motorOK,
        sensoryOK,
        seeOK: sensoryOK,
        taskOK,
        betterThanChance,
        encodeSaw: this.encodeSaw,
        darkRetrieve: o.darkRetrieve !== false,
      },
      failure,
      interesting,
      portable: {
        steering: ctrl.steering,
        vision: ctrl.vision,
        descending: ctrl.descending,
      },
      nSamples: this.samples.length,
      dish: "browser_assay_v2_dark_retrieve",
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
