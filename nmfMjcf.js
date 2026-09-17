/**
 * NeuroMechFly-compatible MJCF for the in-browser plant.
 *
 * Pages cannot ship flygym's exact XML (meshes, tendons, compiled NMF).
 * This builds a capsule/sphere tree from nmf.json rest poses with:
 *   - thorax free joint (gravity)
 *   - 42 leg hinges, NMF-like ranges (poseMap.NMF_JOINT_LIMIT)
 *   - neck 3-DoF, abdomen pitch (+ yaw on A1–2), wing pitch
 *   - tarsus sphere contacts + adhesion actuators
 *
 * Honest: this is NMF-compatible MuJoCo, not a byte-identical flygym MJCF.
 * Empty T2/T3 coxaProm / Ta* stay empty IDs — hinges may still exist.
 */
import {
  LEG_NAMES, nmfJointLimit,
  anatomicalLegAxes, NECK_SPAN, ABD_SEG_KEYS, ABD_YAW_SPAN,
  WING_FLAP_GATE, WING_FLAP_AMP, GROUND_Y,
} from "./poseMap.js?v=realfly3";

export const MUJOCO_CDN = "https://cdn.jsdelivr.net/npm/@mujoco/mujoco@3.11.0";
export const TIMESTEP = 0.0008;
export const GRAVITY_Y = -9810; // mm/s² (NMF millimetre world)
export const OUR_LEGS = LEG_NAMES;

const LEG_JOINTS = [
  { link: "coxa", key: "coxa-yaw", pos: "coxaAdd", neg: "coxaRem" },
  { link: "coxa", key: "coxa-pitch", pos: "coxaProm", neg: "coxaRem" },
  { link: "coxa", key: "coxa-roll", pos: "coxaRotA", neg: "coxaRotP" },
  { link: "trochanterfemur", key: "trochanterfemur-pitch", pos: "trExt", neg: "trFlex" },
  { link: "trochanterfemur", key: "trochanterfemur-roll", pos: "feRed", neg: null },
  { link: "tibia", key: "tibia-pitch", pos: "tiExt", neg: "tiFlex" },
  { link: "tarsus1", key: "tarsus1-pitch", pos: "taLev", neg: "taDep" },
];

export function qinv(q) {
  return [q[0], -q[1], -q[2], -q[3]];
}
export function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
export function qrot(q, v) {
  const uv = [0, v[0], v[1], v[2]];
  const r = qmul(qmul(q, uv), qinv(q));
  return [r[1], r[2], r[3]];
}
export function qaxis(axis, ang) {
  const h = 0.5 * ang;
  const s = Math.sin(h);
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [Math.cos(h), (axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s];
}
export function qnormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
function fmt(n) {
  return Number(n).toFixed(5).replace(/\.?0+$/, (m) => (m.startsWith(".") ? m : ""));
}
function fmt3(v) {
  return `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;
}
function fmt4(q) {
  return `${fmt(q[0])} ${fmt(q[1])} ${fmt(q[2])} ${fmt(q[3])}`;
}

function parentRel(parent, child) {
  if (!parent) {
    return { pos: child.restPos || [0, 0, 0], quat: child.restQuat || [1, 0, 0, 0] };
  }
  const pq = parent.restQuat || [1, 0, 0, 0];
  const pp = parent.restPos || [0, 0, 0];
  const cp = child.restPos || [0, 0, 0];
  const cq = child.restQuat || [1, 0, 0, 0];
  const inv = qinv(pq);
  const pos = qrot(inv, [cp[0] - pp[0], cp[1] - pp[1], cp[2] - pp[2]]);
  const quat = qnormalize(qmul(inv, cq));
  return { pos, quat };
}

function localAxis(seg, axisWorld) {
  const q = seg.restQuat || [1, 0, 0, 0];
  return qrot(qinv(q), axisWorld);
}

function densityFor(name) {
  if (name === "c_thorax") return 0.55;
  if (name.includes("tarsus")) return 0.22;
  if (name.includes("wing") || name.includes("haltere")) return 0.04;
  if (name.includes("abdomen") || name === "c_head") return 0.28;
  return 0.32;
}

function geomRadius(name, len) {
  if (name.includes("tarsus5")) return 0.045;
  if (name.includes("tarsus")) return 0.028;
  if (name.includes("wing")) return 0.012;
  if (name.includes("coxa")) return Math.min(0.09, Math.max(0.04, len * 0.22));
  return Math.min(0.08, Math.max(0.025, len * 0.16));
}

function antagonist(pos, neg) {
  const p = Number(pos || 0);
  const n = Number(neg || 0);
  const mag = p + n;
  if (mag < 0.02) return 0;
  const unipolar = (p < 0.045) !== (n < 0.045);
  const raw = (p - n) / (mag + 0.05);
  const d = Math.tanh(raw * 1.55);
  return d * (unipolar ? 0.52 : 1);
}

/**
 * Map MN command → hinge target (rad about anatomical rest = 0).
 * Same pairing as physics.py / poseMap. Empty pools stay 0.
 */
export function mnTarget(act, cmd) {
  if (act.kind === "adhesion") {
    const flyA = Number(cmd.fly || 0);
    if (flyA > 0.4) return 0;
    const m = (cmd.muscle && cmd.muscle[act.leg]) || {};
    const walk = Number(cmd.walk || 0);
    const lifting = (m.trFlex || 0) > (m.trExt || 0) + 0.18;
    const swinging = !!m._swing || (
      Math.abs((m.coxaProm || 0) - (m.coxaRem || 0)) > 0.28
      && ((m.coxaProm || 0) + (m.coxaRem || 0)) > 0.35
    );
    // Peel swing/lift feet — sticky swing was a vault + twitch-in-place source.
    // While walking, ease stance adhesion so WASM freejoint can accept FK slip.
    if (swinging) return 0.08;
    if (lifting) return 0.22;
    if (walk >= 0.05) return 0.55;
    return 1;
  }
  if (act.kind === "neck") {
    const yaw = Number(cmd.headYaw != null ? cmd.headYaw : cmd.neckYaw || 0);
    const pitch = Number(cmd.head != null ? cmd.head : cmd.neck || 0);
    const roll = Number(cmd.headRoll || 0);
    if (act.axis === "yaw") return NECK_SPAN.yaw * Math.max(-1, Math.min(1, yaw));
    if (act.axis === "pitch") return NECK_SPAN.pitch * Math.max(-1, Math.min(1, pitch));
    return NECK_SPAN.roll * Math.max(-1, Math.min(1, roll));
  }
  if (act.kind === "abdomen") {
    const curl = Number(cmd.abdomen || 0);
    const yaw = Number(cmd.abdomenYaw || 0);
    if (act.axis === "yaw") return ABD_YAW_SPAN * Math.max(-1, Math.min(1, yaw));
    const w = act.weight || 1;
    // Prefer soma-Y segment EMAs when agent sent abdSegs (same 207 IDs).
    const segs = cmd.abdSegs;
    let drive = curl;
    if (Array.isArray(segs) && act.segIndex != null && segs[act.segIndex] != null) {
      drive = Number(segs[act.segIndex]) || 0;
    }
    return -0.22 * w * Math.max(0, Math.min(1, drive));
  }
  if (act.kind === "wing") {
    const side = act.side || 1;
    const sk = side < 0 ? "L" : "R";
    const wing = cmd.wing || {};
    const dlm = Number(wing[`dlm${sk}`] ?? cmd.dlm ?? wing.dlm ?? 0);
    const dvm = Number(wing[`dvm${sk}`] ?? cmd.dvm ?? wing.dvm ?? 0);
    const admn = Number(wing[`admn${sk}`] ?? cmd.admn ?? wing.admn ?? 0);
    const power = Math.max(0, Math.min(1, 0.42 * dlm + 0.38 * dvm + 0.22 * admn));
    if (power < WING_FLAP_GATE) return 0;
    const t = Number(cmd.t || 0);
    return side * WING_FLAP_AMP * (power - WING_FLAP_GATE) * Math.sin(t * (10 + power * 140));
  }
  const m = (cmd.muscle && cmd.muscle[act.leg]) || {};
  let pos = m[act.pos] || 0;
  const neg = act.neg ? (m[act.neg] || 0) : 0;
  if (act.key === "trochanterfemur-pitch") pos = pos + 0.4 * (m.feRed || 0);
  const span = act.span || 0.4;
  return span * antagonist(pos, neg);
}

/**
 * Build MJCF XML + actuator table from nmf.json.
 */
export function buildNmfMjcf(nmf) {
  if (!nmf || !nmf.segments) throw new Error("nmf.json required");
  const segs = Object.fromEntries(nmf.segments.map((s) => [s.name, s]));
  const codes = nmf.legs || { L1: "lf", R1: "rf", L2: "lm", R2: "rm", L3: "lh", R3: "rh" };
  const standZ = nmf.standZ || 1.3;
  const children = {};
  for (const s of nmf.segments) {
    const p = s.parent || "__root";
    (children[p] = children[p] || []).push(s.name);
  }

  const actuators = [];
  const tarsi = [];
  const bodyNames = [];

  const jointsOn = {};
  for (const our of OUR_LEGS) {
    const code = codes[our];
    const coxa = segs[`${code}_coxa`];
    const femur = segs[`${code}_trochanterfemur`];
    const tibia = segs[`${code}_tibia`];
    const tarsus = segs[`${code}_tarsus1`];
    if (!coxa || !femur || !tibia || !tarsus) continue;
    const axes = anatomicalLegAxes(our.startsWith("L") ? -1 : 1, {
      coxa: coxa.restPos, femur: femur.restPos, tibia: tibia.restPos, tarsus: tarsus.restPos,
    });
    for (const j of LEG_JOINTS) {
      const body = `${code}_${j.link}`;
      const span = nmfJointLimit(our, j.key);
      const jname = `${code}_${j.key.replace(/-/g, "_")}`;
      (jointsOn[body] = jointsOn[body] || []).push({
        name: jname,
        axisWorld: axes[j.key],
        span,
      });
      actuators.push({
        kind: "leg",
        name: `pos_${jname}`,
        joint: jname,
        leg: our,
        link: j.link,
        key: j.key,
        pos: j.pos,
        neg: j.neg,
        span,
      });
    }
    tarsi.push({ our, body: `${code}_tarsus5`, adh: `adh_${code}` });
  }

  // Neck 3-DoF on c_head (browser plant — flygym locomotion NMF welds this).
  jointsOn.c_head = [
    { name: "head_yaw", axisWorld: [0, 1, 0], span: NECK_SPAN.yaw },
    { name: "head_pitch", axisWorld: [1, 0, 0], span: NECK_SPAN.pitch },
    { name: "head_roll", axisWorld: [0, 0, 1], span: NECK_SPAN.roll },
  ];
  for (const ax of ["yaw", "pitch", "roll"]) {
    actuators.push({
      kind: "neck", name: `pos_head_${ax}`, joint: `head_${ax}`, axis: ax,
    });
  }

  const abdNames = ["c_abdomen12", "c_abdomen3", "c_abdomen4", "c_abdomen5", "c_abdomen6"];
  abdNames.forEach((name, i) => {
    const span = 0.28 + i * 0.04;
    (jointsOn[name] = jointsOn[name] || []).push({
      name: `${name}_pitch`, axisWorld: [1, 0, 0], span,
    });
    actuators.push({
      kind: "abdomen", name: `pos_${name}_pitch`, joint: `${name}_pitch`,
      axis: "pitch", weight: [0.28, 0.48, 0.68, 0.86, 1][i], segIndex: i,
    });
  });
  (jointsOn.c_abdomen12 = jointsOn.c_abdomen12 || []).push({
    name: "c_abdomen12_yaw", axisWorld: [0, 1, 0], span: ABD_YAW_SPAN,
  });
  actuators.push({
    kind: "abdomen", name: "pos_c_abdomen12_yaw", joint: "c_abdomen12_yaw", axis: "yaw",
  });

  for (const [name, side] of [["l_wing", -1], ["r_wing", 1]]) {
    (jointsOn[name] = jointsOn[name] || []).push({
      name: `${name}_pitch`, axisWorld: [1, 0, 0], span: 0.55,
    });
    actuators.push({
      kind: "wing", name: `pos_${name}_pitch`, joint: `${name}_pitch`, side,
    });
  }

  for (const t of tarsi) {
    actuators.push({ kind: "adhesion", name: t.adh, body: t.body, leg: t.our });
  }

  const xml = [];
  const ind = (n) => "  ".repeat(n);

  function emitBody(name, depth, parentSeg) {
    const seg = segs[name];
    if (!seg) return;
    bodyNames.push(name);
    const rel = parentRel(parentSeg, seg);
    const kids = children[name] || [];
    let to = [0.08, 0, 0];
    if (kids.length) {
      const child = segs[kids[0]];
      if (child) {
        const cr = parentRel(seg, child);
        to = cr.pos;
      }
    }
    const len = Math.hypot(to[0], to[1], to[2]);
    const rad = geomRadius(name, len);
    const contact = name.endsWith("_tarsus5");
    const contype = contact ? 1 : 0;
    xml.push(`${ind(depth)}<body name="${name}" pos="${fmt3(rel.pos)}" quat="${fmt4(rel.quat)}">`);
    for (const j of (jointsOn[name] || [])) {
      const axis = localAxis(seg, j.axisWorld);
      const nrm = Math.hypot(axis[0], axis[1], axis[2]) || 1;
      const ax = [axis[0] / nrm, axis[1] / nrm, axis[2] / nrm];
      xml.push(
        `${ind(depth + 1)}<joint name="${j.name}" type="hinge" axis="${fmt3(ax)}" range="${fmt(-j.span)} ${fmt(j.span)}" damping="0.18" armature="0.002"/>`
      );
    }
    if (contact) {
      xml.push(
        `${ind(depth + 1)}<geom name="${name}_g" type="sphere" size="${fmt(rad)}" density="${densityFor(name)}" contype="1" conaffinity="1" friction="1.6 0.01 0.001" rgba="0.55 0.38 0.18 1"/>`
      );
    } else if (len > 0.03) {
      xml.push(
        `${ind(depth + 1)}<geom name="${name}_g" type="capsule" fromto="0 0 0 ${fmt3(to)}" size="${fmt(rad)}" density="${densityFor(name)}" contype="${contype}" conaffinity="${contype}" rgba="0.55 0.38 0.18 1"/>`
      );
    } else {
      xml.push(
        `${ind(depth + 1)}<geom name="${name}_g" type="sphere" size="${fmt(Math.max(rad, 0.04))}" density="${densityFor(name)}" contype="0" conaffinity="0" rgba="0.55 0.38 0.18 1"/>`
      );
    }
    for (const k of kids) emitBody(k, depth + 1, seg);
    xml.push(`${ind(depth)}</body>`);
  }

  xml.push(`<mujoco model="nmf-browser-animal">`);
  xml.push(`  <compiler angle="radian" autolimits="true"/>`);
  xml.push(`  <option timestep="${TIMESTEP}" gravity="0 ${GRAVITY_Y} 0" iterations="24" solver="Newton" integrator="Euler" cone="pyramidal"/>`);
  xml.push(`  <default>`);
  xml.push(`    <joint limited="true" damping="0.16" armature="0.002"/>`);
  xml.push(`    <geom condim="3" friction="1.2 0.008 0.0008" solref="0.012 1" solimp="0.9 0.95 0.001"/>`);
  xml.push(`    <position kp="28" dampratio="1.05" ctrllimited="true"/>`);
  xml.push(`  </default>`);
  xml.push(`  <worldbody>`);
  xml.push(`    <geom name="floor" type="plane" size="40 40 0.15" pos="0 ${fmt(GROUND_Y)} 0" rgba="0.25 0.35 0.18 0" contype="1" conaffinity="1"/>`);
  xml.push(`    <body name="c_thorax" pos="0 ${fmt(standZ)} 0">`);
  xml.push(`      <freejoint name="root"/>`);
  xml.push(`      <geom name="c_thorax_g" type="ellipsoid" size="0.42 0.32 0.62" density="${densityFor("c_thorax")}" contype="0" conaffinity="0" rgba="0.5 0.34 0.14 1"/>`);
  bodyNames.push("c_thorax");
  for (const k of (children.c_thorax || [])) emitBody(k, 3, segs.c_thorax);
  xml.push(`    </body>`);
  xml.push(`  </worldbody>`);
  xml.push(`  <actuator>`);
  for (const a of actuators) {
    if (a.kind === "adhesion") {
      xml.push(`    <adhesion name="${a.name}" body="${a.body}" gain="18" ctrlrange="0 1"/>`);
    } else {
      const j = a.joint;
      const span = a.span != null ? a.span : (
        a.kind === "neck" ? NECK_SPAN[a.axis] :
        a.kind === "wing" ? 0.55 :
        a.axis === "yaw" ? ABD_YAW_SPAN : 0.35
      );
      xml.push(`    <position name="${a.name}" joint="${j}" kp="28" dampratio="1.05" ctrlrange="${fmt(-span)} ${fmt(span)}"/>`);
    }
  }
  xml.push(`  </actuator>`);
  xml.push(`</mujoco>`);

  return {
    xml: xml.join("\n"),
    actuators,
    tarsi,
    bodyNames,
    standZ,
    timestep: TIMESTEP,
    gravityY: GRAVITY_Y,
    nLegDoF: actuators.filter((a) => a.kind === "leg").length,
    nNeck: actuators.filter((a) => a.kind === "neck").length,
    nAbdomen: actuators.filter((a) => a.kind === "abdomen").length,
    nWing: actuators.filter((a) => a.kind === "wing").length,
    nAdhesion: actuators.filter((a) => a.kind === "adhesion").length,
    limits: {
      engine: "mujoco-wasm or browser-contact",
      note: "Capsule/sphere NMF tree from nmf.json; not byte-identical flygym MJCF. Antennae/halteres/mouth stay visual FK. Exact flygym range= needs the Python plant.",
    },
  };
}

export { antagonist, LEG_JOINTS, ABD_SEG_KEYS };
