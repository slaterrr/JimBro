import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Copy the non-module MediaPipe wasm runtime into dist/mediapipe/wasm so the Pi can serve
 * pose inference assets offline. The model file is fetched by scripts/fetch_models.sh.
 */
export function vendorMediaPipe(): Plugin {
  return {
    name: "vendor-mediapipe",
    apply: "build",
    closeBundle() {
      const src = resolve(__dirname, "node_modules/@mediapipe/tasks-vision/wasm");
      const out = resolve(__dirname, "dist/mediapipe/wasm");
      if (!existsSync(src)) return;
      mkdirSync(out, { recursive: true });
      for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
        cpSync(resolve(src, f), resolve(out, f));
      }
      const model = resolve(__dirname, "../../models/pose_landmarker_lite.task");
      if (existsSync(model)) cpSync(model, resolve(__dirname, "dist/mediapipe/pose_landmarker_lite.task"));
    },
  };
}
