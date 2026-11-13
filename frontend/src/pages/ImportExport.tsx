import { useState } from "react";
import { api, type GitStatus, type ImportReport } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, useLoad } from "../components/ui";
import { fmtDate } from "../lib/format";

const ENTITY_LABEL: Record<string, string> = {
  l1: "L1 use cases",
  l2: "L2 use cases",
  l3: "L3 rules",
  business_drivers: "Business drivers",
  compliance_sources: "Compliance sources",
  compliance_drivers: "Compliance drivers",
  references: "Reference list entries",
};

function ReportView({ report }: { report: ImportReport }) {
  const rows = Object.entries(report.counts);
  return (
    <div className="stack">
      <p className={report.dry_run ? "form-notice" : "form-notice"} role="status" style={{ margin: 0 }}>
        {report.dry_run
          ? `Preview (${report.mode}): nothing was saved yet. Sheets found: ${report.sheets.join(", ")}.`
          : `Import (${report.mode}) saved. Sheets: ${report.sheets.join(", ")}.`}
      </p>
      <div className="card table-card">
        <table className="table count-table" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th>What</th>
              <th>New</th>
              <th>Changed</th>
              <th>Unchanged</th>
              <th>Removed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, c]) => (
              <tr key={k}>
                <td>{ENTITY_LABEL[k] ?? k}</td>
                <td>{c.created}</td>
                <td>{c.updated}</td>
                <td>{c.unchanged}</td>
                <td>{c.deleted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.errors.length > 0 && (
        <details open className="card">
          <summary className="strong">
            {report.errors.length} row{report.errors.length === 1 ? "" : "s"} skipped
          </summary>
          <ul className="issue-list">
            {report.errors.map((e, i) => (
              <li key={i} className="text-err">
                {e.sheet}
                {e.row ? ` row ${e.row}` : ""}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.warnings.length > 0 && (
        <details className="card">
          <summary className="strong">{report.warnings.length} notes</summary>
          <ul className="issue-list">
            {report.warnings.map((w, i) => (
              <li key={i}>
                {w.sheet}
                {w.row ? ` row ${w.row}` : ""}: {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ImportExport() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    if (!file) return;
    if (
      !dryRun &&
      mode === "replace" &&
      !window.confirm("Replace removes everything that is not in the file. Continue?")
    )
      return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api.importExcel(file, mode, dryRun));
    } catch (e) {
      setError((e as Error).message);
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Import / Export</h1>
          <div className="subtitle">Exchange the catalogue with the classic MaGMa UCF Excel tool.</div>
        </div>
      </header>

      <section className="card stack" aria-labelledby="exp-h">
        <h2 id="exp-h">Export</h2>
        <p className="muted" style={{ margin: 0 }}>
          The Excel file has the classic sheets (L1 UC, L2 UC, L3 UC, Drivers, References) with the original formulas,
          so it still works as the classic tool. Fields the classic tool does not know, such as lifecycle status and
          verification dates, are in extra columns on the right. The JSON backup also contains verifications and the
          full YAML configuration history.
        </p>
        <div className="row-actions start">
          <a className="btn btn-primary" href="/api/export/excel" download>
            Download Excel (.xlsx)
          </a>
          <a className="btn" href="/api/export/json" download="magma-ucf-backup.json">
            Download JSON backup
          </a>
        </div>
      </section>

      {editor ? (
        <section className="card stack" aria-labelledby="imp-h">
          <h2 id="imp-h">Import from Excel</h2>
          <p className="muted" style={{ margin: 0 }}>
            Sheets and columns are found by their names, so rows you added in Excel are picked up. Only input columns
            are read; scores are recalculated. Several values in one cell can be separated with ; or ,. Always check the
            preview first.
          </p>
          <div className="form-grid">
            <label className="field">
              Workbook (.xlsx)
              <input
                className="input"
                type="file"
                accept=".xlsx,.xlsm"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setReport(null);
                }}
              />
            </label>
            <fieldset className="radio-row">
              <legend>Mode</legend>
              <label>
                <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge: add and
                update by ID
              </label>
              {can("admin") && (
                <label>
                  <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace: also
                  remove what is not in the file
                </label>
              )}
            </fieldset>
          </div>
          <div className="row-actions start">
            <button type="button" className="btn" disabled={!file || busy} onClick={() => run(true)}>
              Preview
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || busy || !report?.dry_run}
              title={report?.dry_run ? undefined : "Run a preview first"}
              onClick={() => run(false)}
            >
              Import
            </button>
          </div>
          <ErrorNote error={error} />
          {report && <ReportView report={report} />}
        </section>
      ) : (
        <p className="form-notice">Import is not available for your role.</p>
      )}

      {can("admin") && <GitCard />}
    </>
  );
}

function fmtTime(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  return `${fmtDate(iso)} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function GitCard() {
  const status = useLoad<GitStatus>(() => api.gitStatus());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const g = status.data;

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      status.setData(await api.gitSync());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="git-h">
      <div className="section-head">
        <h2 id="git-h">Git repository</h2>
        {g && (
          <span className={!g.enabled ? "pill" : g.last_error ? "badge-gap" : "pill pill-ok"}>
            {!g.enabled ? "Not connected" : g.last_error ? "Sync failed" : "Connected"}
          </span>
        )}
      </div>
      <ErrorNote error={error ?? status.error} />
      {g && !g.enabled && (
        <p className="muted" style={{ margin: 0 }}>
          The YAML configurations can also be pushed to a git repository, one commit per configuration commit, with tags
          as <span className="mono">&lt;use case&gt;/&lt;tag&gt;</span>. Set{" "}
          <span className="mono">GIT_REMOTE_URL</span> and a token or SSH key in the environment to turn it on. The app
          stays the place where configurations are edited.
        </p>
      )}
      {g?.enabled && (
        <>
          <dl className="facts">
            <dt>Repository</dt>
            <dd className="mono">{g.remote}</dd>
            <dt>Branch</dt>
            <dd className="mono">{g.branch}</dd>
            <dt>Authentication</dt>
            <dd>{g.auth}</dd>
            <dt>Last successful sync</dt>
            <dd>{fmtTime(g.last_success_at)}</dd>
            <dt>Commits in git</dt>
            <dd>
              {g.commits_total - g.commits_unsynced} of {g.commits_total}
              {g.head_sha && <span className="mono muted"> · head {g.head_sha.slice(0, 10)}</span>}
            </dd>
            <dt>Automatic sync</dt>
            <dd>{g.auto_sync ? "After every config commit and tag" : "Off, sync by hand"}</dd>
          </dl>
          {g.last_error && (
            <div className="form-error">
              <strong>Last attempt {fmtTime(g.last_attempt_at)} failed:</strong>{" "}
              <span className="mono">{g.last_error}</span>
            </div>
          )}
          <div className="row-actions start">
            <button type="button" className="btn" disabled={busy || g.running} onClick={() => void sync()}>
              {busy || g.running ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
