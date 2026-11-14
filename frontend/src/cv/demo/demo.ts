/**
 * Plain-TS test bench for the CV module (served at /cv-demo.html by `npm run dev`).
 * Not part of the product UI; it exists to check tracking on a real camera.
 */

import { SquatTracker, type TrackerState } from "../index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("overlay");
const startBtn = $<HTMLButtonElement>("start");
const pauseBtn = $<HTMLButtonElement>("pause");
const stopBtn = $<HTMLButtonElement>("stop");
const msg = $("msg");
const log = $("log");

const tracker = new SquatTracker(video, canvas);

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
    `rep ${r.repNumber}: ${(r.durationMs / 1000).toFixed(2)}s, depth ${r.minKneeAngle.value}°` +
      (r.formFlags.length ? `  [${r.formFlags.map((f) => `${f.code}/${f.source}`).join(", ")}]` : ""),
  ),
);
tracker.onRejected((f) => addLog(`not counted: ${f.code}`));

startBtn.addEventListener("click", () => void tracker.start());
pauseBtn.addEventListener("click", () => tracker.pause());
stopBtn.addEventListener("click", () => {
  const session = tracker.stop();
  addLog(`session ended:\n${JSON.stringify(session.summary, null, 2)}`);
  console.info("WorkoutSession", session);
});
