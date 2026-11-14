/**
 * Camera access, MediaPipe Pose Landmarker setup, the detection loop, landmark
 * extraction with confidence filtering, and skeleton drawing.
 *
 * MediaPipe is imported lazily so this module (and its pure helpers) can be
 * imported in tests and server-side code without loading WASM.
 */

import type { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { calculateAngle } from "./angle_calculator";

// ---- landmarks -----------------------------------------------------------

/** Minimal landmark shape (matches MediaPipe's NormalizedLandmark). */
export interface LandmarkLike {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** BlazePose landmark indices used by Jim Bro. */
export const POSE_LANDMARKS = {
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

const SIDE_INDICES = {
  left: { shoulder: L.LEFT_SHOULDER, hip: L.LEFT_HIP, knee: L.LEFT_KNEE, ankle: L.LEFT_ANKLE },
  right: { shoulder: L.RIGHT_SHOULDER, hip: L.RIGHT_HIP, knee: L.RIGHT_KNEE, ankle: L.RIGHT_ANKLE },
} as const;

/** How much better the other side must be before we switch, to avoid flicker. */
const SIDE_SWITCH_MARGIN = 0.15;

export interface SquatJoints {
  /** The leg used for the angles (the one more visible to the camera). */
  side: BodySide | null;
  /** Hip–knee–ankle angle, degrees. null if any of the three is below threshold. */
  kneeAngle: number | null;
  /** Shoulder–hip–knee angle, degrees. null if any of the three is below threshold. */
  hipAngle: number | null;
  /** True when the leg used for counting is above the confidence threshold. */
  visible: boolean;
}

const vis = (p: LandmarkLike | undefined) => p?.visibility ?? 0;

/**
 * Pick the more visible leg and compute knee / hip angles from it. A side-on
 * camera sees one leg clearly and the other partly hidden, so averaging both
 * would mix a good signal with a bad one.
 */
export function extractSquatJoints(
  landmarks: readonly LandmarkLike[] | undefined,
  options: { minVisibility?: number; aspectRatio?: number; preferredSide?: BodySide | null } = {},
): SquatJoints {
  const minVisibility = options.minVisibility ?? 0.6;
  const aspectRatio = options.aspectRatio ?? 1;
  const none: SquatJoints = { side: null, kneeAngle: null, hipAngle: null, visible: false };
  if (!landmarks || landmarks.length < 33) return none;

  const legScore = (side: BodySide) => {
    const i = SIDE_INDICES[side];
    return Math.min(vis(landmarks[i.hip]), vis(landmarks[i.knee]), vis(landmarks[i.ankle]));
  };
  const left = legScore("left");
  const right = legScore("right");

  let side: BodySide = left >= right ? "left" : "right";
  const preferred = options.preferredSide;
  if (preferred) {
    const pScore = preferred === "left" ? left : right;
    const oScore = preferred === "left" ? right : left;
    if (pScore >= minVisibility && oScore - pScore < SIDE_SWITCH_MARGIN) side = preferred;
  }

  const score = side === "left" ? left : right;
  if (score < minVisibility) return none;

  const i = SIDE_INDICES[side];
  const shoulder = landmarks[i.shoulder];
  const hip = landmarks[i.hip]!;
  const knee = landmarks[i.knee]!;
  const ankle = landmarks[i.ankle]!;

  const kneeAngle = calculateAngle(hip, knee, ankle, aspectRatio);
  const hipAngle =
    shoulder && vis(shoulder) >= minVisibility ? calculateAngle(shoulder, hip, knee, aspectRatio) : null;

  return { side, kneeAngle, hipAngle, visible: kneeAngle !== null };
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
        return await build("GPU");
      } catch {
        return await build("CPU");
      }
    }
    return await build("CPU");
  } catch (err) {
    throw new ModelLoadError(err);
  }
}

// ---- detection loop ------------------------------------------------------

/**
 * Runs detection once per new video frame via requestAnimationFrame. Frames
 * the camera hasn't updated are skipped, so the model never runs twice on the
 * same image and the loop idles when the tab is hidden.
 */
export class PoseLoop {
  private rafId: number | null = null;
  private lastVideoTime = -1;
  private lastTimestamp = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly landmarker: PoseLandmarker,
    private readonly onResult: (result: PoseLandmarkerResult, timestamp: number) => void,
  ) {}

  get running(): boolean {
    return this.rafId !== null;
  }

  start(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const v = this.video;
      if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = v.currentTime;
      // MediaPipe requires strictly increasing timestamps.
      const now = Math.max(performance.now(), this.lastTimestamp + 1);
      this.lastTimestamp = now;
      const result = this.landmarker.detectForVideo(v, now);
      this.onResult(result, now);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}

// ---- overlay -------------------------------------------------------------

export interface SkeletonStyle {
  minVisibility: number;
  /** Leg used for counting; drawn in the accent colour. */
  activeSide: BodySide | null;
  lineColor: string;
  activeColor: string;
  dimColor: string;
  lineWidth: number;
  pointRadius: number;
}

export const DEFAULT_SKELETON_STYLE: Readonly<SkeletonStyle> = Object.freeze({
  minVisibility: 0.6,
  activeSide: null,
  lineColor: "rgba(255,255,255,0.85)",
  activeColor: "#C6FF00",
  dimColor: "rgba(255,255,255,0.2)",
  lineWidth: 4,
  pointRadius: 5,
});

const ACTIVE_LEG: Record<BodySide, ReadonlySet<number>> = {
  left: new Set([L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE]),
  right: new Set([L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE]),
};

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

  const active = s.activeSide ? ACTIVE_LEG[s.activeSide] : null;
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
