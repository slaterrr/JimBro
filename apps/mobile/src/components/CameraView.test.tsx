import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CameraView } from "./CameraView";

const fakeStream = () => {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
};
const detector = { detect: vi.fn(() => null), close: vi.fn() };

describe("CameraView", () => {
  it("shows a permission message when the camera is denied", async () => {
    const devices = {
      getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" })),
    } as unknown as MediaDevices;
    render(<CameraView devices={devices} createDetector={async () => detector} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /start camera/i })));
    expect(screen.getByRole("alert")).toHaveTextContent(/permission was denied/i);
  });

  it("starts, reports lost tracking, and stops all tracks", async () => {
    const { stream, stop } = fakeStream();
    const devices = { getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as MediaDevices;
    render(<CameraView devices={devices} createDetector={async () => detector} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /start camera/i })));
    expect(screen.getByTestId("tracking")).toHaveTextContent(/no body/i);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /stop/i })));
    expect(stop).toHaveBeenCalled();
    expect(detector.close).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /start camera/i })).toBeInTheDocument();
  });

  it("can switch camera facing", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    render(
      <CameraView devices={{ getUserMedia } as unknown as MediaDevices} createDetector={async () => detector} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /flip/i }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /start camera/i })));
    expect(getUserMedia.mock.calls[0][0].video.facingMode).toBe("environment");
  });
});
