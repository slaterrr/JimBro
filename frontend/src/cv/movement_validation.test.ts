/**
 * Negative exercise tests: the selected exercise vs. what was actually done.
 *
 * Bodies are synthetic 3D skeletons (test_bodies.ts) with three builds,
 * filmed from several camera angles with landmark noise, run through the real
 * ExerciseTracker (the same engine as live and video modes). Passing these
 * shows the logic behaves as designed on synthetic movement. It is NOT
 * evidence of accuracy on real people: that needs recorded, annotated reps
 * (validation lab).
 */
import { describe, expect, it } from "vitest";
import { ExerciseTracker } from "./exercise_tracker";
import { validateLunge, validateSquat, type MovementFeatures } from "./movement_validation";
import {
  AVERAGE,
  LEFT_LEG,
  LONG_LEGS,
  SHORT_LEGS,
  bendMove,
  lungeMove,
  recordMovements,
  seeded,
  squatMove,
  stand,
  walkMove,
  type Build,
  type Segment,
} from "./test_bodies";
import { toLandmarks, toWorld, type Recording } from "./validation/format";

const NOISE = { sd: 0.005, seed: 1 }; // ≈ typical post-filter MediaPipe jitter, as a fraction of frame height
const pad: Segment = { move: stand, ms: 800 };
const squat = (depth = 1.05): Segment => ({ move: squatMove(depth), ms: 2400 });
const lunge = (lead: "left" | "right", dir: "forward" | "reverse" = "forward", depth = 1.2): Segment => ({
  move: lungeMove(lead, dir, depth),
  ms: 3200,
});

function run(rec: Recording, exercise: "squat" | "lunge", validateMovement = true) {
  const tracker = new ExerciseTracker({ videoWidth: 1600, videoHeight: 900 } as HTMLVideoElement, null, { exercise, validateMovement });
  const rejected: string[] = [];
  tracker.onRejected((f) => rejected.push(f.code));
  tracker.beginReplay(16 / 9);
  for (const f of rec.frames) tracker.ingest(toLandmarks(f.lm), toWorld(f.world), f.t);
  const session = tracker.endReplay();
  return { reps: session.reps, count: session.reps.length, rejected, state: tracker.getState() };
}

const SIDE_VIEWS = [90, -90, 70, 45];
const BUILDS: Array<[string, Build]> = [
  ["average", AVERAGE],
  ["short legs", SHORT_LEGS],
  ["long legs", LONG_LEGS],
];

describe("root cause (regression guard)", () => {
  it("without validation, deep lunges are counted as squats: the reported bug", () => {
    const rec = recordMovements([pad, lunge("left"), pad, lunge("right", "reverse"), pad], 90, AVERAGE, NOISE);
    expect(run(rec, "squat", false).count).toBe(2);
    expect(run(rec, "squat").count).toBe(0);
  });
});

describe("squat selected", () => {
  for (const [name, build] of BUILDS) {
    for (const yaw of [...SIDE_VIEWS, 0]) {
      it(`squat performed → counted (${name}, camera ${yaw}°)`, () => {
        const r = run(recordMovements([pad, squat(), pad, squat(1.15), pad], yaw, build, NOISE), "squat");
        expect(r.count).toBe(2);
        expect(r.rejected).toEqual([]);
      });
    }
    for (const yaw of SIDE_VIEWS) {
      it(`lunge performed → not counted, "doesn't match" (${name}, camera ${yaw}°)`, () => {
        const r = run(recordMovements([pad, lunge("left"), pad, lunge("right", "reverse"), pad], yaw, build, NOISE), "squat");
        expect(r.count).toBe(0);
        expect(r.rejected.filter((c) => c === "WRONG_MOVEMENT").length).toBeGreaterThanOrEqual(1);
        // No squat-specific form feedback for a rep that wasn't a squat.
        expect(r.state.lastRep).toBeNull();
      });
    }
  }

  it("walking → not counted", () => {
    for (const yaw of [90, 45, 0]) expect(run(recordMovements([pad, { move: walkMove, ms: 4000 }, pad], yaw, AVERAGE, NOISE), "squat").count).toBe(0);
  });

  it("bending forward → not counted", () => {
    for (const yaw of [90, 45, 0]) expect(run(recordMovements([pad, { move: bendMove, ms: 2400 }, pad], yaw, AVERAGE, NOISE), "squat").count).toBe(0);
  });

  it("alternating lunges → not counted", () => {
    const rec = recordMovements([pad, lunge("left"), lunge("right"), lunge("left"), lunge("right"), pad], 90, AVERAGE, NOISE);
    const r = run(rec, "squat");
    expect(r.count).toBe(0);
    expect(r.rejected).toContain("WRONG_MOVEMENT");
  });

  it("partial squat → not counted, by the documented depth rule (knee ≤ 85° and hips down ≥ 40%)", () => {
    const r = run(recordMovements([pad, squat(0.55), pad], 90, AVERAGE, NOISE), "squat");
    expect(r.count).toBe(0);
    expect(r.rejected).toEqual(["SHALLOW_DEPTH"]);
  });

  it("one leg hidden through the rep → not counted, no invented rep", () => {
    const rec = recordMovements([pad, { move: squatMove(1.1), ms: 2400, hidden: LEFT_LEG }, pad], 90, AVERAGE, NOISE);
    const r = run(rec, "squat");
    expect(r.count).toBe(0);
    expect(r.rejected).toContain("UNCONFIRMED_MOVEMENT");
  });

  it("squat → lunge → squat: counts only the two squats, numbered 1 and 2", () => {
    for (const yaw of [90, 45]) {
      const r = run(recordMovements([pad, squat(), pad, lunge("left"), pad, squat(), pad], yaw, AVERAGE, NOISE), "squat");
      expect(r.count).toBe(2);
      expect(r.reps.map((x) => x.repNumber)).toEqual([1, 2]);
      expect(r.rejected).toEqual(["WRONG_MOVEMENT"]);
    }
  });
});

describe("lunge selected", () => {
  for (const [name, build] of BUILDS) {
    for (const yaw of SIDE_VIEWS) {
      it(`lunge performed → counted (${name}, camera ${yaw}°)`, () => {
        const r = run(recordMovements([pad, lunge("left"), pad, lunge("right", "reverse"), pad], yaw, build, NOISE), "lunge");
        expect(r.count).toBe(2);
      });
      it(`squat performed → not counted (${name}, camera ${yaw}°)`, () => {
        const r = run(recordMovements([pad, squat(), pad, squat(1.15), pad], yaw, build, NOISE), "lunge");
        expect(r.count).toBe(0);
        expect(r.rejected).toContain("WRONG_MOVEMENT");
      });
    }
  }

  it("filmed front-on → no count, asks to turn side on (front/back legs can't be told apart)", () => {
    const r = run(recordMovements([pad, lunge("left"), pad], 0, AVERAGE, NOISE), "lunge");
    expect(r.count).toBe(0);
  });
});

describe("natural variation (synthetic)", () => {
  /** Random depth, stance stagger, torso lean, tempo, build and camera angle. */
  it("accepts ≥ 95% of varied squats and no lunges, at typical noise", () => {
    const r = seeded(7);
    const builds = [AVERAGE, SHORT_LEGS, LONG_LEGS];
    const yaws = [90, 70, 45, -90, 0];
    let squatsCounted = 0;
    let lungesCounted = 0;
    const N = 30;
    for (let i = 0; i < N; i++) {
      const b = builds[i % 3]!;
      const yaw = yaws[i % 5]!;
      const noise = { sd: 0.003 + r.next() * 0.006, seed: i };
      const sq = recordMovements(
        [pad, { move: squatMove(1 + r.next() * 0.25, r.next() * 0.25, 0.7 + r.next() * 0.6), ms: 2000 + r.next() * 1500 }, pad],
        yaw,
        b,
        noise,
      );
      squatsCounted += run(sq, "squat").count;
      const lu = recordMovements(
        [pad, { move: lungeMove(i % 2 ? "left" : "right", i % 4 < 2 ? "forward" : "reverse", 1 + r.next() * 0.4), ms: 2800 + r.next() * 1200 }, pad],
        yaw,
        b,
        { ...noise, seed: 100 + i },
      );
      lungesCounted += run(lu, "squat").count;
    }
    expect(squatsCounted / N).toBeGreaterThanOrEqual(0.95);
    expect(lungesCounted).toBe(0);
  });
});

describe("validator rules", () => {
  const f = (over: Partial<MovementFeatures>): MovementFeatures => ({
    split: 0.05,
    hipAsymmetry: 5,
    footTravel: 0.02,
    source: "3d",
    frames: 60,
    bothLegsFrames: 60,
    ...over,
  });

  it("a single lunge-like cue (e.g. a staggered stance) doesn't reject a squat", () => {
    expect(validateSquat(f({ split: 0.5 })).verdict).toBe("match");
    expect(validateSquat(f({ hipAsymmetry: 40 })).verdict).toBe("match");
  });

  it("two cues together, or a big step, reject a squat", () => {
    expect(validateSquat(f({ split: 0.6, hipAsymmetry: 50 }))).toMatchObject({ verdict: "mismatch", looksLike: "lunge" });
    expect(validateSquat(f({ footTravel: 0.9 }))).toMatchObject({ verdict: "mismatch", looksLike: "stepping" });
  });

  it("is uncertain without enough two-leg evidence", () => {
    expect(validateSquat(f({ bothLegsFrames: 10 })).verdict).toBe("uncertain");
    expect(validateLunge(f({ split: null, hipAsymmetry: null })).verdict).toBe("uncertain");
  });

  it("lunge: split or asymmetric hips match; level and symmetric = squat; in between = uncertain", () => {
    expect(validateLunge(f({ split: 0.8 })).verdict).toBe("match");
    expect(validateLunge(f({ hipAsymmetry: 60 })).verdict).toBe("match");
    expect(validateLunge(f({}))).toMatchObject({ verdict: "mismatch", looksLike: "squat" });
    expect(validateLunge(f({ split: 0.35, hipAsymmetry: 25 })).verdict).toBe("uncertain");
  });
});
