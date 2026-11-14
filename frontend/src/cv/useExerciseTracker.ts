/**
 * React hook around ExerciseTracker.
 *
 *   const videoRef = useRef<HTMLVideoElement>(null);
 *   const canvasRef = useRef<HTMLCanvasElement>(null);
 *   const t = useExerciseTracker(videoRef, canvasRef, { exercise: "pushup" });
 *   // <video ref={videoRef} /> <canvas ref={canvasRef} /> <button onClick={t.start}>
 *
 * State updates arrive at most `uiUpdateHz` times per second (default 10).
 * The skeleton is drawn directly on the canvas and never causes a re-render.
 * Options are read once, on mount; switch exercises with setExercise().
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ExerciseId, FormFlag, RepEvent, WorkoutSession } from "../../../shared/types";
import {
  ExerciseTracker,
  initialTrackerState,
  type ExerciseTrackerOptions,
  type TrackerState,
} from "./exercise_tracker";

export interface UseExerciseTracker extends TrackerState {
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  /** Ends the session and returns it (null if the tracker isn't mounted). */
  stop: () => WorkoutSession | null;
  /** Switch exercise (not while tracking). Discards any unsaved session. */
  setExercise: (id: ExerciseId) => void;
  /** Subscribe to counted reps. Returns an unsubscribe function; call inside useEffect. */
  onRep: (cb: (rep: RepEvent) => void) => () => void;
  onRejected: (cb: (flag: FormFlag) => void) => () => void;
  /** The underlying tracker (e.g. for VoiceCoach or calibration). null until mounted. */
  tracker: ExerciseTracker | null;
}

export function useExerciseTracker(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: ExerciseTrackerOptions = {},
): UseExerciseTracker {
  const trackerRef = useRef<ExerciseTracker | null>(null);
  const optionsRef = useRef(options);
  const [state, setState] = useState<TrackerState>(() => initialTrackerState(options.exercise));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracker = new ExerciseTracker(video, canvasRef.current, optionsRef.current);
    trackerRef.current = tracker;
    const unsubscribe = tracker.subscribe(setState);
    return () => {
      unsubscribe();
      tracker.dispose();
      trackerRef.current = null;
    };
  }, [videoRef, canvasRef]);

  const start = useCallback(async () => {
    await trackerRef.current?.start();
  }, []);
  const pause = useCallback(() => trackerRef.current?.pause(), []);
  const resume = useCallback(async () => {
    await trackerRef.current?.resume();
  }, []);
  const stop = useCallback(() => trackerRef.current?.stop() ?? null, []);
  const setExercise = useCallback((id: ExerciseId) => trackerRef.current?.setExercise(id), []);
  const onRep = useCallback((cb: (rep: RepEvent) => void) => trackerRef.current?.onRep(cb) ?? (() => {}), []);
  const onRejected = useCallback(
    (cb: (flag: FormFlag) => void) => trackerRef.current?.onRejected(cb) ?? (() => {}),
    [],
  );

  return { ...state, start, pause, resume, stop, setExercise, onRep, onRejected, tracker: trackerRef.current };
}
