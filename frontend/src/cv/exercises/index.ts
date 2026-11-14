import type { ExerciseId } from "../../../../shared/types";
import { bicepCurl } from "./bicep_curl";
import { pushup } from "./pushup";
import { shoulderPress } from "./shoulder_press";
import { squat } from "./squat";
import type { ExerciseDefinition } from "./types";

export const EXERCISES: Readonly<Record<ExerciseId, ExerciseDefinition>> = Object.freeze({
  squat,
  pushup,
  bicep_curl: bicepCurl,
  shoulder_press: shoulderPress,
});

/** Display order. */
export const EXERCISE_IDS: readonly ExerciseId[] = ["squat", "pushup", "bicep_curl", "shoulder_press"];

export function getExercise(id: ExerciseId): ExerciseDefinition {
  return EXERCISES[id];
}

export { squat, pushup, bicepCurl, shoulderPress };
export type * from "./types";
