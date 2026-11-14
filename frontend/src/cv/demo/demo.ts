/**
 * Plain-TS test bench for the CV module (served at /cv-demo.html by `npm run dev`).
 * Not part of the product UI; it exists to check tracking on a real camera.
 */

import { SquatTracker, VoiceCoach, type TrackerState } from "../index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("overlay");
const startBtn = $<HTMLButtonElement>("start");
const pauseBtn = $<HTMLButtonElement>("pause");
const stopBtn = $<HTMLButtonElement>("stop");
const msg = $("msg");
const log = $("log");

const voiceBtn = $<HTMLButtonElement>("voice");

const tracker = new SquatTracker(video, canvas);
const coach = new VoiceCoach(tracker);
let coachAttached = false;

function renderVoiceButton() {
  if (!coach.supported) {
    voiceBtn.disabled = true;
    voiceBtn.textContent = "Voice not supported";
    return;
  }
  voiceBtn.textContent = coach.isEnabled ? "🔊 Voice on" : "🔇 Voice off";
  voiceBtn.setAttribute("aria-pressed", String(coach.isEnabled));
}
renderVoiceButton();
voiceBtn.addEventListener("click", () => {
  coach.setEnabled(!coach.isEnabled);
  renderVoiceButton();
});

const fmt = (v: number | null, unit: string) => (v === null ? "–" : `${Math.round(v)}${unit}`);
const tag = (source: "measured" | "estimated") =>
  `<span class="tag ${source === "measured" ? "m" : "e"}">${source}</span>`;
const row = (label: string, value: string, source: "measured" | "estimated") =>
  `<div class="row"><span>${label}${tag(source)}</span><strong>${value}</strong></div>`;

function addLog(line: string) {
  log.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${log.textContent ?? ""}`;
}

function render(s: TrackerState) {
  $("reps").textContent = String(s.repCount);
  $("status").textContent =
    s.status === "tracking"
      ? s.landmarksVisible
        ? s.armed
          ? `phase: ${s.phase}`
          : "Stand up straight to start counting"
        : "Can't see your hips, knees and ankles"
      : s.status;
  $("metrics").innerHTML = [
    row("Knee angle", fmt(s.liveAngles.knee, "°"), "measured"),
    row("Hip angle", fmt(s.liveAngles.hip, "°"), "measured"),
    row(
      `Hips dropped (need ${Math.round(tracker.getCounterConfig().minHipDrop * 100)}%)`,
      s.liveHipDrop === null ? "–" : `${Math.max(0, Math.round(s.liveHipDrop * 100))}%`,
      "measured",
    ),
    row("Last rep time", s.lastRep ? `${(s.lastRep.durationMs / 1000).toFixed(2)} s` : "–", "measured"),
    row("Last rep depth", s.lastRep ? fmt(s.lastRep.minKneeAngle.value, "°") : "–", "measured"),
    row(
      "Camera view",
      `${s.cameraView.view}${s.cameraView.confidence ? ` (${Math.round(s.cameraView.confidence * 100)}%)` : ""}`,
      "estimated",
    ),
  ].join("");

  msg.textContent = s.error?.message ?? s.viewWarning?.message ?? s.lastRejection?.message ?? "";
  startBtn.disabled = s.status === "tracking" || s.status === "starting-camera" || s.status === "loading-model";
  startBtn.textContent = s.status === "paused" ? "Resume" : "Start";
  pauseBtn.disabled = s.status !== "tracking";
  stopBtn.disabled = s.status !== "tracking" && s.status !== "paused";
}

tracker.subscribe(render);
tracker.onRep((r) =>
  addLog(
    `✓ rep ${r.repNumber}: lowest ${Math.round(r.minKneeAngle.value)}°, ${(r.durationMs / 1000).toFixed(2)}s` +
      (r.formFlags.length ? `  [${r.formFlags.map((f) => `${f.code}/${f.source}`).join(", ")}]` : ""),
  ),
);
tracker.onRejected((f) => {
  const a = tracker.getState().lastAttempt;
  const low = a?.minKneeAngle != null ? `lowest ${Math.round(a.minKneeAngle)}°, ` : "";
  addLog(`✗ not counted: ${low}${f.code}`);
});

// ---- depth calibration ---------------------------------------------------
const depthInput = $<HTMLInputElement>("depth");
const depthVal = $("depthVal");
const curMin = $("curMin");
const DEPTH_KEY = "jimbro.cv.depthAngle";

function applyDepth(deg: number) {
  try {
    tracker.setCounterConfig({ depthAngle: deg });
    depthInput.value = String(deg);
    depthVal.textContent = `${deg}°`;
  } catch {
    depthInput.value = String(tracker.getCounterConfig().depthAngle);
  }
}
try {
  const saved = Number(localStorage.getItem(DEPTH_KEY));
  if (saved >= 70 && saved <= 125) applyDepth(saved);
} catch {
  /* storage unavailable: keep the default */
}
depthInput.addEventListener("input", () => {
  const deg = Number(depthInput.value);
  applyDepth(deg);
  try {
    localStorage.setItem(DEPTH_KEY, String(deg));
  } catch {
    /* ignore */
  }
});

// Lowest knee angle of the current (or last) descent, including shallow dips
// the counter ignores. Held until the next descent starts. Written straight to
// the DOM; no throttled state needed.
let attemptMin: number | null = null;
let prevPhase = "standing";
let lastShown = 0;
tracker.onFrame((f) => {
  if (f.kneeAngle !== null && f.phase !== "standing") {
    attemptMin = prevPhase === "standing" || attemptMin === null ? f.kneeAngle : Math.min(attemptMin, f.kneeAngle);
  }
  prevPhase = f.phase;
  if (f.timestamp - lastShown > 100) {
    lastShown = f.timestamp;
    curMin.textContent = attemptMin === null ? "–" : `${Math.round(attemptMin)}°`;
  }
});

startBtn.addEventListener("click", () => {
  // Browsers only allow speech after a click, so the coach starts here.
  if (!coachAttached) {
    coach.attach();
    coachAttached = true;
  }
  void tracker.start();
});
pauseBtn.addEventListener("click", () => tracker.pause());
stopBtn.addEventListener("click", () => {
  const session = tracker.stop();
  coach.announceSession(session);
  addLog(`session ended:\n${JSON.stringify(session.summary, null, 2)}`);
  console.info("WorkoutSession", session);
});
