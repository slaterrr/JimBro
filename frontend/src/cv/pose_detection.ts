/**
 * Camera access, MediaPipe Pose Landmarker setup, the detection loop, landmark
 * extraction with confidence filtering, and skeleton drawing.
 *
 * MediaPipe is imported lazily so this module (and its pure helpers) can be
 * imported in tests and server-side code without loading WASM.
 */

import type { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

// ---- landmarks -----------------------------------------------------------

/** Minimal landmark shape (matches MediaPipe's NormalizedLandmark). */
/** A 3D landmark from the model's world output: metres, origin between the hips. */
export interface WorldLandmarkLike {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface LandmarkLike {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** BlazePose landmark indices used by Jim Bro. */
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

const L = POSE_LANDMARKS;

/** Body connections drawn in the overlay (face omitted to reduce clutter). */
export const SKELETON_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [L.LEFT_SHOULDER, L.RIGHT_SHOULDER],
  [L.LEFT_SHOULDER, L.LEFT_ELBOW],
  [L.LEFT_ELBOW, L.LEFT_WRIST],
  [L.RIGHT_SHOULDER, L.RIGHT_ELBOW],
  [L.RIGHT_ELBOW, L.RIGHT_WRIST],
  [L.LEFT_SHOULDER, L.LEFT_HIP],
  [L.RIGHT_SHOULDER, L.RIGHT_HIP],
  [L.LEFT_HIP, L.RIGHT_HIP],
  [L.LEFT_HIP, L.LEFT_KNEE],
  [L.LEFT_KNEE, L.LEFT_ANKLE],
  [L.RIGHT_HIP, L.RIGHT_KNEE],
  [L.RIGHT_KNEE, L.RIGHT_ANKLE],
  [L.LEFT_ANKLE, L.LEFT_HEEL],
  [L.LEFT_HEEL, L.LEFT_FOOT_INDEX],
  [L.LEFT_ANKLE, L.LEFT_FOOT_INDEX],
  [L.RIGHT_ANKLE, L.RIGHT_HEEL],
  [L.RIGHT_HEEL, L.RIGHT_FOOT_INDEX],
  [L.RIGHT_ANKLE, L.RIGHT_FOOT_INDEX],
];

export type BodySide = "left" | "right";

/** Landmark visibility (0–1), 0 when missing. */
export const vis = (p: LandmarkLike | undefined): number => p?.visibility ?? 0;

/** How much better the other side must be before switching, to avoid flicker. */
const SIDE_SWITCH_MARGIN = 0.15;

/**
 * Pick the body side whose joints the camera sees better. A side-on camera sees
 * one limb clearly and the other partly hidden, so averaging both would mix a
 * good signal with a bad one. Sticks with `preferred` unless the other side is
 * clearly better. Returns null if neither side passes `minVisibility`.
 */
export function pickSide(
  landmarks: readonly LandmarkLike[],
  joints: { left: readonly number[]; right: readonly number[] },
  minVisibility: number,
  preferred: BodySide | null = null,
): BodySide | null {
  const score = (idx: readonly number[]) => Math.min(...idx.map((i) => vis(landmarks[i])));
  const left = score(joints.left);
  const right = score(joints.right);
  let side: BodySide = left >= right ? "left" : "right";
  if (preferred) {
    const p = preferred === "left" ? left : right;
    const o = preferred === "left" ? right : left;
    if (p >= minVisibility && o - p < SIDE_SWITCH_MARGIN) side = preferred;
  }
  return (side === "left" ? left : right) >= minVisibility ? side : null;
}

/** Distance between two landmarks in height-normalised units (x corrected by aspect ratio). */
export function distance(a: LandmarkLike, b: LandmarkLike, aspectRatio = 1): number {
  return Math.hypot((a.x - b.x) * aspectRatio, a.y - b.y);
}

// ---- camera --------------------------------------------------------------

export type CameraErrorCode =
  | "PERMISSION_DENIED"
  | "NO_CAMERA"
  | "CAMERA_IN_USE"
  | "INSECURE_CONTEXT"
  | "NOT_SUPPORTED"
  | "STREAM_ENDED"
  | "UNKNOWN";

const CAMERA_ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  PERMISSION_DENIED: "Camera access was blocked. Allow camera access in your browser settings, then try again.",
  NO_CAMERA: "No camera was found on this device.",
  CAMERA_IN_USE: "The camera is being used by another app. Close it and try again.",
  INSECURE_CONTEXT: "The camera only works over HTTPS or on localhost.",
  NOT_SUPPORTED: "This browser doesn't support camera access.",
  STREAM_ENDED: "The camera stopped. Reconnect it and start again.",
  UNKNOWN: "Couldn't start the camera.",
};

export class CameraError extends Error {
  constructor(
    readonly code: CameraErrorCode,
    readonly cause?: unknown,
  ) {
    super(CAMERA_ERROR_MESSAGES[code]);
    this.name = "CameraError";
  }
}

/** Map a getUserMedia rejection to a typed CameraError. */
export function mapCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return new CameraError("PERMISSION_DENIED", err);
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return new CameraError("NO_CAMERA", err);
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new CameraError("CAMERA_IN_USE", err);
    case "SecurityError":
      return new CameraError("INSECURE_CONTEXT", err);
    case "TypeError":
      return new CameraError("NOT_SUPPORTED", err);
    default:
      return new CameraError("UNKNOWN", err);
  }
}

export interface CameraOptions {
  facingMode?: "user" | "environment";
  width?: number;
  height?: number;
  /** Called if the camera stops after starting (unplugged, revoked, etc.). */
  onEnded?: (error: CameraError) => void;
}

/** Start the camera and attach it to `video`. Throws CameraError. */
export async function startCamera(video: HTMLVideoElement, options: CameraOptions = {}): Promise<MediaStream> {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new CameraError("INSECURE_CONTEXT");
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("NOT_SUPPORTED");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: options.facingMode ?? "user",
        width: { ideal: options.width ?? 1280 },
        height: { ideal: options.height ?? 720 },
      },
    });
  } catch (err) {
    throw mapCameraError(err);
  }

  for (const track of stream.getVideoTracks()) {
    track.addEventListener("ended", () => options.onEnded?.(new CameraError("STREAM_ENDED")));
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch (err) {
    stopCamera(stream);
    throw mapCameraError(err);
  }
  return stream;
}

export function stopCamera(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

// ---- model ---------------------------------------------------------------

export interface DetectorOptions {
  /** Folder holding MediaPipe's WASM files. Defaults to the matching CDN build. */
  wasmBaseUrl: string;
  /** .task model file. "lite" is fastest; swap for "full" if accuracy matters more. */
  modelAssetPath: string;
  /** GPU is tried first; CPU is the fallback if GPU init fails. */
  delegate: "GPU" | "CPU";
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

export const DEFAULT_DETECTOR_OPTIONS: Readonly<DetectorOptions> = Object.freeze({
  wasmBaseUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm",
  modelAssetPath:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  delegate: "GPU",
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

export class ModelLoadError extends Error {
  constructor(readonly cause?: unknown) {
    super("Couldn't load the pose model. Check your connection and try again.");
    this.name = "ModelLoadError";
  }
}

export async function createPoseLandmarker(options: Partial<DetectorOptions> = {}): Promise<PoseLandmarker> {
  return (await createPoseLandmarkerWithInfo(options)).landmarker;
}

/** Like createPoseLandmarker, also saying which delegate (GPU or CPU) actually loaded. */
export async function createPoseLandmarkerWithInfo(
  options: Partial<DetectorOptions> = {},
): Promise<{ landmarker: PoseLandmarker; delegate: "GPU" | "CPU" }> {
  const o = { ...DEFAULT_DETECTOR_OPTIONS, ...options };
  try {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(o.wasmBaseUrl);
    const build = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: o.modelAssetPath, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: o.minPoseDetectionConfidence,
        minPosePresenceConfidence: o.minPosePresenceConfidence,
        minTrackingConfidence: o.minTrackingConfidence,
      });
    if (o.delegate === "GPU") {
      try {
        return { landmarker: await build("GPU"), delegate: "GPU" };
      } catch {
        return { landmarker: await build("CPU"), delegate: "CPU" };
      }
    }
    return { landmarker: await build("CPU"), delegate: "CPU" };
  } catch (err) {
    throw new ModelLoadError(err);
  }
}

// ---- detection loop ------------------------------------------------------

/** Something that finds a pose in the current video frame: on the main thread or in a worker. */
export interface PoseDetector {
  readonly threading: "main" | "worker";
  readonly delegate: "GPU" | "CPU";
  /** `timestampMs` must strictly increase across calls. */
  detect(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | Promise<PoseLandmarkerResult>;
  close(): void;
}

/** Runs MediaPipe on the main thread (simplest; blocks rendering for the detection time). */
export class MainThreadDetector implements PoseDetector {
  readonly threading = "main" as const;
  constructor(
    private readonly landmarker: PoseLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {}
  detect(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult {
    return this.landmarker.detectForVideo(video, timestampMs);
  }
  close(): void {
    this.landmarker.close();
  }
}

export interface LoopStats {
  /** Pose results per second (smoothed). */
  fps: number;
  /** Time from sending a frame to getting its pose back, ms (smoothed). */
  detectMs: number;
  /** New camera frames skipped because the detector was still busy. */
  skipped: number;
}

/**
 * Runs detection once per new video frame. Uses requestVideoFrameCallback
 * when the browser has it (fires exactly when a new camera frame is ready),
 * else requestAnimationFrame plus a currentTime check.
 *
 * Latest frame wins: at most one frame is in detection at a time; frames that
 * arrive meanwhile are skipped, never queued, so feedback can't fall behind
 * the user. The model never runs twice on the same image, and the loop idles
 * while the tab is hidden.
 *
 * `clock` decides the timestamp handed to `onResult`:
 *   - "wall": performance.now() at capture (live camera)
 *   - "media": the video's own playback time in ms (video files)
 */
export class PoseLoop {
  private handle: number | null = null;
  private usingVfc = false;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private busy = false;
  private running = false;
  private stats: LoopStats = { fps: 0, detectMs: 0, skipped: 0 };
  private lastResultAt: number | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly detector: PoseDetector,
    private readonly onResult: (result: PoseLandmarkerResult, timestamp: number) => void,
    private readonly clock: "wall" | "media" = "wall",
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  getStats(): Readonly<LoopStats> {
    return this.stats;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
      if (this.usingVfc) v.cancelVideoFrameCallback?.(this.handle);
      else cancelAnimationFrame(this.handle);
    }
    this.handle = null;
  }

  private schedule(): void {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    this.usingVfc = typeof v.requestVideoFrameCallback === "function";
    this.handle = this.usingVfc ? v.requestVideoFrameCallback!(() => this.tick()) : requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.handle = null;
    if (!this.running) return;
    this.schedule();
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    if (this.busy) {
      this.stats.skipped += 1;
      return;
    }
    this.lastVideoTime = v.currentTime;
    // MediaPipe requires strictly increasing timestamps.
    const now = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;
    const appTs = this.clock === "media" ? v.currentTime * 1000 : now;
    this.busy = true;
    let out: PoseLandmarkerResult | Promise<PoseLandmarkerResult>;
    try {
      out = this.detector.detect(v, now);
    } catch (err) {
      this.busy = false;
      throw err;
    }
    const done = (result: PoseLandmarkerResult) => {
      this.busy = false;
      const end = performance.now();
      this.stats.detectMs = this.stats.detectMs ? 0.9 * this.stats.detectMs + 0.1 * (end - now) : end - now;
      if (this.lastResultAt !== null) {
        const inst = 1000 / Math.max(1, end - this.lastResultAt);
        this.stats.fps = this.stats.fps ? 0.9 * this.stats.fps + 0.1 * inst : inst;
      }
      this.lastResultAt = end;
      if (this.running) this.onResult(result, appTs);
    };
    if (out instanceof Promise) {
      out.then(done, () => {
        this.busy = false;
      });
    } else {
      done(out);
    }
  }
}

// ---- overlay -------------------------------------------------------------

export interface SkeletonStyle {
  minVisibility: number;
  /** Landmarks used for counting; drawn in the accent colour. */
  highlight: ReadonlySet<number> | null;
  lineColor: string;
  activeColor: string;
  dimColor: string;
  lineWidth: number;
  pointRadius: number;
}

export const DEFAULT_SKELETON_STYLE: Readonly<SkeletonStyle> = Object.freeze({
  minVisibility: 0.6,
  highlight: null,
  lineColor: "rgba(255,255,255,0.85)",
  activeColor: "#C6FF00",
  dimColor: "rgba(255,255,255,0.2)",
  lineWidth: 4,
  pointRadius: 5,
});

/**
 * Draw the skeleton straight onto a canvas (no React involved). Size the canvas
 * to the video's intrinsic resolution and lay it over the <video> with CSS;
 * if you mirror the video, mirror the canvas with the same CSS transform.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly LandmarkLike[] | undefined,
  style: Partial<SkeletonStyle> = {},
): void {
  const s = { ...DEFAULT_SKELETON_STYLE, ...style };
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks || landmarks.length === 0) return;

  const active = s.highlight;
  ctx.lineWidth = s.lineWidth;
  ctx.lineCap = "round";

  for (const [a, b] of SKELETON_CONNECTIONS) {
    const p = landmarks[a];
    const q = landmarks[b];
    if (!p || !q) continue;
    const ok = vis(p) >= s.minVisibility && vis(q) >= s.minVisibility;
    ctx.strokeStyle = !ok ? s.dimColor : active?.has(a) && active.has(b) ? s.activeColor : s.lineColor;
    ctx.beginPath();
    ctx.moveTo(p.x * width, p.y * height);
    ctx.lineTo(q.x * width, q.y * height);
    ctx.stroke();
  }

  for (let i = 11; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!p) continue;
    const ok = vis(p) >= s.minVisibility;
    ctx.fillStyle = !ok ? s.dimColor : active?.has(i) ? s.activeColor : s.lineColor;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, s.pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
