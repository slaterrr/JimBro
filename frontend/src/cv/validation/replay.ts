/**
 * Replay a Recording through the real ExerciseTracker, headless: the same
 * reader, filter, counter and analyzer the app uses, with no camera or model.
 */

import type { ExerciseId, WorkoutSession } from "../../../../shared/types";
import { ExerciseTracker, type ExerciseTrackerOptions } from "../exercise_tracker";
import type { BodySide } from "../pose_detection";
import { toLandmarks, toWorld, type Recording } from "./format";

export interface ReplayFrame {
  t: number;
  primaryAngle: number | null;
  visible: boolean;
  activeSide: BodySide | "both" | null;
  positionHint: string | null;
  phase: string;
}

export interface ReplayResult {
  session: WorkoutSession;
  frames: ReplayFrame[];
  /** Time to process each frame in the tracker (excludes pose detection), ms. */
  pipelineMs: number[];
  trackingQuality: { visible: number; glitches: number; bridged: number };
}

export function replayRecording(
  rec: Recording,
  exercise: ExerciseId,
  options: Omit<ExerciseTrackerOptions, "exercise"> = {},
): ReplayResult {
  // No video element is needed for a replay; the tracker only reads its size.
  const fakeVideo = { videoWidth: rec.source.width, videoHeight: rec.source.height } as HTMLVideoElement;
  const tracker = new ExerciseTracker(fakeVideo, null, { ...options, exercise });
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const frames: ReplayFrame[] = [];
  const pipelineMs: number[] = [];

  tracker.beginReplay(rec.source.width / rec.source.height);
  for (const f of rec.frames) {
    const t0 = now();
    tracker.ingest(toLandmarks(f.lm), toWorld(f.world), f.t);
    pipelineMs.push(now() - t0);
    const s = tracker.getState();
    frames.push({
      t: f.t,
      primaryAngle: s.liveAngle,
      visible: s.landmarksVisible,
      activeSide: s.activeSide,
      positionHint: s.positionHint,
      phase: s.phase,
    });
  }
  const trackingQuality = tracker.getState().trackingQuality;
  const session = tracker.endReplay();
  tracker.dispose();
  return { session, frames, pipelineMs, trackingQuality };
}
