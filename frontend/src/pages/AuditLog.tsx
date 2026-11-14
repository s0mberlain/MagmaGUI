import { useEffect, useState } from "react";
import { api, type AuditEntry } from "../api";
import { t } from "../i18n";

function summarize(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .map(([k, v]) => {
      if (Array.isArray(v) && v.length === 2) return `${k}: ${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join(" · ");
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .audit(200)
      .then(setEntries)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Audit log")}</h1>
          <div className="subtitle">{t("Every change and sign-in, newest first (last 200 entries).")}</div>
        </div>
      </header>
      {error && <p className="form-error">{error}</p>}
      <section className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>{t("When")}</th>
              <th>{t("User")}</th>
              <th>{t("Action")}</th>
              <th>{t("Object")}</th>
              <th>{t("Changes")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString()}</td>
                <td>{e.username}</td>
                <td>{e.action}</td>
                <td>
                  <span className="muted">{e.entity}</span> <span className="mono">{e.entity_key}</span>
                </td>
                <td className="changes">{summarize(e.changes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
