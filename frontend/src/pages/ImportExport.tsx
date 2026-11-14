import { useState } from "react";
import { api, type GitStatus, type ImportReport } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, useLoad } from "../components/ui";
import { fmtTime } from "../lib/format";
import { t } from "../i18n";

const ENTITY_LABEL: Record<string, string> = {
  l1: t("L1 use cases"),
  l2: t("L2 use cases"),
  l3: t("L3 rules"),
  business_drivers: t("Business drivers"),
  compliance_sources: t("Compliance sources"),
  compliance_drivers: t("Compliance drivers"),
  references: t("Reference list entries"),
};

function ReportView({ report }: { report: ImportReport }) {
  const rows = Object.entries(report.counts);
  return (
    <div className="stack">
      <p className={report.dry_run ? "form-notice" : "form-notice"} role="status" style={{ margin: 0 }}>
        {report.dry_run
          ? t("Preview ({mode}): nothing was saved yet. Sheets found: {sheets}.", {
              mode: report.mode,
              sheets: report.sheets.join(", "),
            })
          : t("Import ({mode}) saved. Sheets: {sheets}.", { mode: report.mode, sheets: report.sheets.join(", ") })}
      </p>
      <div className="card table-card">
        <table className="table count-table" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th>{t("What")}</th>
              <th>{t("New")}</th>
              <th>{t("Changed")}</th>
              <th>{t("Unchanged")}</th>
              <th>{t("Removed")}</th>
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
            {report.errors.length} {t("row")}
            {report.errors.length === 1 ? "" : "s"} {t("skipped")}
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
          <summary className="strong">
            {report.warnings.length} {t("notes")}
          </summary>
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
      !window.confirm(t("Replace removes everything that is not in the file. Continue?"))
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
          <h1>{t("Import / Export")}</h1>
          <div className="subtitle">{t("Exchange the catalogue with the classic MaGMa UCF Excel tool.")}</div>
        </div>
      </header>

      <section className="card stack" aria-labelledby="exp-h">
        <h2 id="exp-h">{t("Export")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t(
            "The Excel file has the classic sheets (L1 UC, L2 UC, L3 UC, Drivers, References) with the original formulas, so it still works as the classic tool. Fields the classic tool does not know, such as lifecycle status and verification dates, are in extra columns on the right. The JSON backup also contains verifications and the full YAML configuration history.",
          )}
        </p>
        <div className="row-actions start">
          <a className="btn btn-primary" href="/api/export/excel" download>
            {t("Download Excel (.xlsx)")}
          </a>
          <a className="btn" href="/api/export/json" download="magma-ucf-backup.json">
            {t("Download JSON backup")}
          </a>
        </div>
      </section>

      {editor ? (
        <section className="card stack" aria-labelledby="imp-h">
          <h2 id="imp-h">{t("Import from Excel")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t(
              "Sheets and columns are found by their names, so rows you added in Excel are picked up. Only input columns are read; scores are recalculated. Several values in one cell can be separated with ; or ,. Always check the preview first.",
            )}
          </p>
          <div className="form-grid">
            <label className="field">
              {t("Workbook (.xlsx)")}
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
              <legend>{t("Mode")}</legend>
              <label>
                <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />{" "}
                {t("Merge: add and update by ID")}
              </label>
              {can("admin") && (
                <label>
                  <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />{" "}
                  {t("Replace: also remove what is not in the file")}
                </label>
              )}
            </fieldset>
          </div>
          <div className="row-actions start">
            <button type="button" className="btn" disabled={!file || busy} onClick={() => run(true)}>
              {t("Preview")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || busy || !report?.dry_run}
              title={report?.dry_run ? undefined : t("Run a preview first")}
              onClick={() => run(false)}
            >
              {t("Import")}
            </button>
          </div>
          <ErrorNote error={error} />
          {report && <ReportView report={report} />}
        </section>
      ) : (
        <p className="form-notice">{t("Import is not available for your role.")}</p>
      )}

      {can("admin") && <GitCard />}
    </>
  );
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
        <h2 id="git-h">{t("Git repository")}</h2>
        {g && (
          <span className={!g.enabled ? "pill" : g.last_error ? "badge-gap" : "pill pill-ok"}>
            {!g.enabled ? t("Not connected") : g.last_error ? t("Sync failed") : t("Connected")}
          </span>
        )}
      </div>
      <ErrorNote error={error ?? status.error} />
      {g && !g.enabled && (
        <p className="muted" style={{ margin: 0 }}>
          {t(
            "The YAML configurations can also be pushed to a git repository, one commit per configuration commit, with tags as",
          )}{" "}
          <span className="mono">{t("<use case>/<tag>")}</span>
          {t(". Set")} <span className="mono">GIT_REMOTE_URL</span>{" "}
          {t(
            "and a token or SSH key in the environment to turn it on. The app stays the place where configurations are edited.",
          )}
        </p>
      )}
      {g?.enabled && (
        <>
          <dl className="facts">
            <dt>{t("Repository")}</dt>
            <dd className="mono">{g.remote}</dd>
            <dt>{t("Branch")}</dt>
            <dd className="mono">{g.branch}</dd>
            <dt>{t("Authentication")}</dt>
            <dd>{g.auth}</dd>
            <dt>{t("Last successful sync")}</dt>
            <dd>{fmtTime(g.last_success_at)}</dd>
            <dt>{t("Commits in git")}</dt>
            <dd>
              {g.commits_total - g.commits_unsynced} {t("of")} {g.commits_total}
              {g.head_sha && (
                <span className="mono muted">
                  {" "}
                  {t("· head")} {g.head_sha.slice(0, 10)}
                </span>
              )}
            </dd>
            <dt>{t("Automatic sync")}</dt>
            <dd>{g.auto_sync ? t("After every config commit and tag") : t("Off, sync by hand")}</dd>
            <dt>{t("Direction")}</dt>
            <dd>
              {g.pull ? t("Two-way: changes pushed to the repository are read back") : t("App to git only")}
              {g.pull && (
                <span className="muted">
                  {" · "}
                  {g.pull_interval_minutes > 0
                    ? t("checked every {n} min", { n: g.pull_interval_minutes })
                    : t("checked on sync")}
                  {g.webhook && ` · ${t("webhook on")}`}
                </span>
              )}
            </dd>
            {g.pull && (
              <>
                <dt>{t("Read back from git")}</dt>
                <dd>
                  {t("{n} commits", { n: g.commits_from_git })}
                  {g.last_import_at && (
                    <span className="muted">
                      {" · "}
                      {t("last check {date}", { date: fmtTime(g.last_import_at) })}
                    </span>
                  )}
                </dd>
              </>
            )}
          </dl>
          {g.pull && g.import_notes.length > 0 && (
            <div className="note-box">
              <strong>{t("Not taken over at the last check")}</strong>
              <ul className="plain-list small">
                {g.import_notes.map((n) => (
                  <li key={n} className="mono">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {g.last_error && (
            <div className="form-error">
              <strong>
                {t("Last attempt")} {fmtTime(g.last_attempt_at)} {t("failed:")}
              </strong>{" "}
              <span className="mono">{g.last_error}</span>
            </div>
          )}
          <div className="row-actions start">
            <button type="button" className="btn" disabled={busy || g.running} onClick={() => void sync()}>
              {busy || g.running ? t("Syncing…") : t("Sync now")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
