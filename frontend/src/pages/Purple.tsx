import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { purple, type PtAssessmentInput, type PtAssessmentStatus } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Modal, useLoad } from "../components/ui";
import { fmtDate, pct } from "../lib/format";
import { ASSESSMENT_STATUS_LABEL, BluePill, OutcomePill, RedPill } from "../lib/purple";
import { t } from "../i18n";
import { QuickTestDialog, QuickTests } from "./PurpleQuick";

export const EMPTY_ASSESSMENT: PtAssessmentInput = {
  name: "",
  environment: "",
  description: "",
  scope: "",
  summary: "",
  start_date: null,
  end_date: null,
  status: "planned",
};

export function AssessmentStatusPill({ status }: { status: PtAssessmentStatus }) {
  const cls = status === "completed" ? "pill pill-ok" : status === "in_progress" ? "pill pill-warn" : "pill pill-none";
  return <span className={cls}>{ASSESSMENT_STATUS_LABEL[status]}</span>;
}

function NewAssessmentDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const templates = useLoad(() => purple.campaignTemplates());
  const [form, setForm] = useState<PtAssessmentInput>({ ...EMPTY_ASSESSMENT, start_date: new Date().toISOString().slice(0, 10) });
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await purple.createAssessment({ ...form, campaign_template_ids: picked });
      onSaved(a.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={t("New assessment")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            {t("Name")} *
            <input
              className="input"
              required
              value={form.name}
              placeholder={t("e.g. Purple team 2026 H2 – Active Directory")}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field">
            {t("Environment")}
            <input
              className="input"
              value={form.environment}
              placeholder={t("e.g. Production, test lab")}
              onChange={(e) => setForm({ ...form, environment: e.target.value })}
            />
          </label>
          <label className="field">
            {t("Start date")}
            <input
              className="input"
              type="date"
              value={form.start_date ?? ""}
              onChange={(e) => setForm({ ...form, start_date: e.target.value || null })}
            />
          </label>
        </div>
        <label className="field">
          {t("Goal and scope")}
          <textarea
            className="input"
            rows={3}
            value={form.scope}
            placeholder={t("What is tested, against which defenses, and what is out of scope")}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
          />
        </label>
        <fieldset className="stack-sm">
          <legend className="strong-500">{t("Start from campaign templates (optional)")}</legend>
          <ErrorNote error={templates.error} />
          {templates.data && !templates.data.length && (
            <p className="muted small" style={{ margin: 0 }}>
              {t("No campaign templates yet. Create them in the purple team library or import a Threat Simulation Index.")}
            </p>
          )}
          {templates.data?.map((ct) => (
            <label key={ct.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(ct.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, ct.id] : picked.filter((x) => x !== ct.id))}
              />
              {ct.name} <span className="muted small">{t("{n} test procedures", { n: ct.templates.length })}</span>
            </label>
          ))}
        </fieldset>
        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !form.name.trim()}>
            {t("Create assessment")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Queue() {
  const queue = useLoad(() => purple.queue());
  const SIDE: Record<string, string> = {
    red: t("Run (red)"),
    blue: t("Review (blue)"),
    blue_unassigned: t("Needs a blue reviewer"),
  };
  return (
    <section className="card table-card">
      <ErrorNote error={queue.error} />
      {queue.data && !queue.data.length && (
        <p className="muted" style={{ padding: 20, margin: 0 }}>
          {t("Nothing to do: no tests are assigned to you and every executed test has a reviewer.")}
        </p>
      )}
      {!!queue.data?.length && (
        <div className="scroll-x">
          <table className="table cards-sm">
            <thead>
              <tr>
                <th>{t("Task")}</th>
                <th>{t("Test case")}</th>
                <th>{t("Assessment")}</th>
                <th>{t("ATT&CK")}</th>
                <th>{t("Red")}</th>
                <th>{t("Blue")}</th>
                <th>{t("Outcome")}</th>
              </tr>
            </thead>
            <tbody>
              {queue.data.map((r) => (
                <tr key={r.id}>
                  <td data-label={t("Task")}>
                    <span className={r.side === "red" ? "pill pt-red-in_progress" : "pill pt-blue-in_review"}>{SIDE[r.side]}</span>
                  </td>
                  <td data-label={t("Test case")}>
                    <Link to={`/purple/test-cases/${r.id}`}>{r.name}</Link>
                  </td>
                  <td data-label={t("Assessment")}>
                    <Link to={`/purple/assessments/${r.assessment_id}`}>{r.assessment_name}</Link>
                    <div className="small muted">{r.campaign_name}</div>
                  </td>
                  <td data-label={t("ATT&CK")} className="mono small">
                    {r.techniques.join(", ") || "–"}
                  </td>
                  <td data-label={t("Red")}>
                    <RedPill status={r.red_status} />
                  </td>
                  <td data-label={t("Blue")}>
                    <BluePill status={r.blue_status} />
                  </td>
                  <td data-label={t("Outcome")}>
                    <OutcomePill outcome={r.outcome} overridden={r.overridden} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Purple() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "queue" ? "queue" : params.get("tab") === "quick" ? "quick" : "assessments";
  const list = useLoad(() => purple.assessments());
  const [creating, setCreating] = useState(false);
  const [quick, setQuick] = useState(false);
  const [quickSaved, setQuickSaved] = useState<{ id: number; name: string; verified: { rule: string; result: string }[] } | null>(null);
  const [quickReload, setQuickReload] = useState(0);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = (list.data ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.environment.toLowerCase().includes(q));

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Purple teaming")}</h1>
          <div className="subtitle">
            {t(
              "Run attack simulations together with the SOC: the red team executes a test, the blue team records what each defense did and the findings. Results show on the use cases they prove.",
            )}
          </div>
        </div>
        <div className="row-actions">
          <Link className="btn" to="/purple/library">
            {t("Library")}
          </Link>
          <Link className="btn" to="/purple/trends">
            {t("Trends")}
          </Link>
          {editor && (
            <button type="button" className="btn" onClick={() => setQuick(true)}>
              {t("+ Quick test")}
            </button>
          )}
          {editor && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {t("+ Assessment")}
            </button>
          )}
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label={t("Purple teaming")}>
        {(["assessments", "quick", "queue"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={"tab" + (tab === k ? " active" : "")}
            onClick={() => setParams(k === "assessments" ? {} : { tab: k })}
          >
            {k === "queue" ? t("My queue") : k === "quick" ? t("Quick tests") : t("Assessments")}
          </button>
        ))}
      </div>

      {quickSaved && (
        <p className="form-success" role="status">
          {t("Quick test saved:")} <Link to={`/purple/test-cases/${quickSaved.id}`}>{quickSaved.name}</Link>
          {quickSaved.verified.length > 0 &&
            " · " +
              t("Recorded a verification for {rules}.", {
                rules: quickSaved.verified.map((v) => `${v.rule} (${v.result === "ok" ? "OK" : t("issues")})`).join(", "),
              })}
        </p>
      )}

      {tab === "queue" ? (
        <Queue />
      ) : tab === "quick" ? (
        <QuickTests editor={editor} onNew={() => setQuick(true)} reloadKey={quickReload} />
      ) : (
        <>
          <ErrorNote error={list.error} />
          <section className="card uc-filters" aria-label={t("Filter assessments")}>
            <label className="sr-only" htmlFor="pt-q">
              {t("Search by name or environment")}
            </label>
            <input
              id="pt-q"
              className="input input-sm"
              style={{ minWidth: 240 }}
              placeholder={t("Search by name or environment")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </section>
          <section className="card table-card">
            {list.data && !list.data.length && (
              <p className="muted" style={{ padding: 20, margin: 0 }}>
                {t("No assessments yet. Create one, or start from a campaign template in the library.")}
              </p>
            )}
            {rows.length > 0 && (
              <div className="scroll-x">
                <table className="table cards-sm">
                  <thead>
                    <tr>
                      <th>{t("Assessment")}</th>
                      <th>{t("Status")}</th>
                      <th>{t("Period")}</th>
                      <th className="num">{t("Executed")}</th>
                      <th className="num">{t("Defense success")}</th>
                      <th className="num">{t("Visibility")}</th>
                      <th className="num">{t("Not detected")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id}>
                        <td data-label={t("Assessment")}>
                          <Link to={`/purple/assessments/${a.id}`}>
                            {a.name}
                          </Link>
                          {a.environment && <div className="small muted">{a.environment}</div>}
                        </td>
                        <td data-label={t("Status")}>
                          <AssessmentStatusPill status={a.status} />
                        </td>
                        <td data-label={t("Period")} className="small">
                          {fmtDate(a.start_date)}
                          {a.end_date ? ` – ${fmtDate(a.end_date)}` : ""}
                        </td>
                        <td data-label={t("Executed")} className="num">
                          {a.metrics.executed}/{a.metrics.total}
                        </td>
                        <td data-label={t("Defense success")} className="num">
                          {pct(a.metrics.defense_success)}
                        </td>
                        <td data-label={t("Visibility")} className="num">
                          {pct(a.metrics.visibility)}
                        </td>
                        <td data-label={t("Not detected")} className="num">
                          {a.metrics.counts.none ? <span className="badge-gap">{a.metrics.counts.none}</span> : 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="muted small">
            {t("Defense success: share of executed tests with a result that were blocked or alerted. Visibility: share that was at least logged.")}
          </p>
        </>
      )}

      {quick && (
        <QuickTestDialog
          onClose={() => setQuick(false)}
          onSaved={(tc, openEvidence) => {
            setQuick(false);
            if (openEvidence) {
              navigate(`/purple/test-cases/${tc.id}?tab=blue`);
              return;
            }
            setQuickSaved({ id: tc.id, name: tc.name, verified: tc.verified ?? [] });
            setQuickReload((n) => n + 1);
            setParams({ tab: "quick" });
          }}
        />
      )}

      {creating && (
        <NewAssessmentDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(`/purple/assessments/${id}`)} />
      )}
    </>
  );
}
