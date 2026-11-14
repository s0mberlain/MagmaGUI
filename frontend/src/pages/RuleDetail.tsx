import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type L3, type RefItem } from "../api";
import { useAuth } from "../auth";
import ConfigPanel from "../components/ConfigPanel";
import LifecyclePanel from "../components/LifecyclePanel";
import { DriverBlock } from "../components/Drivers";
import OutputPanel from "../components/OutputPanel";
import { ErrorNote, MultiSelect, StatusPill, useLoad } from "../components/ui";
import { fmtDate, num, pct } from "../lib/format";
import { VerifiedCell, VerifyDialog } from "./UseCases";
import { t } from "../i18n";

type Metric = "effectiveness" | "implementation" | "coverage";
const METRICS: { key: Metric; label: string; hint: string }[] = [
  {
    key: "effectiveness",
    label: t("Effectiveness"),
    hint: t("How well the rule detects the threat if it runs everywhere."),
  },
  { key: "implementation", label: t("Implementation"), hint: t("How far the rule is built, tuned and running.") },
  { key: "coverage", label: t("Coverage"), hint: t("Share of the in-scope estate whose logs the rule sees.") },
];

interface Form {
  name: string;
  description: string;
  effectiveness: number | null;
  implementation: number | null;
  coverage: number | null;
  log_sources: string[];
  detection_technologies: string[];
  scopes: string[];
  attack: string;
  siem: string;
  onboarded_at: string;
  interval: string;
  risk: string;
  target: string;
  comments: string;
}

function toForm(r: L3): Form {
  return {
    name: r.name,
    description: r.description,
    effectiveness: r.effectiveness,
    implementation: r.implementation,
    coverage: r.coverage,
    log_sources: r.log_sources,
    detection_technologies: r.detection_technologies,
    scopes: r.scopes,
    attack: r.attack_techniques.join(", "),
    siem: (r.siem_rule_ids ?? []).join("; "),
    onboarded_at: r.onboarded_at ?? "",
    interval: r.verification_interval_days?.toString() ?? "",
    risk: r.risk_level?.toString() ?? "",
    target: r.target_implementation === null ? "" : String(Math.round(r.target_implementation * 100)),
    comments: r.comments,
  };
}

export default function RuleDetail() {
  const { code = "" } = useParams();
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const navigate = useNavigate();

  const rule = useLoad(() => api.l3(code), [code]);
  const history = useLoad(() => api.verifications("l3", code), [code]);
  const lists = useLoad(async () => {
    const [log, tech, scope] = await Promise.all([
      api.refs("log_source"),
      api.refs("detection_technology"),
      api.refs("scope"),
    ]);
    return { log, tech, scope };
  });

  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (rule.data) setForm(toForm(rule.data));
  }, [rule.data]);

  if (rule.error) return <ErrorNote error={rule.error} />;
  if (!rule.data || !form) return <p className="muted">{t("Loading…")}</p>;
  const r = rule.data;
  const set = (patch: Partial<Form>) => {
    setSaved(null);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  const e = form.effectiveness,
    i = form.implementation,
    c = form.coverage;
  const assessed = e !== null && i !== null && c !== null;
  const weight = assessed ? e * i * c : null;
  const potential = assessed ? e - weight! : null;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(r));

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateL3(code, {
        name: form.name,
        description: form.description,
        effectiveness: form.effectiveness,
        implementation: form.implementation,
        coverage: form.coverage,
        log_sources: form.log_sources,
        detection_technologies: form.detection_technologies,
        scopes: form.scopes,
        attack_techniques: form.attack
          .split(/[\s,;]+/)
          .map((tt) => tt.trim().toUpperCase())
          .filter(Boolean),
        siem_rule_ids: form.siem
          .split(/[;\n]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        onboarded_at: form.onboarded_at || null,
        verification_interval_days: form.interval ? Number(form.interval) : null,
        risk_level: form.risk ? Number(form.risk) : null,
        target_implementation: form.target === "" ? null : Number(form.target) / 100,
        comments: form.comments,
      });
      rule.setData(updated);
      setSaved(t("Saved."));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("Delete rule {code}? This cannot be undone.", { code }))) return;
    try {
      await api.deleteL3(code);
      navigate(`/usecases?l2=${r.l2_code}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const opts = (items: RefItem[] | undefined) => (items ?? []).map((x) => ({ value: x.name, label: x.name }));

  return (
    <>
      <form onSubmit={save} className="stack-lg">
        <nav aria-label={t("Breadcrumb")} className="crumbs">
          <Link to="/usecases">{t("Use cases")}</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/usecases?l1=${r.l1_code}`}>{r.l1_code}</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/usecases?l2=${r.l2_code}`}>{r.l2_code}</Link>
          <span aria-hidden="true">/</span>
          <span>{r.code}</span>
        </nav>

        <header className="page-header">
          <div className="stack-sm">
            <div className="chips">
              <span className="code-tag">{r.code}</span>
              <StatusPill status={r.lifecycle_status} />
              {r.attack_techniques.map((tt) => (
                <span key={tt} className="chip chip-neutral">
                  {t("ATT&CK")} {tt}
                </span>
              ))}
            </div>
            {editor ? (
              <>
                <label className="sr-only" htmlFor="rule-name">
                  {t("Rule name")}
                </label>
                <input
                  id="rule-name"
                  className="title-input"
                  value={form.name}
                  required
                  onChange={(ev) => set({ name: ev.target.value })}
                />
              </>
            ) : (
              <h1>{r.name}</h1>
            )}
          </div>
          {editor && (
            <div className="row-actions">
              {can("admin") && (
                <button type="button" className="btn" onClick={remove}>
                  {t("Delete")}
                </button>
              )}
              <button type="button" className="btn btn-dark" onClick={() => setVerifying(true)}>
                {t("Verify now")}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
                {dirty ? t("Save changes") : t("Saved")}
              </button>
            </div>
          )}
        </header>
        {!editor && <p className="form-notice">{t("Read-only: your role cannot change rules.")}</p>}
        <ErrorNote error={error} />
        {saved && (
          <p className="form-notice" role="status">
            {saved}
          </p>
        )}

        <div className="split">
          <div className="split-side stack-lg">
            <section className="card stack" aria-labelledby="mh">
              <h2 id="mh">{t("Metrics")}</h2>
              {METRICS.map((m) => {
                const v = form[m.key];
                return (
                  <div key={m.key} className="slider">
                    <div className="slider-head">
                      <label htmlFor={m.key}>{m.label}</label>
                      <span className="strong">{v === null ? t("not set") : `${Math.round(v * 100)} %`}</span>
                    </div>
                    <input
                      id={m.key}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      disabled={!editor}
                      value={v === null ? 0 : Math.round(v * 100)}
                      className={v === null ? "unset" : ""}
                      onChange={(ev) => set({ [m.key]: Number(ev.target.value) / 100 } as Partial<Form>)}
                    />
                    <span className="small muted">
                      {m.hint}
                      {editor && v !== null && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => set({ [m.key]: null } as Partial<Form>)}
                          >
                            {t("Clear")}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
              <div className="metric-results">
                <div>
                  <span className="small muted">{t("Weight (eff × impl × cov)")}</span>
                  <span className="big accent">{num(weight)}</span>
                </div>
                <div>
                  <span className="small muted">{t("Potential (eff − weight)")}</span>
                  <span className="big data1">{num(potential)}</span>
                </div>
              </div>
              {r.effective_target !== null && (
                <p className="small target-line">
                  {t("Target implementation")} {pct(r.effective_target)}
                  {r.implementation_gap ? (
                    <span className="text-err">
                      {" "}
                      · {pct(r.implementation_gap)} {t("to go")}
                    </span>
                  ) : (
                    <span className="text-ok"> {t("· reached")}</span>
                  )}
                  {r.priority !== null && (
                    <span className="muted">
                      {" "}
                      {t("· priority")} {num(r.priority)}
                    </span>
                  )}
                </p>
              )}
              {!assessed && <p className="small muted">{t("Set all three metrics to score the rule.")}</p>}
              {assessed && !["operational", "maintenance"].includes(r.lifecycle_status) && (
                <p className="small muted">{t("Only operational and maintenance rules count towards the scores.")}</p>
              )}
            </section>

            <section className="card stack-sm" aria-labelledby="drh">
              <div className="section-head">
                <h2 id="drh">{t("Drivers")}</h2>
                <Link to={`/usecases?l2=${r.l2_code}`} className="small">
                  {t("Inherited from {code}", { code: r.l2_code })}
                </Link>
              </div>
              <DriverBlock business={r.business_drivers} compliance={r.compliance_drivers} />
            </section>

            <section className="card stack" aria-labelledby="vh">
              <div className="section-head">
                <h2 id="vh">{t("Verification")}</h2>
                <VerifiedCell rule={r} />
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {t("Next due")} {fmtDate(r.verification_due)}
                {r.verification_interval_days
                  ? ` · ${t("every {n} days", { n: r.verification_interval_days })}`
                  : t(" · default interval")}
                {r.last_verified_by && ` · ${t("last by {user}", { user: r.last_verified_by })}`}
              </p>
              <ErrorNote error={history.error} />
              {history.data && !history.data.length && <p className="muted small">{t("No verifications recorded.")}</p>}
              <ul className="history">
                {history.data?.map((v) => (
                  <li key={v.id}>
                    <span className={v.result === "ok" ? "pill pill-ok" : "badge-gap"}>
                      {v.result === "ok" ? "OK" : t("Issues")}
                    </span>
                    <span className="stack-xs">
                      <span className="strong-500">
                        {fmtDate(v.verified_at)} · {v.username}
                      </span>
                      {v.note && <span className="ink-2">{v.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <LifecyclePanel level="l3" code={code} onChanged={() => void rule.reload()} />
          </div>

          <div className="split-wide stack-lg">
            <section className="card stack" aria-labelledby="dh">
              <h2 id="dh">{t("Details")}</h2>
              <div className="form-grid">
                <label className="field">
                  {t("Onboarded on")}
                  <input
                    className="input"
                    type="date"
                    disabled={!editor}
                    value={form.onboarded_at}
                    onChange={(ev) => set({ onboarded_at: ev.target.value })}
                  />
                </label>
                <label className="field">
                  {t("Verify every (days)")}
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={3650}
                    placeholder={t("Default")}
                    disabled={!editor}
                    value={form.interval}
                    onChange={(ev) => set({ interval: ev.target.value })}
                  />
                </label>
                <label className="field">
                  {t("Risk level")}
                  <select
                    className="input"
                    disabled={!editor}
                    value={form.risk}
                    onChange={(ev) => set({ risk: ev.target.value })}
                  >
                    <option value="">
                      {r.risk_source === "l2"
                        ? t("Same as L2 ({risk})", { risk: r.effective_risk })
                        : t("Same as L2 (not set)")}
                    </option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {t("Target implementation (%)")}
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    disabled={!editor}
                    placeholder={
                      r.target_source && r.target_source !== "rule"
                        ? `${Math.round((r.effective_target ?? 0) * 100)} (${r.target_source === "l2" ? t("from L2") : t("from risk")})`
                        : t("From L2 or risk level")
                    }
                    value={form.target}
                    onChange={(ev) => set({ target: ev.target.value })}
                  />
                </label>
                <label className="field">
                  {t("ATT&CK techniques")}
                  <input
                    className="input mono"
                    placeholder="T1003, T1059.001"
                    disabled={!editor}
                    value={form.attack}
                    onChange={(ev) => set({ attack: ev.target.value })}
                  />
                </label>
                <label className="field">
                  {t("SIEM rule IDs")}
                  <input
                    className="input mono"
                    placeholder={t("Saved search or rule id; separate with ;")}
                    title={t("Links this rule to the SIEM rule inventory and alert counts (Integrations page)")}
                    disabled={!editor}
                    value={form.siem}
                    onChange={(ev) => set({ siem: ev.target.value })}
                  />
                </label>
              </div>
              <div className="form-grid">
                <MultiSelect
                  label={t("Log sources")}
                  options={opts(lists.data?.log)}
                  value={form.log_sources}
                  disabled={!editor}
                  onChange={(v) => set({ log_sources: v })}
                />
                <MultiSelect
                  label={t("Detection technologies")}
                  options={opts(lists.data?.tech)}
                  value={form.detection_technologies}
                  disabled={!editor}
                  onChange={(v) => set({ detection_technologies: v })}
                />
                <MultiSelect
                  label={t("Scopes")}
                  options={opts(lists.data?.scope)}
                  value={form.scopes}
                  disabled={!editor}
                  onChange={(v) => set({ scopes: v })}
                />
              </div>
              <label className="field">
                {t("Description")}
                <textarea
                  className="input textarea"
                  rows={3}
                  disabled={!editor}
                  value={form.description}
                  onChange={(ev) => set({ description: ev.target.value })}
                />
              </label>
              <label className="field">
                {t("Comments")}
                <textarea
                  className="input textarea"
                  rows={3}
                  disabled={!editor}
                  value={form.comments}
                  onChange={(ev) => set({ comments: ev.target.value })}
                />
              </label>
              <p className="small muted" style={{ margin: 0 }}>
                {t("Last changed")} {fmtDate(r.updated_at)}
              </p>
            </section>

            <OutputPanel code={code} editor={editor} />

            <ConfigPanel level="l3" code={code} editor={editor} />
          </div>
        </div>
      </form>

      {verifying && (
        <VerifyDialog
          level="l3"
          code={code}
          onClose={() => setVerifying(false)}
          onSaved={() => {
            void rule.reload();
            void history.reload();
          }}
        />
      )}
    </>
  );
}
