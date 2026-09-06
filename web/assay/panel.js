/**
 * Minimal assay + lesion dev panel (URL ?assay=1 or ?lesion=silence:HS).
 */
import { parseLesionFlag, lesionSummary, normalizeLesion } from "../lesion.js";
import { ApproachAssay } from "./assay.js";

export function mountAssayPanel({
  getFly,
  arena,
  keyLight,
  ambient,
  applyLesion,
  clearLesion,
  root,
}) {
  const el = root || document.createElement("div");
  el.id = "assayPanel";
  el.className = "panel assay-panel";
  el.innerHTML = `
    <button class="collapse" type="button" title="collapse">–</button>
    <div class="kicker">assay · lesion</div>
    <div class="panel-body">
      <div class="hint">See landmark → lights out → world yaw → retrieve. Lesions hit LIF, not joints. MN-only body.</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">
        <button type="button" id="assayRun">run trial</button>
        <button type="button" id="assaySilenceHS">silence HS</button>
        <button type="button" id="assayClearLesion">clear lesion</button>
      </div>
      <label class="hint" style="display:block;margin-top:8px">lesion flag
        <input id="assayLesionIn" type="text" value="silence:HS" style="width:100%;margin-top:4px;font:inherit;background:#12151c;color:#e8ecf4;border:1px solid #2a3140;border-radius:6px;padding:4px 8px" />
      </label>
      <div class="hint" id="assayStatus" style="margin-top:8px">idle</div>
      <pre id="assayOut" style="margin:8px 0 0;max-height:140px;overflow:auto;font-size:11px;line-height:1.35;color:#b8c0d0;white-space:pre-wrap"></pre>
    </div>
  `;
  let assay = null;
  const status = () => el.querySelector("#assayStatus");
  const out = () => el.querySelector("#assayOut");

  function currentLesion() {
    const raw = el.querySelector("#assayLesionIn")?.value || "";
    return parseLesionFlag(raw);
  }

  async function runTrial(lesionCfg) {
    const fly = getFly();
    if (!fly) {
      status().textContent = "no fly";
      return;
    }
    const lesion = normalizeLesion(lesionCfg || currentLesion());
    if (applyLesion) await applyLesion(fly, lesion);
    assay = new ApproachAssay({
      arena,
      keyLight,
      ambient,
      fly,
      lesion,
      onComplete: (r) => {
        status().textContent = r.interesting
          ? `interesting · ${r.failure}`
          : `done · ${r.failure || "ok"}`;
        out().textContent = JSON.stringify(
          {
            lesion: r.lesionSummary,
            failure: r.failure,
            interesting: r.interesting,
            metrics: r.metrics,
            steering: r.portable?.steering,
          },
          null,
          2
        );
        try {
          const prev = JSON.parse(localStorage.getItem("ffb-assay-log") || "[]");
          prev.push(r);
          localStorage.setItem("ffb-assay-log", JSON.stringify(prev.slice(-50)));
        } catch (_) {}
      },
    });
    assay.start(fly, arena, keyLight, lesion);
    status().textContent = `running · ${lesionSummary(lesion)}`;
    out().textContent = "";
  }

  el.querySelector("#assayRun").onclick = () => runTrial();
  el.querySelector("#assaySilenceHS").onclick = () => {
    el.querySelector("#assayLesionIn").value = "silence:HS";
    runTrial(parseLesionFlag("silence:HS"));
  };
  el.querySelector("#assayClearLesion").onclick = () => {
    const fly = getFly();
    if (fly && clearLesion) clearLesion(fly);
    status().textContent = "lesion cleared";
  };

  const btn = el.querySelector(".collapse");
  if (btn) {
    btn.onclick = () => {
      el.classList.toggle("collapsed");
      btn.textContent = el.classList.contains("collapsed") ? "+" : "–";
    };
  }

  return {
    el,
    tick(dt) {
      if (assay && assay.active) {
        assay.tick(dt);
        const st = status();
        if (st && assay.phase) {
          st.textContent = `${assay.phase} · t=${assay.t.toFixed(1)}s · ${lesionSummary(assay.lesion)}`;
        }
      }
    },
    runTrial,
    getAssay: () => assay,
  };
}
