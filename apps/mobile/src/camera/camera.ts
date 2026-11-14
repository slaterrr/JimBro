/** Camera access with permission failures mapped to user-actionable kinds. */

export type CameraErrorKind = "denied" | "not-found" | "in-use" | "insecure" | "unknown";
export type Facing = "user" | "environment";

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    cause?: unknown,
  ) {
    super(cameraErrorMessage(kind), { cause });
    this.name = "CameraError";
  }
}

export function classifyCameraError(error: unknown): CameraErrorKind {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "not-found";
    case "NotReadableError":
      return "in-use";
    default:
      return "unknown";
  }
}

export function cameraErrorMessage(kind: CameraErrorKind): string {
  return {
    denied: "Camera permission was denied. Allow camera access in your browser settings.",
    "not-found": "No usable camera was found on this device.",
    "in-use": "The camera is in use by another app. Close it and try again.",
    insecure: "Camera needs a secure (HTTPS) connection. Open the Pi's https:// address.",
    unknown: "The camera could not be started. Try again.",
  }[kind];
}

export async function startCamera(
  devices: MediaDevices | undefined,
  facing: Facing,
): Promise<MediaStream> {
  if (!devices?.getUserMedia) throw new CameraError("insecure");
  try {
    // Video only: raw frames stay on the phone and are never uploaded.
    return await devices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (error) {
    throw new CameraError(classifyCameraError(error), error);
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
