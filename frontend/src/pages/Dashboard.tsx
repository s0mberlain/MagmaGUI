import { Link } from "react-router-dom";
import { api, type DueRule, type Kpis, type RecentCommit, type Scores } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, GapBadge, MetricBars, MetricLegend, useLoad } from "../components/ui";
import { fmtDate, num, pct } from "../lib/format";

function kpiTiles(k: Kpis) {
  return [
    { label: "SOC detection score", value: k.soc_detection_score, sub: "Average weight of applicable L1" },
    { label: "Growth potential", value: k.growth_potential, sub: "Average effectiveness − weight" },
    { label: "Detection gap", value: k.detection_gap, sub: "1 − detection score", invert: true },
    {
      label: "Framework completeness",
      value: k.framework_completeness,
      sub: `${k.l2_with_scored_rules} of ${k.applicable_l2} L2 have scored rules`,
    },
    {
      label: "Assessment coverage",
      value: k.assessment_coverage,
      sub: `${k.assessed_rules} of ${k.active_rules} active rules assessed`,
    },
    {
      label: "Verification health",
      value: k.verification_health,
      sub: `${k.verification_overdue} of ${k.operational_rules} rules overdue`,
    },
  ];
}

export function DueBadge({ d }: { d: Pick<DueRule, "due" | "overdue" | "days_left"> }) {
  if (!d.due) return <span className="badge-gap">Never verified</span>;
  if (d.overdue) return <span className="badge-gap">{-(d.days_left ?? 0)} days overdue</span>;
  return <span className="pill pill-ok">due in {d.days_left} days</span>;
}

export default function Dashboard() {
  const { can } = useAuth();
  const scores = useLoad<Scores>(() => api.scores());
  const due = useLoad<DueRule[]>(() => api.due(30));
  const commits = useLoad<RecentCommit[]>(() => api.recentCommits(5));
  const s = scores.data;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">
            Workspace: Default SOC
            {s && ` · ${s.l1.length} L1 · ${s.l2.length} L2 · ${s.l1.reduce((a, x) => a + x.rules, 0)} L3 rules`}
          </div>
        </div>
        <div className="row-actions">
          <a className="btn" href="/api/report.pdf" download>
            Download PDF report
          </a>
          {can("admin", "analyst") && (
            <Link className="btn btn-primary" to="/usecases">
              Edit use cases
            </Link>
          )}
        </div>
      </header>

      <ErrorNote error={scores.error} />

      <section className="kpi-grid" aria-label="Key figures">
        {(s ? kpiTiles(s.kpis) : kpiTiles({} as Kpis)).map((k) => (
          <div className="card kpi" key={k.label}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">{s ? pct(k.value) : "–"}</span>
            <div className="bar">
              <div style={{ width: `${Math.round((k.value ?? 0) * 100)}%` }} className={k.invert ? "bar-muted" : ""} />
            </div>
            <span className="kpi-sub">{s ? k.sub : "…"}</span>
          </div>
        ))}
      </section>

      <div className="split">
        <section className="card split-main" aria-labelledby="l1h">
          <div className="section-head">
            <h2 id="l1h">Detection per L1 use case</h2>
            <MetricLegend />
          </div>
          <div className="scroll-x">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>L1 use case</th>
                  <th className="num">L2</th>
                  <th className="num">L3</th>
                  <th style={{ width: "34%" }}>Eff / Impl / Cov</th>
                  <th className="num">Weight</th>
                  <th className="num">Potential</th>
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
                        <span className="muted">Not applicable</span>
                      ) : r.weight === null ? (
                        <GapBadge>Detection gap · {r.rules ? "no scored rules" : "no rules yet"}</GapBadge>
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
            L2 column: use cases with scored rules / all. Only operational and maintenance rules with all three metrics
            count.
          </p>
        </section>

        <div className="split-side stack-lg">
          <section className="card stack-sm" aria-labelledby="vh">
            <div className="section-head">
              <h2 id="vh">Verification due</h2>
              <Link to="/verification" className="small">
                All {due.data?.length ?? ""}
              </Link>
            </div>
            <ErrorNote error={due.error} />
            {due.data && !due.data.length && <p className="muted">Nothing is due in the next 30 days.</p>}
            <ul className="link-list">
              {due.data?.slice(0, 7).map((d) => (
                <li key={d.code}>
                  <Link to={`/usecases/l3/${d.code}`}>
                    <span className="stack">
                      <span className="mono small muted">{d.code}</span>
                      <span className="strong-500">{d.name}</span>
                      {d.last_verified_at && (
                        <span className="small muted">Last verified {fmtDate(d.last_verified_at)}</span>
                      )}
                    </span>
                    <DueBadge d={d} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="card stack-sm" aria-labelledby="ch">
            <h2 id="ch">Recent config commits</h2>
            {commits.data && !commits.data.length && <p className="muted small">No configurations yet.</p>}
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
    </>
  );
}
