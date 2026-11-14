import { Link } from "react-router-dom";
import { api, type DriverCoverageReport, type DueRule, type Kpis, type RecentCommit, type Scores } from "../api";
import { useAuth } from "../auth";
import { CoverageCell } from "../components/Drivers";
import { ErrorNote, GapBadge, MetricBars, MetricLegend, useLoad } from "../components/ui";
import { fmtDate, num, pct } from "../lib/format";
import { t } from "../i18n";

const UP = t("Higher is better");
const DOWN = t("Lower is better");

function kpiTiles(k: Kpis): { label: string; value: number | null; sub: string; invert?: boolean; good: string }[] {
  const tiles = [
    { label: t("SOC detection score"), value: k.soc_detection_score, sub: t("Average weight of applicable L1") },
    {
      label: t("Catalogue coverage"),
      value: k.catalogue_coverage,
      sub: t("Same average, L2 without scored rules count as 0"),
    },
    { label: t("Growth potential"), value: k.growth_potential, sub: t("Average effectiveness − weight") },
    { label: t("Detection gap"), value: k.detection_gap, sub: t("1 − detection score"), invert: true },
    {
      label: t("Framework completeness"),
      value: k.framework_completeness,
      sub: t("{a} of {b} L2 have scored rules", { a: k.l2_with_scored_rules, b: k.applicable_l2 }),
    },
    {
      label: t("Assessment coverage"),
      value: k.assessment_coverage,
      sub: t("{a} of {b} active rules assessed", { a: k.assessed_rules, b: k.active_rules }),
    },
    {
      label: t("Verification health"),
      value: k.verification_health,
      sub: t("{a} of {b} rules overdue", { a: k.verification_overdue, b: k.operational_rules }),
    },
  ];
  // growth potential is what is still to gain: it shrinks as the detection score grows
  const lower = new Set([t("Detection gap"), t("Growth potential")]);
  return tiles.map((x) => ({ ...x, good: lower.has(x.label) ? DOWN : UP }));
}

export function DueBadge({ d }: { d: Pick<DueRule, "due" | "overdue" | "days_left"> }) {
  if (!d.due) return <span className="badge-gap">{t("Never verified")}</span>;
  if (d.overdue) return <span className="badge-gap">{t("{n} days overdue", { n: -(d.days_left ?? 0) })}</span>;
  return <span className="pill pill-ok">{t("due in {n} days", { n: d.days_left })}</span>;
}

export default function Dashboard() {
  const { can } = useAuth();
  const scores = useLoad<Scores>(() => api.scores());
  const due = useLoad<DueRule[]>(() => api.due(30));
  const commits = useLoad<RecentCommit[]>(() => api.recentCommits(5));
  const drivers = useLoad<DriverCoverageReport>(() => api.driverCoverage());
  const s = scores.data;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Dashboard")}</h1>
          <div className="subtitle">
            {t("Workspace: Default SOC")}
            {s &&
              ` · ${s.l1.length} L1 · ${s.l2.length} L2 · ${s.l1.reduce((a, x) => a + x.rules, 0)} ${t("L3 rules")}`}
          </div>
        </div>
        <div className="row-actions">
          <a className="btn" href="/api/report.pdf" download>
            {t("Download PDF report")}
          </a>
          {can("admin", "analyst") && (
            <Link className="btn btn-primary" to="/usecases">
              {t("Edit use cases")}
            </Link>
          )}
        </div>
      </header>

      <ErrorNote error={scores.error} />

      <section className="kpi-grid" aria-label={t("Key figures")}>
        {(s ? kpiTiles(s.kpis) : kpiTiles({} as Kpis)).map((k) => (
          <div className="card kpi" key={k.label}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">{s ? pct(k.value) : "–"}</span>
            <div className="bar">
              <div style={{ width: `${Math.round((k.value ?? 0) * 100)}%` }} className={k.invert ? "bar-muted" : ""} />
            </div>
            <span className="kpi-sub">{s ? k.sub : "…"}</span>
            <span className="kpi-good">
              <span aria-hidden="true">{k.good === UP ? "↑" : "↓"}</span> {k.good}
            </span>
          </div>
        ))}
      </section>

      <div className="split">
        <section className="card split-main" aria-labelledby="l1h">
          <div className="section-head">
            <h2 id="l1h">{t("Detection per L1 use case")}</h2>
            <MetricLegend />
          </div>
          <div className="scroll-x">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>{t("L1 use case")}</th>
                  <th className="num">L2</th>
                  <th className="num">L3</th>
                  <th style={{ width: "34%" }}>{t("Eff / Impl / Cov")}</th>
                  <th className="num">{t("Weight")}</th>
                  <th className="num">{t("Potential")}</th>
                </tr>
              </thead>
              <tbody>
                {s?.l1.map((r) => (
                  <tr key={r.code} className={r.applicable ? "" : "row-muted"}>
                    <td>
                      <Link className="code-link" to={`/usecases?l1=${r.code}`}>
                        <span className="code-tag">{r.code}</span>
                        <span>{r.name}</span>
                      </Link>
                    </td>
                    <td className="num">
                      {r.scored_l2}/{r.l2_count}
                    </td>
                    <td className="num">{r.rules}</td>
                    <td>
                      {!r.applicable ? (
                        <span className="muted">{t("Not applicable")}</span>
                      ) : r.weight === null ? (
                        <GapBadge>
                          {t("Detection gap ·")} {r.rules ? t("no scored rules") : t("no rules yet")}
                        </GapBadge>
                      ) : (
                        <MetricBars e={r.effectiveness} i={r.implementation} c={r.coverage} />
                      )}
                    </td>
                    <td className="num strong">{num(r.weight)}</td>
                    <td className="num">{num(r.potential)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {t(
              "L2 column: use cases with scored rules / all. Only operational and maintenance rules with all three metrics count.",
            )}
          </p>
        </section>

        <div className="split-side stack-lg">
          <section className="card stack-sm" aria-labelledby="vh">
            <div className="section-head">
              <h2 id="vh">{t("Verification due")}</h2>
              <Link to="/verification" className="small">
                {t("All")} {due.data?.length ?? ""}
              </Link>
            </div>
            <ErrorNote error={due.error} />
            {due.data && !due.data.length && <p className="muted">{t("Nothing is due in the next 30 days.")}</p>}
            <ul className="link-list">
              {due.data?.slice(0, 7).map((d) => (
                <li key={d.code}>
                  <Link to={`/usecases/l3/${d.code}`}>
                    <span className="stack">
                      <span className="mono small muted">{d.code}</span>
                      <span className="strong-500">{d.name}</span>
                      {d.last_verified_at && (
                        <span className="small muted">
                          {t("Last verified")} {fmtDate(d.last_verified_at)}
                        </span>
                      )}
                    </span>
                    <DueBadge d={d} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="card stack-sm" aria-labelledby="ch">
            <h2 id="ch">{t("Recent config commits")}</h2>
            {commits.data && !commits.data.length && <p className="muted small">{t("No configurations yet.")}</p>}
            <ul className="link-list">
              {commits.data?.map((c) => (
                <li key={c.sha}>
                  <Link to={c.level === "l3" ? `/usecases/l3/${c.code}` : `/usecases?l2=${c.code}`}>
                    <span className="mono small accent" style={{ paddingTop: 1 }}>
                      {c.short}
                    </span>
                    <span className="stack grow">
                      <span className="strong-500">{c.message}</span>
                      <span className="small muted">
                        {c.code} r{c.rev} · {c.author} · {fmtDate(c.created_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <DriverCoverageCards data={drivers.data} error={drivers.error} />
    </>
  );
}

function DriverCoverageCards({ data, error }: { data: DriverCoverageReport | null; error: string | null }) {
  return (
    <div className="two-col even">
      <section className="card table-card" aria-labelledby="bdc">
        <div className="table-title section-head">
          <h2 id="bdc">{t("Coverage per business driver")}</h2>
          <Link to="/drivers" className="small">
            {t("Drivers")}
          </Link>
        </div>
        <ErrorNote error={error} />
        <div className="scroll-x">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>{t("Business driver")}</th>
              <th className="num">L2</th>
              <th style={{ width: "38%" }}>{t("Coverage")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.business.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link className="code-link" to={`/usecases?bd=${encodeURIComponent(d.code)}&view=table`}>
                    <span className="code-tag">{d.code}</span>
                    <span>{d.name}</span>
                  </Link>
                </td>
                <td className="num">{d.l2_count}</td>
                <td>
                  <CoverageCell d={d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
      <section className="card table-card" aria-labelledby="csc">
        <div className="table-title section-head">
          <h2 id="csc">{t("Coverage per compliance source")}</h2>
        </div>
        <div className="scroll-x">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>{t("Compliance source")}</th>
              <th className="num">{t("Linked")}</th>
              <th className="num">L2</th>
              <th style={{ width: "38%" }}>{t("Coverage")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.sources.map((x) => (
              <tr key={x.id}>
                <td>
                  <Link to={`/usecases?src=${x.id}&view=table`}>{x.name}</Link>
                  {x.gap_drivers > 0 && (
                    <div className="small muted">
                      {t("Requirements without a use case: {n}", { n: x.gap_drivers })}
                    </div>
                  )}
                </td>
                <td className="num">
                  {x.linked_drivers}/{x.drivers}
                </td>
                <td className="num">{x.l2_count}</td>
                <td>
                  <CoverageCell
                    d={{ coverage: x.coverage, gap: x.l2_count === 0, low: x.coverage !== null && x.coverage < data.low_threshold }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {data && (
          <p className="muted small" style={{ padding: "0 16px 12px" }}>
            {t("Coverage = average weight of the linked L2 use cases; L2 without scored rules count as 0. Below {p} is low.", {
              p: pct(data.low_threshold),
            })}
          </p>
        )}
      </section>
    </div>
  );
}
