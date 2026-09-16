import * as THREE from "three";
import {
  MUSCLE_SPAN, NECK_SPAN, MUSCLE_TAU, NECK_TAU, WING_TAU, FEED_TAU,
  WING_FLAP_GATE, WING_FLAP_AMP, ABD_SEG_WEIGHTS, ANTENNA_SPAN,
  antagonist, follow, isForeleg, slipWeight,
} from "./poseMap.js?v=dynw1";

const LEG_NAMES = ["L1", "R1", "L2", "R2", "L3", "R3"];
const GROUND_Y = 0.05;
const _foot = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _flapQ = new THREE.Quaternion();
const _fkQ = new THREE.Quaternion();
const _fkP = new THREE.Vector3();
const _fkPivot = new THREE.Vector3();

let nmf = null;
let nmfGeos = [];

function rgbToInt(c) {
  return ((c[0] * 255) << 16) | ((c[1] * 255) << 8) | (c[2] * 255);
}

function tintRgb(c, female) {
  if (!female) return c;
  return [
    c[0] * 0.42 + 1.0 * 0.58,
    c[1] * 0.42 + 0.43 * 0.58,
    c[2] * 0.42 + 0.71 * 0.58,
  ];
}

function parseNmfBin(buf) {
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== "NMF1") throw new Error("bad nmf.bin magic " + magic);
  const view = new DataView(buf);
  const n = view.getUint32(4, true);
  let off = 8;
  const geos = [];
  for (let i = 0; i < n; i++) {
    const nv = view.getUint32(off, true); off += 4;
    const nt = view.getUint32(off, true); off += 4;
    const pos = new Float32Array(buf, off, nv * 3); off += nv * 12;
    const idx = new Uint32Array(buf, off, nt * 3); off += nt * 12;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos.slice(), 3));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    geo.computeVertexNormals();
    geos.push(geo);
  }
  return geos;
}

export async function loadNmf() {
  if (nmf) return nmf;
  const [json, buf] = await Promise.all([
    fetch("data/nmf.json").then((r) => {
      if (!r.ok) throw new Error("nmf.json " + r.status);
      return r.json();
    }),
    fetch("data/nmf.bin").then((r) => {
      if (!r.ok) throw new Error("nmf.bin " + r.status);
      return r.arrayBuffer();
    }),
  ]);
  nmf = json;
  nmfGeos = parseNmfBin(buf);
  return nmf;
}

function makeMaterials(female) {
  const mats = {};
  const specs = (nmf && nmf.materials) || {};
  for (const [name, spec] of Object.entries(specs)) {
    const keep = name === "eye" || name === "wing";
    const col = keep ? spec.color : tintRgb(spec.color, female);
    const opacity = spec.opacity ?? 1;
    mats[name] = new THREE.MeshPhysicalMaterial({
      color: rgbToInt(col),
      roughness: spec.roughness ?? 0.55,
      metalness: name === "eye" ? 0.12 : 0.06,
      transparent: opacity < 0.99,
      opacity,
      side: name === "wing" ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: opacity > 0.8,
      emissive: name === "eye" ? 0xff5a38 : 0x000000,
      emissiveIntensity: name === "eye" ? 0.12 : 0,
    });
  }
  if (!mats.headthorax) {
    mats.headthorax = new THREE.MeshPhysicalMaterial({
      color: female ? 0xff6eb4 : 0x96632e,
      roughness: 0.55,
    });
  }
  return mats;
}

function setQuatWxyz(obj, wxyz) {
  obj.quaternion.set(wxyz[1], wxyz[2], wxyz[3], wxyz[0]);
}

function setHinge(h, angle) {
  h.userData.angle = angle;
  if (h.isObject3D) {
    _axis.copy(h.userData.axis);
    h.setRotationFromAxisAngle(_axis, angle);
  }
}

function makeVirtualHinge(axis) {
  return {
    isObject3D: false,
    userData: {
      axis: new THREE.Vector3(axis[0], axis[1], axis[2]),
      rest: 0,
      angle: 0,
    },
  };
}

/** Virtual antagonist hinges so kinematic mode can pose without a CPG clock. */
function wireLegHinges(leg) {
  leg.hinges["coxa-yaw"] = makeVirtualHinge([0, 1, 0]);
  leg.hinges["coxa-pitch"] = makeVirtualHinge([1, 0, 0]);
  leg.hinges["coxa-roll"] = makeVirtualHinge([0, 0, 1]);
  leg.hinges["trochanterfemur-pitch"] = makeVirtualHinge([1, 0, 0]);
  leg.hinges["trochanterfemur-roll"] = makeVirtualHinge([0, 0, 1]);
  leg.hinges["tibia-pitch"] = makeVirtualHinge([1, 0, 0]);
  leg.hinges["tarsus1-pitch"] = makeVirtualHinge([1, 0, 0]);
}

function applyRest(node, seg) {
  node.position.fromArray(seg.restPos || [0, 0, 0]);
  setQuatWxyz(node, seg.restQuat || [1, 0, 0, 0]);
  node.userData.restPos = node.position.clone();
  node.userData.restQuat = node.quaternion.clone();
  // Immutable anatomical rest for kinematic MN→FK (physics may rewrite restQuat).
  node.userData.anatomicalRestPos = node.position.clone();
  node.userData.anatomicalRestQuat = node.quaternion.clone();
}

function buildFly({ female = false } = {}) {
  if (!nmf) throw new Error("loadNmf() first");
  const fly = new THREE.Group();
  const visual = new THREE.Group();
  fly.add(visual);

  const mats = makeMaterials(female);
  const nodes = {};

  for (const seg of nmf.segments) {
    const body = new THREE.Group();
    body.name = seg.name;
    const mesh = new THREE.Mesh(nmfGeos[seg.mesh], mats[seg.material] || mats.headthorax);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = seg.name;
    body.add(mesh);
    applyRest(body, seg);
    visual.add(body);
    nodes[seg.name] = { body, seg, mesh };
  }

  const legs = [];
  const codes = nmf.legs || { L1: "lf", R1: "rf", L2: "lm", R2: "rm", L3: "lh", R3: "rh" };
  for (const name of LEG_NAMES) {
    const code = codes[name];
    const tarsus = nodes[`${code}_tarsus5`]?.body;
    const tip = new THREE.Object3D();
    if (tarsus) tarsus.add(tip);
    const leg = {
      name,
      side: name.startsWith("L") ? -1 : 1,
      code,
      tarsusTip: tip,
      hinges: {},
      angles: {},
      chain: [
        `${code}_coxa`,
        `${code}_trochanterfemur`,
        `${code}_tibia`,
        `${code}_tarsus1`,
        `${code}_tarsus2`,
        `${code}_tarsus3`,
        `${code}_tarsus4`,
        `${code}_tarsus5`,
      ],
      foot: { x: 0, y: 0, z: 0, stance: true, vx: 0, vy: 0, vz: 0 },
    };
    wireLegHinges(leg);
    legs.push(leg);
  }

  const antennae = [];
  for (const side of ["l", "r"]) {
    const ant = nodes[`${side}_pedicel`]?.body;
    const tipHost = nodes[`${side}_arista`]?.body || ant;
    if (ant) {
      const tip = new THREE.Object3D();
      if (tipHost) tipHost.add(tip);
      ant.userData.tip = tip;
      antennae.push(ant);
    }
  }

  const eyes = [nodes.l_eye?.mesh, nodes.r_eye?.mesh].filter(Boolean);
  const wings = [nodes.l_wing?.body, nodes.r_wing?.body].filter(Boolean);
  const bodyOf = (n) => nodes[n]?.body;
  const abdomenChain = [
    "c_abdomen12", "c_abdomen3", "c_abdomen4", "c_abdomen5", "c_abdomen6",
  ].map(bodyOf).filter(Boolean);
  const headChain = [
    "c_head", "l_eye", "r_eye",
    "l_pedicel", "l_funiculus", "l_arista",
    "r_pedicel", "r_funiculus", "r_arista",
    "c_rostrum", "c_haustellum",
  ].map(bodyOf).filter(Boolean);
  const antennaChains = {
    L: ["l_pedicel", "l_funiculus", "l_arista"].map(bodyOf).filter(Boolean),
    R: ["r_pedicel", "r_funiculus", "r_arista"].map(bodyOf).filter(Boolean),
  };
  const halteres = [bodyOf("l_haltere"), bodyOf("r_haltere")].filter(Boolean);

  fly.userData = {
    female,
    plantMode: "fly",
    body: visual,
    head: nodes.c_head?.body,
    thorax: nodes.c_thorax?.body,
    abdomen: nodes.c_abdomen12?.body,
    abdomenChain,
    headChain,
    antennaChains,
    halteres,
    wings,
    legs,
    eyes,
    antennae,
    proboscis: nodes.c_rostrum?.body,
    haustellum: nodes.c_haustellum?.body,
    gait: 0,
    hinges: {},
    nodes,
    standZ: nmf.standZ || 1.3,
  };
  return fly;
}

export function createMaleFly() { return buildFly({ female: false }); }
export function createFemaleFly() { return buildFly({ female: true }); }

/**
 * Apply hinge angle deltas onto flat thorax-relative NMF segments (FK).
 * Proximal rotations move all distal segments so tarsus tips track muscle pose.
 */
function applyMuscleFk(leg, nodes) {
  const names = (leg.chain || []).filter((n) => nodes[n]?.body);
  for (const n of names) {
    const body = nodes[n].body;
    const rp = body.userData.anatomicalRestPos || body.userData.restPos;
    const rq = body.userData.anatomicalRestQuat || body.userData.restQuat;
    if (rp) body.position.copy(rp);
    if (rq) body.quaternion.copy(rq);
  }
  const joints = [
    { key: "coxa-yaw", pivot: 0 },
    { key: "coxa-pitch", pivot: 0 },
    { key: "coxa-roll", pivot: 0 },
    { key: "trochanterfemur-pitch", pivot: 1 },
    { key: "trochanterfemur-roll", pivot: 1 },
    { key: "tibia-pitch", pivot: 2 },
    { key: "tarsus1-pitch", pivot: 3 },
  ];
  for (const j of joints) {
    const h = leg.hinges[j.key];
    if (!h) continue;
    const delta = (h.userData.angle ?? 0) - (h.userData.rest ?? 0);
    if (Math.abs(delta) < 1e-5) continue;
    const pivotBody = nodes[names[j.pivot]]?.body;
    if (!pivotBody) continue;
    rotateDistal(nodes, names, j.pivot, h.userData.axis, delta);
  }
  // Soft tarsus chain: tarsus2–5 follow tarsus1 with decaying pitch (mesh
  // kinematics from the one MN-driven tarsus hinge — not extra cell IDs).
  const ta = leg.hinges["tarsus1-pitch"];
  const taDelta = ta ? ((ta.userData.angle ?? 0) - (ta.userData.rest ?? 0)) : 0;
  if (Math.abs(taDelta) > 1e-4) {
    for (let k = 1; k <= 4; k++) {
      const pivot = 3 + k;
      if (pivot >= names.length) break;
      rotateDistal(nodes, names, pivot, ta.userData.axis, taDelta * (0.16 * k));
    }
  }
}

function rotateDistal(nodes, names, pivot, axis, delta) {
  const pivotBody = nodes[names[pivot]]?.body;
  if (!pivotBody || Math.abs(delta) < 1e-5) return;
  _fkPivot.copy(pivotBody.position);
  _fkQ.setFromAxisAngle(axis, delta);
  for (let i = pivot; i < names.length; i++) {
    const body = nodes[names[i]].body;
    _fkP.copy(body.position).sub(_fkPivot).applyQuaternion(_fkQ).add(_fkPivot);
    body.position.copy(_fkP);
    body.quaternion.premultiply(_fkQ);
  }
}

function resetAnatomical(body) {
  if (!body) return;
  const rp = body.userData.anatomicalRestPos || body.userData.restPos;
  const rq = body.userData.anatomicalRestQuat || body.userData.restQuat;
  if (rp) body.position.copy(rp);
  if (rq) body.quaternion.copy(rq);
}

function poseLegFromMuscle(leg, muscle, dt) {
  const m = muscle || {};
  // Forelegs already scaled in poseMap; still cap T1 hinge travel so "arms"
  // cannot throw up even if a small MN pool saturates.
  const t1k = isForeleg(leg.name) ? 0.72 : 1;
  for (const [key, spec] of Object.entries(MUSCLE_SPAN)) {
    const h = leg.hinges[key];
    if (!h) continue;
    let pos = m[spec[0]] || 0;
    const neg = spec[1] ? (m[spec[1]] || 0) : 0;
    const feAssist = isForeleg(leg.name) ? 0.22 : 0.45;
    if (key === "trochanterfemur-pitch") pos = pos + feAssist * (m.feRed || 0);
    const span = spec[2] * t1k;
    const raw = span * antagonist(pos, neg);
    const lim = span * 0.88;
    const tgt = h.userData.rest + Math.max(-lim, Math.min(lim, raw));
    const cur = h.userData.angle ?? h.userData.rest;
    setHinge(h, follow(cur, tgt, dt, MUSCLE_TAU));
  }
}

/**
 * Pose the NeuroMechFly skeleton from connectome motor neurons.
 * Gap-fill: kinematic hinges + stance-slip so Pages can walk without MuJoCo.
 * Body translation comes from MN foot motion, not cmd.walk, not a CPG.
 */
export function stepLife(fly, dt, t, cmd) {
  const d = fly.userData;
  const flyA = cmd.fly || 0;
  const feed = cmd.feed || 0;
  const muscle = cmd.muscle || {};
  d.gait = 0;

  fly.updateMatrixWorld(true);
  const prev = d.legs.map((leg) => {
    if (leg.tarsusTip) leg.tarsusTip.getWorldPosition(_foot);
    else _foot.set(0, 0, 0);
    return { x: _foot.x, y: _foot.y, z: _foot.z };
  });

  for (const leg of d.legs) {
    poseLegFromMuscle(leg, muscle[leg.name], dt);
    applyMuscleFk(leg, d.nodes);
  }

  fly.updateMatrixWorld(true);
  let slipX = 0, slipZ = 0, n = 0, yawL = 0, yawR = 0;
  const hy = fly.rotation.y;
  const cy = Math.cos(hy), sy = Math.sin(hy);
  const idt = 1 / Math.max(dt, 1e-4);
  // Stance vs world floor only — do not mark a swinging cluster as planted
  // (that turned idle MN twitch into XY/yaw seizure).
  const floorY = GROUND_Y + 0.18;
  d.legs.forEach((leg, i) => {
    if (leg.tarsusTip) leg.tarsusTip.getWorldPosition(_foot);
    else _foot.set(prev[i].x, prev[i].y, prev[i].z);
    const dx = _foot.x - prev[i].x;
    const dy = _foot.y - prev[i].y;
    const dz = _foot.z - prev[i].z;
    leg.foot.x = _foot.x;
    leg.foot.y = _foot.y;
    leg.foot.z = _foot.z;
    const mus = muscle[leg.name] || {};
    const swinging = !!mus._swing && flyA < 0.40;
    // Idle: all planted. Walk: unplant only legs whose flex/ext contrast is swing.
    leg.foot.stance = flyA < 0.40 && !swinging && _foot.y <= floorY + 0.04;
    leg.foot.vx = dx * idt;
    leg.foot.vy = dy * idt;
    leg.foot.vz = dz * idt;
    if (leg.foot.stance) {
      // Planted foot: body slips opposite the world foot displacement.
      // T2/T3 carry walk; T1 (foreleg) is reach/groom so it must not thrash XY.
      const w = slipWeight(leg.name);
      slipX -= dx * w;
      slipZ -= dz * w;
      n += w;
      const back = -(dx * sy + dz * cy) * w;
      if (leg.side < 0) yawL += back * 0.85;
      else yawR += back * 0.85;
    }
  });
  const meanAbs = n > 0 ? Math.hypot(slipX, slipZ) / n : 0;
  d.slip = { x: slipX, z: slipZ, n, yawL, yawR, meanAbs };
  // EMA for HUD / diagnostics (kinematic Pages path).
  d.slipMeanAbs = (d.slipMeanAbs || 0) * 0.85 + meanAbs * 0.15;
  poseSoftParts(d, dt, t, cmd, flyA, feed);
}

function applyPivotDelta(bodies, pivot, axis, delta) {
  if (!pivot || Math.abs(delta) < 1e-5) return;
  _fkPivot.copy(pivot.position);
  _fkQ.setFromAxisAngle(axis, delta);
  const start = bodies.indexOf(pivot);
  const from = start >= 0 ? start : 0;
  for (let i = from; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body) continue;
    _fkP.copy(body.position).sub(_fkPivot).applyQuaternion(_fkQ).add(_fkPivot);
    body.position.copy(_fkP);
    body.quaternion.premultiply(_fkQ);
  }
}

function poseSoftParts(d, dt, t, cmd, flyA, feed) {
  // Wings move ONLY from wing-MN drive (cmd.fly ← DLM/DVM/ADMN). Quiet MNs → rest pose.
  // No always-on idle flap / cosmetic CPG. Mesh pose only — body translation/lift
  // is gated separately in agent.js / physics.py (flight default OFF).
  const wing = cmd.wing || {};
  const dlm = wing.dlm != null ? wing.dlm : flyA;
  const dvm = wing.dvm != null ? wing.dvm : flyA;
  const admn = wing.admn != null ? wing.admn : flyA * 0.7;
  const powerRaw = Math.max(0, Math.min(1, 0.42 * dlm + 0.38 * dvm + 0.22 * admn));
  const power = powerRaw >= WING_FLAP_GATE ? powerRaw : 0;
  const over = power > 0 ? (power - WING_FLAP_GATE) / Math.max(1e-3, 1 - WING_FLAP_GATE) : 0;
  const flapHz = power > 0 ? 4 + over * 36 : 0;
  const flapAmp = over * WING_FLAP_AMP;
  const flap = flapHz > 0 ? Math.sin(t * flapHz) * flapAmp : 0;
  const tau = dt != null ? dt : 0.032;
  const wingSoft = d.wingSoft || (d.wingSoft = { amp: 0 });
  wingSoft.amp = follow(wingSoft.amp, flapAmp, tau, WING_TAU);
  for (let i = 0; i < d.wings.length; i++) {
    const w = d.wings[i];
    const rest = w.userData.restQuat;
    if (!rest) continue;
    const s = i === 0 ? -1 : 1;
    w.quaternion.copy(rest);
    // Below gate: exact rest (folded). No residual rotateZ that read as tapping.
    if (power > 0 && wingSoft.amp > 0.01) {
      _flapQ.setFromAxisAngle(_axis.set(1, 0, 0), flap * (0.20 + over * 0.25));
      w.quaternion.multiply(_flapQ);
      w.rotateZ(s * (over * 0.12 + admn * 0.04));
      w.rotateX((dlm - dvm) * 0.06 * s * over);
    }
  }
  // Halteres: rest when wings folded; beat with wing MNs only (same gate).
  const halt = d.halteres || [];
  for (let i = 0; i < halt.length; i++) {
    const h = halt[i];
    resetAnatomical(h);
    if (power > 0 && wingSoft.amp > 0.01) {
      const s = i === 0 ? -1 : 1;
      h.rotateX(flap * 0.55 * s);
    }
  }

  // Abdomen: multi-segment posture from abdomen MN pool (quiet unless driven).
  const abdChain = d.abdomenChain || (d.abdomen ? [d.abdomen] : []);
  for (const body of abdChain) resetAnatomical(body);
  const segs = cmd.abdSegs || [];
  const curlCmd = cmd.abdomen || 0;
  if (curlCmd > 0.01 || segs.some((v) => v > 0.01)) {
    for (let i = 0; i < abdChain.length; i++) {
      const w = segs[i] != null ? segs[i] : curlCmd * (ABD_SEG_WEIGHTS[i] ?? 1);
      const ang = -0.012 + w * 0.38;
      applyPivotDelta(abdChain, abdChain[i], _axis.set(1, 0, 0), ang);
    }
  }

  // Head + attached cuticle (eyes, antennae, mouth) follow neck MNs via FK.
  const headChain = d.headChain || [];
  for (const body of headChain) resetAnatomical(body);
  if (d.head) {
    const pose = d.headPose || (d.headPose = { yaw: 0, pitch: 0, roll: 0 });
    const yawT = THREE.MathUtils.clamp((cmd.headYaw || 0) * NECK_SPAN.yaw, -NECK_SPAN.yaw, NECK_SPAN.yaw);
    const mouthPitch = feed > 0.35 ? (feed - 0.35) * 0.08 : 0;
    const pitchT = THREE.MathUtils.clamp(
      (cmd.head || 0) * NECK_SPAN.pitch + mouthPitch,
      -NECK_SPAN.pitch, NECK_SPAN.pitch + 0.06
    );
    const rollT = THREE.MathUtils.clamp((cmd.headRoll || 0) * NECK_SPAN.roll, -NECK_SPAN.roll, NECK_SPAN.roll);
    pose.yaw = follow(pose.yaw, yawT, tau, NECK_TAU);
    pose.pitch = follow(pose.pitch, pitchT, tau, NECK_TAU);
    pose.roll = follow(pose.roll, rollT, tau, NECK_TAU);
    applyPivotDelta(headChain, d.head, _axis.set(0, 1, 0), pose.yaw);
    applyPivotDelta(headChain, d.head, _axis.set(1, 0, 0), pose.pitch);
    applyPivotDelta(headChain, d.head, _axis.set(0, 0, 1), pose.roll);
  }

  // Antennae: calm JO reflex on pedicel after head FK (no thrash).
  const antSoft = d.antSoft || (d.antSoft = { L: 0, R: 0 });
  antSoft.L = follow(antSoft.L, cmd.antennaL || 0, tau, NECK_TAU);
  antSoft.R = follow(antSoft.R, cmd.antennaR || 0, tau, NECK_TAU);
  const chains = d.antennaChains || {};
  for (const side of ["L", "R"]) {
    const chain = chains[side] || [];
    const ped = chain[0];
    if (!ped) continue;
    const a = (side === "L" ? antSoft.L : antSoft.R) * ANTENNA_SPAN;
    const sgn = side === "L" ? -1 : 1;
    applyPivotDelta(chain, ped, _axis.set(0, 1, 0), a * 0.55 * sgn);
    applyPivotDelta(chain, ped, _axis.set(1, 0, 0), a * 0.35);
  }

  const mouth = d.mouthSoft || (d.mouthSoft = { feed: 0 });
  const feedT = feed > 0.28 ? (feed - 0.28) / 0.72 : 0;
  mouth.feed = follow(mouth.feed, feedT, tau, FEED_TAU);
  if (d.proboscis) {
    d.proboscis.scale.set(1, 1 + mouth.feed * 0.32, 1);
    if (mouth.feed > 0.01) d.proboscis.rotateX(mouth.feed * 0.18);
  }
  if (d.haustellum && mouth.feed > 0.01) {
    d.haustellum.rotateX(mouth.feed * 0.12);
  }
  // Eye glow tracks MN/behavior cmds only (no fake activity).
  const glow = 0.08 + power * 0.25 + (cmd.walk || 0) * 0.2 + mouth.feed * 0.08 + (cmd.court || 0) * 0.18;
  for (const e of d.eyes) if (e.material) e.material.emissiveIntensity = glow;
}

/** Copy MuJoCo body poses onto the NeuroMechFly meshes. */
export function applyPhysicsPose(fly, pose, dt, t, cmd) {
  const d = fly.userData;
  const flyA = cmd.fly || 0;
  const feed = cmd.feed || 0;
  if (pose.bones) {
    for (const [name, b] of Object.entries(pose.bones)) {
      const node = d.nodes[name];
      if (!node || !b) continue;
      if (b.p) node.body.position.fromArray(b.p);
      if (b.q) setQuatWxyz(node.body, b.q);
      // Do NOT overwrite anatomicalRest* — that skewed kinematic re-entry and
      // left cuticle tips desynced from the plant thorax root.
    }
  }
  fly.updateMatrixWorld(true);
  for (const leg of d.legs) {
    if (leg.tarsusTip) leg.tarsusTip.getWorldPosition(_foot);
    leg.foot.x = _foot.x;
    leg.foot.y = _foot.y;
    leg.foot.z = _foot.z;
    leg.foot.stance = !!(pose.contact && pose.contact[leg.name]);
    leg.foot.vx = 0;
    leg.foot.vz = 0;
    leg.foot.vy = 0;
  }
  d.slip = { x: 0, z: 0, n: 0, yawL: 0, yawR: 0 };
  poseSoftParts(d, dt, t, cmd, flyA, feed);
}

export function wanderFemale(female, dt, t) {
  // Demo helper only — quiet MN pose (no scripted walk thruster).
  const r = 7.5;
  const w = 0.18;
  female.position.x = Math.cos(t * w) * r;
  female.position.z = Math.sin(t * w) * r * 0.7;
  female.position.y = female.userData.standZ || 1.3;
  female.rotation.y = t * w + Math.PI / 2;
  stepLife(female, dt, t, { mode: "rest", walk: 0, turn: 0, muscle: {} });
}

/** @deprecated Prefer createOpenWorld() from world/procgen.js — dish cage retired. */
export function createArena() {
  const g = new THREE.Group();
  const chk = document.createElement("canvas");
  chk.width = 512; chk.height = 512;
  const cx = chk.getContext("2d");
  const n = 16;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    cx.fillStyle = ((i + j) & 1) ? "#2a3140" : "#161920";
    cx.fillRect(i * 32, j * 32, 32, 32);
  }
  const floorMap = new THREE.CanvasTexture(chk);
  floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set(4, 4);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(18, 72),
    new THREE.MeshStandardMaterial({ map: floorMap, color: 0xc8d0dc, roughness: 0.92, metalness: 0.04 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(18, 0.18, 8, 80),
    new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.6 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18;
  g.add(ring);
  const grid = new THREE.GridHelper(36, 36, 0x2a3140, 0x222833);
  grid.position.y = 0.01;
  g.add(grid);

  function drop(color, emissive, x, z) {
    const grp = new THREE.Group();
    grp.position.set(x, 0.12, z);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 12),
      new THREE.MeshPhysicalMaterial({
        color, roughness: 0.15, metalness: 0.05,
        transparent: true, opacity: 0.85, emissive, emissiveIntensity: 0.25,
      })
    );
    mesh.scale.set(1, 0.55, 1);
    grp.add(mesh);
    const light = new THREE.PointLight(emissive, 1.1, 7);
    light.position.y = 0.4;
    grp.add(light);
    g.add(grp);
    return grp;
  }

  // Assay landmark: warm sugar drop + tall beacon the compound eye can resolve.
  const food = drop(0xffcc44, 0xff9900, 6.5, 4.2);
  food.traverse((o) => {
    if (o.isMesh && o.material && o.material.emissive) o.material.emissiveIntensity = 0.95;
    if (o.isLight) o.intensity = 2.2;
  });
  {
    const beacon = new THREE.Group();
    beacon.name = "assayBeacon";
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 1.9, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffaa22, emissive: 0xff7700, emissiveIntensity: 1.15, roughness: 0.45,
      })
    );
    pole.position.y = 1.15;
    pole.castShadow = true;
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 14, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffe066, emissive: 0xffaa00, emissiveIntensity: 1.7,
        roughness: 0.3, metalness: 0.05,
      })
    );
    ball.position.y = 2.2;
    ball.castShadow = true;
    const glow = new THREE.PointLight(0xffaa33, 2.4, 10);
    glow.position.y = 2.2;
    beacon.add(pole, ball, glow);
    food.add(beacon);
    food.userData.assayBeacon = beacon;
  }
  const bitter = drop(0x3d6b2e, 0x5a8f2a, -7.2, 5.8);
  const water = drop(0x4aa8ff, 0x3388ff, -5.5, -3.8);

  const perch = new THREE.Group();
  perch.position.set(4.8, 0, -7.4);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.82, metalness: 0.05 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3218, roughness: 0.85 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.15, 10), wood);
  pole.position.y = 1.08;
  pole.castShadow = true;
  perch.add(pole);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), woodDark);
  cap.position.y = 2.18;
  cap.castShadow = true;
  perch.add(cap);
  g.add(perch);
  perch.userData = { x: 4.8, z: -7.4, r: 0.22, h: 2.18 };

  g.userData = { food, water, bitter, perch };
  return g;
}
