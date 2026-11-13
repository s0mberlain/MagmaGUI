import { useId, useState } from "react";

export interface TrendDatum {
  label: string;
  at: string;
  value: number | null;
  live?: boolean;
}

const W = 320;
const H = 120;
const PAD = { l: 34, r: 10, t: 10, b: 20 };

const SHORT = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });
function shortDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : SHORT.format(d);
}

/** One-series line chart with a hover crosshair and tooltip. Percentages are 0..1. */
export default function TrendChart({
  data,
  unit,
  title,
}: {
  data: TrendDatum[];
  unit: "pct" | "count";
  title: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.map((d) => d.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return <p className="muted small chart-empty">No data yet</p>;

  let lo = unit === "pct" ? 0 : Math.min(...vals);
  let hi = unit === "pct" ? Math.max(0.25, Math.min(1, Math.ceil(Math.max(...vals) * 4) / 4)) : Math.max(...vals);
  if (unit === "count") {
    const span = Math.max(1, hi - lo);
    lo = Math.max(0, Math.floor(lo - span * 0.15));
    hi = Math.ceil(hi + span * 0.15);
  }
  const x = (i: number) => PAD.l + (data.length === 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (data.length - 1));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const fmt = (v: number | null) =>
    v === null ? "–" : unit === "pct" ? `${Math.round(v * 100)} %` : String(Math.round(v));

  const pts = data.map((d, i) => (d.value === null ? null : ([x(i), y(d.value)] as const)));
  let path = "";
  pts.forEach((p, i) => {
    if (!p) return;
    path += `${path && pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  });
  const ticks = [lo, (lo + hi) / 2, hi];
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          data.forEach((_, i) => {
            if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          });
          setHover(best);
        }}
      >
        <title id={id}>
          {title}: {data.map((d) => `${d.label} ${fmt(d.value)}`).join(", ")}
        </title>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        <text className="axis" x={PAD.l} y={H - 4} textAnchor="start">
          {shortDate(data[0].at)}
        </text>
        <text className="axis" x={W - PAD.r} y={H - 4} textAnchor="end">
          {data[data.length - 1].live ? "Now" : shortDate(data[data.length - 1].at)}
        </text>
        {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />}
        <path className="line" d={path} />
        {pts.map((p, i) =>
          p ? (
            <circle
              key={i}
              className={"dot" + (data[i].live ? " dot-live" : "")}
              cx={p[0]}
              cy={p[1]}
              r={hover === i || data[i].live ? 5 : 4}
            />
          ) : null,
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > data.length / 2 ? "-100%" : "0"})`,
          }}
        >
          <span className="small muted">{h.live ? "Now" : h.label}</span>
          <strong>{fmt(h.value)}</strong>
        </div>
      )}
    </div>
  );
}
