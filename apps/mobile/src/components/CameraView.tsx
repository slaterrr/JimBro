import { useCallback, useEffect, useRef, useState } from "react";
import { CameraError, type Facing, startCamera, stopStream } from "../camera/camera";
import { createMediaPipeDetector, type DetectorFactory, type PoseDetector } from "../pose/detector";
import { drawSkeleton } from "../pose/skeleton";
import { assessTracking, type Landmark, type TrackingAssessment } from "../pose/tracking";

export interface PoseFrame {
  pose: Landmark[] | null;
  tracking: TrackingAssessment;
  timestampMs: number;
}

interface Props {
  devices?: MediaDevices;
  createDetector?: DetectorFactory;
  onFrame?: (frame: PoseFrame) => void;
}

const LABEL = { ok: "Tracking", low: "Low confidence", lost: "No body detected" } as const;

export function CameraView({
  devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices,
  createDetector = createMediaPipeDetector,
  onFrame,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<PoseDetector | null>(null);
  const rafRef = useRef<number>(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const [running, setRunning] = useState(false);
  const [facing, setFacing] = useState<Facing>("user");
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingAssessment>({ status: "lost", confidence: 0 });
  const [fps, setFps] = useState(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    stopStream(streamRef.current);
    streamRef.current = null;
    detectorRef.current?.close();
    detectorRef.current = null;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const loop = useCallback(() => {
    let frames = 0;
    let windowStart = performance.now();
    let lastStatus = "";
    const tick = () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!detector) return;
      if (video && video.readyState >= 2) {
        const now = performance.now();
        const pose = detector.detect(video, now);
        const assessment = assessTracking(pose);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          drawSkeleton(ctx, pose, assessment.status);
        }
        if (assessment.status !== lastStatus) {
          lastStatus = assessment.status;
          setTracking(assessment);
        }
        onFrameRef.current?.({ pose, tracking: assessment, timestampMs: now });
        frames += 1;
        if (now - windowStart >= 1000) {
          setFps(Math.round((frames * 1000) / (now - windowStart)));
          frames = 0;
          windowStart = now;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await startCamera(devices, facing);
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // Some browsers (and jsdom) return undefined or throw; autoplay is muted anyway.
        await Promise.resolve().then(() => video.play()).catch(() => undefined);
      }
      detectorRef.current = await createDetector();
      setTracking({ status: "lost", confidence: 0 });
      setRunning(true);
      loop();
    } catch (err) {
      stop();
      setError(err instanceof CameraError ? err.message : "Pose model failed to load. Check connection and retry.");
    }
  };

  return (
    <section className="camera">
      <div className={`stage ${facing === "user" ? "mirror" : ""}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>
      <div className="camera-bar">
        <span data-testid="tracking" className={`badge ${running ? tracking.status : "lost"}`}>
          {running ? `${LABEL[tracking.status]} · ${Math.round(tracking.confidence * 100)}%` : "Camera off"}
        </span>
        {running && <span className="muted">{fps} fps</span>}
        {running ? (
          <button onClick={stop}>Stop</button>
        ) : (
          <>
            <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
              Flip ({facing === "user" ? "front" : "rear"})
            </button>
            <button className="primary" onClick={start}>Start camera</button>
          </>
        )}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
