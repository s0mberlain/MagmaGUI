import { useState } from "react";
import { Link } from "react-router-dom";
import { purple, type PtTrend } from "../api";
import TrendChart from "../components/TrendChart";
import { ErrorNote, useLoad } from "../components/ui";
import { fmtDate, pct } from "../lib/format";
import { OUTCOME_LABEL, OutcomePill, TREND_LABEL, TrendPill } from "../lib/purple";
import { t } from "../i18n";

const FILTERS: (PtTrend | "all")[] = ["all", "regressed", "improved", "unchanged", "new"];

export default function PurpleTrends() {
  const data = useLoad(() => purple.trends());
  const [filter, setFilter] = useState<PtTrend | "all">("all");
  const d = data.data;
  const series = (d?.assessments ?? []).filter((a) => a.metrics.executed > 0);
  const procs = (d?.procedures ?? []).filter((p) => filter === "all" || p.trend === filter);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Purple team trends")}</h1>
          <div className="subtitle">
            {t("How the defenses develop over assessments, and the resilience of each procedure that was tested more than once.")}
          </div>
        </div>
      </header>
      <ErrorNote error={data.error} />
      {d && (
        <>
          <section className="two-col even">
            <div className="card stack-sm">
              {series.length >= 2 ? (
                <>
                  <h2 className="h-sm">{t("Defense success")}</h2>
                  <TrendChart
                    title={t("Defense success")}
                    unit="pct"
                    data={series.map((a) => ({ label: a.name, at: a.date, value: a.metrics.defense_success }))}
                  />
                  <h2 className="h-sm">{t("Visibility")}</h2>
                  <TrendChart
                    title={t("Visibility")}
                    unit="pct"
                    data={series.map((a) => ({ label: a.name, at: a.date, value: a.metrics.visibility }))}
                  />
                </>
              ) : (
                <p className="muted">{t("The trend lines need at least two assessments with executed tests.")}</p>
              )}
            </div>
            <div className="card table-card">
              <div className="scroll-x">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>{t("Assessment")}</th>
                      <th>{t("Date")}</th>
                      <th className="num">{t("Executed")}</th>
                      <th className="num">{t("Defense success")}</th>
                      <th className="num">{t("Not detected")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.assessments.map((a) => (
                      <tr key={a.assessment_id}>
                        <td>
                          <Link to={`/purple/assessments/${a.assessment_id}`}>{a.name}</Link>
                        </td>
                        <td>{fmtDate(a.date)}</td>
                        <td className="num">
                          {a.metrics.executed}/{a.metrics.total}
                        </td>
                        <td className="num">{pct(a.metrics.defense_success)}</td>
                        <td className="num">{a.metrics.counts.none}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className="section-head">
            <h2>{t("Resilience per procedure")}</h2>
          </div>
          <div className="uc-filters card">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={"filter-chip" + (filter === f ? " active" : "")}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? t("All ({n})", { n: d.procedures.length }) : `${TREND_LABEL[f]} (${d.counts[f]})`}
              </button>
            ))}
          </div>
          <section className="card table-card">
            {!procs.length ? (
              <p className="muted" style={{ padding: 20, margin: 0 }}>
                {t("No executed procedures match.")}
              </p>
            ) : (
              <>
              <div className="scroll-x">
                <table className="table cards-sm">
                  <thead>
                    <tr>
                      <th>{t("Procedure")}</th>
                      <th>{t("ATT&CK")}</th>
                      <th>{t("Runs (oldest first)")}</th>
                      <th>{t("Latest")}</th>
                      <th>{t("Trend")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {procs.map((p) => (
                      <tr key={p.lineage_key}>
                        <td data-label={t("Procedure")}>{p.name}</td>
                        <td data-label={t("ATT&CK")} className="mono small">
                          {p.techniques.join(", ") || "–"}
                        </td>
                        <td data-label={t("Runs (oldest first)")}>
                          <span className="pt-runs">
                            {p.runs.map((r) => (
                              <Link
                                key={r.test_case_id}
                                to={`/purple/test-cases/${r.test_case_id}`}
                                className={`pt-dot pt-${r.outcome}`}
                                title={`${r.assessment} · ${fmtDate(r.date)} · ${OUTCOME_LABEL[r.outcome]}`}
                                aria-label={`${r.assessment}: ${OUTCOME_LABEL[r.outcome]}`}
                              />
                            ))}
                          </span>
                        </td>
                        <td data-label={t("Latest")}>
                          <OutcomePill outcome={p.latest} />
                        </td>
                        <td data-label={t("Trend")}>
                          <TrendPill trend={p.trend} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                <div className="legend pt-legend small" style={{ padding: "12px 18px" }}>
                  <span className="muted">{t("Runs:")}</span>
                  {(["blocked", "alerted", "logged_central", "logged_local", "none"] as const).map((o) => (
                    <span key={o}>
                      <i className={`pt-${o}`} /> {OUTCOME_LABEL[o]}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
