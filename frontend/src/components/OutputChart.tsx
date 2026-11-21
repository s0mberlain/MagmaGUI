import { locale, t } from "../i18n";
import { useState } from "react";

export interface MonthBar {
  period: string; // YYYY-MM
  alerts: number;
  false_positives: number;
  incidents: number;
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

export function monthLabel(period: string, long = false): string {
  const d = new Date(period + "-01T00:00:00");
  return (long ? MONTH_YEAR : MONTH).format(d);
}

/** Last `n` months as YYYY-MM, oldest first. */
export function lastMonths(n: number): string[] {
  const now = new Date();
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Stacked monthly bars: confirmed alerts (dark) and false positives (light). */
export default function OutputChart({ data, height = 140 }: { data: MonthBar[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.alerts));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="out-chart">
      <div className="out-axis" style={{ height }}>
        {ticks
          .slice()
          .reverse()
          .map((t) => (
            <span key={t}>{fmtCount(t)}</span>
          ))}
      </div>
      <div className="out-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <i key={t} className="out-grid" style={{ bottom: `${(t / top) * 100}%` }} />
        ))}
        {data.map((d, i) => {
          const real = d.alerts - d.false_positives;
          return (
            <div
              key={d.period}
              className={"out-col" + (hover === i ? " hover" : "")}
              onMouseEnter={() => setHover(i)}
              aria-label={t("{month}: {alerts} alerts, {fp} false positives", {
                month: monthLabel(d.period, true),
                alerts: d.alerts,
                fp: d.false_positives,
              })}
            >
              <div className="out-stack" style={{ height: `${(d.alerts / top) * 100}%` }}>
                <div className="fp" style={{ flexGrow: d.false_positives }} />
                <div className="tp" style={{ flexGrow: real }} />
              </div>
              <span className="out-x">{monthLabel(d.period)}</span>
            </div>
          );
        })}
        {h && hover !== null && (
          <div className="chart-tip out-tip" style={{ left: `${((hover + 0.5) / data.length) * 100}%` }} role="status">
            <strong>{monthLabel(h.period, true)}</strong>
            <span>
              {h.alerts} {t("alerts ·")} {h.incidents} {t("incidents")}
            </span>
            <span>
              {h.false_positives} {t("false positives")}
              {h.alerts ? ` (${Math.round((h.false_positives / h.alerts) * 100)} %)` : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function OutputLegend() {
  return (
    <div className="legend">
      <span>
        <i className="out-tp" />
        {t("Alerts that were not false positives")}
      </span>
      <span>
        <i className="out-fp" />
        {t("False positives")}
      </span>
    </div>
  );
}

function niceStep(max: number): number {
  const raw = max / 2;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

export function fmtCount(v: number): string {
  return v >= 10000 ? `${Math.round(v / 1000)}k` : v.toLocaleString(locale());
}
