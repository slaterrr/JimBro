/** Small, dependency-free logistic regression and metrics, shared by the training scripts. */

export interface Sample {
  x: number[];
  y: 0 | 1;
  /** Group for subject-independent validation. */
  subject: string;
}

export interface Fitted {
  mean: number[];
  std: number[];
  w: number[];
  b: number;
}

/** Standardised, class-balanced, L2-regularised logistic regression (batch gradient descent). */
export function fitLogistic(samples: readonly Sample[], l2: number, iters = 3000, lr = 0.2): Fitted {
  const d = samples[0]!.x.length;
  const mean = Array.from({ length: d }, (_, j) => samples.reduce((s, p) => s + p.x[j]!, 0) / samples.length);
  const std = Array.from(
    { length: d },
    (_, j) => Math.sqrt(samples.reduce((s, p) => s + (p.x[j]! - mean[j]!) ** 2, 0) / samples.length) || 1,
  );
  const X = samples.map((p) => p.x.map((v, j) => (v - mean[j]!) / std[j]!));
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const pos = samples.filter((s) => s.y === 1).length;
  const wPos = pos ? samples.length / (2 * pos) : 1;
  const wNeg = samples.length - pos ? samples.length / (2 * (samples.length - pos)) : 1;
  for (let it = 0; it < iters; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]!;
      let z = b;
      for (let j = 0; j < d; j++) z += w[j]! * xi[j]!;
      const p = 1 / (1 + Math.exp(-z));
      const yi = samples[i]!.y;
      const err = (p - yi) * (yi === 1 ? wPos : wNeg);
      for (let j = 0; j < d; j++) gw[j]! += err * xi[j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] = w[j]! - lr * (gw[j]! / X.length + l2 * w[j]!);
    b -= lr * (gb / X.length);
  }
  return { mean, std, w, b };
}

export function predict(m: Fitted, x: readonly number[]): number {
  let z = m.b;
  for (let j = 0; j < x.length; j++) z += m.w[j]! * ((x[j]! - m.mean[j]!) / m.std[j]!);
  return 1 / (1 + Math.exp(-z));
}

export function auc(scores: readonly { p: number; y: number }[]): number {
  const pos = scores.filter((s) => s.y === 1);
  const neg = scores.filter((s) => s.y === 0);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const a of pos) for (const n of neg) wins += a.p > n.p ? 1 : a.p === n.p ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export function confusion(scores: readonly { p: number; y: number }[], thr: number) {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const s of scores) {
    const pred = s.p >= thr;
    if (pred && s.y === 1) tp++;
    else if (pred) fp++;
    else if (s.y === 1) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, tn, fn, precision, recall, f1, accuracy: scores.length ? (tp + tn) / scores.length : 0 };
}
