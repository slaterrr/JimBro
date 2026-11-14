import type { ExerciseId } from "../../../../shared/types";
import { bicepCurl } from "./bicep_curl";
import { deadlift } from "./deadlift";
import { lunge } from "./lunge";
import { pushup } from "./pushup";
import { shoulderPress } from "./shoulder_press";
import { squat } from "./squat";
import type { ExerciseDefinition } from "./types";

export const EXERCISES: Readonly<Record<ExerciseId, ExerciseDefinition>> = Object.freeze({
  squat,
  deadlift,
  lunge,
  pushup,
  bicep_curl: bicepCurl,
  shoulder_press: shoulderPress,
});

/** Display order. */
export const EXERCISE_IDS: readonly ExerciseId[] = ["squat", "deadlift", "lunge", "pushup", "bicep_curl", "shoulder_press"];

export function getExercise(id: ExerciseId): ExerciseDefinition {
  return EXERCISES[id];
}

export { squat, deadlift, lunge, pushup, bicepCurl, shoulderPress };
export type * from "./types";
