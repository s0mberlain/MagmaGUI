import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type DueRule } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, StatusPill, useLoad } from "../components/ui";
import { fmtDate } from "../lib/format";
import { DueBadge } from "./Dashboard";
import { VerifyDialog } from "./UseCases";

const WINDOWS = [
  { days: 0, label: "Overdue only" },
  { days: 30, label: "Next 30 days" },
  { days: 90, label: "Next 90 days" },
];

export default function Verification() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const [days, setDays] = useState(30);
  const [verifying, setVerifying] = useState<string | null>(null);
  const due = useLoad<DueRule[]>(() => api.due(days), [days]);
  const scores = useLoad(() => api.scores());
  const k = scores.data?.kpis;
  const rows = due.data?.filter((d) => days > 0 || d.overdue) ?? [];
  const never = rows.filter((d) => !d.due).length;
  const overdue = rows.filter((d) => d.due && d.overdue).length;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Verification</h1>
          <div className="subtitle">
            Operational and maintenance rules must be re-tested regularly
            {k && ` (default every ${k.default_verification_days} days, per-rule override on the rule page)`}.
          </div>
        </div>
      </header>

      <section className="kpi-grid" aria-label="Verification figures">
        <div className="card kpi">
          <span className="kpi-label">Verification health</span>
          <span className="kpi-value">
            {k?.verification_health == null ? "–" : `${Math.round(k.verification_health * 100)} %`}
          </span>
          <span className="kpi-sub">
            {k ? `${k.verified_in_time} of ${k.operational_rules} rules verified in time` : "…"}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Never verified</span>
          <span className="kpi-value">{due.data ? never : "–"}</span>
          <span className="kpi-sub">Count as overdue</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Overdue</span>
          <span className="kpi-value">{due.data ? overdue : "–"}</span>
          <span className="kpi-sub">Past their due date</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Due soon</span>
          <span className="kpi-value">{due.data ? rows.length - never - overdue : "–"}</span>
          <span className="kpi-sub">Within the chosen window</span>
        </div>
      </section>

      <div role="group" aria-label="Window" className="chips">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            className={"filter-chip" + (days === w.days ? " active" : "")}
            aria-pressed={days === w.days}
            onClick={() => setDays(w.days)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <ErrorNote error={due.error} />
      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Status</th>
              <th>Last verified</th>
              <th>Due</th>
              <th>State</th>
              {editor && <th className="sr-only">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.code}>
                <td>
                  <Link to={`/usecases/l3/${d.code}`} className="rule-link">
                    <span className="mono small muted">{d.code}</span>
                    <span className="strong-500">{d.name}</span>
                  </Link>
                </td>
                <td>
                  <StatusPill status={d.lifecycle_status} />
                </td>
                <td>
                  {fmtDate(d.last_verified_at)}
                  {d.last_verified_by && <span className="muted"> · {d.last_verified_by}</span>}
                </td>
                <td>{fmtDate(d.due)}</td>
                <td>
                  <DueBadge d={d} />
                </td>
                {editor && (
                  <td className="num">
                    <button type="button" className="btn btn-sm" onClick={() => setVerifying(d.code)}>
                      Verify now
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {due.data && !rows.length && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing to verify in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {verifying && (
        <VerifyDialog
          level="l3"
          code={verifying}
          onClose={() => setVerifying(null)}
          onSaved={() => {
            void due.reload();
            void scores.reload();
          }}
        />
      )}
    </>
  );
}
