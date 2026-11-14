/** Adapter around MediaPipe PoseLandmarker. Runs entirely on the phone. */
import type { Landmark } from "./tracking";

export interface PoseDetector {
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null;
  close(): void;
}

export type DetectorFactory = () => Promise<PoseDetector>;

const LOCAL_ROOT = "/mediapipe";
const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

async function available(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

/** Prefer assets vendored onto the Pi (offline demo), fall back to public CDNs. */
export const createMediaPipeDetector: DetectorFactory = async () => {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const localModel = `${LOCAL_ROOT}/pose_landmarker_lite.task`;
  const local = await available(localModel);
  const fileset = await FilesetResolver.forVisionTasks(local ? `${LOCAL_ROOT}/wasm` : CDN_WASM);
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: local ? localModel : CDN_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  return {
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      return (result.landmarks[0] as Landmark[] | undefined) ?? null;
    },
    close: () => landmarker.close(),
  };
};
