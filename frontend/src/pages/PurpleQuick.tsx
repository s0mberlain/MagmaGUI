import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, purple, type PtDetection, type PtOutcome, type PtQuickTestInput, type PtTestCase } from "../api";
import { MarkdownField } from "../components/Markdown";
import TechniquePicker from "../components/TechniquePicker";
import { ErrorNote, Modal, useLoad } from "../components/ui";
import { fmtTime, pct } from "../lib/format";
import { fromLocalInput, OUTCOME_HINT, OUTCOME_LABEL, OUTCOMES, OutcomePill, splitList, toLocalInput } from "../lib/purple";
import { t } from "../i18n";

/** Quick tests: test one detection or script and record the result and the finding in one
 * step (backend app/api/purple_quick.py). Each quick test is an ordinary test case, so the
 * test case page adds evidence files or changes it later. */

const detection = (kind: "rule" | "tool", extra: Partial<PtDetection> = {}): PtDetection => ({
  id: null,
  kind,
  rule_code: "",
  tool: "",
  outcome: "tbd",
  expected: true,
  alert_name: "",
  severity: "",
  detected_at: null,
  note: "",
  ...extra,
});

const bestOutcome = (list: PtDetection[]): PtOutcome => OUTCOMES.find((o) => list.some((d) => d.outcome === o)) ?? "tbd";

interface Form extends Omit<PtQuickTestInput, "targets"> {
  targets: string;
}

const emptyForm = (): Form => ({
  name: "",
  template_id: null,
  techniques: [],
  executor: "",
  command: "",
  targets: "",
  executed_at: new Date().toISOString(),
  red_notes: "",
  detections: [],
  blue_notes: "",
  outcome_override: null,
  done: true,
  record_verification: true,
});

export function QuickTestDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (tc: PtTestCase & { verified: { rule: string; result: string }[] }, openEvidence: boolean) => void;
}) {
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const library = useLoad(() => purple.templates());
  const techniques = useLoad(() => api.attackTechniques());
  const names = useMemo(() => new Map((techniques.data ?? []).map((x) => [x.id, x.name])), [techniques.data]);
  const rules = useLoad(() => api.l3s());
  const ruleNames = useMemo(() => new Map((rules.data ?? []).map((r) => [r.code, r.name])), [rules.data]);
  const tools = useLoad(() => api.refs("detection_technology"));
  const techKey = form.techniques.join(",");
  const suggested = useLoad(() => (form.techniques.length ? purple.suggestedRulesFor(form.techniques) : Promise.resolve([])), [techKey]);
  const usedRules = new Set(form.detections.filter((d) => d.kind === "rule").map((d) => d.rule_code));
  const derived = bestOutcome(form.detections);

  const setDetection = (i: number, patch: Partial<PtDetection>) =>
    setForm({ ...form, detections: form.detections.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  function pickTemplate(id: string) {
    const tpl = library.data?.find((x) => String(x.id) === id);
    if (!tpl) {
      setForm({ ...form, template_id: null });
      return;
    }
    setForm({
      ...form,
      template_id: tpl.id,
      name: tpl.name,
      techniques: tpl.techniques,
      executor: tpl.executor,
      command: tpl.command,
      // the defenses the procedure expects, unless defenses were entered already
      detections: form.detections.length ? form.detections : tpl.expected_defenses.map((x) => detection("tool", { tool: x })),
    });
  }

  async function submit(e: FormEvent, openEvidence = false) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tc = await purple.createQuickTest({ ...form, targets: splitList(form.targets) });
      onSaved(tc, openEvidence);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Quick test")} open onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted small" style={{ margin: 0 }}>
          {t("Test one detection or script and record the result and your finding in one step. No assessment or campaign needed.")}
        </p>
        <div className="form-grid">
          <label className="field">
            {t("Start from the library (optional)")}
            <select className="input" value={form.template_id ?? ""} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="">{t("– none –")}</option>
              {(library.data ?? [])
                .filter((x) => !x.archived)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.techniques.length ? ` (${x.techniques.join(", ")})` : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="field grow-2">
            {t("What did you test?")} *
            <input
              className="input"
              required
              value={form.name}
              placeholder={t("e.g. LSASS dump with ProcDump, new brute force rule")}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
        </div>
        <TechniquePicker
          value={form.techniques}
          names={names}
          techniques={techniques.data ?? []}
          onChange={(v) => setForm({ ...form, techniques: v })}
          required={false}
        />
        <label className="field">
          {t("Script or command")}
          <textarea
            className="input mono"
            rows={3}
            value={form.command}
            placeholder={t("What was run, e.g. Invoke-AtomicTest T1003.001")}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            {t("Executor")}
            <input
              className="input"
              value={form.executor}
              placeholder="powershell, bash"
              onChange={(e) => setForm({ ...form, executor: e.target.value })}
            />
          </label>
          <label className="field">
            {t("Targets")}
            <input
              className="input"
              value={form.targets}
              placeholder={t("hosts, accounts, IPs")}
              onChange={(e) => setForm({ ...form, targets: e.target.value })}
            />
          </label>
          <label className="field">
            {t("Executed at")}
            <input
              className="input"
              type="datetime-local"
              value={toLocalInput(form.executed_at)}
              onChange={(e) => setForm({ ...form, executed_at: fromLocalInput(e.target.value) })}
            />
          </label>
        </div>

        <fieldset className="stack-sm">
          <legend className="strong-500">{t("What did the defenses do?")}</legend>
          <div className="pt-suggest small">
            {!!suggested.data?.filter((r) => !usedRules.has(r.code)).length && (
              <>
                <span className="muted">{t("Rules covering the techniques:")}</span>
                {suggested.data
                  .filter((r) => !usedRules.has(r.code))
                  .slice(0, 8)
                  .map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      className="chip chip-info chip-link"
                      title={`${r.name} (${r.matched.join(", ")})`}
                      onClick={() => setForm({ ...form, detections: [...form.detections, detection("rule", { rule_code: r.code })] })}
                    >
                      + {r.code}
                    </button>
                  ))}
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setForm({ ...form, detections: [...form.detections, detection("rule")] })}>
              {t("+ Use case rule")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setForm({ ...form, detections: [...form.detections, detection("tool")] })}>
              {t("+ Other detection")}
            </button>
          </div>
          {form.detections.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              {t("Add the use case rule you tested, or any other defense (EDR, firewall, logs), and what it did.")}
            </p>
          ) : (
            <div className="scroll-x">
              <table className="table pt-quick-det">
                <thead>
                  <tr>
                    <th>{t("Defense")}</th>
                    <th>{t("Outcome")}</th>
                    <th>{t("Alert / event")}</th>
                    <th>
                      <span className="sr-only">{t("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {form.detections.map((d, i) => (
                    <tr key={i}>
                      <td>
                        {d.kind === "rule" ? (
                          <span className="stack-xs">
                            <input
                              className="input input-sm mono"
                              list="pt-quick-rules"
                              required
                              value={d.rule_code}
                              placeholder={t("L3 rule, e.g. AO-BRU-01")}
                              aria-label={t("L3 rule")}
                              onChange={(e) => setDetection(i, { rule_code: e.target.value.split(" ")[0].toUpperCase() })}
                            />
                            <span className="small muted">{ruleNames.get(d.rule_code) ?? t("Use case rule")}</span>
                          </span>
                        ) : (
                          <span className="stack-xs">
                            <input
                              className="input input-sm"
                              list="pt-quick-tools"
                              required
                              value={d.tool}
                              placeholder={t("e.g. Microsoft Defender, Firewall, DC logs")}
                              aria-label={t("Tool or source")}
                              onChange={(e) => setDetection(i, { tool: e.target.value })}
                            />
                            <span className="small muted">{t("Other detection")}</span>
                          </span>
                        )}
                      </td>
                      <td>
                        <select
                          className={`input input-sm pt-sel-${d.outcome}`}
                          value={d.outcome}
                          title={OUTCOME_HINT[d.outcome]}
                          aria-label={t("Outcome")}
                          onChange={(e) => setDetection(i, { outcome: e.target.value as PtOutcome })}
                        >
                          {OUTCOMES.map((o) => (
                            <option key={o} value={o}>
                              {OUTCOME_LABEL[o]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="input input-sm"
                          value={d.alert_name}
                          aria-label={t("Alert / event")}
                          onChange={(e) => setDetection(i, { alert_name: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t("Remove")}
                          onClick={() => setForm({ ...form, detections: form.detections.filter((_, j) => j !== i) })}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <datalist id="pt-quick-rules">
            {(rules.data ?? []).map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </datalist>
          <datalist id="pt-quick-tools">
            {(tools.data ?? []).map((x) => (
              <option key={x.name} value={x.name} />
            ))}
          </datalist>
          <div className="row-actions" style={{ justifyContent: "space-between" }}>
            <span className="small">
              {t("Test outcome:")} <OutcomePill outcome={form.outcome_override ?? derived} overridden={!!form.outcome_override} />
            </span>
            <label className="field-inline small">
              {t("Override")}{" "}
              <select
                className="input input-sm"
                value={form.outcome_override ?? ""}
                onChange={(e) => setForm({ ...form, outcome_override: (e.target.value || null) as PtOutcome | null })}
              >
                <option value="">{t("From the defenses ({outcome})", { outcome: OUTCOME_LABEL[derived] })}</option>
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <MarkdownField
          label={t("Finding")}
          value={form.blue_notes}
          rows={4}
          placeholder={t("What was seen, what is missing, what should be fixed")}
          onChange={(v) => setForm({ ...form, blue_notes: v })}
        />

        <div className="stack-xs">
          <label className="check small">
            <input type="checkbox" checked={form.done} onChange={(e) => setForm({ ...form, done: e.target.checked })} />
            {t("The result is final (blue team review done)")}
          </label>
          <label className="check small">
            <input
              type="checkbox"
              disabled={!form.done}
              checked={form.done && form.record_verification}
              onChange={(e) => setForm({ ...form, record_verification: e.target.checked })}
            />
            {t("Record the result as a verification of the linked use case rules (blocked or alerted = OK, logged or not detected = issues)")}
          </label>
        </div>

        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn" disabled={busy || !form.name.trim()} onClick={(e) => void submit(e as unknown as FormEvent, true)}>
            {t("Save and add evidence")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !form.name.trim()}>
            {t("Save quick test")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function QuickTests({ editor, onNew, reloadKey }: { editor: boolean; onNew: () => void; reloadKey: number }) {
  const list = useLoad(() => purple.quickTests(), [reloadKey]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = (list.data?.tests ?? []).filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.command.toLowerCase().includes(q) ||
      r.techniques.some((x) => x.toLowerCase().includes(q)) ||
      r.defenses.some((d) => d.name.toLowerCase().includes(q)),
  );
  const m = list.data?.metrics;

  return (
    <>
      <ErrorNote error={list.error} />
      <section className="card uc-filters" aria-label={t("Filter quick tests")}>
        <label className="sr-only" htmlFor="pt-quick-q">
          {t("Search by test, command, technique or rule")}
        </label>
        <input
          id="pt-quick-q"
          className="input input-sm"
          style={{ minWidth: 280 }}
          placeholder={t("Search by test, command, technique or rule")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {m && m.total > 0 && (
          <span className="small muted">
            {t("Quick tests: {n}", { n: m.total })} · {t("Defense success")} {pct(m.defense_success)} · {t("Visibility")} {pct(m.visibility)} ·{" "}
            {t("Not detected")} {m.counts.none}
          </span>
        )}
      </section>
      <section className="card table-card">
        {list.data && !list.data.tests.length && (
          <div style={{ padding: 20 }} className="stack-sm">
            <p className="muted" style={{ margin: 0 }}>
              {t("No quick tests yet. Use a quick test to check a single detection or script and note what you found.")}
            </p>
            {editor && (
              <div>
                <button type="button" className="btn btn-primary" onClick={onNew}>
                  {t("+ Quick test")}
                </button>
              </div>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <div className="scroll-x">
            <table className="table cards-sm">
              <thead>
                <tr>
                  <th>{t("Executed at")}</th>
                  <th>{t("Test")}</th>
                  <th>{t("ATT&CK")}</th>
                  <th>{t("Defenses")}</th>
                  <th>{t("Outcome")}</th>
                  <th>{t("Finding")}</th>
                  <th>{t("By")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t("Executed at")} className="small">
                      {fmtTime(r.attack_start ?? r.created_at)}
                    </td>
                    <td data-label={t("Test")}>
                      <Link to={`/purple/test-cases/${r.id}`}>{r.name}</Link>
                      {r.command && (
                        <div className="small muted mono" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.command}>
                          {r.command}
                        </div>
                      )}
                    </td>
                    <td data-label={t("ATT&CK")} className="mono small">
                      {r.techniques.join(", ") || "–"}
                    </td>
                    <td data-label={t("Defenses")} className="small">
                      {r.defenses.length
                        ? r.defenses.map((d, i) => (
                            <div key={i} style={{ marginBottom: 2 }}>
                              {d.kind === "rule" ? <Link to={`/usecases/l3/${d.name}`}>{d.name}</Link> : d.name}{" "}
                              <OutcomePill outcome={d.outcome} />
                            </div>
                          ))
                        : "–"}
                    </td>
                    <td data-label={t("Outcome")}>
                      <OutcomePill outcome={r.outcome} overridden={r.overridden} />
                      {r.blue_status !== "done" && <div className="small muted">{t("In review")}</div>}
                    </td>
                    <td data-label={t("Finding")} className="small" style={{ maxWidth: 320 }}>
                      {r.blue_notes ? (
                        <span title={r.blue_notes}>{r.blue_notes.length > 140 ? r.blue_notes.slice(0, 140) + "…" : r.blue_notes}</span>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td data-label={t("By")} className="small">
                      {r.red_assignee || "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted small">
        {t("Quick tests are single checks: they are not part of an assessment and stay out of the purple team trends. Their results show on the use case rules they tested.")}
      </p>
    </>
  );
}
