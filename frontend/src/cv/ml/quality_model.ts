/**
 * Movement-quality model: a standardised logistic regression over
 * repFeatures(), trained offline (ml/uiprmd/train.ts) and shipped as JSON.
 * Tiny on purpose: about 70 weights, microseconds per rep, no ML runtime.
 */

import { FEATURE_NAMES } from "./rep_features";

export interface QualityModelJson {
  name: string;
  /** What the positive class means, e.g. "resembles the dataset's incorrect squats". */
  positiveMeaning: string;
  featureNames: string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
  /** Probability above which a rep is flagged. Chosen on held-out subjects. */
  threshold: number;
  /** Held-out (leave-one-subject-out) results, for documentation and the UI. */
  evaluation: Record<string, number>;
  trainedOn: string;
  trainedAt: string;
}

export class QualityModel {
  constructor(readonly spec: QualityModelJson) {
    const n = spec.featureNames.length;
    if (spec.mean.length !== n || spec.std.length !== n || spec.weights.length !== n) {
      throw new Error(`Model ${spec.name}: feature, mean, std and weight lengths differ.`);
    }
    if (spec.featureNames.join() !== FEATURE_NAMES.join()) {
      throw new Error(`Model ${spec.name} was trained on different features than this build computes.`);
    }
  }

  /** Probability of the positive class (0–1). */
  predict(features: readonly number[]): number {
    const s = this.spec;
    let z = s.bias;
    for (let i = 0; i < s.weights.length; i++) {
      const sd = s.std[i]! > 1e-9 ? s.std[i]! : 1;
      z += s.weights[i]! * (((features[i] ?? s.mean[i]!) - s.mean[i]!) / sd);
    }
    return 1 / (1 + Math.exp(-z));
  }
}
