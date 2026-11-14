/**
 * Choose where pose detection runs: a Web Worker when the browser supports
 * it (main thread stays free for the camera picture and skeleton), else the
 * main thread. Both use the same MediaPipe model and settings, and either
 * one feeds the same analysis engine.
 */

import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { MainThreadDetector, ModelLoadError, createPoseLandmarkerWithInfo, type DetectorOptions, type PoseDetector } from "./pose_detection";

export class WorkerDetector implements PoseDetector {
  readonly threading = "worker" as const;
  private pending: ((r: PoseLandmarkerResult) => void) | null = null;

  private constructor(
    private readonly worker: Worker,
    readonly delegate: "GPU" | "CPU",
  ) {
    worker.onmessage = (e: MessageEvent) => {
      if (e.data?.type !== "result") return;
      const done = this.pending;
      this.pending = null;
      done?.({ landmarks: e.data.landmarks, worldLandmarks: e.data.worldLandmarks } as unknown as PoseLandmarkerResult);
    };
  }

  static async create(options: Partial<DetectorOptions>, timeoutMs = 30_000): Promise<WorkerDetector> {
    const worker = new Worker(new URL("./pose_worker.ts", import.meta.url), { type: "module" });
    const delegate = await new Promise<"GPU" | "CPU">((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Pose worker didn't start in time.")), timeoutMs);
      worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type === "ready") {
          clearTimeout(timer);
          resolve(e.data.delegate);
        } else if (e.data?.type === "error") {
          clearTimeout(timer);
          reject(new Error(e.data.message));
        }
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message || "Pose worker failed."));
      };
      worker.postMessage({ type: "init", options });
    }).catch((err) => {
      worker.terminate();
      throw err;
    });
    return new WorkerDetector(worker, delegate);
  }

  async detect(video: HTMLVideoElement, timestampMs: number): Promise<PoseLandmarkerResult> {
    const bitmap = await createImageBitmap(video);
    return new Promise((resolve) => {
      this.pending = resolve;
      this.worker.postMessage({ type: "frame", bitmap, ts: timestampMs }, [bitmap]);
    });
  }

  close(): void {
    this.worker.postMessage({ type: "close" });
    setTimeout(() => this.worker.terminate(), 500);
  }
}

/**
 * Worker first (unless `useWorker` is false or Workers/ImageBitmap are
 * missing), falling back to the main thread if the worker can't start.
 */
export async function createDetector(options: Partial<DetectorOptions> & { useWorker?: boolean } = {}): Promise<PoseDetector> {
  const { useWorker = true, ...detectorOptions } = options;
  const canWorker = typeof Worker !== "undefined" && typeof createImageBitmap === "function";
  if (useWorker && canWorker) {
    try {
      return await WorkerDetector.create(detectorOptions);
    } catch (err) {
      console.warn("Pose worker unavailable, detecting on the main thread instead.", err);
    }
  }
  try {
    const { landmarker, delegate } = await createPoseLandmarkerWithInfo(detectorOptions);
    return new MainThreadDetector(landmarker, delegate);
  } catch (err) {
    throw err instanceof ModelLoadError ? err : new ModelLoadError(err);
  }
}
