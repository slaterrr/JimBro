/**
 * Plain-TS test bench for the CV module (served at /cv-demo.html by `npm run dev`).
 * Not part of the product UI; it exists to check tracking on a real camera.
 */

import type { ExerciseId } from "../../../../shared/types";
import { DEFAULT_DETECTOR_OPTIONS, EXERCISE_IDS, ExerciseTracker, VoiceCoach, getExercise, type TrackerState } from "../index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("overlay");
const startBtn = $<HTMLButtonElement>("start");
const pauseBtn = $<HTMLButtonElement>("pause");
const stopBtn = $<HTMLButtonElement>("stop");
const voiceBtn = $<HTMLButtonElement>("voice");
const fileInput = $<HTMLInputElement>("file");
const fileLabel = $("fileLabel");
const stage = $("stage");
const picker = $("picker");
const msg = $("msg");
const log = $("log");
const peakInput = $<HTMLInputElement>("peak");
const progressInput = $<HTMLInputElement>("progress");

// ---- per-viewer settings (browser storage; optional) ----------------------
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`jimbro.cv.v3.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`jimbro.cv.v3.${key}`, value);
    } catch {
      /* storage unavailable */
    }
  },
};

// Pose model variant, for comparing accuracy vs. speed: ?model=lite|full|heavy (default lite).
const MODEL_URLS = {
  lite: DEFAULT_DETECTOR_OPTIONS.modelAssetPath,
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
} as const;
type ModelVariant = keyof typeof MODEL_URLS;
const requested = new URLSearchParams(location.search).get("model");
const model: ModelVariant = requested === "full" || requested === "heavy" ? requested : "lite";

const savedExercise = store.get("exercise") as ExerciseId | null;
const tracker = new ExerciseTracker(video, canvas, {
  exercise: savedExercise && EXERCISE_IDS.includes(savedExercise) ? savedExercise : "squat",
  detector: { modelAssetPath: MODEL_URLS[model] },
});

const modelSelect = $<HTMLSelectElement>("model");
modelSelect.value = model;
modelSelect.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("model", modelSelect.value);
  location.href = url.toString(); // the model loads once per page, so reload
});
const coach = new VoiceCoach(tracker);
let coachAttached = false;

// ---- exercise picker -----------------------------------------------------
const pickerButtons = new Map<ExerciseId, HTMLButtonElement>();
for (const id of EXERCISE_IDS) {
  const b = document.createElement("button");
  b.textContent = getExercise(id).name;
  b.addEventListener("click", () => selectExercise(id));
  picker.append(b);
  pickerButtons.set(id, b);
}

function selectExercise(id: ExerciseId) {
  const s = tracker.getState().status;
  if (s === "tracking" || s === "paused") return; // end the session first
  tracker.setExercise(id);
  store.set("exercise", id);
  log.textContent = "";
  setupExerciseUi();
}

function setupExerciseUi() {
  const ex = tracker.getExercise();
  for (const [id, b] of pickerButtons) b.setAttribute("aria-pressed", String(id === ex.id));
  $("setup").textContent = ex.setupInstructions;

  // Full-range line slider. Bounds keep the counter config valid.
  const c = tracker.getCounterConfig();
  const dec = c.direction === "decreasing";
  const joint = ex.primaryJoint;
  $("angleLabel").innerHTML = dec
    ? `Full-range line: a rep counts only if your ${joint} bends <strong>below</strong> this`
    : `Full-range line: a rep counts only if your ${joint} straightens <strong>above</strong> this`;
  if (dec) {
    peakInput.min = String(Math.max(20, c.peakAngle - 35));
    peakInput.max = String(Math.min(c.partialAngle, c.leaveStartAngle - c.hysteresis) - 1);
  } else {
    peakInput.min = String(Math.max(c.partialAngle, c.leaveStartAngle + c.hysteresis) + 1);
    peakInput.max = String(Math.min(178, c.peakAngle + 20));
  }
  const savedPeak = Number(store.get(`${ex.id}.peak`));
  applyPeak(savedPeak >= Number(peakInput.min) && savedPeak <= Number(peakInput.max) ? savedPeak : c.peakAngle);

  // Progress slider (hidden for exercises without one).
  $("progressBox").hidden = !ex.progress;
  if (ex.progress) {
    $("progressLabel").textContent = `…and ${ex.progress.label.toLowerCase()} must reach at least this (${ex.progress.hint})`;
    const savedPct = Number(store.get(`${ex.id}.progress`));
    applyProgress(savedPct >= 10 && savedPct <= 95 ? savedPct : Math.round(c.minProgress * 100));
  }
  $("guide").textContent = `Guide: ${ex.calibrationGuide}`;
  attemptPeak = null;
  $("curPeak").textContent = "–";
  render(tracker.getState());
}

function applyPeak(deg: number) {
  try {
    tracker.setCounterConfig({ peakAngle: deg });
  } catch {
    deg = tracker.getCounterConfig().peakAngle;
  }
  peakInput.value = String(deg);
  $("peakVal").textContent = `${deg}°`;
}

function applyProgress(pct: number) {
  try {
    tracker.setCounterConfig({ minProgress: pct / 100 });
  } catch {
    pct = Math.round(tracker.getCounterConfig().minProgress * 100);
  }
  progressInput.value = String(pct);
  $("progressVal").textContent = `${pct}%`;
}

peakInput.addEventListener("input", () => {
  applyPeak(Number(peakInput.value));
  store.set(`${tracker.getExercise().id}.peak`, peakInput.value);
});
progressInput.addEventListener("input", () => {
  applyProgress(Number(progressInput.value));
  store.set(`${tracker.getExercise().id}.progress`, progressInput.value);
});

// ---- live readouts -------------------------------------------------------
const fmt = (v: number | null, unit: string) => (v === null ? "–" : `${Math.round(v)}${unit}`);
const pct = (v: number | null) => (v === null ? "–" : `${Math.max(0, Math.round(v * 100))}%`);
const tag = (source: "measured" | "estimated") =>
  `<span class="tag ${source === "measured" ? "m" : "e"}">${source}</span>`;
const row = (label: string, value: string, source: "measured" | "estimated") =>
  `<div class="row"><span>${label}${tag(source)}</span><strong>${value}</strong></div>`;

function addLog(line: string) {
  log.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${log.textContent ?? ""}`;
}

function render(s: TrackerState) {
  const ex = getExercise(s.exercise);
  const c = tracker.getCounterConfig();
  $("reps").textContent = String(s.repCount);
  $("status").textContent =
    s.status === "tracking"
      ? s.positionHint ??
        (s.landmarksVisible ? (s.armed ? `phase: ${s.phaseLabel}` : ex.startPrompt) : "Can't see the joints I need")
      : s.status;
  if (s.videoProgress) {
    $("status").textContent += ` · video ${s.videoProgress.current.toFixed(1)} / ${s.videoProgress.duration.toFixed(1)} s`;
  }

  const joint = ex.primaryJoint[0]!.toUpperCase() + ex.primaryJoint.slice(1);
  const rows = [row(`${joint} angle`, fmt(s.liveAngle, "°"), "measured")];
  if (ex.progress) {
    rows.push(row(`${ex.progress.label} (need ${Math.round(c.minProgress * 100)}%)`, pct(s.liveProgress), "measured"));
  }
  rows.push(
    row("Last rep time", s.lastRep ? `${(s.lastRep.durationMs / 1000).toFixed(2)} s` : "–", "measured"),
    row("Last rep range", s.lastRep ? fmt(s.lastRep.peakAngle.value, "°") : "–", "measured"),
    ...(ex.quality
      ? [
          row(
            ex.quality.raiseFlag
              ? `Pattern vs. reference (flag ≥ ${Math.round(ex.quality.model.spec.threshold * 100)}%)`
              : "Pattern vs. reference (experimental, no feedback)",
            s.lastRep?.movementQuality ? `${s.lastRep.movementQuality.value}% off` : "–",
            "estimated",
          ),
        ]
      : []),
    row(
      "Tracking (visible · glitches · gaps)",
      s.status === "idle"
        ? "–"
        : `${pct(s.trackingQuality.visible)} · ${pct(s.trackingQuality.glitches)} · ${pct(s.trackingQuality.bridged)}`,
      "measured",
    ),
    row("Measured from", `${s.measuredView} view${s.measuredView === "front" && ex.cameraView === "side" ? " (3D estimate)" : ""}`, "measured"),
    row(
      `Camera view (want ${[ex.cameraView, ...(ex.otherViews ?? [])].join(" or ")})`,
      `${s.cameraView.view}${s.cameraView.confidence ? ` (${Math.round(s.cameraView.confidence * 100)}%)` : ""}`,
      "estimated",
    ),
  );
  $("metrics").innerHTML = rows.join("");

  msg.textContent = s.error?.message ?? s.viewWarning?.message ?? s.lastRejection?.message ?? "";
  const busy = s.status === "tracking" || s.status === "starting-camera" || s.status === "loading-model";
  startBtn.disabled = busy;
  startBtn.textContent = s.status === "paused" ? "Resume" : "Start";
  pauseBtn.disabled = s.status !== "tracking";
  stopBtn.disabled = s.status !== "tracking" && s.status !== "paused";
  const locked = busy || s.status === "paused";
  for (const b of pickerButtons.values()) b.disabled = locked;
  fileInput.disabled = locked;
  fileLabel.setAttribute("aria-disabled", String(locked));
}

// Furthest angle of the current (or last) attempt, held until the next attempt
// starts. Written straight to the DOM; no throttled state needed.
let attemptPeak: number | null = null;
let prevPhase = "start";
let lastShown = 0;
tracker.onFrame((f) => {
  if (f.primaryAngle !== null && f.phase !== "start") {
    const further = tracker.getCounterConfig().direction === "decreasing" ? Math.min : Math.max;
    attemptPeak = prevPhase === "start" || attemptPeak === null ? f.primaryAngle : further(attemptPeak, f.primaryAngle);
  }
  prevPhase = f.phase;
  if (f.timestamp - lastShown > 100) {
    lastShown = f.timestamp;
    $("curPeak").textContent = attemptPeak === null ? "–" : `${Math.round(attemptPeak)}°`;
  }
});

tracker.subscribe(render);
tracker.onRep((r) =>
  addLog(
    `✓ rep ${r.repNumber}: ${Math.round(r.peakAngle.value)}°, ${(r.durationMs / 1000).toFixed(2)}s` +
      (r.movementQuality ? `, pattern score ${r.movementQuality.value}% (estimated)` : "") +
      (r.formFlags.length ? `  [${r.formFlags.map((f) => `${f.code}/${f.source}`).join(", ")}]` : ""),
  ),
);
tracker.onRejected((f) => {
  const a = tracker.getState().lastAttempt;
  const angle = a?.peakAngle != null ? `${Math.round(a.peakAngle)}°, ` : "";
  const prog = a?.progress != null ? `${pct(a.progress)}, ` : "";
  addLog(`✗ not counted: ${angle}${prog}${f.code}`);
});

// ---- voice ---------------------------------------------------------------
function renderVoiceButton() {
  if (!coach.supported) {
    voiceBtn.disabled = true;
    voiceBtn.textContent = "Voice not supported";
    return;
  }
  voiceBtn.textContent = coach.isEnabled ? "🔊 Voice on" : "🔇 Voice off";
  voiceBtn.setAttribute("aria-pressed", String(coach.isEnabled));
}
voiceBtn.addEventListener("click", () => {
  coach.setEnabled(!coach.isEnabled);
  renderVoiceButton();
});

// ---- controls ------------------------------------------------------------
function attachCoach() {
  // Browsers only allow speech after a click, so the coach starts here.
  if (!coachAttached) {
    coach.attach();
    coachAttached = true;
  }
}

startBtn.addEventListener("click", () => {
  attachCoach();
  // Start = camera, unless a paused video is waiting to resume.
  if (tracker.getState().status !== "paused") stage.classList.remove("recorded");
  void tracker.start();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // allow picking the same file again
  if (!file) return;
  attachCoach();
  stage.classList.add("recorded");
  log.textContent = "";
  addLog(`analysing ${file.name}`);
  void tracker.startFile(file);
});

function logSession(session: ReturnType<typeof tracker.stop>) {
  coach.announceSession(session);
  const summary = session.summary;
  if (!summary) {
    addLog("session ended: no reps counted");
  } else {
    const { insights, ...rest } = summary;
    addLog(
      `session ended:\n${JSON.stringify(rest, null, 2)}` +
        (insights.length ? `\n${insights.map((f) => `• ${f.message} (${f.source})`).join("\n")}` : ""),
    );
  }
  console.info("WorkoutSession", session);
}
tracker.onSessionEnd(logSession);
pauseBtn.addEventListener("click", () => tracker.pause());
stopBtn.addEventListener("click", () => logSession(tracker.stop()));

renderVoiceButton();
setupExerciseUi();
