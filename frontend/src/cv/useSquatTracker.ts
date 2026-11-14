/**
 * React hook around SquatTracker.
 *
 *   const videoRef = useRef<HTMLVideoElement>(null);
 *   const canvasRef = useRef<HTMLCanvasElement>(null);
 *   const t = useSquatTracker(videoRef, canvasRef);
 *   // <video ref={videoRef} /> <canvas ref={canvasRef} /> <button onClick={t.start}>
 *
 * State updates arrive at most `uiUpdateHz` times per second (default 10).
 * The skeleton is drawn directly on the canvas and never causes a re-render.
 * Options are read once, on mount.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FormFlag, RepEvent, WorkoutSession } from "../../../shared/types";
import { SquatTracker, initialTrackerState, type SquatTrackerOptions, type TrackerState } from "./squat_tracker";

export interface UseSquatTracker extends TrackerState {
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  /** Ends the session and returns it (null if the tracker isn't mounted). */
  stop: () => WorkoutSession | null;
  /** Subscribe to counted reps. Returns an unsubscribe function; call inside useEffect. */
  onRep: (cb: (rep: RepEvent) => void) => () => void;
  onRejected: (cb: (flag: FormFlag) => void) => () => void;
}

export function useSquatTracker(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: SquatTrackerOptions = {},
): UseSquatTracker {
  const trackerRef = useRef<SquatTracker | null>(null);
  const optionsRef = useRef(options);
  const [state, setState] = useState<TrackerState>(initialTrackerState);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracker = new SquatTracker(video, canvasRef.current, optionsRef.current);
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
  const onRep = useCallback((cb: (rep: RepEvent) => void) => trackerRef.current?.onRep(cb) ?? (() => {}), []);
  const onRejected = useCallback(
    (cb: (flag: FormFlag) => void) => trackerRef.current?.onRejected(cb) ?? (() => {}),
    [],
  );

  return { ...state, start, pause, resume, stop, onRep, onRejected };
}
