/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Pi serves the built app from FastAPI; in dev, proxy API + websocket calls.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  server: {
    proxy: {
      "/v1": { target: "http://localhost:8000", ws: true },
      "/health": "http://localhost:8000",
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["src/setupTests.ts"] },
});
