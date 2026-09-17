#!/usr/bin/env node
/**
 * browseranimal1: in-browser full animal — MJCF + JS contact plant.
 * No Mac, no paid host. WASM is optional (jsDelivr); JS plant always works.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function load(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

async function main() {
  const nmf = JSON.parse(fs.readFileSync(path.join(ROOT, "web/data/nmf.json"), "utf8"));
  const { buildNmfMjcf, mnTarget } = await load("web/nmfMjcf.js");
  const spec = buildNmfMjcf(nmf);

  console.log("--- MJCF: 42 leg DoF, neck, abdomen, wings, adhesion, gravity ---");
  assert(spec.nLegDoF === 42, "42 leg hinges, got " + spec.nLegDoF);
  assert(spec.nNeck === 3, "neck 3-DoF, got " + spec.nNeck);
  assert(spec.nAbdomen >= 5, "abdomen segments, got " + spec.nAbdomen);
  assert(spec.nWing === 2, "two wing hinges");
  assert(spec.nAdhesion === 6, "six tarsus adhesion actuators");
  assert(spec.xml.includes('gravity="0 -9810 0"'), "NMF-scale gravity");
  assert(spec.xml.includes("<freejoint"), "thorax free joint");
  assert(spec.xml.includes('name="floor"'), "ground plane");
  assert(spec.xml.includes("<adhesion"), "adhesion actuators");
  assert(spec.xml.includes("head_yaw"), "neck yaw joint");
  assert(spec.xml.includes("l_wing_pitch"), "wing pitch");
  assert((spec.xml.match(/<position /g) || []).length >= 42, "position actuators");
  console.log({
    nLegDoF: spec.nLegDoF, nNeck: spec.nNeck, nAbdomen: spec.nAbdomen,
    nWing: spec.nWing, nAdhesion: spec.nAdhesion, xmlBytes: spec.xml.length,
  });

  console.log("--- MN map: quiet stays 0; empty pools stay 0 ---");
  const silent = { muscle: { L1: { coxaProm: 0, coxaRem: 0, trFlex: 0, trExt: 0 } } };
  const aLeg = spec.actuators.find((a) => a.kind === "leg" && a.leg === "L1" && a.key === "coxa-pitch");
  assert(Math.abs(mnTarget(aLeg, silent)) < 1e-6, "quiet coxa target 0");
  const aNeck = spec.actuators.find((a) => a.kind === "neck" && a.axis === "pitch");
  assert(Math.abs(mnTarget(aNeck, { head: 0 })) < 1e-6, "quiet neck 0");
  const driven = mnTarget(aLeg, { muscle: { L1: { coxaProm: 0.9, coxaRem: 0.05 } } });
  assert(driven > 0.1, "promotor drives positive coxa pitch, got " + driven);

  console.log("--- JS contact plant: spawn planted, gravity holds, MN steps ---");
  const { ContactPlant } = await load("web/browserPlant.js");
  const plant = new ContactPlant(nmf, spec);
  const pose0 = plant.spawn("test", 0, 0, 0);
  assert(Number.isFinite(pose0.y), "spawn y");
  assert(pose0.bones && pose0.bones.lf_coxa, "bones include lf_coxa");
  assert(pose0.bones.c_head, "head bone");
  assert(pose0.bones.c_abdomen12, "abdomen bone");
  const silentCmd = { muscle: {}, dlm: 0, dvm: 0, admn: 0, fly: 0 };
  let pose = pose0;
  for (let i = 0; i < 12; i++) {
    pose = plant.step(0.016, { test: silentCmd }).test;
  }
  console.log({ y: pose.y.toFixed(3), n_leg: pose.n_leg, planted: pose.planted, speed: pose.speed.toFixed(3) });
  assert(pose.y > 0.2 && pose.y < spec.standZ + 1.2, "thorax stays near stand after gravity");
  assert(!pose.fallen, "not fallen at rest");

  const kick = {
    muscle: {
      L1: { trExt: 0.8, tiExt: 0.5 },
      R2: { trExt: 0.8, tiExt: 0.5 },
      L3: { trExt: 0.8, tiExt: 0.5 },
      R1: { trFlex: 0.7, tiFlex: 0.5 },
      L2: { trFlex: 0.7, tiFlex: 0.5 },
      R3: { trFlex: 0.7, tiFlex: 0.5 },
    },
    dlm: 0, dvm: 0, admn: 0, fly: 0,
  };
  for (let i = 0; i < 8; i++) pose = plant.step(0.016, { test: kick }).test;
  console.log({ afterKick: { y: pose.y.toFixed(3), n_leg: pose.n_leg, ncon: pose.ncon } });
  assert(pose.bones.lf_tarsus5, "tarsus bone after kick");

  const neckCmd = {
    muscle: {},
    head: 0.8, headYaw: 0.5, headRoll: 0.2,
    abdomen: 0.7, abdomenYaw: 0.4,
    dlm: 0.9, dvm: 0.8, admn: 0.6, t: 0.2,
  };
  pose = plant.step(0.016, { test: neckCmd }).test;
  const head0 = pose0.bones.c_head;
  const head1 = pose.bones.c_head;
  const hd = Math.hypot(
    (head1.p[0] - head0.p[0]), (head1.p[1] - head0.p[1]), (head1.p[2] - head0.p[2])
  ) + Math.hypot(
    (head1.q[0] - head0.q[0]), (head1.q[1] - head0.q[1]),
    (head1.q[2] - head0.q[2]), (head1.q[3] - head0.q[3])
  );
  assert(hd > 1e-4, "neck MN poses head bone, delta " + hd);
  assert(pose.bones.l_wing, "wing bone present");

  const h = plant.health();
  assert(h.ok && h.kind === "browser-contact", "health kind");
  assert(h.nLegDoF === 42, "health 42 DoF");

  console.log("--- plantConfig: Pages does not require a remote host ---");
  const cfg = await load("web/plantConfig.js");
  assert(cfg.DEFAULT_PLANT === "", "DEFAULT_PLANT empty (no Mac tunnel)");
  const pages = cfg.plantProbeOrigins({
    hostname: "wjb000.github.io", protocol: "https:", search: "", storedPlant: "https://dead.example",
  });
  assert(pages.length === 0, "github.io does not probe remote without ?plant=, got " + JSON.stringify(pages));
  const opt = cfg.plantProbeOrigins({
    hostname: "wjb000.github.io", protocol: "https:", search: "?plant=https://lab.example",
  });
  assert(opt[0] === "https://lab.example", "optional ?plant= still works");
  const local = cfg.plantProbeOrigins({
    hostname: "localhost", protocol: "http:", search: "",
  });
  assert(local.includes(""), "localhost may probe same-origin serve.py");
  assert(cfg.plantHudLabel({ ok: true, kind: "mujoco-wasm" }).includes("full MuJoCo animal"));
  assert(cfg.plantHudLabel({ ok: true, kind: "browser-contact" }).includes("full animal"));
  assert(cfg.plantHudLabel({ ok: false }).includes("kinematic NMF"));

  console.log("PASS browseranimal1");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
