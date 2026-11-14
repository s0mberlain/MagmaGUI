import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type DriverCoverageReport, type GapRow, type Gaps, type L1 } from "../api";
import { CoverageCell } from "../components/Drivers";
import { ErrorNote, StatusPill, useLoad } from "../components/ui";
import { num, pct } from "../lib/format";
import { t } from "../i18n";

const SOURCE_LABEL: Record<string, string> = { rule: t("own value"), l2: t("from L2"), risk: t("from risk level") };

/** Implementation bar with a marker at the target. */
function TargetBar({ impl, target }: { impl: number | null; target: number | null }) {
  const below = target !== null && (impl ?? 0) < target;
  return (
    <div className="target-bar" title={t("Implementation {a} · target {b}", { a: pct(impl), b: pct(target) })}>
      <div className={below ? "fill below" : "fill"} style={{ width: `${Math.round((impl ?? 0) * 100)}%` }} />
      {target !== null && <i style={{ left: `${Math.round(target * 100)}%` }} />}
    </div>
  );
}

function RiskBadge({ r }: { r: GapRow }) {
  if (r.risk === null) return <span className="muted">–</span>;
  return (
    <span
      className={`risk risk-${r.risk}`}
      title={t("Risk {r} ({source})", { r: r.risk, source: SOURCE_LABEL[r.risk_source ?? ""] ?? "" })}
    >
      {r.risk}
    </span>
  );
}

export default function Priorities() {
  const cat = useLoad<L1[]>(() => api.l1s());
  const [l1, setL1] = useState("");
  const [minRisk, setMinRisk] = useState(1);
  const [below, setBelow] = useState(true);
  const gaps = useLoad<Gaps>(() => api.gaps({ l1, min_risk: minRisk, below_target: below }), [l1, minRisk, below]);
  const [limit, setLimit] = useState(50);
  const cov = useLoad<DriverCoverageReport>(() => api.driverCoverage());
  const [allDrivers, setAllDrivers] = useState(false);
  const g = gaps.data;
  const s = g?.summary;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Priorities")}</h1>
          <div className="subtitle">
            {t(
              "Gap to target per rule, highest priority first. Priority = potential × risk level ÷ 5, raised by 10 % per driver linked to the L2 use case (at most 50 %).",
            )}
          </div>
        </div>
      </header>
      <ErrorNote error={gaps.error ?? cat.error ?? cov.error} />

      <section className="kpi-grid" aria-label={t("Summary")}>
        <div className="card kpi">
          <span className="kpi-label">{t("Below target")}</span>
          <span className="kpi-value">{s ? s.below_target : "–"}</span>
          <span className="kpi-sub">{s ? t("of {n} active rules with a target", { n: s.with_target }) : "…"}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t("Average gap")}</span>
          <span className="kpi-value">{s ? pct(s.avg_gap) : "–"}</span>
          <span className="kpi-sub">{t("Implementation missing to reach the target")}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t("No risk level")}</span>
          <span className="kpi-value">{s ? s.no_risk : "–"}</span>
          <span className="kpi-sub">{t("Set a risk level on the L2 use case or the rule")}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t("Driver gaps")}</span>
          <span className="kpi-value">{g ? g.driver_gaps.length : "–"}</span>
          <span className="kpi-sub">
            {g
              ? t("{a} without a use case, {b} with low coverage", {
                  a: g.driver_gaps.filter((d) => d.gap).length,
                  b: g.driver_gaps.filter((d) => !d.gap).length,
                })
              : "…"}
          </span>
        </div>
        <div className="card kpi risk-kpi">
          <span className="kpi-label">{t("Below target per risk level")}</span>
          <div className="risk-rows">
            {s &&
              [5, 4, 3, 2, 1].map((lvl) => {
                const b = s.by_risk[lvl] ?? { rules: 0, below_target: 0 };
                return (
                  <div key={lvl} className="risk-row">
                    <span className={`risk risk-${lvl}`}>{lvl}</span>
                    <div className="bar">
                      <div
                        className="bar-accent"
                        style={{ width: `${b.rules ? (b.below_target / b.rules) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="small muted num-cell">
                      {b.below_target}/{b.rules}
                    </span>
                    <span className="small muted">
                      {t("target")} {pct(s.risk_targets[lvl])}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      </section>

      <section className="card table-card" aria-labelledby="dch">
        <div className="table-title filters">
          <h2 id="dch">{t("Driver coverage")}</h2>
          <label className="check small">
            <input type="checkbox" checked={!allDrivers} onChange={(e) => setAllDrivers(!e.target.checked)} />
            {t("Only gaps and low coverage")}
          </label>
          <span className="grow" />
          <span className="small muted">
            {g && t("Low coverage: below {p}", { p: pct(g.driver_low_threshold) })}
          </span>
        </div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Driver")}</th>
                <th>{t("Type")}</th>
                <th className="num">L2</th>
                <th className="num">L3</th>
                <th style={{ width: "30%" }}>{t("Coverage")}</th>
              </tr>
            </thead>
            <tbody>
              {(allDrivers && cov.data
                ? [...cov.data.business, ...cov.data.compliance].sort(
                    (a, b) => Number(b.gap) - Number(a.gap) || (a.coverage ?? 0) - (b.coverage ?? 0),
                  )
                : (g?.driver_gaps ?? [])
              ).map((d) => (
                <tr key={`${d.source ?? "bd"}-${d.id}`}>
                  <td>
                    <Link
                      className="rule-link"
                      to={d.source ? `/usecases?cd=${d.id}&view=table` : `/usecases?bd=${encodeURIComponent(d.code)}&view=table`}
                    >
                      <span className="mono small muted">{d.source ? `${d.source} ${d.code}` : d.code}</span>
                      <span>{d.name || d.code}</span>
                    </Link>
                  </td>
                  <td className="small">{d.source ? t("Compliance") : t("Business")}</td>
                  <td className="num">{d.l2_count}</td>
                  <td className="num">{d.l3_count}</td>
                  <td>
                    <CoverageCell d={d} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {g && !allDrivers && !g.driver_gaps.length && (
          <p className="muted empty-flat">{t("Every driver is linked and above the threshold.")}</p>
        )}
      </section>

      <section className="card table-card" aria-labelledby="gh">
        <div className="table-title filters">
          <h2 id="gh">{t("Rules")}</h2>
          <select
            className="input input-sm"
            aria-label={t("L1 use case")}
            value={l1}
            onChange={(e) => setL1(e.target.value)}
          >
            <option value="">{t("All L1 use cases")}</option>
            {cat.data?.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
          <select
            className="input input-sm"
            aria-label={t("Minimum risk level")}
            value={minRisk}
            onChange={(e) => setMinRisk(Number(e.target.value))}
          >
            <option value={1}>{t("Any risk")}</option>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {t("Risk")} {n}
                {n < 5 ? t(" or higher") : ""}
              </option>
            ))}
          </select>
          <label className="check small">
            <input type="checkbox" checked={below} onChange={(e) => setBelow(e.target.checked)} />
            {t("Only below target")}
          </label>
          <span className="grow" />
          <span className="small muted">{g ? t("{n} rules", { n: g.rows.length }) : ""}</span>
        </div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th className="num" style={{ width: 48 }}>
                  #
                </th>
                <th>{t("Rule")}</th>
                <th>{t("Status")}</th>
                <th className="num">{t("Risk")}</th>
                <th style={{ width: "22%" }}>{t("Implementation vs target")}</th>
                <th className="num">{t("Gap")}</th>
                <th className="num">{t("Potential")}</th>
                <th>{t("Drivers")}</th>
                <th className="num">{t("Priority")}</th>
              </tr>
            </thead>
            <tbody>
              {g?.rows.slice(0, limit).map((r, idx) => (
                <tr key={r.code}>
                  <td className="num muted">{idx + 1}</td>
                  <td>
                    <Link className="rule-link" to={`/usecases/l3/${r.code}`}>
                      <span className="mono small muted">{r.code}</span>
                      <span>{r.name}</span>
                    </Link>
                  </td>
                  <td>
                    <StatusPill status={r.lifecycle_status} />
                  </td>
                  <td className="num">
                    <RiskBadge r={r} />
                  </td>
                  <td>
                    <TargetBar impl={r.implementation} target={r.target} />
                    <span className="small muted">
                      {pct(r.implementation)} {t("of")} {pct(r.target)}
                      {r.target_source && ` · ${SOURCE_LABEL[r.target_source]}`}
                    </span>
                  </td>
                  <td className="num">{r.gap ? pct(r.gap) : <span className="text-ok">reached</span>}</td>
                  <td className="num">{num(r.potential)}</td>
                  <td>
                    {r.business_drivers.length + r.compliance_drivers.length > 0 ? (
                      <span
                        className="chip chip-info"
                        title={[...r.business_drivers, ...r.compliance_drivers].join(", ")}
                      >
                        {t("{n} linked · ×{f}", {
                          n: r.business_drivers.length + r.compliance_drivers.length,
                          f: r.driver_boost.toFixed(1),
                        })}
                      </span>
                    ) : (
                      <span className="muted small">{t("none")}</span>
                    )}
                  </td>
                  <td className="num strong">{num(r.priority)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {g && !g.rows.length && <p className="muted empty-flat">{t("No rule matches the filters.")}</p>}
        {g && g.rows.length > limit && (
          <div className="row-actions start" style={{ padding: "12px 16px" }}>
            <button type="button" className="btn btn-sm" onClick={() => setLimit((n) => n + 100)}>
              {t("Show more (")}
              {g.rows.length - limit} {t("left)")}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
