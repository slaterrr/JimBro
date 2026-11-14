import { describe, expect, it } from "vitest";
import type { FormFlag, RepEvent } from "../../../shared/types";
import { initialTrackerState, type TrackerState } from "./exercise_tracker";
import { pushup, squat } from "./exercises";
import { VoiceCoach, type CoachableTracker, type Speaker } from "./voice_coach";

const SETUP_INSTRUCTIONS = squat.setupInstructions;

class FakeTracker implements CoachableTracker {
  state: TrackerState = initialTrackerState();
  private s = new Set<(s: TrackerState) => void>();
  private r = new Set<(r: RepEvent) => void>();
  private j = new Set<(f: FormFlag) => void>();
  subscribe(l: (s: TrackerState) => void) {
    this.s.add(l);
    l(this.state);
    return () => this.s.delete(l);
  }
  onRep(l: (r: RepEvent) => void) {
    this.r.add(l);
    return () => this.r.delete(l);
  }
  onRejected(l: (f: FormFlag) => void) {
    this.j.add(l);
    return () => this.j.delete(l);
  }
  set(patch: Partial<TrackerState>) {
    this.state = { ...this.state, ...patch };
    this.s.forEach((l) => l(this.state));
  }
  rep(n: number, flags: FormFlag[] = []) {
    const e: RepEvent = {
      exercise: this.state.exercise,
      repNumber: n,
      startedAt: 0,
      endedAt: 2000,
      durationMs: 2000,
      primaryJoint: "knee",
      peakAngle: { value: 85, unit: "deg", source: "measured" },
      fullRange: true,
      formFlags: flags,
    };
    this.r.forEach((l) => l(e));
  }
  reject(code: string) {
    this.j.forEach((l) => l({ code, message: `msg ${code}`, source: "measured" }));
  }
}

class FakeSpeaker implements Speaker {
  said: string[] = [];
  cancels = 0;
  speak(text: string) {
    this.said.push(text);
  }
  cancel() {
    this.cancels += 1;
  }
}

function setup(opts: { enabled?: boolean } = {}) {
  let clock = 0;
  const tracker = new FakeTracker();
  const speaker = new FakeSpeaker();
  const coach = new VoiceCoach(tracker, { now: () => clock, ...opts }, speaker);
  coach.attach();
  return { tracker, speaker, coach, advance: (ms: number) => (clock += ms) };
}

describe("VoiceCoach", () => {
  it("speaks setup instructions when tracking starts", () => {
    const { tracker, speaker } = setup();
    tracker.set({ status: "tracking" });
    expect(speaker.said).toEqual([SETUP_INSTRUCTIONS]);
  });

  it("says the rep number, interrupting other speech", () => {
    const { tracker, speaker } = setup();
    tracker.set({ status: "tracking", landmarksVisible: true, armed: true });
    const cancelsBefore = speaker.cancels;
    tracker.rep(1);
    tracker.rep(2);
    expect(speaker.said.slice(-2)).toEqual(["1", "2"]);
    expect(speaker.cancels).toBe(cancelsBefore + 2);
  });

  it("speaks only measured form tips worth hearing mid-set", () => {
    const { tracker, speaker } = setup();
    tracker.set({ status: "tracking", landmarksVisible: true, armed: true });
    tracker.rep(1, [
      { code: "FAST_LOWERING", message: "x", source: "measured" },
      { code: "UNEVEN_TEMPO", message: "y", source: "estimated" },
    ]);
    expect(speaker.said.slice(-2)).toEqual(["1", "Slow down on the way down."]);
  });

  it("explains why a rep didn't count", () => {
    const { tracker, speaker } = setup();
    tracker.reject("SHALLOW_DEPTH");
    tracker.reject("SOMETHING_NEW");
    expect(speaker.said).toEqual(["Not counted. Go a little lower.", "msg SOMETHING_NEW"]);
  });

  it("uses the current exercise's wording", () => {
    const { tracker, speaker } = setup();
    tracker.set({ exercise: "pushup", status: "tracking" });
    expect(speaker.said).toEqual([pushup.setupInstructions]);
    tracker.reject("SHALLOW_PUSHUP");
    expect(speaker.said.at(-1)).toBe("Not counted. Go lower.");
    tracker.set({ landmarksVisible: true, armed: true });
    expect(speaker.said.at(-1)).toBe(pushup.readyPrompt);
  });

  it("speaks the position hint when the user isn't in position", () => {
    const { tracker, speaker, advance } = setup();
    tracker.set({ exercise: "pushup", status: "tracking", landmarksVisible: false, positionHint: "Get down." });
    speaker.said = [];
    advance(3000);
    tracker.set({ landmarksVisible: false });
    expect(speaker.said).toEqual(["Get down."]);
  });

  it("asks the user to step back only after a sustained loss of view", () => {
    const { tracker, speaker, advance } = setup();
    tracker.set({ status: "tracking", landmarksVisible: false });
    speaker.said = [];
    advance(1000);
    tracker.set({ landmarksVisible: false });
    expect(speaker.said).toEqual([]);
    advance(2000);
    tracker.set({ landmarksVisible: false });
    expect(speaker.said).toEqual(["I can't see you clearly. Step back so I can see the whole movement."]);
  });

  it("prompts to stand, then says ready once armed, without nagging", () => {
    const { tracker, speaker, advance } = setup();
    tracker.set({ status: "tracking" });
    speaker.said = [];
    advance(9000);
    tracker.set({ landmarksVisible: true, armed: false });
    tracker.set({ landmarksVisible: true, armed: false }); // within cooldown: silent
    expect(speaker.said).toEqual(["Stand up tall to begin."]);
    tracker.set({ armed: true });
    expect(speaker.said).toEqual(["Stand up tall to begin.", "Ready. Start squatting."]);
  });

  it("doesn't repeat 'stand up' right after the setup instructions", () => {
    const { tracker, speaker } = setup();
    tracker.set({ status: "tracking", landmarksVisible: true, armed: false });
    expect(speaker.said).toEqual([SETUP_INSTRUCTIONS]);
  });

  it("warns once when the user faces the camera", () => {
    const { tracker, speaker } = setup();
    tracker.set({ status: "tracking", landmarksVisible: true, armed: true });
    speaker.said = [];
    const flag: FormFlag = { code: "CAMERA_NOT_SIDE_ON", message: "x", source: "estimated" };
    tracker.set({ viewWarning: flag });
    tracker.set({ viewWarning: flag });
    expect(speaker.said).toEqual(["Turn side on to the camera."]);
  });

  it("speaks camera errors", () => {
    const { tracker, speaker } = setup();
    tracker.set({ status: "error", error: { code: "PERMISSION_DENIED", message: "Camera access was blocked." } });
    expect(speaker.said).toEqual(["Camera access was blocked."]);
  });

  it("announces the session summary", () => {
    const { coach, speaker } = setup();
    coach.announceSession({
      id: "s",
      exercise: "squat",
      startedAt: "",
      endedAt: "",
      reps: [],
      summary: null,
    });
    expect(speaker.said).toEqual(["Session ended. No reps counted."]);
  });

  it("stays silent when disabled, and after detach", () => {
    const { tracker, speaker, coach } = setup({ enabled: false });
    tracker.set({ status: "tracking" });
    tracker.rep(1);
    expect(speaker.said).toEqual([]);
    coach.setEnabled(true);
    coach.detach();
    tracker.rep(2);
    expect(speaker.said).toEqual([]);
  });

  it("is a no-op when speech isn't supported", () => {
    const tracker = new FakeTracker();
    const coach = new VoiceCoach(tracker, {}, null);
    coach.attach();
    expect(coach.supported).toBe(false);
    expect(() => tracker.set({ status: "tracking" })).not.toThrow();
  });
});
