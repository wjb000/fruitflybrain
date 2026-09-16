import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadNmf, createMaleFly } from "./fly.js?v=cns2";
import { createCubeChassis, createDroneChassis, bodyModeFromUrl, isKinematicChassis } from "./chassis.js?v=cns2";
import { createOpenWorld, UTOPIA_FOOD, UTOPIA_HOME } from "./world/procgen.js?v=cns2";
import { EmbodiedFly } from "./agent.js?v=cns2";
import { drawOmmatidia } from "./eye.js?v=cns2";
import { OdorWorld } from "./plume.js?v=cns2";
import { physics, connectPhysics, clearPhysics, flushPhysics } from "./physics.js?v=cns2";
import { parseLesionFlag } from "./lesion.js?v=cns2";
import { mountAssayPanel } from "./assay/panel.js?v=cns2";
import { mountStimMapPanel, stimMapWanted, stimMapUrl } from "./stimmap.js?v=cns2";
import { portableControls, stubRobotDriver, chassisSetpoints, droneSetpoints, ROBOT_HOWTO, PORTABLE_SIGNAL_DOC } from "./controller/portable.js?v=cns2";
import { createHandCam, camWanted, applyCamToFly } from "./handcam.js?v=cns2";

const BODY_MODE = bodyModeFromUrl(); // default "fly"; ?body=cube|drone optional

/** Local flight URL gate for HUD — do not import FLIGHT_ENABLED (stale module cache). Default OFF. */
function flightEnabled() {
  try {
    const q = new URLSearchParams(location.search).get("flight");
    return q === "1" || q === "true" || q === "on";
  } catch {
    return false;
  }
}
const FLIGHT_ENABLED = flightEnabled();

const $ = (id) => document.getElementById(id);
const canvas = $("c");
const loaderEl = $("loader");
const barEl = $("bar");
const loadmsg = $("loadmsg");
const MAX_FLIES = 8;

function setLoad(p, msg) {
  barEl.style.width = Math.round(p * 100) + "%";
  if (msg) loadmsg.textContent = msg;
}
async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.arrayBuffer();
}
async function fetchJson(url) { return (await fetch(url)).json(); }

setLoad(0.04, "male CNS connectome");

const [
  mNeu, mCsr, mBrain, mVnc, mStim, mEff, mMeta,
] = await Promise.all([
  fetchBuf("data/neurons.bin"),
  fetchBuf("data/connectome.bin"),
  fetchBuf("data/brain.mesh"),
  fetchBuf("data/vnc.mesh"),
  fetchJson("data/stim.json"),
  fetchJson("data/effectors.json"),
  fetchJson("data/meta.json"),
]);

if ($("nNeurons")) $("nNeurons").textContent = mMeta.n.toLocaleString();
if ($("nEdges")) $("nEdges").textContent = mMeta.nEdges.toLocaleString();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xd8b888, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 80);
if (BODY_MODE === "fly") {
  camera.position.set(UTOPIA_HOME.x + 1.15, 1.55, UTOPIA_HOME.z + 2.45);
} else if (BODY_MODE === "drone") {
  camera.position.set(0, 5.4, 9.2);
} else {
  camera.position.set(0, 3.8, 7.2);
}
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.7;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.15;
controls.maxDistance = 14;
controls.target.set(
  BODY_MODE === "fly" ? UTOPIA_HOME.x : 0,
  BODY_MODE === "fly" ? 0.52 : 0.55,
  BODY_MODE === "fly" ? UTOPIA_HOME.z : 0
);
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const hemi = new THREE.HemisphereLight(0xfff2d8, 0x4a7a38, 1.38);
scene.add(hemi);
const fill = new THREE.DirectionalLight(0xffe0b8, 0.48);
fill.position.set(-5, 6, -3);
scene.add(fill);
const key = new THREE.DirectionalLight(0xfff6e6, 1.28);
key.position.set(6, 11, 7);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1;
key.shadow.camera.far = 48;
key.shadow.camera.left = key.shadow.camera.bottom = -16;
key.shadow.camera.right = key.shadow.camera.top = 16;
scene.add(key);
scene.fog = new THREE.FogExp2(0xd4b48a, 0.012);

const procWorld = createOpenWorld();
const arena = procWorld.root;
scene.add(arena);
const odors = new OdorWorld();
odors.setShowOdor(false);
scene.add(odors.group);

const worldShared = {
  food: arena.userData.food.position,
  water: arena.userData.water.position,
  bitter: arena.userData.bitter.position,
  perch: arena.userData.perch.userData,
  foods: arena.userData.foods || [],
  assayBeacon: !!arena.userData.assayBeacon,
  odors,
  landmarks: [],
  procedural: true,
  utopia: true,
};

const flies = [];
let selected = null;
let followMode = "flock";
let userDriving = false;
let xrayOn = false;
let paused = false;
let nMale = 0;
let readyN = 0;
let expectedReady = 1;

/** First male: planted in the garden clearing, facing ripe fruit. */
function thriveHome() {
  const x = UTOPIA_HOME.x, z = UTOPIA_HOME.z;
  const yaw = Math.atan2(UTOPIA_FOOD.x - x, UTOPIA_FOOD.z - z);
  return { x, z, yaw };
}

function spawnSpot(occupied) {
  const pts = occupied || flies.map((f) => ({ x: f.body.position.x, z: f.body.position.z }));
  if (!pts.length) return thriveHome();
  const gap = 3.2;
  for (let k = 0; k < 24; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.6 + Math.random() * 4.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pts.every((p) => Math.hypot(p.x - x, p.z - z) >= gap)) {
      return { x, z, yaw: Math.atan2(UTOPIA_FOOD.x - x, UTOPIA_FOOD.z - z) };
    }
  }
  const h = thriveHome();
  return { x: h.x + (Math.random() - 0.5) * 1.6, z: h.z + (Math.random() - 0.5) * 1.6, yaw: h.yaw };
}

function onFlyReady() {
  readyN++;
  if (readyN >= expectedReady) {
    document.body.dataset.ready = "1";
    loaderEl.classList.add("hidden");
  }
  paintFlock();
}

function wireWorld(fly) {
  Object.assign(fly.world, worldShared);
}

function spawn(sex, x, z, yaw) {
  if (flies.length >= MAX_FLIES) return null;
  // Public sim is male CNS only — ignore any non-male request.
  sex = "male";
  if (x == null || z == null) {
    const s = spawnSpot();
    x = s.x; z = s.z; if (yaw == null) yaw = s.yaw;
  }
  if (yaw == null) yaw = Math.random() * Math.PI * 2;
  const body = BODY_MODE === "fly"
    ? createMaleFly()
    : BODY_MODE === "cube"
      ? createCubeChassis()
      : createDroneChassis();
  const fly = new EmbodiedFly({
    sex,
    body,
    neuBuf: mNeu,
    csrBuf: mCsr,
    stim: mStim,
    effectors: mEff,
    brainBuf: mBrain,
    vncBuf: mVnc,
    scene, x, z, yaw,
    onReady: onFlyReady,
    onFrame: onAny,
  });
  nMale++;
  fly.name = "♂" + nMale;
  fly.setRun(!paused);
  fly.setCnsVisible(xrayOn);
  wireWorld(fly);
  flies.push(fly);
  if (!selected) selected = fly;
  refreshNeighbors();
  paintFlock();
  return fly;
}

function refreshNeighbors() {
  for (const f of flies) {
    f.world.others = flies.filter((o) => o !== f);
    let best = null, bestD = 99;
    for (const o of f.world.others) {
      const d = Math.hypot(
        o.body.position.x - f.body.position.x,
        o.body.position.z - f.body.position.z
      );
      if (d < bestD) { bestD = d; best = o; }
    }
    f.world.other = best;
  }
}

function selectFly(fly) {
  selected = fly;
  paintFlock();
}

const ACT = [
  ["walk", "#3dff9a"], ["turn", "#4de4ff"], ["fly", "#b07cff"], ["feed", "#ffd166"],
  ["court", "#ff4fd8"], ["groom", "#ff9f1c"], ["escape", "#ff5c7a"], ["rest", "#8892a8"],
];
function fillActs(el, prefix) {
  if (!el) return;
  el.innerHTML = "";
  for (const [k, col] of ACT) {
    const row = document.createElement("div");
    row.className = "barline";
    row.innerHTML = `<div class="name">${k}</div><div class="track"><i id="${prefix}-${k}" style="background:${col}"></i></div>`;
    el.appendChild(row);
  }
}
fillActs($("acts"), "sact");

const JOINT_LEGS = ["L1", "R1", "L2", "R2", "L3", "R3"];
function fillJoints(el) {
  if (!el) return;
  el.innerHTML = "";
  for (const name of JOINT_LEGS) {
    const row = document.createElement("div");
    row.className = "barline";
    row.innerHTML = `<div class="name">${name}</div><div class="track"><i id="j-${name}" style="background:#7ecbff"></i></div>`;
    el.appendChild(row);
  }
}
fillJoints($("joints"));

if (BODY_MODE === "fly") {
  setLoad(0.88, "NeuroMechFly body");
  await loadNmf();
  setLoad(0.92, "closing the loop");
  await connectPhysics();
  // Ghost hygiene: clear plant bodies from prior tabs/sessions, then spawn a fresh flock.
  if (physics.ok) {
    try { await clearPhysics(); } catch (_) {}
  }
} else {
  setLoad(0.88, BODY_MODE === "cube" ? "cube chassis" : "drone chassis");
  setLoad(0.92, "brain → chassis");
}
if ($("flesh")) {
  if (isKinematicChassis(BODY_MODE)) {
    $("flesh").textContent = BODY_MODE === "cube" ? "cube chassis" : "drone chassis";
  } else {
    const origin = physics.plantOrigin || "";
    $("flesh").textContent = physics.ok
      ? (origin && origin !== "(same-origin)" ? "MuJoCo remote" : "MuJoCo")
      : "fly body";
  }
}
if ($("info")) {
  if (BODY_MODE === "drone") {
    $("info").textContent = "Optional drone chassis: male CNS + compound eye → optic/visionL/R → LIF → leg/descending MNs → portable forward/yawRate → quadrotor pitch/yaw/strafe/throttle. Homepage default is the fly body (?body=fly omitted). See web/controller/portable.js.";
  } else if (BODY_MODE === "cube") {
    $("info").textContent = "Optional cube chassis: male CNS + compound eye → optic/visionL/R → LIF → leg/descending MNs → portable {v,ω}. Homepage default is the fly body. No food-bearing thruster.";
  } else {
    const plantHint = physics.plantOrigin && physics.plantOrigin !== "(same-origin)"
      ? (" Plant @ " + physics.plantOrigin + ".")
      : "";
    $("info").textContent = physics.ok
      ? ("Home: a fly utopia. Full Male CNS LIF is primary; gap-fill is encoding + plant only (no CPG/thrusters). Eyes → optic/visionL/R → connectome → leg MNs → MuJoCo contact. Planted walk; flight " + (FLIGHT_ENABLED ? "ON (?flight=1)" : "off") + ". Fruit, dew, shade, blossoms. Empty MN pools stay quiet." + plantHint)
      : ("Home: a fly utopia. Full Male CNS LIF is primary; gap-fill is encoding + plant only (no CPG/thrusters). Eyes → optic/visionL/R → LIF → annotated MNs → pose → planted stance-slip. Fruit, dew, shade, blossoms. Flight " + (FLIGHT_ENABLED ? "ON" : "off") + ". Soft garden rim — bounce, never punish." + plantHint);
  }
}

spawn("male");

function paintActs(fly, prefix) {
  if (!fly) return;
  const cmd = fly.cmd;
  for (const [k] of ACT) {
    const el = document.getElementById(prefix + "-" + k);
    if (!el) continue;
    const v = k === "turn" ? Math.abs(cmd.turn) : (cmd[k] || 0);
    el.style.width = (Math.min(1, v) * 100).toFixed(1) + "%";
  }
}
function paintJoints(fly) {
  if (!fly) return;
  const m = fly.cmd.muscle || {};
  for (const name of JOINT_LEGS) {
    const el = document.getElementById("j-" + name);
    if (!el) continue;
    const u = m[name] || {};
    const net = Math.abs((u.tiFlex || 0) - (u.tiExt || 0))
      + Math.abs((u.trFlex || 0) - (u.trExt || 0))
      + Math.abs((u.coxaProm || 0) - (u.coxaRem || 0));
    el.style.width = (Math.min(1, net / 2) * 100).toFixed(1) + "%";
  }
}

function paintFlock() {
  const el = $("flock");
  if (!el) return;
  el.innerHTML = "";
  for (const f of flies) {
    const b = document.createElement("button");
    b.textContent = f.name + " " + (f.life?.mode || "…");
    b.className = "flychip" + (f === selected ? " on" : "");
    b.onclick = () => {
      selectFly(f);
      followMode = "selected";
      userDriving = false;
      syncFollow();
    };
    el.appendChild(b);
  }
  if ($("nFlock")) $("nFlock").textContent = flies.length;
  if ($("addM")) $("addM").disabled = flies.length >= MAX_FLIES;
}

let worldTick = 0;
const wantCam = camWanted();
let handCam = null;
if (wantCam) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;right:calc(16px + var(--safe-r));top:calc(16px + var(--safe-t));z-index:6;pointer-events:auto";
  const thumb = document.createElement("canvas");
  thumb.width = 200; thumb.height = 146;
  thumb.style.cssText = "width:200px;height:146px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:#07080d;cursor:grab;touch-action:none";
  thumb.title = "Drag synthetic you · ?cam=1";
  wrap.appendChild(thumb);
  (document.querySelector(".hud") || document.body).appendChild(wrap);
  handCam = createHandCam({ canvas: thumb, forceOn: false });
  handCam.start();
}

function onAny() {
  if (++worldTick % 2 === 0) {
    refreshNeighbors();
    for (const f of flies) {
      if (handCam) applyCamToFly(handCam, f);
      f.pushWorldDrive();
    }
  }
  const focus = selected || flies[0];
  if (!focus) return;
  paintActs(focus, "sact");
  paintJoints(focus);
  if (focus.eye) {
    drawOmmatidia($("eyeL"), focus.eye, "L");
    drawOmmatidia($("eyeR"), focus.eye, "R");
  }
  if (focus.day != null) {
    const day = focus.day;
    // Stable garden sun — gentle, never night-black.
    key.intensity = 1.12 + day * 0.22;
    key.position.set(6.2 + Math.sin(day * Math.PI) * 1.1, 11, 7.2);
    key.target.position.set(focus.body.position.x, 0, focus.body.position.z);
    if (!key.target.parent) scene.add(key.target);
    hemi.intensity = 1.28 + day * 0.14;
    renderer.setClearColor(0xd8b888, 1);
  }
  const focusMode = focus.life?.mode || "…";
  if ($("gait")) $("gait").textContent = "♂ " + focusMode;
  if ($("hunger")) $("hunger").textContent = Math.round(focus.life.hunger * 100) + "%";
  if ($("selName")) $("selName").textContent = focus.name;
  const kinMode = focus.bodyMode || BODY_MODE;
  const flesh = isKinematicChassis(kinMode)
    ? (kinMode === "cube" ? "cube chassis" : "drone chassis")
    : (physics.ok
      ? ("MuJoCo" + (physics.plantOrigin && physics.plantOrigin !== "(same-origin)" ? " remote" : ""))
      : "fly body");
  if ($("flesh")) $("flesh").textContent = flesh;
  const eMn = focus.motEma || {};
  const dlm = (eMn.DLM || 0).toFixed(2);
  const legs = (((eMn.T1L||0)+(eMn.T1R||0)+(eMn.T2L||0)+(eMn.T2R||0)+(eMn.T3L||0)+(eMn.T3R||0))/6).toFixed(2);
  const steer = focus.lastSteering || (kinMode === "drone"
    ? droneSetpoints(portableControls(focus))
    : chassisSetpoints(portableControls(focus)));
  if ($("steerHint")) {
    const salT = steer.salTarget ?? focus.lastVisionSal?.salTarget ?? focus.eye?.lastSummary?.salTarget ?? 0;
    const asym = steer.asymFood ?? focus.lastVisionSal?.asymFood ?? focus.eye?.lastSummary?.asymFood ?? 0;
    if (kinMode === "drone") {
      $("steerHint").textContent =
        "thr " + (steer.throttle ?? 1.45).toFixed(2) +
        "  yaw " + (steer.yawRate ?? 0).toFixed(2) +
        "  pitch " + (steer.pitch ?? 0).toFixed(2) +
        "  | v=" + (steer.v ?? 0).toFixed(2) +
        " ω=" + (steer.omega ?? 0).toFixed(2) +
        "  sal " + Number(salT).toFixed(2) +
        " Δ" + (asym >= 0 ? "+" : "") + Number(asym).toFixed(2);
    } else {
      $("steerHint").textContent =
        "fwd " + (steer.forward ?? 0).toFixed(2) +
        "  yaw " + (steer.yawRate ?? 0).toFixed(2) +
        "  | v=" + (steer.v ?? 0).toFixed(2) +
        " ω=" + (steer.omega ?? 0).toFixed(2) +
        "  sal " + Number(salT).toFixed(2) +
        " Δ" + (asym >= 0 ? "+" : "") + Number(asym).toFixed(2);
    }
  }
  if ($("lifeHint")) {
    let plantBit;
    if (kinMode === "drone") {
      plantBit = "plant=drone · MN→pitch/yaw/strafe/thr";
    } else if (kinMode === "cube") {
      plantBit = "plant=cube · MN→v/ω";
    } else {
      const nLeg = focus.plantNLeg != null ? focus.plantNLeg : "–";
      const slip = (focus.slipMeanAbs != null ? focus.slipMeanAbs : (focus.body?.userData?.slipMeanAbs || 0));
      plantBit = physics.ok
        ? ("legs↓" + nLeg + (focus.planted ? " planted" : " settling"))
        : ("planted " + (focus.planted ? "yes" : "…") + " |slip|=" + Number(slip).toFixed(3));
    }
    $("lifeHint").textContent = flesh + " · " + plantBit + " · home · MN DLM " + dlm + " legs " + legs +
      (kinMode === "drone"
        ? (" · steer thr=" + (steer.throttle ?? 1.45).toFixed(2) + " yaw=" + (steer.yawRate ?? 0).toFixed(2) + " pitch=" + (steer.pitch ?? 0).toFixed(2))
        : (" · steer f=" + (steer.forward ?? 0).toFixed(2) + " y=" + (steer.yawRate ?? 0).toFixed(2))) +
      " · " + flies.map((f) => f.name + " " + f.life.mode).join(" · ");
  }
  const e = focus.motEma || {};
  const setW = (id, v) => { const el = $(id); if (el) el.style.width = (Math.min(1, v) * 100).toFixed(1) + "%"; };
  setW("slow-sleep", focus.life.sleep);
  setW("slow-pdf", (e.sLNv || 0) * 0.65 + (e.lLNv || 0) * 0.35);
  setW("slow-da", e.DAN || 0);
  setW("slow-oa", e.OA || 0);
  // Live MN cause→effect (Hz-decoded EMAs). Quiet bars → quiet body.
  setW("mn-dlm", e.DLM || 0);
  setW("mn-dvm", e.DVM || 0);
  setW("mn-admn", e.ADMN || 0);
  setW("mn-legs", ((e.T1L || 0) + (e.T1R || 0) + (e.T2L || 0) + (e.T2R || 0) + (e.T3L || 0) + (e.T3R || 0)) / 6);
  setW("mn-neck", e.neck || 0);
  setW("mn-abd", e.abdomen || 0);
  setW("mn-mn9", Math.max(e.MN9 || 0, e.proboscis || 0));
  const o = focus.lastOdor;
  if (o && $("odorFL")) {
    $("odorFL").style.width = Math.min(100, o.foodL).toFixed(1) + "%";
    $("odorFR").style.width = Math.min(100, o.foodR).toFixed(1) + "%";
    $("odorPL").style.width = Math.min(100, o.pherL).toFixed(1) + "%";
    $("odorPR").style.width = Math.min(100, o.pherR).toFixed(1) + "%";
  }
}

const pauseBtn = $("pause");
if (pauseBtn) {
  pauseBtn.onclick = () => {
    paused = !paused;
    for (const f of flies) f.setRun(!paused);
    pauseBtn.textContent = paused ? "resume" : "pause";
    pauseBtn.classList.toggle("on", paused);
  };
}
$("reset").onclick = () => {
  const taken = [];
  for (const f of flies) {
    const s = spawnSpot(taken);
    taken.push(s);
    f.resetPose(s.x, s.z, s.yaw);
  }
};
function syncFollow() {
  $("followFlock").parentElement.classList.toggle("on", followMode === "flock");
  $("followSel").parentElement.classList.toggle("on", followMode === "selected");
  $("followFlock").checked = followMode === "flock";
  $("followSel").checked = followMode === "selected";
}
$("followFlock").onchange = (e) => {
  followMode = e.target.checked ? "flock" : "off";
  if (followMode === "flock") {
    $("followSel").checked = false;
    userDriving = false;
  }
  syncFollow();
};
$("followSel").onchange = (e) => {
  followMode = e.target.checked ? "selected" : "off";
  if (followMode === "selected") {
    $("followFlock").checked = false;
    userDriving = false;
  }
  syncFollow();
};
$("xray").onchange = (e) => {
  xrayOn = e.target.checked;
  e.target.parentElement.classList.toggle("on", xrayOn);
  for (const f of flies) f.setCnsVisible(xrayOn);
};
$("showOdor").onchange = (e) => {
  const on = e.target.checked;
  e.target.parentElement.classList.toggle("on", on);
  odors.setShowOdor(on);
};

function placeBombNearView() {
  // Prefer garden fruit / clearing center; fall back near camera look target
  const food = arena.userData.food?.position;
  let x = food ? food.x + 1.8 : controls.target.x;
  let z = food ? food.z + 1.2 : controls.target.z;
  const r2 = x * x + z * z;
  if (r2 > 14 * 14) {
    const s = 14 / Math.sqrt(r2);
    x *= s; z *= s;
  }
  odors.setBombPos(x, 0.72, z);
}

function setSensoryBomb(on) {
  const el = $("sensoryBomb");
  if (el) el.checked = !!on;
  if (el) el.parentElement.classList.toggle("on", !!on);
  const hint = $("bombHint");
  if (hint) hint.classList.toggle("hidden", !on);
  if (on) {
    placeBombNearView();
    odors.setBomb(true);
  } else {
    odors.setBomb(false);
  }
  // Never persist as ON — only remember explicit off preference if stored
  try {
    if (on) localStorage.removeItem("ffb-sensoryBomb");
    else localStorage.setItem("ffb-sensoryBomb", "0");
  } catch (_) {}
}

if ($("sensoryBomb")) {
  // Default OFF always on load (do not restore as on)
  $("sensoryBomb").checked = false;
  setSensoryBomb(false);
  $("sensoryBomb").onchange = (e) => setSensoryBomb(e.target.checked);
}
$("addM").onclick = () => {
  expectedReady = readyN + 1;
  spawn("male");
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.72);
const _dragHit = new THREE.Vector3();
let downX = 0, downY = 0;
let lastTapT = 0, lastTapX = 0, lastTapY = 0;
let draggingBomb = false;

function setPointer(clientX, clientY) {
  pointer.x = (clientX / innerWidth) * 2 - 1;
  pointer.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function hitBombAt(clientX, clientY) {
  if (!odors.bombEnabled || !odors.bombMesh) return false;
  setPointer(clientX, clientY);
  const hits = raycaster.intersectObject(odors.bombMesh, true);
  return hits.length > 0;
}

function dragBombTo(clientX, clientY) {
  setPointer(clientX, clientY);
  _dragPlane.constant = -0.72;
  if (!raycaster.ray.intersectPlane(_dragPlane, _dragHit)) return;
  let x = _dragHit.x, z = _dragHit.z;
  const r2 = x * x + z * z;
  const maxR = 16.2;
  if (r2 > maxR * maxR) {
    const s = maxR / Math.sqrt(r2);
    x *= s; z *= s;
  }
  const y = Math.min(1.0, Math.max(0.4, 0.72));
  odors.setBombPos(x, y, z);
}

function hitFlyAt(clientX, clientY) {
  setPointer(clientX, clientY);
  const meshes = [];
  for (const f of flies) f.body.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && !flies.some((f) => f.body === obj)) obj = obj.parent;
  return flies.find((f) => f.body === obj) || null;
}

function overviewCamera() {
  userDriving = false;
  followMode = "off";
  syncFollow();
  controls.target.set(UTOPIA_HOME.x, 0.5, UTOPIA_HOME.z);
  camera.position.set(UTOPIA_HOME.x + 2.4, 2.4, UTOPIA_HOME.z + 4.2);
  controls.update();
}

function dollyBy(factor) {
  userDriving = true;
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const dist = offset.length();
  const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist * factor));
  if (dist > 1e-6) offset.multiplyScalar(next / dist);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

canvas.addEventListener("pointerdown", (ev) => {
  downX = ev.clientX; downY = ev.clientY;
  draggingBomb = false;
  if (odors.bombEnabled && hitBombAt(ev.clientX, ev.clientY)) {
    draggingBomb = true;
    controls.enabled = false;
    userDriving = true;
    try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
    dragBombTo(ev.clientX, ev.clientY);
    ev.preventDefault();
  }
});
canvas.addEventListener("pointermove", (ev) => {
  if (!draggingBomb) return;
  dragBombTo(ev.clientX, ev.clientY);
  ev.preventDefault();
});
function endBombDrag(ev) {
  if (!draggingBomb) return;
  draggingBomb = false;
  controls.enabled = true;
  try { canvas.releasePointerCapture(ev.pointerId); } catch (_) {}
}
canvas.addEventListener("pointerup", (ev) => {
  const wasBomb = draggingBomb;
  endBombDrag(ev);
  // Skip fly-select taps while / after dragging the scent orb
  if (wasBomb) return;
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 8) return;
  const now = performance.now();
  const dbl = now - lastTapT < 320 && Math.hypot(ev.clientX - lastTapX, ev.clientY - lastTapY) < 28;
  lastTapT = now; lastTapX = ev.clientX; lastTapY = ev.clientY;
  const fly = hitFlyAt(ev.clientX, ev.clientY);
  if (fly) {
    selectFly(fly);
    followMode = "selected";
    userDriving = false;
    syncFollow();
    return;
  }
  if (dbl) {
    overviewCamera();
    return;
  }
  followMode = "off";
  syncFollow();
});
canvas.addEventListener("pointercancel", endBombDrag);

// User orbit/zoom/pan pauses follow lerp until they re-enable follow
controls.addEventListener("start", () => { userDriving = true; });
canvas.addEventListener("wheel", () => { userDriving = true; }, { passive: true });
canvas.addEventListener("touchmove", (ev) => {
  if (ev.touches && ev.touches.length > 1) ev.preventDefault();
}, { passive: false });

const camZoomIn = $("camZoomIn");
const camZoomOut = $("camZoomOut");
const camRecenter = $("camRecenter");
if (camZoomIn) camZoomIn.onclick = () => dollyBy(0.82);
if (camZoomOut) camZoomOut.onclick = () => dollyBy(1.22);
if (camRecenter) camRecenter.onclick = () => overviewCamera();

const camHint = $("camHint");
if (camHint) {
  let seen = false;
  try { seen = localStorage.getItem("ffb-cam-hint") === "1"; } catch (_) {}
  if (seen) camHint.classList.add("fade");
  else {
    const dismiss = () => {
      camHint.classList.add("fade");
      try { localStorage.setItem("ffb-cam-hint", "1"); } catch (_) {}
    };
    camHint.onclick = dismiss;
    setTimeout(dismiss, 6500);
  }
}

const stimBtns = [
  ["loop", "live", ""],
  ["vision", "light", ""],
  ["smell", "scent", ""],
  ["taste", "taste", ""],
  ["touch", "touch", ""],
];
const stimsEl = $("stims");
for (const [id, label, cls] of stimBtns) {
  const b = document.createElement("button");
  b.textContent = label;
  b.dataset.stim = id;
  if (cls) b.classList.add(cls);
  b.onclick = () => applyStim(id);
  stimsEl.appendChild(b);
}
function applyStim(id) {
  for (const b of stimsEl.querySelectorAll("button")) b.classList.toggle("on", b.dataset.stim === id);
  const extra = { vision: 0, smellL: 0, smellR: 0, taste: 0, touch: 0, courtship: 0, escape: 0 };
  if (id === "vision") extra.vision = 90;
  if (id === "smell") extra.smellL = extra.smellR = 90;
  if (id === "taste") extra.taste = 90;
  if (id === "touch") extra.touch = 90;
  for (const f of flies) {
    f.extra = { ...extra };
  }
  if ($("stimHint")) $("stimHint").textContent = id === "loop" ? "every fly closed-loop" : id;
}

function wireCollapse(panelId, key, defaultCollapsed = false) {
  const panel = $(panelId);
  if (!panel) return;
  const btn = panel.querySelector(".collapse");
  const apply = (on, persist) => {
    panel.classList.toggle("collapsed", on);
    if (btn) btn.textContent = on ? "+" : "–";
    if (persist) {
      try { localStorage.setItem("ffb-" + key, on ? "1" : "0"); } catch (_) {}
    }
  };
  let start = defaultCollapsed;
  try {
    const v = localStorage.getItem("ffb-" + key);
    if (v === "1") start = true;
    else if (v === "0") start = false;
  } catch (_) {}
  apply(start, false);
  if (btn) btn.onclick = () => apply(!panel.classList.contains("collapsed"), true);
}
const narrow = innerWidth <= 900;
wireCollapse("panelL", "left", narrow);
wireCollapse("panelR", "right", narrow);
wireCollapse("panelB", "bottom", narrow);

const _tgt = new THREE.Vector3();
let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!paused) {
    if (BODY_MODE === "fly") flushPhysics(dt);
    const focusPos = (selected || flies[0])?.body?.position;
    const wx = focusPos?.x ?? 0, wz = focusPos?.z ?? 0;
    procWorld.update(wx, wz);
    worldShared.food = arena.userData.food.position;
    worldShared.water = arena.userData.water.position;
    worldShared.bitter = arena.userData.bitter.position;
    worldShared.perch = arena.userData.perch.userData;
    worldShared.landmarks = procWorld.landmarksNear(wx, wz, 18);
    worldShared.foods = arena.userData.foods || [];
    worldShared.assayBeacon = !!arena.userData.assayBeacon;
    for (const f of flies) {
      if (f.world) {
        f.world.food = worldShared.food;
        f.world.water = worldShared.water;
        f.world.bitter = worldShared.bitter;
        f.world.perch = worldShared.perch;
        f.world.landmarks = worldShared.landmarks;
        f.world.foods = worldShared.foods;
        f.world.assayBeacon = worldShared.assayBeacon;
      }
    }
    odors.step(dt, now * 0.001, {
      food: arena.userData.food.position,
      water: arena.userData.water.position,
      bitter: arena.userData.bitter.position,
      foods: arena.userData.foods || [],
      flies,
    });
    if (assayPanel) assayPanel.tick(dt);
  }
  if (!userDriving && followMode === "selected" && selected) {
    const h = selected.heading;
    const px = selected.body.position.x, pz = selected.body.position.z, py = selected.y;
    _tgt.set(px + Math.sin(h) * 0.85, 0.48 + Math.min(0.35, py * 0.12), pz + Math.cos(h) * 0.85);
    const prevT = controls.target.clone();
    controls.target.lerp(_tgt, 0.12);
    const delta = controls.target.clone().sub(prevT);
    camera.position.add(delta);
    // Preserve current zoom radius; gently steer azimuth toward behind the fly
    const offset = camera.position.clone().sub(controls.target);
    const radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length()));
    const desired = new THREE.Vector3(
      -Math.sin(h) * radius * 0.92,
      Math.max(1.05, radius * 0.34 + 0.35),
      -Math.cos(h) * radius * 0.92
    );
    offset.lerp(desired, 0.045);
    offset.setLength(radius);
    camera.position.copy(controls.target).add(offset);
  } else if (!userDriving && followMode === "flock" && flies.length) {
    let cx = 0, cz = 0, minx = 99, maxx = -99, minz = 99, maxz = -99;
    for (const f of flies) {
      const x = f.body.position.x, z = f.body.position.z;
      cx += x; cz += z;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const n = flies.length;
    cx /= n; cz /= n;
    _tgt.set(cx, 0.48, cz);
    const prevT = controls.target.clone();
    controls.target.lerp(_tgt, 0.09);
    const delta = controls.target.clone().sub(prevT);
    camera.position.add(delta);
    const offset = camera.position.clone().sub(controls.target);
    let radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length()));
    const span = Math.max(3.2, maxx - minx, maxz - minz);
    const comfort = Math.min(8.5, Math.max(3.15, 3.05 + span * 0.28));
    radius += (comfort - radius) * 0.02;
    offset.setLength(radius);
    camera.position.copy(controls.target).add(offset);
  }
  controls.update();
  renderer.render(scene, camera);
}
// --- Stim-map mode (causal pool → drone axes; default on drone/cube, ?stim=1 / ?map=1) ---
const wantStimMap = stimMapWanted(BODY_MODE);
let stimMapPanel = null;
{
  const host = document.querySelector(".hud") || document.body;
  const panelL = document.getElementById("panelL")?.querySelector(".panel-body");
  if (wantStimMap) {
    const badge = document.createElement("div");
    badge.className = "hint";
    badge.style.marginTop = "8px";
    badge.innerHTML = 'stim map on · <a class="stim-map-link" href="' + stimMapUrl(false) + '">off (?stim=0)</a>';
    if (panelL) panelL.appendChild(badge);
    stimMapPanel = mountStimMapPanel({
      getFly: () => selected || flies[0],
    });
    host.appendChild(stimMapPanel.el);
  } else {
    const linkRow = document.createElement("div");
    linkRow.className = "row";
    linkRow.style.marginTop = "8px";
    const a = document.createElement("a");
    a.href = stimMapUrl(true);
    a.textContent = "explore stim map";
    a.className = "stim-map-link";
    a.title = "Gentle pool exploration: Hz inject → LIF → MNs (not surgery)";
    linkRow.appendChild(a);
    if (panelL) panelL.appendChild(linkRow);
  }
}

// --- Assay / lesion scaffolding (URL: ?assay=1&lesion=silence:HS) ---
const _params = new URLSearchParams(location.search);
const wantAssay = _params.get("assay") === "1" || _params.has("lesion") || _params.get("dev") === "1";
let assayPanel = null;
if (wantAssay) {
  const host = document.querySelector(".hud") || document.body;
  assayPanel = mountAssayPanel({
    getFly: () => selected || flies[0],
    arena,
    keyLight: key,
    ambient: hemi,
    applyLesion: async (fly, lesion) => { fly.applyLesion(lesion); },
    clearLesion: (fly) => fly.clearLesion(),
  });
  host.appendChild(assayPanel.el);
  const lesionFlag = _params.get("lesion");
  if (lesionFlag) {
    const waitReady = () => {
      const f = selected || flies[0];
      if (f && f.ready) {
        f.applyLesion(parseLesionFlag(lesionFlag));
        if (_params.get("assay") === "1") assayPanel.runTrial(parseLesionFlag(lesionFlag));
      } else setTimeout(waitReady, 200);
    };
    waitReady();
  }
}
window.ffbPortable = {
  snapshot: () => {
    const f = selected || flies[0];
    return f ? portableControls(f) : null;
  },
  stub: () => {
    const f = selected || flies[0];
    return f ? stubRobotDriver(portableControls(f)) : null;
  },
  chassis: () => {
    const f = selected || flies[0];
    return f ? chassisSetpoints(portableControls(f)) : null;
  },
  drone: () => {
    const f = selected || flies[0];
    return f ? droneSetpoints(portableControls(f)) : null;
  },
  howto: ROBOT_HOWTO,
  signals: PORTABLE_SIGNAL_DOC,
  applyLesion: (flagOrCfg) => {
    const f = selected || flies[0];
    if (!f) return null;
    const cfg = typeof flagOrCfg === "string" ? parseLesionFlag(flagOrCfg) : flagOrCfg;
    return f.applyLesion(cfg);
  },
  clearLesion: () => { const f = selected || flies[0]; if (f) f.clearLesion(); },
  setRates: (rates) => { const f = selected || flies[0]; return f ? f.setRates(rates) : null; },
  clearStim: () => { const f = selected || flies[0]; if (f) f.clearStimInject(); },
  stimMap: () => stimMapPanel,
};

setLoad(1, "starting brains");
paintFlock();
syncFollow();
loop();
