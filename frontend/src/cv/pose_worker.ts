/**
 * Pose detection in a Web Worker, so the camera picture, skeleton and UI on
 * the main thread never wait for the model. The main thread sends one
 * ImageBitmap per frame (transferred, not copied) and gets the landmarks back.
 */

import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPoseLandmarkerWithInfo, type DetectorOptions } from "./pose_detection";

type InMsg =
  | { type: "init"; options: Partial<DetectorOptions> }
  | { type: "frame"; bitmap: ImageBitmap; ts: number }
  | { type: "close" };

interface WorkerScope {
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
  postMessage(msg: unknown): void;
  importScripts?: (...urls: string[]) => void;
  close(): void;
}
const scope = self as unknown as WorkerScope;

// MediaPipe loads its WASM glue script with importScripts(), which module
// workers don't allow. Load it synchronously and evaluate it in global scope,
// which is what importScripts would have done.
scope.importScripts = (...urls: string[]) => {
  for (const url of urls) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send();
    if (xhr.status < 200 || xhr.status >= 300) throw new Error(`Failed to load ${url} (${xhr.status})`);
    (0, eval)(xhr.responseText);
  }
};

let landmarker: PoseLandmarker | null = null;

scope.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      const { landmarker: lm, delegate } = await createPoseLandmarkerWithInfo(msg.options);
      landmarker = lm;
      scope.postMessage({ type: "ready", delegate });
    } catch (err) {
      scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === "frame") {
    if (!landmarker) {
      msg.bitmap.close();
      scope.postMessage({ type: "result", ts: msg.ts, landmarks: [], worldLandmarks: [] });
      return;
    }
    try {
      const r = landmarker.detectForVideo(msg.bitmap, msg.ts);
      scope.postMessage({ type: "result", ts: msg.ts, landmarks: r.landmarks, worldLandmarks: r.worldLandmarks });
    } catch (err) {
      scope.postMessage({ type: "result", ts: msg.ts, landmarks: [], worldLandmarks: [], error: String(err) });
    } finally {
      msg.bitmap.close();
    }
  } else if (msg.type === "close") {
    landmarker?.close();
    landmarker = null;
    scope.close();
  }
};
