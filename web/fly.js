import * as THREE from "three";

const LEG_NAMES = ["L1", "R1", "L2", "R2", "L3", "R3"];
const MUSCLE_SPAN = {
  // Moderate spans: body follows MNs without extreme thrashing.
  "coxa-pitch": ["coxaProm", "coxaRem", 0.95],
  "coxa-yaw": ["coxaAdd", "coxaRem", 0.70],
  "coxa-roll": ["coxaRotA", "coxaRotP", 0.65],
  "trochanterfemur-pitch": ["trExt", "trFlex", 1.05],
  "trochanterfemur-roll": ["feRed", null, 0.42],
  "tibia-pitch": ["tiExt", "tiFlex", 0.90],
  "tarsus1-pitch": ["taLev", "taDep", 0.55],
};
const GROUND_Y = 0.05;
const MUSCLE_TAU = 0.05;
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

  fly.userData = {
    female,
    body: visual,
    head: nodes.c_head?.body,
    thorax: nodes.c_thorax?.body,
    abdomen: nodes.c_abdomen12?.body,
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
    _fkPivot.copy(pivotBody.position);
    _fkQ.setFromAxisAngle(h.userData.axis, delta);
    for (let i = j.pivot; i < names.length; i++) {
      const body = nodes[names[i]].body;
      _fkP.copy(body.position).sub(_fkPivot).applyQuaternion(_fkQ).add(_fkPivot);
      body.position.copy(_fkP);
      body.quaternion.premultiply(_fkQ);
    }
  }
}

function antagonist(pos, neg) {
  const p = pos || 0, n = neg || 0;
  const mag = p + n;
  // Quiet pools stay limp (Dan bar). Modest real asymmetries get sharpened
  // so flex/ext contrast from connectome rates can step without a CPG.
  if (mag < 0.01) return 0;
  const raw = (p - n) / (mag + 0.045);
  return Math.tanh(raw * 2.55);
}

function follow(cur, target, dt) {
  const a = 1 - Math.exp(-dt / MUSCLE_TAU);
  return cur + (target - cur) * a;
}

function poseLegFromMuscle(leg, muscle, dt) {
  const m = muscle || {};
  for (const [key, spec] of Object.entries(MUSCLE_SPAN)) {
    const h = leg.hinges[key];
    if (!h) continue;
    let pos = m[spec[0]] || 0;
    const neg = spec[1] ? (m[spec[1]] || 0) : 0;
    if (key === "trochanterfemur-pitch") pos = pos + 0.6 * (m.feRed || 0);
    const tgt = h.userData.rest + spec[2] * antagonist(pos, neg);
    const cur = h.userData.angle ?? h.userData.rest;
    setHinge(h, follow(cur, tgt, dt));
  }
}

/**
 * Pose the NeuroMechFly skeleton from connectome motor neurons.
 * cmd: {walk, turn, fly, feed, court, groom, escape, rest, head, abdomen, muscle}
 * Body translation comes from stance slip (MN foot motion), not cmd.walk.
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
  d.legs.forEach((leg, i) => {
    if (leg.tarsusTip) leg.tarsusTip.getWorldPosition(_foot);
    else _foot.set(prev[i].x, prev[i].y, prev[i].z);
    const dx = _foot.x - prev[i].x;
    const dy = _foot.y - prev[i].y;
    const dz = _foot.z - prev[i].z;
    leg.foot.x = _foot.x;
    leg.foot.y = _foot.y;
    leg.foot.z = _foot.z;
    leg.foot.stance = flyA < 0.28 && _foot.y < GROUND_Y + 0.18;
    leg.foot.vx = dx * idt;
    leg.foot.vy = dy * idt;
    leg.foot.vz = dz * idt;
    if (leg.foot.stance) {
      // Planted foot: body slips opposite the world foot displacement.
      slipX -= dx;
      slipZ -= dz;
      n += 1;
      // Tank-steer from body-longitudinal foot slip (rearward push drives that side).
      const back = -(dx * sy + dz * cy);
      if (leg.side < 0) yawL += back * 0.85;
      else yawR += back * 0.85;
    }
  });
  d.slip = { x: slipX, z: slipZ, n, yawL, yawR };
  poseSoftParts(d, t, cmd, flyA, feed);
}

function poseSoftParts(d, t, cmd, flyA, feed) {
  // Wings move ONLY from wing-MN drive (cmd.fly ← DLM/DVM/ADMN). Quiet MNs → rest pose.
  // No always-on idle flap / cosmetic CPG.
  const wing = cmd.wing || {};
  const dlm = wing.dlm != null ? wing.dlm : flyA;
  const dvm = wing.dvm != null ? wing.dvm : flyA;
  const admn = wing.admn != null ? wing.admn : flyA * 0.7;
  const power = Math.max(0, Math.min(1, 0.45 * dlm + 0.4 * dvm + 0.25 * admn));
  const flapHz = power > 0.02 ? 12 + power * 170 : 0;
  const flapAmp = power * 1.05; // zero when MNs quiet
  const flap = flapHz > 0 ? Math.sin(t * flapHz) * flapAmp : 0;
  for (let i = 0; i < d.wings.length; i++) {
    const w = d.wings[i];
    const rest = w.userData.restQuat;
    if (!rest) continue;
    const s = i === 0 ? -1 : 1;
    w.quaternion.copy(rest);
    if (power > 0.02) {
      _flapQ.setFromAxisAngle(_axis.set(1, 0, 0), flap * (0.35 + power * 0.55));
      w.quaternion.multiply(_flapQ);
      w.rotateZ(s * (0.02 + power * 0.28 + admn * 0.12));
      // Slight stroke asymmetry from DLM vs DVM (still MN-derived).
      w.rotateX((dlm - dvm) * 0.12 * s);
    }
  }
  if (d.abdomen) {
    const rest = d.abdomen.userData.restQuat;
    if (rest) {
      const curl = (cmd.abdomen || 0) * 0.72 + (cmd.court || 0) * 0.28;
      _flapQ.setFromAxisAngle(_axis.set(1, 0, 0), -0.02 + curl);
      d.abdomen.quaternion.copy(rest).multiply(_flapQ);
    }
  }
  if (d.head) {
    const rest = d.head.userData.restQuat;
    if (rest) {
      const hy = THREE.MathUtils.clamp((cmd.head || 0) * 0.95, -0.85, 0.85);
      d.head.quaternion.copy(rest);
      d.head.rotateY(hy);
      d.head.rotateX(feed * 0.55 - power * 0.2);
    }
  }
  if (d.proboscis) {
    const pe = 1 + feed * 0.85;
    d.proboscis.scale.set(1, pe, 1);
    d.proboscis.rotation.x = feed * 0.55;
  }
  if (d.haustellum) {
    d.haustellum.rotation.x = feed * 0.35;
  }
  // Eye glow tracks MN/behavior cmds only (no fake activity).
  const glow = 0.08 + power * 0.45 + (cmd.walk || 0) * 0.2 + feed * 0.15 + (cmd.court || 0) * 0.18;
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
      if (node.body.userData.restQuat) node.body.userData.restQuat.copy(node.body.quaternion);
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
  poseSoftParts(d, t, cmd, flyA, feed);
}

export function wanderFemale(female, dt, t) {
  const r = 7.5;
  const w = 0.18;
  female.position.x = Math.cos(t * w) * r;
  female.position.z = Math.sin(t * w) * r * 0.7;
  female.position.y = female.userData.standZ || 1.3;
  female.rotation.y = t * w + Math.PI / 2;
  stepLife(female, dt, t, { mode: "walk", walk: 0.35, turn: 0.15 });
}

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

  const food = drop(0xf0c040, 0xffaa22, 6.5, 4.2);
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
