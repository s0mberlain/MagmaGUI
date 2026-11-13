import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CsvReport, type OutputSummary } from "../api";
import { useAuth } from "../auth";
import OutputChart, { OutputLegend, fmtCount } from "../components/OutputChart";
import { ErrorNote, useLoad } from "../components/ui";
import { pct } from "../lib/format";

export default function OutputPage() {
  const { can } = useAuth();
  const [months, setMonths] = useState(12);
  const sum = useLoad<OutputSummary>(() => api.outputSummary(months), [months]);
  const [limit, setLimit] = useState(15);
  const s = sum.data;
  const t = s?.totals;
  const last = s?.months[s.months.length - 1];
  const prev = s?.months[s.months.length - 2];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Output metrics</h1>
          <div className="subtitle">Alerts, incidents and false positives per rule and month</div>
        </div>
        <div className="row-actions">
          <select
            className="input input-sm"
            aria-label="Period"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
        </div>
      </header>
      <ErrorNote error={sum.error} />

      <section className="kpi-grid" aria-label="Totals">
        <div className="card kpi">
          <span className="kpi-label">Alerts</span>
          <span className="kpi-value">{t ? fmtCount(t.alerts) : "–"}</span>
          <span className="kpi-sub">{s ? `${s.rules_reporting} rules reporting` : "…"}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Incidents</span>
          <span className="kpi-value">{t ? fmtCount(t.incidents) : "–"}</span>
          <span className="kpi-sub">{t && t.alerts ? `${pct(t.incidents / t.alerts, 1)} of alerts` : "…"}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">False positive rate</span>
          <span className="kpi-value">{t ? pct(t.fp_rate) : "–"}</span>
          <span className="kpi-sub">
            {last && prev && last.fp_rate !== null && prev.fp_rate !== null
              ? `This month ${pct(last.fp_rate)}, last month ${pct(prev.fp_rate)}`
              : `${t?.false_positives ?? 0} false positives`}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">False negatives</span>
          <span className="kpi-value">{t ? t.false_negatives : "–"}</span>
          <span className="kpi-sub">Missed attacks found later (pentest, incident review)</span>
        </div>
      </section>

      <section className="card stack" aria-labelledby="mt">
        <div className="section-head">
          <h2 id="mt">Alerts per month</h2>
          <OutputLegend />
        </div>
        {s && <OutputChart data={s.months} height={200} />}
      </section>

      <div className="split">
        <section className="card table-card split-main" aria-labelledby="nr">
          <div className="table-title filters">
            <h2 id="nr">Rules by false positives</h2>
            <span className="grow" />
            <span className="small muted">Tuning these first cuts the most noise</span>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th className="num">Months</th>
                  <th className="num">Alerts</th>
                  <th className="num">Incidents</th>
                  <th className="num">False pos.</th>
                  <th style={{ width: "18%" }}>FP rate</th>
                </tr>
              </thead>
              <tbody>
                {s?.rules.slice(0, limit).map((r) => (
                  <tr key={r.code}>
                    <td>
                      <Link className="rule-link" to={`/usecases/l3/${r.code}`}>
                        <span className="mono small muted">{r.code}</span>
                        <span>{r.name}</span>
                      </Link>
                    </td>
                    <td className="num">{r.months}</td>
                    <td className="num">{r.alerts.toLocaleString()}</td>
                    <td className="num">{r.incidents.toLocaleString()}</td>
                    <td className="num strong">{r.false_positives.toLocaleString()}</td>
                    <td>
                      <div className="fp-cell">
                        <div className="bar">
                          <div className="bar-fp" style={{ width: `${(r.fp_rate ?? 0) * 100}%` }} />
                        </div>
                        <span className="small num-cell">{pct(r.fp_rate)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s && !s.rules.length && (
            <p className="muted empty-flat">No output metrics yet. Enter them on a rule's page or import a CSV file.</p>
          )}
          {s && s.rules.length > limit && (
            <div className="row-actions start" style={{ padding: "12px 16px" }}>
              <button type="button" className="btn btn-sm" onClick={() => setLimit((n) => n + 50)}>
                Show more ({s.rules.length - limit} left)
              </button>
            </div>
          )}
        </section>
        <div className="split-side stack-lg">
          <CsvCard editor={can("admin", "analyst")} onImported={() => void sum.reload()} />
        </div>
      </div>
    </>
  );
}

export function CsvCard({ editor, onImported }: { editor: boolean; onImported?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<CsvReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dry: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.importOutputCsv(file, dry);
      setReport(r);
      if (!dry && !r.errors.length) {
        setFile(null);
        if (input.current) input.current.value = "";
        onImported?.();
      }
    } catch (e) {
      setError((e as Error).message);
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="csv">
      <h2 id="csv">CSV import and export</h2>
      <p className="small muted" style={{ margin: 0 }}>
        One row per rule and month, for example exported from your SIEM or ticket system. Columns:{" "}
        <span className="mono">rule, period, alerts, incidents, false_positives, false_negatives, note</span>. Period is{" "}
        <span className="mono">YYYY-MM</span>; comma or semicolon separated. Existing months are overwritten.
      </p>
      <div className="row-actions start">
        <a className="btn" href="/api/export/output-metrics.csv" download>
          Export CSV
        </a>
      </div>
      {editor && (
        <>
          <label className="field">
            File to import
            <input
              ref={input}
              className="input"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
              }}
            />
          </label>
          <div className="row-actions start">
            <button type="button" className="btn" disabled={!file || busy} onClick={() => void run(true)}>
              Check
            </button>
            <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={() => void run(false)}>
              Import
            </button>
          </div>
        </>
      )}
      <ErrorNote error={error} />
      {report && (
        <div className={report.errors.length ? "form-error stack-xs" : "form-notice stack-xs"} role="status">
          <strong>
            {report.errors.length
              ? `${report.errors.length} row(s) have errors. Nothing was imported.`
              : report.dry_run
                ? `Check passed: ${report.created} new and ${report.updated} updated months in ${report.rows} rows.`
                : `Imported: ${report.created} new and ${report.updated} updated months.`}
          </strong>
          {report.errors.slice(0, 8).map((e) => (
            <span key={e} className="small">
              {e}
            </span>
          ))}
          {report.errors.length > 8 && <span className="small">… and {report.errors.length - 8} more</span>}
        </div>
      )}
    </section>
  );
}
