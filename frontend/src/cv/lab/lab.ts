/**
 * Validation lab (served at /cv-lab.html by `npm run dev`): extract landmarks
 * from videos, annotate as an independent reviewer, evaluate the tracker
 * against annotations, export a dataset. Internal tool, not product UI.
 */

import type { ExerciseId } from "../../../../shared/types";
import { EXERCISE_IDS, getExercise } from "../exercises";
import { DEFAULT_DETECTOR_OPTIONS, drawSkeleton } from "../pose_detection";
import { extractRecording } from "../video_analysis";
import { exportDataset, toJsonl } from "../validation/dataset";
import { evaluate, type Evaluation } from "../validation/evaluate";
import {
  ANGLE_JOINTS,
  assertRecording,
  toLandmarks,
  type Annotation,
  type AngleCheck,
  type AngleJoint,
  type Recording,
  type RepAnnotation,
  type TraitLabel,
  type View,
} from "../validation/format";
import { renderMarkdown, summarize } from "../validation/report";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("overlay");
const status = (msg: string) => ($("status").textContent = msg);

const MODEL_URLS = {
  lite: DEFAULT_DETECTOR_OPTIONS.modelAssetPath,
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
} as const;

const recordings: Recording[] = [];
let active: Recording | null = null;
let videoFile: File | null = null;
let videoSha: string | null = null;
let lastReport = "";

// ---- helpers ---------------------------------------------------------------

async function sha256(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const sec = (ms: number) => (ms / 1000).toFixed(2);


// ---- 1. recording -----------------------------------------------------------

$<HTMLInputElement>("video-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  videoFile = file;
  status("Hashing video…");
  videoSha = await sha256(file);
  video.src = URL.createObjectURL(file);
  await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
  const match = recordings.find((r) => r.source.sha256 === videoSha);
  if (match) setActive(match);
  $<HTMLButtonElement>("extract").disabled = false;
  status(match ? `Video matches recording ${match.id.slice(0, 8)}.` : `Loaded ${file.name}. Extract landmarks next.`);
});

$("extract").addEventListener("click", async () => {
  if (!videoFile || !videoSha) return;
  const subjectId = $<HTMLInputElement>("subject").value.trim();
  if (!subjectId) return status("Enter a pseudonymous subject ID first (needed for subject-wise evaluation).");
  const variant = $<HTMLSelectElement>("model").value as keyof typeof MODEL_URLS;
  const sampleMs = Math.max(10, Number($<HTMLInputElement>("sample-ms").value) || 33);
  $<HTMLButtonElement>("extract").disabled = true;
  try {
    status("Loading pose model…");
    const rec = await extractRecording(video, videoFile, {
      sampleMs,
      subjectId,
      mirrored: $<HTMLInputElement>("mirrored").checked,
      detector: { modelAssetPath: MODEL_URLS[variant] },
      onProgress: (f) => status(`Extracting… ${Math.round(f * 100)}%`),
    });
    const frames = rec.frames;
    assertRecording(rec);
    recordings.push(rec);
    setActive(rec);
    const found = frames.filter((f) => f.lm).length;
    status(`Extracted ${frames.length} frames; a person was found in ${found}. Save it, then annotate.`);
  } catch (err) {
    status(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    $<HTMLButtonElement>("extract").disabled = false;
  }
});


$<HTMLInputElement>("load").addEventListener("change", async (e) => {
  for (const file of (e.target as HTMLInputElement).files ?? []) {
    try {
      const rec: unknown = JSON.parse(await file.text());
      assertRecording(rec);
      const existing = recordings.findIndex((r) => r.id === rec.id);
      if (existing >= 0) recordings[existing] = rec;
      else recordings.push(rec);
      setActive(rec);
      status(`Loaded ${file.name}: ${rec.frames.length} frames, ${rec.annotations.length} annotation(s).`);
    } catch (err) {
      status(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
});

$("save").addEventListener("click", () => {
  if (active) download(`recording-${active.subjectId}-${active.id.slice(0, 8)}.json`, JSON.stringify(active));
});

$<HTMLSelectElement>("active").addEventListener("change", (e) => {
  const rec = recordings.find((r) => r.id === (e.target as HTMLSelectElement).value);
  if (rec) setActive(rec);
});

function setActive(rec: Recording) {
  active = rec;
  const sel = $<HTMLSelectElement>("active");
  sel.innerHTML = recordings
    .map((r) => `<option value="${r.id}">${r.subjectId} · ${escapeHtml(r.source.fileName)} · ${r.annotations.length} ann.</option>`)
    .join("");
  sel.value = rec.id;
  $<HTMLButtonElement>("save").disabled = false;
  renderAnnotationList();
  if (videoSha && videoSha !== rec.source.sha256) status("Note: the loaded video doesn't match this recording's hash.");
}

// Skeleton overlay from the extracted frames, so landmark errors are visible while annotating.
function drawOverlay() {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth || 1;
    canvas.height = video.videoHeight || 1;
  }
  if (!active || active.source.sha256 !== videoSha) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const t = video.currentTime * 1000;
  let best = active.frames[0];
  for (const f of active.frames) if (Math.abs(f.t - t) < Math.abs(best!.t - t)) best = f;
  drawSkeleton(ctx, toLandmarks(best?.lm ?? null), { minVisibility: 0.6 });
}
video.addEventListener("timeupdate", drawOverlay);
video.addEventListener("seeked", drawOverlay);

// ---- 2. annotate --------------------------------------------------------------

const exSel = $<HTMLSelectElement>("exercise");
exSel.innerHTML = EXERCISE_IDS.map((id) => `<option value="${id}">${getExercise(id).name}</option>`).join("");
$<HTMLSelectElement>("angle-joint").innerHTML = Object.keys(ANGLE_JOINTS).map((j) => `<option>${j}</option>`).join("");

let reps: RepAnnotation[] = [];
let angles: AngleCheck[] = [];
let traits: TraitLabel[] = [];
let pendingStart: number | null = null;
const nowMs = () => Math.round(video.currentTime * 1000);

function markStart() {
  pendingStart = nowMs();
  $("pending").textContent = `start at ${sec(pendingStart)} s…`;
}
function markEnd() {
  if (pendingStart === null) return status("Mark a rep start first.");
  const end = nowMs();
  if (end <= pendingStart) return status("Rep end must be after its start.");
  reps.push({ start: pendingStart, end });
  reps.sort((a, b) => a.start - b.start);
  pendingStart = null;
  $("pending").textContent = "";
  renderReps();
}
$("rep-start").addEventListener("click", markStart);
$("rep-end").addEventListener("click", markEnd);
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, select")) return;
  if (e.key === "s" || e.key === "S") markStart();
  if (e.key === "e" || e.key === "E") markEnd();
});

function renderReps() {
  const ex = exSel.value as ExerciseId;
  const roleOptions =
    ex === "lunge" ? ["", "left", "right"] : ex === "bicep_curl" ? ["", "left", "right", "both"] : null;
  $("reps").innerHTML = reps
    .map((r, i) => {
      const cur = r.frontLeg ?? r.arm ?? "";
      const sel = roleOptions
        ? `<select data-role="${i}">${roleOptions.map((o) => `<option ${o === cur ? "selected" : ""} value="${o}">${o || "–"}</option>`).join("")}</select>`
        : "–";
      return `<tr><td>${i + 1}</td><td>${sec(r.start)}–${sec(r.end)}</td><td>${sel}</td><td><button class="secondary" data-del="${i}">✕</button></td></tr>`;
    })
    .join("");
  $<HTMLSelectElement>("trait-rep").innerHTML =
    `<option value="">whole set</option>` + reps.map((_, i) => `<option value="${i}">rep ${i + 1}</option>`).join("");
}
$("reps").addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  const i = Number(el.dataset.role);
  const rep = reps[i];
  if (!rep) return;
  const v = el.value || undefined;
  if (exSel.value === "lunge") rep.frontLeg = v as RepAnnotation["frontLeg"];
  else rep.arm = v as RepAnnotation["arm"];
});
$("reps").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).dataset.del;
  if (i === undefined) return;
  reps.splice(Number(i), 1);
  renderReps();
});
exSel.addEventListener("change", renderReps);

$("angle-add").addEventListener("click", () => {
  const degrees = Number($<HTMLInputElement>("angle-deg").value);
  if (!Number.isFinite(degrees) || degrees <= 0 || degrees > 180) return status("Enter an angle between 0 and 180°.");
  angles.push({
    t: nowMs(),
    joint: $<HTMLSelectElement>("angle-joint").value as AngleJoint,
    degrees,
    method: $<HTMLSelectElement>("angle-method").value as AngleCheck["method"],
  });
  $("angles").textContent = angles.map((a) => `${sec(a.t)} s ${a.joint} ${a.degrees}° (${a.method})`).join(" · ");
});

$("trait-add").addEventListener("click", () => {
  const code = $<HTMLInputElement>("trait-code").value.trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) return status("Enter a characteristic code.");
  const repVal = $<HTMLSelectElement>("trait-rep").value;
  traits.push({ rep: repVal === "" ? null : Number(repVal), code, value: $<HTMLSelectElement>("trait-value").value as TraitLabel["value"] });
  $("traits").textContent = traits.map((t) => `${t.rep === null ? "set" : `rep ${t.rep + 1}`}: ${t.code}=${t.value}`).join(" · ");
});

function clearAnnotation() {
  reps = [];
  angles = [];
  traits = [];
  pendingStart = null;
  $("angles").textContent = "";
  $("traits").textContent = "";
  $<HTMLTextAreaElement>("notes").value = "";
  renderReps();
}
$("ann-clear").addEventListener("click", clearAnnotation);

$("ann-save").addEventListener("click", () => {
  if (!active) return status("Extract or load a recording first.");
  const reviewerId = $<HTMLInputElement>("reviewer").value.trim();
  if (!reviewerId) return status("Enter your reviewer ID.");
  const ann: Annotation = {
    id: uid(),
    reviewer: { id: reviewerId, role: $<HTMLSelectElement>("role").value as Annotation["reviewer"]["role"] },
    createdAt: new Date().toISOString(),
    exercise: exSel.value as ExerciseId,
    variation: $<HTMLInputElement>("variation").value.trim() || "unspecified",
    view: $<HTMLSelectElement>("view").value as View,
    reps: [...reps],
    angleChecks: [...angles],
    traits: [...traits],
    notes: $<HTMLTextAreaElement>("notes").value.trim() || undefined,
  };
  const candidate = { ...active, annotations: [...active.annotations, ann] };
  try {
    assertRecording(candidate);
  } catch (err) {
    return status(err instanceof Error ? err.message : String(err));
  }
  active.annotations.push(ann);
  clearAnnotation();
  setActive(active);
  status(`Saved annotation by ${reviewerId}: ${ann.reps.length} reps. Remember to save the recording file.`);
});

function renderAnnotationList() {
  $("ann-list").textContent = active
    ? active.annotations.map((a) => `${a.reviewer.id} (${a.reviewer.role}) · ${a.exercise} · ${a.view} · ${a.reps.length} reps`).join(" | ")
    : "";
}

// ---- 3. evaluate and export -----------------------------------------------------

$("evaluate").addEventListener("click", () => {
  const evals: Evaluation[] = [];
  for (const rec of recordings) for (const ann of rec.annotations) evals.push(evaluate(rec, ann));
  if (evals.length === 0) return status("No annotated recordings loaded.");
  lastReport = renderMarkdown(summarize(evals));
  const perRec = evals
    .map(
      (e) =>
        `${e.subjectId} ${e.exercise}/${e.view} by ${e.reviewerId}: reps ${e.reps.predicted}/${e.reps.annotated} (missed ${e.reps.missed}, extra ${e.reps.falsePositives})` +
        (e.legRoles ? `, front leg ${e.legRoles.correct}/${e.legRoles.checked} (uncertain ${e.legRoles.uncertain})` : "") +
        (e.arms ? `, arm ${e.arms.correct}/${e.arms.checked}` : "") +
        (e.angles.groundTruth.n ? `, angle MAE ${e.angles.groundTruth.meanAbsError!.toFixed(1)}°` : "") +
        `, recognised as ${e.recognition.predicted ?? "?"}`,
    )
    .join("\n");
  $("report").textContent = `${lastReport}\n\nPer annotation:\n${perRec}`;
  $<HTMLButtonElement>("report-dl").disabled = false;
  download("evaluations.json", JSON.stringify(evals, null, 2));
  status(`Evaluated ${evals.length} annotation(s).`);
});

$("report-dl").addEventListener("click", () => download("validation-report.md", lastReport, "text/markdown"));

$("dataset-dl").addEventListener("click", () => {
  const rows = exportDataset(recordings);
  if (rows.length === 0) return status("No annotated reps to export.");
  download("jimbro-reps.jsonl", toJsonl(rows), "application/x-ndjson");
  status(`Exported ${rows.length} reps from ${recordings.length} recording(s).`);
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

renderReps();
