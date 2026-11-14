/**
 * Jim Bro app page (served at / by `npm run dev`).
 *
 * Primary: Live workout. The camera is analysed frame by frame while you
 * train: skeleton, live angles, rep count, timer and feedback.
 * Secondary: Analyze video. Upload a recording and get a per-rep report.
 *
 * Both use the same engine (ExerciseTracker): live via the camera loop,
 * video via landmark extraction and replay (see cv/video_analysis.ts).
 */

import type { ExerciseId, RepEvent, WorkoutSession } from "../../../shared/types";
import { EXERCISE_IDS, ExerciseTracker, VoiceCoach, getExercise, type TrackerState } from "../cv";
import { drawSkeleton } from "../cv/pose_detection";
import { toLandmarks, type Recording } from "../cv/validation/format";
import { analyzeRecording, extractRecording, type VideoReport } from "../cv/video_analysis";
import { FeedbackFeed, SessionClock, SIGNAL_LABELS, formatDuration, formatSignal } from "./live_feedback";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`jimbro.app.${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`jimbro.app.${k}`, v);
    } catch {
      /* storage unavailable */
    }
  },
};

// ---- tabs ---------------------------------------------------------------------

function showTab(which: "live" | "video") {
  const liveBusy = ["tracking", "starting-camera", "loading-model"].includes(tracker.getState().status);
  if (which === "video" && liveBusy) tracker.pause(); // never compete with a live session for the camera/model
  $("live").hidden = which !== "live";
  $("video").hidden = which !== "video";
  $("tab-live").setAttribute("aria-selected", String(which === "live"));
  $("tab-video").setAttribute("aria-selected", String(which === "video"));
}
$("tab-live").addEventListener("click", () => showTab("live"));
$("tab-video").addEventListener("click", () => showTab("video"));

// ---- LIVE WORKOUT ---------------------------------------------------------------

const liveVideo = $<HTMLVideoElement>("live-video");
const savedEx = store.get("exercise") as ExerciseId | null;
const tracker = new ExerciseTracker(liveVideo, $<HTMLCanvasElement>("live-canvas"), {
  exercise: savedEx && EXERCISE_IDS.includes(savedEx) ? savedEx : "squat",
});
const coach = new VoiceCoach(tracker);
const feed = new FeedbackFeed();
const clock = new SessionClock();
let coachAttached = false;
let lastSession: WorkoutSession | null = null;

const picker = $("live-picker");
const pickerButtons = new Map<ExerciseId, HTMLButtonElement>();
for (const id of EXERCISE_IDS) {
  const b = document.createElement("button");
  b.textContent = getExercise(id).name;
  b.addEventListener("click", () => {
    const st = tracker.getState().status;
    if (st === "tracking" || st === "paused") return;
    tracker.setExercise(id);
    store.set("exercise", id);
    renderPicker();
  });
  picker.append(b);
  pickerButtons.set(id, b);
}

function renderPicker() {
  const ex = tracker.getExercise();
  for (const [id, b] of pickerButtons) b.setAttribute("aria-pressed", String(id === ex.id));
  $("live-setup").textContent = ex.setupInstructions;
}

function renderLive(s: TrackerState) {
  const ex = getExercise(s.exercise);
  const active = s.status === "tracking" || s.status === "paused";
  $("live-idle").hidden = active || s.status === "starting-camera" || s.status === "loading-model";
  if (s.status === "starting-camera") $("live-idle").textContent = "Starting camera…";
  $("live-hud").hidden = !active;
  $("live-reps").textContent = String(s.repCount);
  $("live-phase").textContent = s.status === "paused" ? "paused" : s.armed ? s.phaseLabel : ex.startPrompt;

  // One hint slot: errors first, then position/visibility, then camera angle.
  const hint =
    s.error?.message ??
    (s.status === "loading-model" ? "Loading the pose model…" : null) ??
    (s.status === "tracking"
      ? s.positionHint ?? (!s.landmarksVisible ? "I can't see the joints I need. Step back into view." : s.viewWarning?.message ?? null)
      : null);
  feed.setHint(hint);
  $("live-hint").textContent = feed.hint ?? "";

  // Live angles: the counting angle, then this exercise's own signals.
  const rows: string[] = [];
  if (s.liveAngle !== null) {
    rows.push(row(`${cap(ex.primaryJoint)} angle <span class="tag m">counting</span>`, `${Math.round(s.liveAngle)}°`));
  }
  if (ex.progress && s.liveProgress !== null) {
    rows.push(row(`${ex.progress.label}`, `${Math.max(0, Math.round(s.liveProgress * 100))}%`));
  }
  for (const [k, v] of Object.entries(s.liveForm)) {
    const text = formatSignal(k, v);
    if (text) rows.push(row(SIGNAL_LABELS[k]!.label, text));
  }
  $("live-angles").innerHTML = rows.length ? rows.join("") : `<p class="note">${active ? "Waiting for a clear view…" : "Shown once you're in view."}</p>`;

  const p = s.performance;
  $("live-perf").textContent = p && s.status === "tracking"
    ? `${p.fps.toFixed(0)} fps · ${p.detectMs.toFixed(0)} ms · ${p.threading === "worker" ? "worker" : "main thread"} · ${p.delegate}`
    : "";

  const busy = s.status === "tracking" || s.status === "starting-camera" || s.status === "loading-model";
  const startBtn = $<HTMLButtonElement>("live-start");
  startBtn.disabled = busy;
  startBtn.textContent = s.status === "paused" ? "Resume" : "Start";
  $<HTMLButtonElement>("live-pause").disabled = s.status !== "tracking";
  $<HTMLButtonElement>("live-stop").disabled = !active;
  for (const b of pickerButtons.values()) b.disabled = busy || s.status === "paused";
}

const row = (label: string, value: string) => `<div class="row"><span>${label}</span><strong>${value}</strong></div>`;
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function renderFeed() {
  const items = feed.list();
  $("live-feed").innerHTML = items.length
    ? items
        .map(
          (i) =>
            `<li class="${i.resolved ? "resolved" : ""}"><span class="${i.kind === "not-counted" ? "nc" : ""}">${esc(i.message)}</span>` +
            `${i.count > 1 ? ` <span class="tag">×${i.count}</span>` : ""}` +
            `<span class="tag ${i.source === "measured" ? "m" : "e"}">${i.source}</span>${i.rep ? `<span class="tag">rep ${i.rep}</span>` : ""}</li>`,
        )
        .join("")
    : `<li class="note">No issues spotted so far.</li>`;
}

tracker.subscribe(renderLive);
tracker.onRep((r) => {
  feed.addRep(r.repNumber, r.formFlags, performance.now());
  renderFeed();
});
tracker.onRejected((f) => {
  feed.addRejection(f, performance.now());
  renderFeed();
});

// Timer ticks independently of pose results so it's smooth.
setInterval(() => {
  $("live-timer").textContent = formatDuration(clock.elapsed(performance.now()));
}, 250);

$("live-start").addEventListener("click", () => {
  if (!coachAttached) {
    coach.attach();
    coachAttached = true;
  }
  const st = tracker.getState().status;
  if (st === "paused") {
    clock.resume(performance.now());
  } else {
    clock.start(performance.now());
    feed.clear();
    renderFeed();
    $("results").hidden = true;
  }
  void tracker.start();
});
$("live-pause").addEventListener("click", () => {
  tracker.pause();
  clock.pause(performance.now());
});
$("live-stop").addEventListener("click", () => {
  clock.stop(performance.now());
  lastSession = tracker.stop();
  coach.announceSession(lastSession);
  renderResults(lastSession, clock.elapsed(performance.now()));
});
$("live-voice").addEventListener("click", () => {
  coach.setEnabled(!coach.isEnabled);
  $("live-voice").textContent = coach.isEnabled ? "🔊 Voice on" : "🔇 Voice off";
  $("live-voice").setAttribute("aria-pressed", String(coach.isEnabled));
});
$("results-download").addEventListener("click", () => {
  if (lastSession) download(`jimbro-session-${lastSession.startedAt.slice(0, 19)}.json`, JSON.stringify(lastSession, null, 2));
});
$("results-clear").addEventListener("click", () => {
  $("results").hidden = true;
  lastSession = null;
});

function metricsText(r: RepEvent) {
  return Object.entries(r.metrics)
    .map(([k, m]) => `${k} ${m.value}${m.unit === "deg" ? "°" : ` ${m.unit}`}`)
    .join(" · ");
}

/** Results stay on screen (and downloadable) until the next session starts. */
function renderResults(session: WorkoutSession, activeMs: number) {
  const s = session.summary;
  const parts = [
    row("Reps", String(session.reps.length)),
    row("Active time", formatDuration(activeMs)),
  ];
  if (s) {
    parts.push(
      row(`Average rep <span class="tag m">measured</span>`, `${(s.avgRepDurationMs.value / 1000).toFixed(1)} s`),
      row(`Tempo consistency <span class="tag e">estimated</span>`, `${s.tempoConsistency.value}%`),
      row(`Range consistency <span class="tag e">estimated</span>`, `±${s.rangeConsistency.value}°`),
    );
    for (const i of s.insights) parts.push(`<p class="note">• ${esc(i.message)} <span class="tag ${i.source === "measured" ? "m" : "e"}">${i.source}</span></p>`);
  }
  if (session.reps.length) {
    parts.push(
      `<table><thead><tr><th>#</th><th>Time</th><th>Range</th><th>Notes</th></tr></thead><tbody>` +
        session.reps
          .map(
            (r) =>
              `<tr><td>${r.repNumber}</td><td>${(r.durationMs / 1000).toFixed(1)} s</td><td>${Math.round(r.peakAngle.value)}°</td>` +
              `<td>${r.formFlags.map((f) => esc(f.message)).join("<br>") || "–"}${Object.keys(r.metrics).length ? `<div class="note">${esc(metricsText(r))}</div>` : ""}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`,
    );
  }
  $("results-body").innerHTML = parts.join("");
  $("results").hidden = false;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

renderPicker();
renderFeed();

// ---- ANALYZE VIDEO (secondary) ---------------------------------------------------

const vidVideo = $<HTMLVideoElement>("vid-video");
const vidCanvas = $<HTMLCanvasElement>("vid-canvas");
const vidSelect = $<HTMLSelectElement>("vid-exercise");
vidSelect.innerHTML =
  `<option value="auto">Detect exercise automatically (experimental)</option>` +
  EXERCISE_IDS.map((id) => `<option value="${id}">${getExercise(id).name}</option>`).join("");
let vidFile: File | null = null;
let vidRecording: Recording | null = null;
let cancel = { cancelled: false };
const vidStatus = (t: string) => ($("vid-status").textContent = t);

$<HTMLInputElement>("vid-file").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  vidFile = f;
  vidRecording = null;
  vidVideo.src = URL.createObjectURL(f);
  $<HTMLButtonElement>("vid-analyze").disabled = false;
  for (const id of ["vid-summary", "vid-issues", "vid-reps"]) $(id).hidden = true;
  vidStatus(`Loaded ${f.name}. Choose the exercise and press Analyze.`);
});

$("vid-analyze").addEventListener("click", async () => {
  if (!vidFile) return;
  const btn = $<HTMLButtonElement>("vid-analyze");
  btn.disabled = true;
  try {
    if (!vidVideo.videoWidth) await new Promise((r) => vidVideo.addEventListener("loadedmetadata", r, { once: true }));
    if (!vidRecording) {
      cancel = { cancelled: false };
      $("vid-cancel").hidden = false;
      const prog = $<HTMLProgressElement>("vid-progress");
      prog.hidden = false;
      vidStatus("Finding your pose in each frame…");
      vidRecording = await extractRecording(vidVideo, vidFile, { onProgress: (f) => (prog.value = f), signal: cancel });
      prog.hidden = true;
      $("vid-cancel").hidden = true;
      if (cancel.cancelled) {
        vidRecording = null;
        return vidStatus("Cancelled.");
      }
    }
    const report = analyzeRecording(vidRecording, vidSelect.value as ExerciseId | "auto");
    if ("error" in report) return vidStatus(report.error);
    renderReport(report);
    vidVideo.currentTime = 0;
    drawVideoOverlay();
  } catch (err) {
    vidStatus(`Couldn't analyse this video: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.disabled = false;
    $("vid-cancel").hidden = true;
    $<HTMLProgressElement>("vid-progress").hidden = true;
  }
});
$("vid-cancel").addEventListener("click", () => (cancel.cancelled = true));
// Re-running with another exercise reuses the extracted landmarks.
vidSelect.addEventListener("change", () => {
  if (vidRecording) $("vid-analyze").click();
});

const t2 = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;

function renderReport(r: VideoReport) {
  const ex = getExercise(r.exercise);
  const s = r.session.summary;
  const summary = [
    row("Exercise", `${ex.name}${r.chosenBy === "auto" ? ` <span class="tag e">detected</span>` : ""}`),
    row("Reps counted", String(r.reps.length)),
    row("Person found", `${Math.round(r.coverage.personFound * 100)}% of frames`),
    row("Joints clearly visible", `${Math.round(r.coverage.jointsVisible * 100)}% of frames`),
  ];
  if (s) summary.push(row(`Average rep <span class="tag m">measured</span>`, `${(s.avgRepDurationMs.value / 1000).toFixed(1)} s`));
  if (r.coverage.jointsVisible < 0.6) {
    summary.push(`<p class="note">⚠ The joints this exercise needs were often out of view, so counts and observations may be incomplete. ${esc(ex.setupInstructions)}</p>`);
  }
  $("vid-summary-body").innerHTML = summary.join("");
  $("vid-summary").hidden = false;

  $("vid-issues-body").innerHTML = r.issues.length
    ? r.issues
        .map(
          (i) =>
            `<div class="row"><span>${i.repNumber ? `<button data-seek="${i.t}">▶ ${t2(i.t)}</button> rep ${i.repNumber}` : "whole set"}</span>` +
            `<span>${esc(i.flag.message)} <span class="tag ${i.flag.source === "measured" ? "m" : "e"}">${i.flag.source}</span></span></div>`,
        )
        .join("")
    : `<p class="note">No form observations in this video.</p>`;
  $("vid-issues").hidden = false;

  $("vid-reps-body").innerHTML = r.reps.length
    ? `<table><thead><tr><th>#</th><th>At</th><th>Time</th><th>Range</th><th>Measurements</th></tr></thead><tbody>` +
      r.reps
        .map(
          (rep) =>
            `<tr><td>${rep.repNumber}</td><td><button data-seek="${rep.start}">▶ ${t2(rep.start)}</button></td><td>${(rep.durationMs / 1000).toFixed(1)} s</td>` +
            `<td>${Math.round(rep.peakAngle)}°</td><td class="note">${esc(Object.entries(rep.metrics).map(([k, m]) => `${k} ${m.value}${m.unit === "deg" ? "°" : ` ${m.unit}`}`).join(" · ")) || "–"}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`
    : `<p class="note">No full reps were counted.</p>`;
  $("vid-reps").hidden = false;
  vidStatus(`Analysed ${r.reps.length} rep${r.reps.length === 1 ? "" : "s"}. Click a time to jump to it.`);
}

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-seek]")?.dataset.seek;
  if (t === undefined) return;
  vidVideo.currentTime = Math.max(0, Number(t) - 0.3);
  void vidVideo.play();
});

// Skeleton from the extracted landmarks while reviewing the video.
function drawVideoOverlay() {
  const ctx = vidCanvas.getContext("2d");
  if (!ctx) return;
  if (vidCanvas.width !== vidVideo.videoWidth || vidCanvas.height !== vidVideo.videoHeight) {
    vidCanvas.width = vidVideo.videoWidth || 1;
    vidCanvas.height = vidVideo.videoHeight || 1;
  }
  if (!vidRecording) return ctx.clearRect(0, 0, vidCanvas.width, vidCanvas.height);
  const t = vidVideo.currentTime * 1000;
  const frames = vidRecording.frames;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  drawSkeleton(ctx, toLandmarks(frames[lo]?.lm ?? null), { minVisibility: 0.6 });
}
const vfc = (vidVideo as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
if (vfc) {
  const loop = () => {
    drawVideoOverlay();
    vfc.call(vidVideo, loop);
  };
  vfc.call(vidVideo, loop);
} else {
  vidVideo.addEventListener("timeupdate", drawVideoOverlay);
}
vidVideo.addEventListener("seeked", drawVideoOverlay);
