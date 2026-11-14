/** In-memory angle trace (no video) exportable for scripts/evaluate accuracy runs. */
export class TraceRecorder {
  private rows: string[] = [];
  constructor(private readonly max = 20_000) {}

  add(t: number, angle: number, confidence: number) {
    this.rows.push(`${Math.round(t)},${Math.round(angle * 100) / 100},${Math.round(confidence * 100) / 100}`);
    if (this.rows.length > this.max) this.rows.splice(0, this.rows.length - this.max);
  }

  get size() {
    return this.rows.length;
  }

  clear() {
    this.rows = [];
  }

  csv() {
    return `t_ms,angle,confidence\n${this.rows.map((r) => `${r}\n`).join("")}`;
  }
}

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function traceFilename(movement: string, trueReps: number, tags: Record<string, string>): string {
  const extra = Object.entries(tags)
    .map(([k, v]) => [clean(k), clean(v)])
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `_${k}-${v}`)
    .join("");
  return `${movement}_true${trueReps}${extra}.csv`;
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
