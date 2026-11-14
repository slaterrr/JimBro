/**
 * Prerecorded-video analysis, the secondary mode. It shares the live engine:
 *
 *   Live camera    → PoseLoop  → ExerciseTracker → real-time feedback
 *   Uploaded video → extractRecording → replay into ExerciseTracker → VideoReport
 *
 * Frames are pulled from the video by seeking, so every sampled frame is
 * analysed even on a slow device (unlike playing it back in real time), with
 * the same detector, filters, rep counter, leg-role tracking and form checks
 * as a live session.
 */

import type { ExerciseId, FormFlag, Metric, WorkoutSession } from "../../../shared/types";
import { createDetector } from "./detector";
import type { DetectorOptions } from "./pose_detection";
import { RECORDING_SCHEMA, toLandmarks, type Recording } from "./validation/format";
import { recognizeExercise } from "./validation/recognize";
import { replayRecording } from "./validation/replay";

export interface ExtractOptions {
  /** Sample a frame every this many ms of video. */
  sampleMs?: number;
  detector?: Partial<DetectorOptions> & { useWorker?: boolean };
  subjectId?: string;
  mirrored?: boolean;
  onProgress?: (fraction: number) => void;
  /** Set to true to stop early. */
  signal?: { cancelled: boolean };
}

async function sha256(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function seek(video: HTMLVideoElement, sec: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = sec;
  });
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const r3 = (x: number) => Math.round(x * 1e3) / 1e3;

/** Turn a loaded video into a landmark Recording. `video` must already show `file` (metadata loaded). */
export async function extractRecording(video: HTMLVideoElement, file: File, o: ExtractOptions = {}): Promise<Recording> {
  const sampleMs = Math.max(10, o.sampleMs ?? 33);
  const detector = await createDetector({ useWorker: true, ...o.detector });
  const frames: Recording["frames"] = [];
  try {
    const dur = video.duration * 1000;
    video.pause();
    let ts = 0;
    for (let t = 0; t <= dur; t += sampleMs) {
      if (o.signal?.cancelled) break;
      await seek(video, t / 1000);
      ts = Math.max(ts + 1, performance.now());
      const t0 = performance.now();
      const res = await detector.detect(video, ts);
      const detectMs = performance.now() - t0;
      const lm = res.landmarks[0];
      const w = res.worldLandmarks[0];
      frames.push({
        t: Math.round(t),
        lm: lm ? lm.map((p) => [r5(p.x), r5(p.y), r5(p.z), r3(p.visibility ?? 0)]) : null,
        world: w ? w.map((p) => [r5(p.x), r5(p.y), r5(p.z)]) : null,
        detectMs: Math.round(detectMs * 10) / 10,
      });
      o.onProgress?.(Math.min(1, t / dur));
    }
  } finally {
    detector.close();
  }
  return {
    schema: RECORDING_SCHEMA,
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`,
    createdAt: new Date().toISOString(),
    subjectId: o.subjectId ?? "unknown",
    source: {
      fileName: file.name,
      sha256: await sha256(file),
      bytes: file.size,
      durationSec: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      mirrored: o.mirrored ?? false,
    },
    extraction: {
      model: o.detector?.modelAssetPath?.split("/").pop()?.replace(".task", "") ?? "pose_landmarker_lite",
      mediapipe: "@mediapipe/tasks-vision 1.1.1",
      sampleMs,
      extractedAt: new Date().toISOString(),
    },
    frames,
    annotations: [],
  };
}

export interface VideoRep {
  repNumber: number;
  /** Video time, seconds. */
  start: number;
  end: number;
  durationMs: number;
  peakAngle: number;
  flags: FormFlag[];
  metrics: Record<string, Metric>;
}

export interface VideoIssue {
  /** Video time of the rep start, seconds (seek here to review it). */
  t: number;
  repNumber: number | null;
  flag: FormFlag;
}

export interface VideoReport {
  exercise: ExerciseId;
  /** "auto" if the exercise was detected; the detection's evidence is kept. */
  chosenBy: "user" | "auto";
  recognition: { exercise: ExerciseId | null; evidence: Record<string, number> } | null;
  reps: VideoRep[];
  /** Every form observation with the time it happened, in order. */
  issues: VideoIssue[];
  session: WorkoutSession;
  /** Fraction of frames with a person found, and with the counting joints visible. */
  coverage: { personFound: number; jointsVisible: number };
}

/** Run a Recording through the shared engine and build the report. */
export function analyzeRecording(rec: Recording, exercise: ExerciseId | "auto"): VideoReport | { error: string; recognition: VideoReport["recognition"] } {
  let recognition: VideoReport["recognition"] = null;
  let ex: ExerciseId;
  if (exercise === "auto") {
    recognition = recognizeExercise(rec.frames.map((f) => toLandmarks(f.lm)), rec.source.width / rec.source.height);
    if (!recognition.exercise) {
      return { error: "Couldn't tell which exercise this is. Pick it from the list.", recognition };
    }
    ex = recognition.exercise;
  } else {
    ex = exercise;
  }

  const { session, frames } = replayRecording(rec, ex);
  const reps: VideoRep[] = session.reps.map((r) => ({
    repNumber: r.repNumber,
    start: r.startedAt / 1000,
    end: r.endedAt / 1000,
    durationMs: r.durationMs,
    peakAngle: r.peakAngle.value,
    flags: r.formFlags,
    metrics: r.metrics,
  }));
  const issues: VideoIssue[] = [
    ...reps.flatMap((r) => r.flags.map((flag) => ({ t: r.start, repNumber: r.repNumber, flag }))),
    ...(session.summary?.insights ?? []).map((flag) => ({ t: 0, repNumber: null, flag })),
  ].sort((a, b) => a.t - b.t);
  const n = rec.frames.length || 1;
  return {
    exercise: ex,
    chosenBy: exercise === "auto" ? "auto" : "user",
    recognition,
    reps,
    issues,
    session,
    coverage: {
      personFound: rec.frames.filter((f) => f.lm).length / n,
      jointsVisible: frames.filter((f) => f.visible).length / n,
    },
  };
}
