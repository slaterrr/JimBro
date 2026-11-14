/**
 * Jim Bro validation data format (v1).
 *
 * A Recording is one exercise video turned into pose landmarks, plus any
 * number of independent Annotations of it. Everything needed to audit a
 * label later is kept: the video's SHA-256, how and with which model the
 * landmarks were extracted, every frame's timestamp, and who annotated what
 * and when. Video itself is never stored here.
 *
 *   Recording ─┬─ source (file name, hash, size, duration, mirrored?)
 *              ├─ extraction (model, settings, per-frame latency)
 *              ├─ frames[] (t ms, 33 landmarks [x, y, z, visibility], 33 world [x, y, z])
 *              └─ annotations[] (one per reviewer pass)
 */

import type { ExerciseId } from "../../../../shared/types";
import { POSE_LANDMARKS as L } from "../pose_detection";

export const RECORDING_SCHEMA = "jimbro.recording/v1";

export type View = "side" | "front" | "diagonal";

export interface Recording {
  schema: typeof RECORDING_SCHEMA;
  id: string;
  createdAt: string;
  /** Pseudonymous person ID, needed for subject-wise splits. Never a name. */
  subjectId: string;
  source: {
    fileName: string;
    sha256: string;
    bytes: number;
    durationSec: number;
    width: number;
    height: number;
    /**
     * True if the video is mirrored (selfie-style). MediaPipe's left/right
     * then refer to the person's opposite side, so evaluation swaps them.
     */
    mirrored: boolean;
  };
  extraction: {
    model: string;
    mediapipe: string;
    /** Frames were sampled every this many ms of video time. */
    sampleMs: number;
    extractedAt: string;
  };
  frames: RecordingFrame[];
  annotations: Annotation[];
}

export interface RecordingFrame {
  /** Video time, ms. */
  t: number;
  /** 33 × [x, y, z, visibility] in normalised image coordinates, or null if no person was found. */
  lm: number[][] | null;
  /** 33 × [x, y, z] in metres, or null. */
  world: number[][] | null;
  /** Model time for this frame, ms. */
  detectMs: number;
}

export interface Reviewer {
  /** Stable pseudonymous ID (e.g. "coach-3"). */
  id: string;
  role: "coach" | "physio" | "researcher" | "other";
}

/** Joints whose angle can be checked against a reference measurement. */
export const ANGLE_JOINTS = {
  left_knee: [L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE],
  right_knee: [L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE],
  left_hip: [L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE],
  right_hip: [L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE],
  left_elbow: [L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST],
  right_elbow: [L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST],
} as const;
export type AngleJoint = keyof typeof ANGLE_JOINTS;

export interface RepAnnotation {
  /** Video time, ms. */
  start: number;
  end: number;
  /** Lunges: the person's front leg on this rep. */
  frontLeg?: "left" | "right";
  /** Curls: which arm(s) did this rep. */
  arm?: "left" | "right" | "both";
  /**
   * What the person actually did on this attempt, if it wasn't the annotated
   * exercise (e.g. a lunge in a squat set, to test the app doesn't count it).
   * Such attempts must NOT be counted. Omitted = the annotated exercise.
   */
  performed?: ExerciseId | "walking" | "bending" | "other";
}

export interface AngleCheck {
  t: number;
  joint: AngleJoint;
  /** Reference angle in degrees. */
  degrees: number;
  /** How the reference was obtained. Only "goniometer" and "mocap" count as ground truth. */
  method: "goniometer" | "mocap" | "on-screen";
}

/**
 * A technique characteristic, judged by the reviewer. Codes are free text
 * chosen by the reviewer team; nothing is pre-filled as an error.
 */
export interface TraitLabel {
  /** Index into `reps`, or null for the whole set. */
  rep: number | null;
  code: string;
  value: "yes" | "no" | "unsure";
  note?: string;
}

export interface Annotation {
  id: string;
  reviewer: Reviewer;
  createdAt: string;
  exercise: ExerciseId;
  /** e.g. "reverse lunge", "alternating dumbbell curl". */
  variation: string;
  view: View;
  /** Every rep the reviewer counts as a rep, in order. */
  reps: RepAnnotation[];
  angleChecks: AngleCheck[];
  traits: TraitLabel[];
  notes?: string;
}

/** Throws with a readable message if `x` isn't a valid Recording. */
export function assertRecording(x: unknown): asserts x is Recording {
  const r = x as Partial<Recording>;
  const fail = (msg: string) => {
    throw new Error(`Not a valid ${RECORDING_SCHEMA} file: ${msg}`);
  };
  if (!r || typeof r !== "object") fail("not an object");
  if (r.schema !== RECORDING_SCHEMA) fail(`schema is "${String(r.schema)}"`);
  if (!r.id || !r.subjectId) fail("missing id or subjectId");
  if (!r.source?.sha256) fail("missing source hash");
  if (!Array.isArray(r.frames) || r.frames.length === 0) fail("no frames");
  let prev = -Infinity;
  for (const f of r.frames!) {
    if (!(f.t > prev)) fail("frame times must increase");
    prev = f.t;
    if (f.lm && f.lm.length !== 33) fail("each frame needs 33 landmarks");
  }
  for (const a of r.annotations ?? []) {
    if (!a.reviewer?.id) fail("annotation without a reviewer");
    for (const rep of a.reps) if (!(rep.end > rep.start)) fail("rep end must be after start");
  }
}

export const toLandmarks = (lm: number[][] | null) =>
  lm?.map(([x, y, z, v]) => ({ x: x!, y: y!, z: z ?? 0, visibility: v ?? 0 }));

export const toWorld = (w: number[][] | null) => w?.map(([x, y, z]) => ({ x: x!, y: y!, z: z! }));
