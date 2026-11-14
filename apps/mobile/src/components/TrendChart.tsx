import { useState } from "react";

export interface Point { label: string; value: number }

const W = 320;
const H = 140;
const PAD = { l: 36, r: 12, t: 12, b: 22 };
const MARK = "#0ea5c4"; // validated against the dark surface (lightness band + 3:1 contrast)

/** Single-series line chart: 2px line, 8px markers, hover tooltip, table fallback. */
export function TrendChart({ points, unit, title }: { points: Point[]; unit: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(1, hi * 0.1);
  const min = lo - span * 0.15;
  const max = hi + span * 0.15;
  const x = (i: number) => PAD.l + (points.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v: number) => PAD.t + ((max - v) / (max - min)) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const step = (W - PAD.l - PAD.r) / Math.max(1, points.length - 1);

  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="row" style={{ justifyContent: "space-between" }}>
        <span className="small">{title} ({unit})</span>
        <button className="small" style={{ minHeight: 32, padding: "4px 10px" }} onClick={() => setTable((t) => !t)}>
          {table ? "Chart" : "Table"}
        </button>
      </figcaption>
      {table ? (
        <table>
          <thead><tr><th>Session</th><th>{title} ({unit})</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={i}><td>{p.label}</td><td>{p.value}</td></tr>)}</tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title} over ${points.length} sessions`}>
          {[min + (max - min) * 0.25, min + (max - min) * 0.75].map((g) => (
            <g key={g}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(g) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">{Math.round(g * 10) / 10}</text>
            </g>
          ))}
          <path d={path} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} fill={MARK} stroke="var(--panel)" strokeWidth={2} />
          ))}
          <text x={PAD.l} y={H - 6} fontSize={10} fill="var(--muted)">{points[0].label}</text>
          <text x={W - PAD.r} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor="end">{points.at(-1)!.label}</text>
          {points.map((_, i) => (
            <rect key={i} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent"
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeDasharray="2 3" />
              <rect x={Math.min(x(hover) + 6, W - 110)} y={PAD.t} width={104} height={34} rx={6} fill="var(--bg)" stroke="var(--line)" />
              <text x={Math.min(x(hover) + 12, W - 104)} y={PAD.t + 14} fontSize={10} fill="var(--muted)">{points[hover].label}</text>
              <text x={Math.min(x(hover) + 12, W - 104)} y={PAD.t + 28} fontSize={12} fill="var(--text)">{points[hover].value} {unit}</text>
            </g>
          )}
        </svg>
      )}
    </figure>
  );
}
