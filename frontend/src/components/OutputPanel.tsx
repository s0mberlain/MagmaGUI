import { useState } from "react";
import { api, type OutputMetric, type OutputMetricInput } from "../api";
import { pct } from "../lib/format";
import OutputChart, { OutputLegend, lastMonths, monthLabel } from "./OutputChart";
import { ErrorNote, useLoad } from "./ui";

type Draft = {
  period: string;
  alerts: string;
  incidents: string;
  false_positives: string;
  false_negatives: string;
  note: string;
};

const EMPTY = (period: string): Draft => ({
  period,
  alerts: "",
  incidents: "",
  false_positives: "",
  false_negatives: "",
  note: "",
});

/** Output metrics of one rule: last 12 months as a chart and table, editable per month.
 *  Lives inside the rule form, so it uses no <form> of its own. */
export default function OutputPanel({ code, editor }: { code: string; editor: boolean }) {
  const rows = useLoad<OutputMetric[]>(() => api.outputMetrics(code, 12), [code]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const months = lastMonths(12);
  const by = new Map((rows.data ?? []).map((m) => [m.period, m]));
  const series = months.map((p) => by.get(p) ?? { period: p, alerts: 0, false_positives: 0, incidents: 0 });
  const total = (rows.data ?? []).reduce(
    (a, m) => ({ alerts: a.alerts + m.alerts, fp: a.fp + m.false_positives, inc: a.inc + m.incidents }),
    { alerts: 0, fp: 0, inc: 0 },
  );

  function edit(period: string) {
    const m = by.get(period);
    setError(null);
    setDraft(
      m
        ? {
            period,
            alerts: String(m.alerts),
            incidents: String(m.incidents),
            false_positives: String(m.false_positives),
            false_negatives: m.false_negatives === null ? "" : String(m.false_negatives),
            note: m.note,
          }
        : EMPTY(period),
    );
  }

  async function save() {
    if (!draft) return;
    const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
    const body: OutputMetricInput = {
      alerts: n(draft.alerts),
      incidents: n(draft.incidents),
      false_positives: n(draft.false_positives),
      false_negatives: draft.false_negatives.trim() === "" ? null : Number(draft.false_negatives),
      note: draft.note,
    };
    if (body.false_positives > body.alerts) {
      setError("False positives cannot be more than alerts.");
      return;
    }
    setBusy(true);
    try {
      await api.setOutputMetric(code, draft.period, body);
      setDraft(null);
      setError(null);
      await rows.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(period: string) {
    setBusy(true);
    try {
      await api.deleteOutputMetric(code, period);
      setDraft(null);
      await rows.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Draft, label: string, wide = false) => (
    <label className={"field" + (wide ? " out-note" : "")}>
      {label}
      <input
        className="input input-sm"
        inputMode={key === "note" ? undefined : "numeric"}
        value={draft?.[key] ?? ""}
        onChange={(e) => draft && setDraft({ ...draft, [key]: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
      />
    </label>
  );

  return (
    <section className="card stack" aria-labelledby="oh">
      <div className="section-head">
        <h2 id="oh">Output metrics</h2>
        <span className="small muted">
          Last 12 months: {total.alerts} alerts · {total.inc} incidents · FP rate{" "}
          {pct(total.alerts ? total.fp / total.alerts : null)}
        </span>
      </div>
      <ErrorNote error={rows.error ?? error} />
      <OutputChart data={series} height={110} />
      <OutputLegend />
      <div className="scroll-x">
        <table className="table table-plain out-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Alerts</th>
              <th className="num">Incidents</th>
              <th className="num">False pos.</th>
              <th className="num">False neg.</th>
              <th className="num">FP rate</th>
              <th>Note</th>
              {editor && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {months
              .slice()
              .reverse()
              .map((p) => {
                const m = by.get(p);
                if (draft?.period === p) {
                  return (
                    <tr key={p} className="out-edit">
                      <td colSpan={editor ? 8 : 7}>
                        <div className="out-form">
                          <strong>{monthLabel(p, true)}</strong>
                          {field("alerts", "Alerts")}
                          {field("incidents", "Incidents")}
                          {field("false_positives", "False positives")}
                          {field("false_negatives", "False negatives")}
                          {field("note", "Note", true)}
                          <div className="row-actions start">
                            <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>
                              Cancel
                            </button>
                            {m && (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                disabled={busy}
                                onClick={() => void remove(p)}
                              >
                                Delete
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={busy}
                              onClick={() => void save()}
                            >
                              Save month
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={p} className={m ? "" : "row-muted"}>
                    <td className="nowrap">{monthLabel(p, true)}</td>
                    <td className="num">{m ? m.alerts : "–"}</td>
                    <td className="num">{m ? m.incidents : "–"}</td>
                    <td className="num">{m ? m.false_positives : "–"}</td>
                    <td className="num">{m?.false_negatives ?? "–"}</td>
                    <td className="num">{m ? pct(m.fp_rate) : "–"}</td>
                    <td className="small muted out-note-cell" title={m ? `${m.source} · ${m.updated_by}` : undefined}>
                      {m?.note}
                    </td>
                    {editor && (
                      <td className="num">
                        <button type="button" className="link-btn" onClick={() => edit(p)}>
                          {m ? "Edit" : "Add"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
