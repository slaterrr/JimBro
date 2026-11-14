/**
 * SquatTracker: the public interface between the CV module and the frontend.
 *
 * It wires camera → pose model → angle smoothing → rep counter → form analyzer,
 * draws the overlay straight onto a canvas, and pushes *throttled* state to
 * subscribers so React doesn't re-render on every frame. Rep events are
 * delivered immediately.
 *
 * Framework-agnostic; see useSquatTracker.ts for the React hook.
 */

import type { NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { FormFlag, PoseFrame, RepEvent, SquatPhase, WorkoutSession } from "../../../shared/types";
import { AngleSmoother } from "./angle_calculator";
import {
  analyzeRep,
  assessCameraView,
  cameraViewFlag,
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
  extractSquatJoints,
  mapCameraError,
  startCamera,
  stopCamera,
  type BodySide,
  type CameraErrorCode,
  type CameraOptions,
  type DetectorOptions,
  type SkeletonStyle,
} from "./pose_detection";
import { SquatRepCounter, type CompletedRep, type RepCounterConfig } from "./rep_counter";

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
  phase: SquatPhase;
  /** False until the user has stood up straight in frame; reps don't count before that. */
  armed: boolean;
  repCount: number;
  lastRep: RepEvent | null;
  /** Why the most recent attempt didn't count (cleared when a rep counts). */
  lastRejection: FormFlag | null;
  /**
   * Lowest knee angle of the most recent attempt, counted or not (measured).
   * Useful for calibrating the depth line: compare partial vs full squats.
   */
  lastAttempt: { counted: boolean; minKneeAngle: number | null; code: string | null } | null;
  /** Smoothed angles, degrees; null when not visible. Updated at uiUpdateHz. */
  liveAngles: { knee: number | null; hip: number | null };
  landmarksVisible: boolean;
  /** Leg used for counting. */
  activeSide: BodySide | null;
  cameraView: CameraViewAssessment;
  /** Live camera-position warning, e.g. CAMERA_NOT_SIDE_ON. Estimated. */
  viewWarning: FormFlag | null;
}

export interface SquatTrackerOptions {
  /** Landmark visibility (0–1) required for a joint to be used. */
  minVisibility?: number;
  /** EMA factor for angle smoothing (0–1, higher = less smoothing). */
  smoothingAlpha?: number;
  /** Max subscriber updates per second. Rep events are never throttled. */
  uiUpdateHz?: number;
  counter?: Partial<RepCounterConfig>;
  analyzer?: Partial<FormAnalyzerConfig>;
  detector?: Partial<DetectorOptions>;
  camera?: Omit<CameraOptions, "onEnded">;
  skeleton?: Partial<Omit<SkeletonStyle, "activeSide" | "minVisibility">>;
}

type Listener<T> = (value: T) => void;

const INITIAL_VIEW: CameraViewAssessment = { view: "unknown", confidence: 0, ratio: null };

export function initialTrackerState(): TrackerState {
  return {
    status: "idle",
    error: null,
    phase: "standing",
    armed: false,
    repCount: 0,
    lastRep: null,
    lastRejection: null,
    lastAttempt: null,
    liveAngles: { knee: null, hip: null },
    landmarksVisible: false,
    activeSide: null,
    cameraView: INITIAL_VIEW,
    viewWarning: null,
  };
}

export class SquatTracker {
  private readonly opts: Required<Pick<SquatTrackerOptions, "minVisibility" | "smoothingAlpha" | "uiUpdateHz">> &
    SquatTrackerOptions;
  private state: TrackerState = initialTrackerState();
  private readonly counter: SquatRepCounter;
  private readonly kneeSmoother: AngleSmoother;
  private readonly hipSmoother: AngleSmoother;
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
    options: SquatTrackerOptions = {},
  ) {
    this.opts = { minVisibility: 0.6, smoothingAlpha: 0.5, uiUpdateHz: 10, ...options };
    this.counter = new SquatRepCounter(options.counter);
    this.kneeSmoother = new AngleSmoother(this.opts.smoothingAlpha);
    this.hipSmoother = new AngleSmoother(this.opts.smoothingAlpha);
  }

  // ---- public API ------------------------------------------------------

  getState(): TrackerState {
    return this.state;
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

  /** Fires when an attempt is not counted (shallow, too fast, tracking lost...). */
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
   * Adjust counting thresholds live, e.g. `setCounterConfig({ depthAngle: 90 })`.
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
        this.stream = await startCamera(this.video, {
          ...this.opts.camera,
          onEnded: (err) => this.fail(err),
        });
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
    this.loop ??= new PoseLoop(this.video, this.landmarker, (result, ts) =>
      this.processFrame(result.landmarks[0], ts),
    );
    this.loop.start();
    this.setState({ status: "tracking", error: null }, true);
  }

  /** Stop counting but keep the camera on. */
  pause(): void {
    if (this.state.status !== "tracking") return;
    this.loop?.stop();
    this.counter.cancelCurrentRep();
    this.kneeSmoother.reset();
    this.hipSmoother.reset();
    this.setState({ status: "paused", phase: "standing", armed: false }, true);
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

  private beginSession(): void {
    this.sessionId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now()}`;
    this.sessionStartedAt = new Date();
    this.reps = [];
    this.repEvents = [];
    this.frames = 0;
    this.visibleFrames = 0;
    this.counter.reset();
    this.setState({ repCount: 0, lastRep: null, lastRejection: null, lastAttempt: null }, true);
  }

  private processFrame(lm: NormalizedLandmark[] | undefined, perfTs: number): void {
    const ts = performance.timeOrigin + perfTs; // epoch ms, so events are meaningful to the backend
    const aspect = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 1;

    const joints = extractSquatJoints(lm, {
      minVisibility: this.opts.minVisibility,
      aspectRatio: aspect,
      preferredSide: this.state.activeSide,
    });
    const knee = this.kneeSmoother.next(joints.kneeAngle);
    const hip = this.hipSmoother.next(joints.hipAngle);

    this.frames += 1;
    if (joints.visible) this.visibleFrames += 1;

    let cameraView = this.state.cameraView;
    if (lm) {
      const v = assessCameraView(lm, aspect, this.opts.minVisibility);
      if (v.ratio !== null) {
        this.viewRatioEma = this.viewRatioEma === null ? v.ratio : 0.1 * v.ratio + 0.9 * this.viewRatioEma;
        const r = this.viewRatioEma;
        cameraView = { view: r < 0.35 ? "side" : r > 0.6 ? "front" : "unknown", confidence: v.confidence, ratio: r };
      }
    }

    this.drawOverlay(lm, joints.side);

    const event = this.counter.update(ts, knee, hip);

    const frame: PoseFrame = {
      timestamp: ts,
      phase: this.counter.phase,
      kneeAngle: knee,
      hipAngle: hip,
      landmarksVisible: joints.visible,
    };
    this.frameListeners.forEach((l) => l(frame));

    const patch: Partial<TrackerState> = {
      phase: this.counter.phase,
      armed: this.counter.armed,
      liveAngles: { knee: round1(knee), hip: round1(hip) },
      landmarksVisible: joints.visible,
      activeSide: joints.side ?? this.state.activeSide,
      cameraView,
      viewWarning: cameraViewFlag(cameraView),
    };

    if (event?.type === "rep") {
      const flags = analyzeRep(event.rep, this.reps, this.opts.analyzer);
      const repEvent = toRepEvent(event.rep, flags);
      this.reps.push(event.rep);
      this.repEvents.push(repEvent);
      this.setState(
        {
          ...patch,
          repCount: this.reps.length,
          lastRep: repEvent,
          lastRejection: null,
          lastAttempt: { counted: true, minKneeAngle: round1(event.rep.minKneeAngle), code: null },
        },
        true,
      );
      this.repListeners.forEach((l) => l(repEvent));
      return;
    }
    if (event?.type === "rejected") {
      const flag = describeRejection(event.rejected);
      this.setState(
        {
          ...patch,
          lastRejection: flag,
          lastAttempt: { counted: false, minKneeAngle: round1(event.rejected.minKneeAngle), code: flag.code },
        },
        true,
      );
      this.rejectionListeners.forEach((l) => l(flag));
      return;
    }
    this.setState(patch, false);
  }

  private drawOverlay(lm: readonly { x: number; y: number }[] | undefined, side: BodySide | null): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    drawSkeleton(ctx, lm, { ...this.opts.skeleton, minVisibility: this.opts.minVisibility, activeSide: side });
  }

  private clearCanvas(): void {
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private buildSession(endedAt: Date | null): WorkoutSession {
    const quality = this.frames > 0 ? this.visibleFrames / this.frames : 0;
    return {
      id: this.sessionId ?? "",
      exercise: "squat",
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
    this.stateListeners.forEach((l) => l(this.state));
  }
}

function round1(x: number | null): number | null {
  return x === null ? null : Math.round(x * 10) / 10;
}
