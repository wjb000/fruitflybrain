#!/usr/bin/env node
/**
 * Plant-probe policy: static hosts must not same-origin /physics/health.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const mod = await import(pathToFileURL(path.join(ROOT, "web/plantConfig.js")).href);

const {
  DEFAULT_PLANT,
  isStaticHost,
  isLocalPlantHost,
  isPagesHost,
  resolvePlantBase,
  plantProbeOrigins,
  plantUrl,
  plantHealthUrl,
  plantConfigured,
} = mod;

let failed = 0;
function check(name, got, want) {
  const gs = JSON.stringify(got);
  const ws = JSON.stringify(want);
  if (gs !== ws) {
    console.error("FAIL", name, "got", gs, "want", ws);
    failed++;
  } else {
    console.log("ok  ", name);
  }
}

check("pages is static", isStaticHost("wjb000.github.io", "https:"), true);
check("github.io is pages", isPagesHost("foo.github.io"), true);
check("localhost is not static", isStaticHost("localhost", "http:"), false);
check("localhost is local plant", isLocalPlantHost("localhost"), true);
check("netlify is static", isStaticHost("app.netlify.app", "https:"), true);
check("file is static", isStaticHost("", "file:"), true);

const pages = { hostname: "wjb000.github.io", protocol: "https:", search: "", storedPlant: "https://stale.example" };
check("pages base ignores stale storage", resolvePlantBase(pages), "");
check("pages probe origins empty", plantProbeOrigins(pages), []);
check("pages not configured", plantConfigured(pages), false);
check("pages plantUrl empty (no same-origin)", plantUrl("/physics/health", pages), "");

const pagesPlant = {
  hostname: "wjb000.github.io",
  protocol: "https:",
  search: "?plant=https://lab.example/plant",
  storedPlant: "",
};
check("pages ?plant= is remote only", plantProbeOrigins(pagesPlant), ["https://lab.example/plant"]);
check("pages ?plant= url", plantUrl("/physics/health", pagesPlant), "https://lab.example/plant/physics/health");
check("pages ?plant= no same-origin fallback", plantProbeOrigins(pagesPlant).includes(""), false);

const local = { hostname: "localhost", protocol: "http:", search: "", storedPlant: "" };
check("localhost probes same-origin", plantProbeOrigins(local), [""]);
check("localhost plantUrl is relative", plantUrl("/physics/health", local), "/physics/health");

const localPlant = {
  hostname: "127.0.0.1",
  protocol: "http:",
  search: "?plant=https://tunnel.example",
  storedPlant: "",
};
check("localhost + ?plant= tries remote then same-origin", plantProbeOrigins(localPlant), [
  "https://tunnel.example",
  "",
]);

const lab = {
  hostname: "fly-lab.internal",
  protocol: "https:",
  search: "",
  storedPlant: "",
  defaultPlant: DEFAULT_PLANT,
};
check("non-static non-local uses DEFAULT_PLANT", plantProbeOrigins(lab), [DEFAULT_PLANT.replace(/\/$/, "")]);

check("health url remote", plantHealthUrl("https://x.example"), "https://x.example/physics/health");
check("health url same-origin only when origin empty", plantHealthUrl(""), "/physics/health");

const loadutil = await import(pathToFileURL(path.join(ROOT, "web/loadutil.js")).href);
const { CONNECTOME_BYTES, connectomeWaitMsg } = loadutil;
check("connectome size constant", CONNECTOME_BYTES, 38074596);
if (!connectomeWaitMsg(0).includes("38MB")) {
  console.error("FAIL wait msg missing 38MB", connectomeWaitMsg(0));
  failed++;
} else {
  console.log("ok   connectome wait copy");
}
if (!connectomeWaitMsg(10e6, CONNECTOME_BYTES).includes("10.0")) {
  console.error("FAIL progress msg", connectomeWaitMsg(10e6, CONNECTOME_BYTES));
  failed++;
} else {
  console.log("ok   connectome progress copy", connectomeWaitMsg(10e6, CONNECTOME_BYTES));
}

if (failed) {
  console.error(failed + " plant-config checks failed");
  process.exit(1);
}
console.log("plant_config_sanity: all ok");
