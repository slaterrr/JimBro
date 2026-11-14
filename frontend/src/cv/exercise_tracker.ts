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

import type { NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { ExerciseId, FormFlag, PoseFrame, RepEvent, RepPhase, WorkoutSession } from "../../../shared/types";
import { AngleSmoother } from "./angle_calculator";
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
  code: CameraErrorCode | "MODEL_LOAD_FAILED";
  message: string;
}

export interface TrackerState {
  status: TrackerStatus;
  error: TrackerError | null;
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
}

export interface ExerciseTrackerOptions {
  /** Exercise to start with. Default "squat". */
  exercise?: ExerciseId;
  /** Landmark visibility (0–1) required for a joint to be used. */
  minVisibility?: number;
  /** EMA factor for smoothing (0–1, higher = less smoothing). */
  smoothingAlpha?: number;
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
  };
}

export class ExerciseTracker {
  private readonly opts: Required<Pick<ExerciseTrackerOptions, "minVisibility" | "smoothingAlpha" | "uiUpdateHz">> &
    ExerciseTrackerOptions;
  private exercise: ExerciseDefinition;
  private counter: RepCounter;
  private state: TrackerState;
  private readonly angleSmoother: AngleSmoother;
  private readonly progressSmoother: AngleSmoother;
  private formSmoothers = new Map<string, AngleSmoother>();
  private readonly dropMeter = new BaselineDropMeter();
  private formStats: FormStats = {};
  private prevPhase: RepPhase = "start";

  private stream: MediaStream | null = null;
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

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement | null = null,
    options: ExerciseTrackerOptions = {},
  ) {
    this.opts = { minVisibility: 0.6, smoothingAlpha: 0.5, uiUpdateHz: 10, ...options };
    this.exercise = getExercise(options.exercise ?? "squat");
    this.counter = this.makeCounter();
    this.state = initialTrackerState(this.exercise.id);
    this.angleSmoother = new AngleSmoother(this.opts.smoothingAlpha);
    this.progressSmoother = new AngleSmoother(this.opts.smoothingAlpha);
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
    const keep = { status: this.state.status, error: this.state.error, cameraView: this.state.cameraView };
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

  /** Start the camera (if needed), load the model (once) and begin tracking. */
  async start(): Promise<void> {
    if (this.state.status === "tracking") return;
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
    this.loop ??= new PoseLoop(this.video, this.landmarker, (result, ts) => this.processFrame(result.landmarks[0], ts));
    this.loop.start();
    this.setState({ status: "tracking", error: null }, true);
  }

  /** Stop counting but keep the camera on. A half-finished rep is discarded. */
  pause(): void {
    if (this.state.status !== "tracking") return;
    this.loop?.stop();
    this.counter.cancelCurrentRep();
    this.angleSmoother.reset();
    this.setState(
      { status: "paused", phase: "start", phaseLabel: this.exercise.phaseLabels.start, armed: false },
      true,
    );
  }

  resume(): Promise<void> {
    return this.start();
  }

  /** End the session: stops the loop and camera, returns the session data. */
  stop(): WorkoutSession {
    this.loop?.stop();
    stopCamera(this.stream);
    this.stream = null;
    this.video.srcObject = null;
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
    stopCamera(this.stream);
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.stateListeners.clear();
    this.repListeners.clear();
    this.rejectionListeners.clear();
    this.frameListeners.clear();
  }

  // ---- internals -------------------------------------------------------

  private makeCounter(): RepCounter {
    return new RepCounter({ ...this.exercise.counter, ...this.opts.counter?.[this.exercise.id] });
  }

  private resetSignals(): void {
    this.angleSmoother.reset();
    this.progressSmoother.reset();
    this.formSmoothers.clear();
    this.dropMeter.reset();
    this.formStats = {};
    this.prevPhase = "start";
  }

  private beginSession(): void {
    this.sessionId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now()}`;
    this.sessionStartedAt = new Date();
    this.reps = [];
    this.repEvents = [];
    this.frames = 0;
    this.visibleFrames = 0;
    this.counter.reset();
    this.resetSignals();
    this.setState({ repCount: 0, lastRep: null, lastRejection: null, lastAttempt: null }, true);
  }

  private processFrame(lm: NormalizedLandmark[] | undefined, perfTs: number): void {
    const ts = performance.timeOrigin + perfTs; // epoch ms, so events are meaningful to the backend
    const aspect = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 1;
    const ex = this.exercise;

    const reading = ex.read(lm, {
      aspectRatio: aspect,
      minVisibility: this.opts.minVisibility,
      preferredSide: this.state.activeSide === "left" || this.state.activeSide === "right" ? this.state.activeSide : null,
    });
    const angle = this.angleSmoother.next(reading.primaryAngle);

    let progress: number | null = null;
    if (reading.progress?.kind === "drop") {
      const y = this.progressSmoother.next(reading.progress.y);
      const atStart = this.counter.phase === "start" && this.counter.atStart(angle);
      progress = this.dropMeter.update(y, reading.progress.refLength, atStart);
    } else if (reading.progress?.kind === "absolute") {
      progress = this.progressSmoother.next(reading.progress.value);
    } else {
      this.progressSmoother.reset();
    }

    this.frames += 1;
    if (reading.visible) this.visibleFrames += 1;

    const cameraView = this.updateCameraView(lm, aspect);
    this.drawOverlay(lm, reading.highlight);

    const event = this.counter.update(ts, angle, progress);
    this.recordForm(reading.form);

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
      viewWarning: cameraViewFlag(cameraView, ex.cameraView),
    };

    if (event?.type === "rep") {
      const flags = analyzeRep(ex, event.rep, this.reps, this.formStats, this.opts.analyzer);
      const repEvent = toRepEvent(ex, event.rep, flags);
      this.reps.push(event.rep);
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

  /** Track min/max of each (smoothed) form signal over the current rep. */
  private recordForm(form: Record<string, number | null>): void {
    const phase = this.counter.phase;
    if (phase !== "start" && this.prevPhase === "start") this.formStats = {};
    this.prevPhase = phase;
    for (const [key, raw] of Object.entries(form)) {
      let sm = this.formSmoothers.get(key);
      if (!sm) {
        sm = new AngleSmoother(this.opts.smoothingAlpha);
        this.formSmoothers.set(key, sm);
      }
      const v = sm.next(raw);
      if (v === null || phase === "start") continue;
      const s = this.formStats[key];
      this.formStats[key] = s ? { min: Math.min(s.min, v), max: Math.max(s.max, v) } : { min: v, max: v };
    }
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
      summary: summarizeSession(this.reps, quality),
    };
  }

  private fail(err: unknown): void {
    this.loop?.stop();
    let error: TrackerError;
    if (err instanceof ModelLoadError) {
      error = { code: "MODEL_LOAD_FAILED", message: err.message };
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
