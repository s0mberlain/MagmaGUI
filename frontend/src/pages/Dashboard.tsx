import { useEffect, useState } from "react";
import { api, type CatalogueSummary } from "../api";

// KPI tiles from the design. Values are filled by the scoring engine in M2/M3.
const KPIS = [
  { label: "SOC detection score", sub: "Average weight" },
  { label: "Growth potential", sub: "Average potential" },
  { label: "Detection gap", sub: "1 − detection score" },
  { label: "Framework completeness", sub: "L2 with scored rules" },
  { label: "Assessment coverage", sub: "Assessed rules" },
  { label: "Verification health", sub: "Rules verified in time" },
];

const REF_LABELS: Record<string, string> = {
  threat_actor: "Threat actors",
  detection_technology: "Detection technologies",
  log_source: "Log sources",
  scope: "Scopes",
};

export default function Dashboard() {
  const [summary, setSummary] = useState<CatalogueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .summary()
      .then(setSummary)
      .catch((e: Error) => setError(e.message));
  }, []);

  const counts = summary
    ? [
        { label: "L1 use cases", value: summary.l1 },
        { label: "L2 use cases", value: summary.l2 },
        { label: "L3 rules", value: summary.l3 },
        { label: "Business drivers", value: summary.business_drivers },
        { label: "Compliance drivers", value: summary.compliance_drivers },
        ...Object.entries(summary.references).map(([k, v]) => ({ label: REF_LABELS[k] ?? k, value: v })),
      ]
    : [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">Workspace: Default SOC</div>
        </div>
      </header>

      <section className="kpi-grid" aria-label="Key figures">
        {KPIS.map((k) => (
          <div className="card kpi" key={k.label}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">–</span>
            <div className="bar">
              <div style={{ width: 0 }} />
            </div>
            <span className="kpi-sub">{k.sub}</span>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="cat-h">
        <h2 id="cat-h" style={{ marginBottom: 14 }}>
          Catalogue
        </h2>
        {error && <p className="form-error">{error}</p>}
        <dl className="stat-grid">
          {counts.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>{c.value}</dd>
            </div>
          ))}
        </dl>
        <p className="muted" style={{ margin: "14px 0 0", fontSize: 13 }}>
          Scores and charts are added with the scoring engine in M2 and M3.
        </p>
      </section>
    </>
  );
}
