import { useEffect, useState } from "react";
import { api, type VersionInfo } from "../api";

type Status = { state: "loading" } | { state: "ok"; info: VersionInfo } | { state: "error"; message: string };

// KPI tiles from the design. Values are filled by the scoring engine in M2/M3.
const KPIS = [
  { label: "SOC detection score", sub: "Average weight" },
  { label: "Growth potential", sub: "Average potential" },
  { label: "Detection gap", sub: "1 − detection score" },
  { label: "Framework completeness", sub: "L2 with scored rules" },
  { label: "Assessment coverage", sub: "Assessed rules" },
  { label: "Verification health", sub: "Rules verified in time" },
];

export default function Dashboard() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    api
      .version()
      .then((info) => setStatus({ state: "ok", info }))
      .catch((e: Error) => setStatus({ state: "error", message: e.message }));
  }, []);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">Workspace: Default SOC</div>
        </div>
        <span className={"pill " + (status.state === "error" ? "pill-warn" : "pill-ok")} role="status">
          {status.state === "loading" && "Connecting to API…"}
          {status.state === "ok" && `API online · v${status.info.version}`}
          {status.state === "error" && `API unreachable (${status.message})`}
        </span>
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

      <div className="empty">
        <span className="pill pill-warn">Skeleton (M0)</span>
        <h3>No use case data yet</h3>
        <p>
          The MaGMa catalogue (12 L1, 62 L2, 169 L3), the scoring engine and the charts are added in
          milestones M1 to M3. See docs/PLAN.md.
        </p>
      </div>
    </>
  );
}
