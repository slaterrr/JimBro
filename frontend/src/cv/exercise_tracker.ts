/**
 * ExerciseTracker: the public interface between the CV module and the frontend.
 *
 * It wires camera → pose model → exercise reading → smoothing → rep counter →
 * form analyzer for whichever exercise is selected, draws the overlay straight
 * onto a canvas, and pushes *throttled* state to subscribers so React doesn't
 * re-render on every frame. Rep events are delivered immediately.
 *
 * Framework-agnostic; see useExerciseTracker.ts for the React hook.
 */

import type { Landmark, NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { ExerciseId, FormFlag, Metric, PoseFrame, RepEvent, RepPhase, WorkoutSession } from "../../../shared/types";
import { repFeatures, type RepFrame } from "./ml/rep_features";
import { ANGLE_FILTER, POSITION_FILTER, SignalFilter, type SignalFilterOptions } from "./signal_filter";
import { getExercise } from "./exercises";
import type { ExerciseDefinition, FormStats } from "./exercises/types";
import {
  analyzeRep,
  assessCameraView,
  cameraViewFlag,
  classifyViewRatio,
  describeRejection,
  summarizeSession,
  toRepEvent,
  withEvidence,
  type CameraViewAssessment,
  type FormAnalyzerConfig,
} from "./form_analyzer";
import {
  CameraError,
  ModelLoadError,
  PoseLoop,
  createPoseLandmarker,
  drawSkeleton,
  mapCameraError,
  startCamera,
  stopCamera,
  type BodySide,
  type CameraErrorCode,
  type CameraOptions,
  type DetectorOptions,
  type SkeletonStyle,
} from "./pose_detection";
import { BaselineDropMeter, RepCounter, type CompletedRep, type RepCounterConfig } from "./rep_counter";

export type TrackerStatus =
  | "idle"
  | "starting-camera"
  | "loading-model"
  | "tracking"
  | "paused"
  | "stopped"
  | "error";

export interface TrackerError {
  code: CameraErrorCode | "MODEL_LOAD_FAILED" | "VIDEO_LOAD_FAILED";
  message: string;
}

/** Where frames come from: the live camera or an uploaded / linked video. */
export type TrackerSource = "camera" | "file";

export interface TrackerState {
  status: TrackerStatus;
  error: TrackerError | null;
  /** null until started. */
  source: TrackerSource | null;
  /** Playback position and length of an uploaded video, seconds. null for the camera. */
  videoProgress: { current: number; duration: number } | null;
  exercise: ExerciseId;
  phase: RepPhase;
  /** Human-readable phase for the current exercise, e.g. "descending". */
  phaseLabel: string;
  /** False until the user is in the start position; reps don't count before that. */
  armed: boolean;
  repCount: number;
  lastRep: RepEvent | null;
  /** Why the most recent attempt didn't count (cleared when a rep counts). */
  lastRejection: FormFlag | null;
  /** Peak angle and progress of the most recent attempt, counted or not (measured). For calibration. */
  lastAttempt: { counted: boolean; peakAngle: number | null; progress: number | null; code: string | null } | null;
  /** Smoothed counting-joint angle, degrees; null when not visible. Updated at uiUpdateHz. */
  liveAngle: number | null;
  /** Exercise progress signal (fraction of a body length); null when not measured. */
  liveProgress: number | null;
  landmarksVisible: boolean;
  /** Limb(s) used for counting. */
  activeSide: BodySide | "both" | null;
  /** Set when the user is visible but not in position (e.g. standing during push-ups). */
  positionHint: string | null;
  cameraView: CameraViewAssessment;
  /** Live camera-position warning, e.g. CAMERA_NOT_SIDE_ON. Estimated. */
  viewWarning: FormFlag | null;
  /** View the current exercise is being measured from. */
  measuredView: "side" | "front";
  /**
   * Tracking quality this session, as fractions of processed frames:
   * counting joints visible, readings rejected as glitches, short gaps bridged.
   */
  trackingQuality: { visible: number; glitches: number; bridged: number };
}

export interface ExerciseTrackerOptions {
  /** Exercise to start with. Default "squat". */
  exercise?: ExerciseId;
  /** Landmark visibility (0–1) required for a joint to be used. */
  minVisibility?: number;
  /**
   * Overrides for the counting-angle filter (One Euro smoothing, short-gap
   * bridging, glitch rejection). See signal_filter.ts.
   */
  filter?: Partial<SignalFilterOptions>;
  /** Max subscriber updates per second. Rep events are never throttled. */
  uiUpdateHz?: number;
  /** Per-exercise threshold overrides. */
  counter?: Partial<Record<ExerciseId, Partial<RepCounterConfig>>>;
  analyzer?: Partial<FormAnalyzerConfig>;
  detector?: Partial<DetectorOptions>;
  camera?: Omit<CameraOptions, "onEnded">;
  skeleton?: Partial<Omit<SkeletonStyle, "highlight" | "minVisibility">>;
}

type Listener<T> = (value: T) => void;

const INITIAL_VIEW: CameraViewAssessment = { view: "unknown", confidence: 0, ratio: null };

export function initialTrackerState(exercise: ExerciseId = "squat"): TrackerState {
  return {
    status: "idle",
    error: null,
    source: null,
    videoProgress: null,
    exercise,
    phase: "start",
    phaseLabel: getExercise(exercise).phaseLabels.start,
    armed: false,
    repCount: 0,
    lastRep: null,
    lastRejection: null,
    lastAttempt: null,
    liveAngle: null,
    liveProgress: null,
    landmarksVisible: false,
    activeSide: null,
    positionHint: null,
    cameraView: INITIAL_VIEW,
    viewWarning: null,
    measuredView: getExercise(exercise).cameraView,
    trackingQuality: { visible: 0, glitches: 0, bridged: 0 },
  };
}

export class ExerciseTracker {
  private readonly opts: Required<Pick<ExerciseTrackerOptions, "minVisibility" | "uiUpdateHz">> &
    ExerciseTrackerOptions;
  private exercise: ExerciseDefinition;
  private counter: RepCounter;
  private state: TrackerState;
  private readonly angleFilter: SignalFilter;
  private readonly progressFilter = new SignalFilter(POSITION_FILTER);
  private formFilters = new Map<string, SignalFilter>();
  private readonly dropMeter = new BaselineDropMeter();
  private formStats: FormStats = {};
  private formSeen: Record<string, number> = {};
  private repFrames = 0;
  private phaseFrames: Partial<Record<RepPhase, number>> = {};
  private prevPhase: RepPhase = "start";
  private repStats: FormStats[] = [];
  private lastTs = -Infinity;
  /** Recent per-frame measurements for the learned quality check (about 15 s). */
  private trace: RepFrame[] = [];
  private lastForm: Record<string, number | null> = {};

  private stream: MediaStream | null = null;
  private source: TrackerSource | null = null;
  private fileUrl: string | null = null;
  private fileEpoch = 0;
  private fileCleanup: (() => void) | null = null;
  private landmarker: PoseLandmarker | null = null;
  private loop: PoseLoop | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private reps: CompletedRep[] = [];
  private repEvents: RepEvent[] = [];
  private sessionId: string | null = null;
  private sessionStartedAt: Date | null = null;
  private frames = 0;
  private visibleFrames = 0;
  private viewRatioEma: number | null = null;
  private lastEmit = 0;

  private stateListeners = new Set<Listener<TrackerState>>();
  private repListeners = new Set<Listener<RepEvent>>();
  private rejectionListeners = new Set<Listener<FormFlag>>();
  private frameListeners = new Set<Listener<PoseFrame>>();
  private sessionEndListeners = new Set<Listener<WorkoutSession>>();

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement | null = null,
    options: ExerciseTrackerOptions = {},
  ) {
    this.opts = { minVisibility: 0.6, uiUpdateHz: 10, ...options };
    this.exercise = getExercise(options.exercise ?? "squat");
    this.counter = this.makeCounter();
    this.state = initialTrackerState(this.exercise.id);
    this.angleFilter = new SignalFilter({ ...ANGLE_FILTER, ...options.filter });
  }

  // ---- public API ------------------------------------------------------

  getState(): TrackerState {
    return this.state;
  }

  getExercise(): ExerciseDefinition {
    return this.exercise;
  }

  /**
   * Switch exercise. Not allowed while tracking (pause or stop first). Any
   * unsaved session is discarded, so call stop() first if you want to keep it.
   */
  setExercise(id: ExerciseId): void {
    if (this.state.status === "tracking") throw new Error("Pause or stop tracking before switching exercise.");
    if (id === this.exercise.id) return;
    this.exercise = getExercise(id);
    this.counter = this.makeCounter();
    this.resetSignals();
    this.sessionId = null;
    this.reps = [];
    this.repEvents = [];
    const keep = {
      status: this.state.status,
      error: this.state.error,
      cameraView: this.state.cameraView,
      source: this.state.source,
      videoProgress: this.state.videoProgress,
    };
    this.state = { ...initialTrackerState(id), ...keep };
    this.emit();
  }

  /** Throttled state updates. Returns an unsubscribe function. */
  subscribe(listener: Listener<TrackerState>): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  /** Fires once per counted rep, immediately. */
  onRep(listener: Listener<RepEvent>): () => void {
    this.repListeners.add(listener);
    return () => this.repListeners.delete(listener);
  }

  /** Fires when an attempt is not counted (partial, too fast, tracking lost...). */
  onRejected(listener: Listener<FormFlag>): () => void {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  /**
   * Fires when a session ends on its own: an uploaded video reached its end.
   * (Calling stop() returns the session directly instead.)
   */
  onSessionEnd(listener: Listener<WorkoutSession>): () => void {
    this.sessionEndListeners.add(listener);
    return () => this.sessionEndListeners.delete(listener);
  }

  /** Every processed frame, unthrottled. Don't set React state from this. */
  onFrame(listener: Listener<PoseFrame>): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  getCounterConfig(): Readonly<RepCounterConfig> {
    return this.counter.config;
  }

  /**
   * Adjust the current exercise's thresholds live, e.g. `setCounterConfig({ peakAngle: 80 })`.
   * Keeps the rep count. Throws RangeError on an invalid combination.
   */
  setCounterConfig(patch: Partial<RepCounterConfig>): void {
    this.counter.configure(patch);
  }

  /**
   * Start the camera (if needed), load the model (once) and begin tracking.
   * If an uploaded video is loaded and paused, this resumes it instead.
   */
  async start(): Promise<void> {
    if (this.state.status === "tracking") return;
    if (this.source === "file" && this.fileUrl && this.state.status === "paused") {
      await this.resumeFile();
      return;
    }
    if (this.source === "file") {
      // Switching from a video back to the camera: new loop on the wall clock, new session.
      this.releaseSource();
      this.loop = null;
      this.sessionId = null;
    }
    this.source = "camera";
    try {
      if (!this.stream) {
        this.setState({ status: "starting-camera", error: null }, true);
        this.stream = await startCamera(this.video, { ...this.opts.camera, onEnded: (err) => this.fail(err) });
      }
      if (!this.landmarker) {
        this.setState({ status: "loading-model" }, true);
        this.landmarker = await createPoseLandmarker(this.opts.detector);
      }
    } catch (err) {
      this.fail(err);
      return;
    }

    if (!this.sessionId) this.beginSession();
    this.ctx = this.canvas?.getContext("2d") ?? null;
    this.loop ??= this.makeLoop("wall");
    this.loop.start();
    this.setState({ status: "tracking", error: null, source: "camera", videoProgress: null }, true);
  }

  /**
   * Analyse a prerecorded video (a File from an <input type="file">, a Blob, or
   * a URL) instead of the camera. Plays it through once at `playbackRate`; rep
   * timings use the video's own clock. When it ends the session finishes and
   * onSessionEnd listeners receive it. Lower the playback rate on slow devices
   * so frames aren't skipped.
   */
  async startFile(file: Blob | string, options: { playbackRate?: number } = {}): Promise<void> {
    if (this.state.status === "tracking") this.pause();
    this.releaseSource();
    this.source = "file";
    this.loop = null;
    this.sessionId = null;

    const url = typeof file === "string" ? file : URL.createObjectURL(file);
    this.fileUrl = url;
    const v = this.video;
    v.srcObject = null;
    v.muted = true;
    v.playsInline = true;
    v.loop = false;
    v.src = url;
    v.playbackRate = options.playbackRate ?? 1;

    try {
      this.setState({ status: "starting-camera", error: null, source: "file" }, true);
      await new Promise<void>((resolve, reject) => {
        const ok = () => {
          cleanup();
          resolve();
        };
        const bad = () => {
          cleanup();
          reject(new VideoLoadError());
        };
        const cleanup = () => {
          v.removeEventListener("loadeddata", ok);
          v.removeEventListener("error", bad);
        };
        v.addEventListener("loadeddata", ok);
        v.addEventListener("error", bad);
      });
      if (!this.landmarker) {
        this.setState({ status: "loading-model" }, true);
        this.landmarker = await createPoseLandmarker(this.opts.detector);
      }
    } catch (err) {
      this.fail(err);
      return;
    }

    const onEnded = () => this.finishFile();
    v.addEventListener("ended", onEnded);
    this.fileCleanup = () => v.removeEventListener("ended", onEnded);

    this.beginSession();
    this.fileEpoch = Date.now();
    this.ctx = this.canvas?.getContext("2d") ?? null;
    this.loop = this.makeLoop("media");
    await this.resumeFile();
  }

  /** Stop counting but keep the camera on (or pause the video). A half-finished rep is discarded. */
  pause(): void {
    if (this.state.status !== "tracking") return;
    this.loop?.stop();
    if (this.source === "file") this.video.pause();
    this.counter.cancelCurrentRep();
    this.angleFilter.reset();
    this.setState(
      { status: "paused", phase: "start", phaseLabel: this.exercise.phaseLabels.start, armed: false },
      true,
    );
  }

  resume(): Promise<void> {
    return this.start();
  }

  /** End the session: stops the loop and camera (or video), returns the session data. */
  stop(): WorkoutSession {
    this.loop?.stop();
    this.releaseSource();
    this.clearCanvas();
    const session = this.buildSession(new Date());
    this.setState({ status: "stopped" }, true);
    this.sessionId = null;
    return session;
  }

  /** Snapshot of the session so far, without stopping. */
  getSession(): WorkoutSession {
    return this.buildSession(null);
  }

  /** Release the camera and the model. The tracker can't be restarted afterwards. */
  dispose(): void {
    this.loop?.stop();
    this.loop = null;
    this.releaseSource();
    this.landmarker?.close();
    this.landmarker = null;
    this.stateListeners.clear();
    this.repListeners.clear();
    this.rejectionListeners.clear();
    this.frameListeners.clear();
    this.sessionEndListeners.clear();
  }

  // ---- internals -------------------------------------------------------

  private makeLoop(clock: "wall" | "media"): PoseLoop {
    const landmarker = this.landmarker!;
    return new PoseLoop(
      this.video,
      landmarker,
      (result, ts) => this.processFrame(result.landmarks[0], result.worldLandmarks[0], ts),
      clock,
    );
  }

  private async resumeFile(): Promise<void> {
    try {
      await this.video.play();
    } catch (err) {
      this.fail(err instanceof Error && err.name === "NotSupportedError" ? new VideoLoadError() : err);
      return;
    }
    this.loop?.start();
    this.setState({ status: "tracking", error: null, source: "file" }, true);
  }

  private finishFile(): void {
    if (this.source !== "file" || !this.sessionId) return;
    this.loop?.stop();
    const session = this.buildSession(new Date());
    this.sessionId = null;
    this.setState({ status: "stopped" }, true);
    this.sessionEndListeners.forEach((l) => l(session));
  }

  /** Stop the camera stream or unload the video file. */
  private releaseSource(): void {
    stopCamera(this.stream);
    this.stream = null;
    this.fileCleanup?.();
    this.fileCleanup = null;
    const v = this.video;
    v.srcObject = null;
    if (this.fileUrl) {
      v.pause();
      v.removeAttribute("src");
      v.load();
      if (this.fileUrl.startsWith("blob:")) URL.revokeObjectURL(this.fileUrl);
      this.fileUrl = null;
    }
  }

  private makeCounter(): RepCounter {
    return new RepCounter({ ...this.exercise.counter, ...this.opts.counter?.[this.exercise.id] });
  }

  private resetSignals(): void {
    this.angleFilter.reset();
    this.progressFilter.reset();
    this.formFilters.clear();
    this.dropMeter.reset();
    this.formStats = {};
    this.formSeen = {};
    this.repFrames = 0;
    this.phaseFrames = {};
    this.prevPhase = "start";
    this.lastTs = -Infinity;
    this.trace = [];
    this.lastForm = {};
  }

  private beginSession(): void {
    this.sessionId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now()}`;
    this.sessionStartedAt = new Date();
    this.reps = [];
    this.repEvents = [];
    this.repStats = [];
    this.angleFilter.resetStats();
    this.frames = 0;
    this.visibleFrames = 0;
    this.counter.reset();
    this.resetSignals();
    this.setState({ repCount: 0, lastRep: null, lastRejection: null, lastAttempt: null }, true);
  }

  private processFrame(lm: NormalizedLandmark[] | undefined, world: Landmark[] | undefined, rawTs: number): void {
    // Epoch ms, so events are meaningful to the backend. For a video file, the
    // session start plus the video's own playback time.
    const ts = this.source === "file" ? this.fileEpoch + rawTs : performance.timeOrigin + rawTs;
    if (ts <= this.lastTs) {
      // The video was rewound: drop any half-finished rep rather than mixing times.
      this.counter.cancelCurrentRep();
      this.resetSignals();
    }
    this.lastTs = ts;
    const aspect = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 1;
    const ex = this.exercise;

    const reading = ex.read(lm, {
      aspectRatio: aspect,
      minVisibility: this.opts.minVisibility,
      preferredSide: this.state.activeSide === "left" || this.state.activeSide === "right" ? this.state.activeSide : null,
      world,
      view: this.state.cameraView.view,
    });
    const angle = this.angleFilter.next(reading.primaryAngle, ts);

    let progress: number | null = null;
    if (reading.progress?.kind === "drop") {
      const y = this.progressFilter.next(reading.progress.y, ts);
      const atStart = this.counter.phase === "start" && this.counter.atStart(angle);
      progress = this.dropMeter.update(y, reading.progress.refLength, atStart);
    } else if (reading.progress?.kind === "absolute") {
      progress = this.progressFilter.next(reading.progress.value, ts);
    } else {
      this.progressFilter.reset();
    }

    this.frames += 1;
    if (reading.visible) this.visibleFrames += 1;

    const cameraView = this.updateCameraView(lm, aspect);
    this.drawOverlay(lm, reading.highlight);

    const event = this.counter.update(ts, angle, progress);
    this.recordForm(reading.form, ts);
    this.recordTrace(ts, angle, progress);

    const frame: PoseFrame = {
      timestamp: ts,
      exercise: ex.id,
      phase: this.counter.phase,
      primaryAngle: angle,
      progress,
      landmarksVisible: reading.visible,
    };
    this.frameListeners.forEach((l) => l(frame));

    const patch: Partial<TrackerState> = {
      phase: this.counter.phase,
      phaseLabel: ex.phaseLabels[this.counter.phase],
      armed: this.counter.armed,
      liveAngle: round1(angle),
      liveProgress: progress === null ? null : Math.round(progress * 100) / 100,
      landmarksVisible: reading.visible,
      activeSide: reading.side ?? this.state.activeSide,
      positionHint: reading.positionHint,
      cameraView,
      viewWarning: cameraViewFlag(cameraView, ex.cameraView, ex.otherViews),
      measuredView: reading.view,
      trackingQuality: this.trackingQuality(),
      videoProgress:
        this.source === "file" && Number.isFinite(this.video.duration)
          ? { current: this.video.currentTime, duration: this.video.duration }
          : null,
    };

    if (event?.type === "rep") {
      const stats = withEvidence(this.finalFormStats(), this.opts.analyzer?.minEvidence);
      const flags = analyzeRep(ex, event.rep, this.reps, stats, {
        config: this.opts.analyzer,
        view: reading.view,
        history: this.repStats,
      });
      const quality = this.judgeQuality(event.rep, reading.view);
      if (quality.flag) flags.push(quality.flag);
      const repEvent = toRepEvent(ex, event.rep, flags, reading.view, quality.metric);
      this.reps.push(event.rep);
      this.repStats.push(stats);
      this.repEvents.push(repEvent);
      this.setState(
        {
          ...patch,
          repCount: this.reps.length,
          lastRep: repEvent,
          lastRejection: null,
          lastAttempt: { counted: true, peakAngle: round1(event.rep.peakAngle), progress: round2(event.rep.maxProgress), code: null },
        },
        true,
      );
      this.repListeners.forEach((l) => l(repEvent));
      return;
    }
    if (event?.type === "rejected") {
      const flag = describeRejection(ex, event.rejected);
      this.setState(
        {
          ...patch,
          lastRejection: flag,
          lastAttempt: {
            counted: false,
            peakAngle: round1(event.rejected.peakAngle),
            progress: round2(event.rejected.maxProgress),
            code: flag.code,
          },
        },
        true,
      );
      this.rejectionListeners.forEach((l) => l(flag));
      return;
    }
    this.setState(patch, false);
  }

  /**
   * Track min/max of each (smoothed) form signal over the current rep, overall
   * and per phase ("<signal>@<phase>"), plus how many frames each was seen in.
   */
  private recordForm(form: Record<string, number | null>, ts: number): void {
    const phase = this.counter.phase;
    if (phase !== "start" && this.prevPhase === "start") {
      this.formStats = {};
      this.formSeen = {};
      this.repFrames = 0;
      this.phaseFrames = {};
    }
    this.prevPhase = phase;
    if (phase !== "start") {
      this.repFrames += 1;
      this.phaseFrames[phase] = (this.phaseFrames[phase] ?? 0) + 1;
    }
    for (const [key, raw] of Object.entries(form)) {
      let f = this.formFilters.get(key);
      if (!f) {
        // Form signals mix degrees and ratios, so no glitch gate; just smoothing and gap bridging.
        f = new SignalFilter({ ...ANGLE_FILTER, maxRatePerSec: Infinity });
        this.formFilters.set(key, f);
      }
      const v = f.next(raw, ts);
      this.lastForm[key] = v;
      if (v === null || phase === "start") continue;
      this.addFormValue(key, v);
      this.addFormValue(`${key}@${phase}`, v);
    }
  }

  private recordTrace(t: number, knee: number | null, drop: number | null): void {
    const lean = this.lastForm.torsoLean;
    this.trace.push({
      t,
      knee,
      hip: this.lastForm.hipAngle ?? null,
      lean: lean === null || lean === undefined ? null : Math.abs(lean),
      drop,
    });
    while (this.trace.length > 0 && t - this.trace[0]!.t > 15_000) this.trace.shift();
  }

  /** Learned movement-quality check for a counted rep, if this exercise has one. */
  private judgeQuality(rep: CompletedRep, view: "side" | "front"): { metric: Metric | null; flag: FormFlag | null } {
    const q = this.exercise.quality;
    if (!q || !q.views.includes(view)) return { metric: null, flag: null };
    // The rep plus a second of context before it (standing), as in training.
    const frames = this.trace.filter((f) => f.t >= rep.startedAt - 1000 && f.t <= rep.endedAt);
    const features = repFeatures(frames);
    if (!features) return { metric: null, flag: null };
    const p = q.model.predict(features);
    const metric: Metric = {
      value: Math.round(p * 100),
      unit: "%",
      source: "estimated",
      // Confidence = how far from the decision boundary, scaled 0–1.
      confidence: Math.round(Math.min(1, Math.abs(p - q.model.spec.threshold) * 2) * 100) / 100,
    };
    const flag =
      q.raiseFlag && p >= q.model.spec.threshold ? { code: q.code, message: q.message, source: "estimated" as const } : null;
    return { metric, flag };
  }

  private addFormValue(key: string, v: number): void {
    const s = this.formStats[key];
    this.formStats[key] = s ? { min: Math.min(s.min, v), max: Math.max(s.max, v), coverage: 0 } : { min: v, max: v, coverage: 0 };
    this.formSeen[key] = (this.formSeen[key] ?? 0) + 1;
  }

  /** Form stats for the rep just finished, with coverage filled in. */
  private finalFormStats(): FormStats {
    const out: FormStats = {};
    for (const [key, s] of Object.entries(this.formStats)) {
      const at = key.indexOf("@");
      const frames = at === -1 ? this.repFrames : (this.phaseFrames[key.slice(at + 1) as RepPhase] ?? 0);
      out[key] = { ...s, coverage: frames > 0 ? Math.min(1, (this.formSeen[key] ?? 0) / frames) : 0 };
    }
    return out;
  }

  private trackingQuality(): TrackerState["trackingQuality"] {
    const n = this.frames || 1;
    const f = this.angleFilter.getStats();
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return { visible: r2(this.visibleFrames / n), glitches: r2(f.rejected / n), bridged: r2(f.bridged / n) };
  }

  private updateCameraView(lm: NormalizedLandmark[] | undefined, aspect: number): CameraViewAssessment {
    if (!lm) return this.state.cameraView;
    const v = assessCameraView(lm, aspect, this.opts.minVisibility);
    if (v.ratio === null) return this.state.cameraView;
    this.viewRatioEma = this.viewRatioEma === null ? v.ratio : 0.1 * v.ratio + 0.9 * this.viewRatioEma;
    return { view: classifyViewRatio(this.viewRatioEma), confidence: v.confidence, ratio: this.viewRatioEma };
  }

  private drawOverlay(lm: readonly { x: number; y: number }[] | undefined, highlight: readonly number[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    drawSkeleton(ctx, lm, {
      ...this.opts.skeleton,
      minVisibility: this.opts.minVisibility,
      highlight: highlight.length ? new Set(highlight) : null,
    });
  }

  private clearCanvas(): void {
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private buildSession(endedAt: Date | null): WorkoutSession {
    const quality = this.frames > 0 ? this.visibleFrames / this.frames : 0;
    return {
      id: this.sessionId ?? "",
      exercise: this.exercise.id,
      startedAt: (this.sessionStartedAt ?? new Date()).toISOString(),
      endedAt: endedAt ? endedAt.toISOString() : null,
      reps: [...this.repEvents],
      summary: summarizeSession(this.reps, quality, this.exercise),
    };
  }

  private fail(err: unknown): void {
    this.loop?.stop();
    let error: TrackerError;
    if (err instanceof ModelLoadError) {
      error = { code: "MODEL_LOAD_FAILED", message: err.message };
    } else if (err instanceof VideoLoadError) {
      error = { code: "VIDEO_LOAD_FAILED", message: err.message };
      this.releaseSource();
    } else {
      const camErr = err instanceof CameraError ? err : mapCameraError(err);
      error = { code: camErr.code, message: camErr.message };
      stopCamera(this.stream);
      this.stream = null;
    }
    this.setState({ status: "error", error }, true);
  }

  private setState(patch: Partial<TrackerState>, force: boolean): void {
    this.state = { ...this.state, ...patch };
    const now = performance.now();
    if (!force && now - this.lastEmit < 1000 / this.opts.uiUpdateHz) return;
    this.lastEmit = now;
    this.emit();
  }

  private emit(): void {
    this.stateListeners.forEach((l) => l(this.state));
  }
}

function round1(x: number | null): number | null {
  return x === null ? null : Math.round(x * 10) / 10;
}

function round2(x: number | null): number | null {
  return x === null ? null : Math.round(x * 100) / 100;
}

export class VideoLoadError extends Error {
  constructor() {
    super("Couldn't play that video. Try an MP4 or WebM file recorded on your phone.");
    this.name = "VideoLoadError";
  }
}
