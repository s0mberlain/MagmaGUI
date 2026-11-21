import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, purple, type PtAssessment, type PtAssessmentInput, type PtCampaign, type PtMetrics } from "../api";
import { useAuth } from "../auth";
import { Markdown, MarkdownField } from "../components/Markdown";
import { AssigneePicker, RunState } from "../components/RunStatus";
import TechniquePicker from "../components/TechniquePicker";
import { confirmDialog, ErrorNote, MenuButton, Modal, useLoad, useUnsavedGuard } from "../components/ui";
import { fmtDate, pct } from "../lib/format";
import { BluePill, fmtDuration, OUTCOME_LABEL, OutcomePill } from "../lib/purple";
import { getLang, t } from "../i18n";
import { AssessmentStatusPill } from "./Purple";

function input(a: PtAssessment): PtAssessmentInput {
  return {
    name: a.name,
    environment: a.environment,
    description: a.description,
    scope: a.scope,
    summary: a.summary,
    start_date: a.start_date,
    end_date: a.end_date,
    status: a.status,
    expected_version: a.version,
  };
}

export function MetricTiles({ m }: { m: PtMetrics }) {
  const tiles = [
    {
      label: t("Executed"),
      value: `${m.executed}/${m.total}`,
      bar: m.total ? m.executed / m.total : 0,
      sub: m.not_executed ? t("{n} not executed", { n: m.not_executed }) : t("tests run by the red team"),
    },
    { label: t("Defense success"), value: pct(m.defense_success), bar: m.defense_success ?? 0, sub: t("blocked or alerted") },
    { label: t("Visibility"), value: pct(m.visibility), bar: m.visibility ?? 0, sub: t("at least logged") },
    {
      label: t("Not detected"),
      value: String(m.counts.none ?? 0),
      bar: m.executed ? (m.counts.none ?? 0) / m.executed : 0,
      sub: t("detection gaps"),
      invert: true,
    },
    { label: t("Mean time to detect"), value: fmtDuration(m.mean_time_to_detect), bar: null, sub: t("attack start to first alert") },
  ];
  return (
    <section className="kpi-grid" aria-label={t("Key figures")}>
      {tiles.map((k) => (
        <div className="card kpi" key={k.label}>
          <span className="kpi-label">{k.label}</span>
          <span className="kpi-value">{k.value}</span>
          {k.bar !== null && (
            <div className="bar">
              <div style={{ width: `${Math.round(k.bar * 100)}%` }} className={k.invert ? "bar-muted" : ""} />
            </div>
          )}
          <span className="kpi-sub">{k.sub}</span>
        </div>
      ))}
    </section>
  );
}

function OutcomeBar({ m }: { m: PtMetrics }) {
  const order = ["blocked", "alerted", "logged_central", "logged_local", "none"] as const;
  const total = order.reduce((n, o) => n + (m.counts[o] ?? 0), 0);
  if (!total) return <span className="muted small">{t("No results yet")}</span>;
  return (
    <span className="pt-stack" title={order.map((o) => `${OUTCOME_LABEL[o]}: ${m.counts[o] ?? 0}`).join(" · ")}>
      {order.map((o) =>
        m.counts[o] ? <i key={o} className={`pt-${o}`} style={{ flexGrow: m.counts[o] }} /> : null,
      )}
    </span>
  );
}

function AssessmentDialog({ a, onClose, onSaved }: { a: PtAssessment; onClose: () => void; onSaved: (a: PtAssessment) => void }) {
  const [form, setForm] = useState(input(a));
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      onSaved(await purple.updateAssessment(a.id, form));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title={t("Edit assessment")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            {t("Name")} *
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            {t("Environment")}
            <input className="input" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} />
          </label>
          <label className="field">
            {t("Status")}
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as PtAssessmentInput["status"] })}
            >
              <option value="planned">{t("Planned")}</option>
              <option value="in_progress">{t("In progress")}</option>
              <option value="completed">{t("Completed")}</option>
            </select>
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
          <label className="field">
            {t("End date")}
            <input
              className="input"
              type="date"
              value={form.end_date ?? ""}
              onChange={(e) => setForm({ ...form, end_date: e.target.value || null })}
            />
          </label>
        </div>
        <MarkdownField label={t("Description")} value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        <MarkdownField label={t("Goal and scope")} value={form.scope} onChange={(v) => setForm({ ...form, scope: v })} />
        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary">
            {t("Save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignDialog({
  a,
  campaign,
  onClose,
  onSaved,
}: {
  a: PtAssessment;
  campaign?: PtCampaign;
  onClose: () => void;
  onSaved: (a: PtAssessment) => void;
}) {
  const templates = useLoad(() => (campaign ? Promise.resolve([]) : purple.campaignTemplates()));
  const [name, setName] = useState(campaign?.name ?? "");
  const [description, setDescription] = useState(campaign?.description ?? "");
  const [fromTemplate, setFromTemplate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      onSaved(
        campaign
          ? await purple.updateCampaign(campaign.id, { name, description })
          : await purple.createCampaign(a.id, { name, description, campaign_template_id: fromTemplate }),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title={campaign ? t("Edit campaign") : t("New campaign")} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!campaign && !!templates.data?.length && (
          <label className="field">
            {t("From campaign template")}
            <select
              className="input"
              value={fromTemplate ?? ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setFromTemplate(id);
                const ct = templates.data?.find((x) => x.id === id);
                if (ct && !name) setName(ct.name);
              }}
            >
              <option value="">{t("Empty campaign")}</option>
              {templates.data.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.name} ({t("{n} test procedures", { n: ct.templates.length })})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          {t("Name")} *
          <input
            className="input"
            required
            value={name}
            placeholder={t("e.g. APT29 emulation, Credential access, Discovery")}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          {t("Description")}
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {campaign ? t("Save") : t("Add campaign")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddTestsDialog({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: PtCampaign;
  onClose: () => void;
  onSaved: (a: PtAssessment, created: number[]) => void;
}) {
  const [mode, setMode] = useState<"library" | "blank">("library");
  const [q, setQ] = useState("");
  const templates = useLoad(() => purple.templates());
  const techniques = useLoad(() => api.attackTechniques());
  const names = useMemo(() => new Map((techniques.data ?? []).map((x) => [x.id, x.name])), [techniques.data]);
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [tech, setTech] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = (templates.data ?? []).filter(
    (x) => !needle || x.name.toLowerCase().includes(needle) || x.techniques.some((id) => id.toLowerCase().startsWith(needle)),
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await purple.createTestCases(
        campaign.id,
        mode === "library" ? { template_ids: picked } : { plan: { name, techniques: tech } },
      );
      onSaved(r.assessment, r.created);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title={t("Add test cases to {name}", { name: campaign.name })} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "library"} className={"tab" + (mode === "library" ? " active" : "")} onClick={() => setMode("library")}>
            {t("From the library")}
          </button>
          <button type="button" role="tab" aria-selected={mode === "blank"} className={"tab" + (mode === "blank" ? " active" : "")} onClick={() => setMode("blank")}>
            {t("New test case")}
          </button>
        </div>
        {mode === "library" ? (
          <>
            <input className="input" placeholder={t("Search by name or technique")} value={q} onChange={(e) => setQ(e.target.value)} />
            <ErrorNote error={templates.error} />
            {templates.data && !templates.data.length && (
              <p className="muted small">
                {t("The library is empty.")} <Link to="/purple/library">{t("Add procedures or import Atomic Red Team tests")}</Link>
              </p>
            )}
            <div className="pt-pick-list">
              {shown.map((x) => (
                <label key={x.id} className="check">
                  <input
                    type="checkbox"
                    checked={picked.includes(x.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id))}
                  />
                  <span className="stack-xs">
                    <span>{x.name}</span>
                    <span className="small muted mono">{x.techniques.join(", ") || "–"}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="field">
              {t("Name")} *
              <input className="input" value={name} required onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Kerberoasting with Rubeus")} />
            </label>
            <TechniquePicker value={tech} names={names} techniques={techniques.data ?? []} onChange={setTech} required={false} />
            <p className="muted small" style={{ margin: 0 }}>
              {t("Command, guidance and the expected defenses can be filled in on the test case.")}
            </p>
          </>
        )}
        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={mode === "library" ? !picked.length : !name.trim()}
          >
            {mode === "library" ? t("Add {n} test cases", { n: picked.length }) : t("Add test case")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Heatmap({ a }: { a: PtAssessment }) {
  if (!a.heatmap_tactics.length)
    return <p className="muted small">{t("The ATT&CK view fills in when tests with techniques are executed.")}</p>;
  return (
    <div className="stack-sm">
      <div className="attack-matrix pt-matrix">
        {a.heatmap_tactics.map((tac) => (
          <div key={tac.id} className="tactic">
            <div className="tactic-head" title={tac.id}>
              <span>{tac.name}</span>
            </div>
            {tac.techniques.map((x) => (
              <span key={x.id} className={`tech pt-${x.outcome}`} title={`${x.id} ${x.name}: ${OUTCOME_LABEL[x.outcome]}`}>
                <span className="tech-name">
                  <span className="mono">{x.id}</span> {x.name}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="legend pt-legend small">
        {(["blocked", "alerted", "logged_central", "logged_local", "none"] as const).map((o) => (
          <span key={o}>
            <i className={`pt-${o}`} /> {OUTCOME_LABEL[o]}
          </span>
        ))}
        <span className="muted">{t("A technique shows its weakest result.")}</span>
      </div>
    </div>
  );
}

export default function PurpleAssessment() {
  const { id = "" } = useParams();
  const aid = Number(id);
  const { can, user } = useAuth();
  const editor = can("admin", "analyst");
  const navigate = useNavigate();
  const load = useLoad(() => purple.assessment(aid), [aid]);
  const a = load.data;
  const [editing, setEditing] = useState(false);
  const [campaignDialog, setCampaignDialog] = useState<PtCampaign | "new" | null>(null);
  const [adding, setAdding] = useState<PtCampaign | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<number[]>([]);

  useEffect(() => {
    if (a) setSummary(a.summary);
  }, [a]);
  const summaryDirty = !!a && summary !== null && summary !== a.summary;
  useUnsavedGuard(summaryDirty);

  if (load.error) return <ErrorNote error={load.error} />;
  if (!a) return <p className="muted">{t("Loading…")}</p>;

  const replace = (next: PtAssessment) => {
    load.setData(next);
    setError(null);
  };

  /** Who works on the red or blue side of a test, saved right away from the table. */
  async function assign(testCaseId: number, side: "red" | "blue", assignee: string) {
    try {
      const tc = await purple.setAssignee(testCaseId, side, assignee);
      load.setData((cur) =>
        cur && {
          ...cur,
          campaign_list: cur.campaign_list.map((c) => ({
            ...c,
            test_cases: c.test_cases.map((x) => (x.id === tc.id ? { ...x, red_assignee: tc.red_assignee, blue_assignee: tc.blue_assignee } : x)),
          })),
        },
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveSummary() {
    if (!a || summary === null) return;
    try {
      replace(await purple.updateAssessment(a.id, { ...input(a), summary }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function rerun() {
    if (!a) return;
    const ok = await confirmDialog(
      t("Start a new assessment with the same campaigns and test procedures? Results start empty; the trends compare both runs."),
      { confirmLabel: t("Re-run") },
    );
    if (!ok) return;
    try {
      const next = await purple.rerun(a.id, { start_date: new Date().toISOString().slice(0, 10) });
      navigate(`/purple/assessments/${next.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!a) return;
    const n = a.metrics.total;
    const ok = await confirmDialog(t("Delete the assessment {name} with its {n} test cases and their evidence?", { name: a.name, n }), {
      danger: true,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    try {
      await purple.deleteAssessment(a.id);
      navigate("/purple");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeCampaign(c: PtCampaign) {
    const ok = await confirmDialog(t("Delete the campaign {name} with its {n} test cases?", { name: c.name, n: c.test_cases.length }), {
      danger: true,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    try {
      await purple.deleteCampaign(c.id);
      void load.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <nav className="crumbs" aria-label={t("Breadcrumb")}>
        <Link to="/purple">{t("Purple team assessments")}</Link> / <span aria-current="page">{a.name}</span>
      </nav>
      <header className="page-header">
        <div>
          <h1>{a.name}</h1>
          <div className="subtitle">
            <AssessmentStatusPill status={a.status} /> {a.environment && <>· {a.environment} </>}
            {a.start_date && (
              <>
                · {fmtDate(a.start_date)}
                {a.end_date ? ` – ${fmtDate(a.end_date)}` : ""}
              </>
            )}
            {a.previous_id && (
              <>
                {" "}
                · {t("re-run of")} <Link to={`/purple/assessments/${a.previous_id}`}>{a.previous_name}</Link>
              </>
            )}
          </div>
        </div>
        <div className="row-actions">
          <MenuButton label={t("Export")}>
            <a role="menuitem" href={purple.reportUrl(a.id, getLang())}>
              {t("PDF report")}
            </a>
            <a role="menuitem" href={purple.navigatorUrl(a.id)}>
              {t("ATT&CK Navigator layer")}
            </a>
            <a role="menuitem" href={purple.csvUrl(a.id)}>
              {t("Test cases as CSV")}
            </a>
          </MenuButton>
          {editor && (
            <>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                {t("Edit")}
              </button>
              <button type="button" className="btn" onClick={() => void rerun()}>
                {t("Re-run")}
              </button>
              <button type="button" className="btn btn-danger sep-left" onClick={() => void remove()}>
                {t("Delete")}
              </button>
            </>
          )}
        </div>
      </header>
      <ErrorNote error={error} />

      <MetricTiles m={a.metrics} />

      <div className="two-col even">
        <section className="card stack-sm" aria-labelledby="pt-scope">
          <h2 id="pt-scope" className="h-sm">
            {t("Goal and scope")}
          </h2>
          {a.scope || a.description ? (
            <>
              {a.description && <Markdown text={a.description} />}
              {a.scope && <Markdown text={a.scope} />}
            </>
          ) : (
            <p className="muted small">{t("No scope described yet.")}</p>
          )}
        </section>
        <section className="card stack-sm" aria-labelledby="pt-sum">
          <h2 id="pt-sum" className="h-sm">
            {t("Summary and findings")}
          </h2>
          <MarkdownField
            label={t("Overall conclusions, key findings and recommendations")}
            value={summary ?? ""}
            onChange={setSummary}
            readOnly={!editor}
            rows={5}
          />
          {editor && summaryDirty && (
            <div className="row-actions">
              <button type="button" className="btn btn-sm" onClick={() => setSummary(a.summary)}>
                {t("Discard")}
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveSummary()}>
                {t("Save summary")}
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="section-head">
        <h2>{t("Campaigns")}</h2>
        {editor && (
          <button type="button" className="btn btn-sm" onClick={() => setCampaignDialog("new")}>
            {t("+ Campaign")}
          </button>
        )}
      </div>
      {!a.campaign_list.length && (
        <p className="muted">{t("No campaigns yet. A campaign groups test cases, e.g. by adversary or kill chain phase.")}</p>
      )}
      {a.campaign_list.map((c) => {
        const open = !collapsed.includes(c.id);
        return (
          <section key={c.id} className="card table-card" aria-label={c.name}>
            <div className="section-head pt-campaign-head">
              <button
                type="button"
                className="link-btn strong-500"
                aria-expanded={open}
                onClick={() => setCollapsed(open ? [...collapsed, c.id] : collapsed.filter((x) => x !== c.id))}
              >
                {open ? "▾" : "▸"} {c.name}
              </button>
              <span className="small muted">
                {t("{done} of {n} executed", { done: c.metrics.executed, n: c.metrics.total })} · {t("Defense success")}{" "}
                {pct(c.metrics.defense_success)}
              </span>
              <OutcomeBar m={c.metrics} />
              <span className="grow" />
              {editor && (
                <>
                  <button type="button" className="btn btn-sm" onClick={() => setAdding(c)}>
                    {t("+ Test cases")}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setCampaignDialog(c)}>
                    {t("Edit")}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void removeCampaign(c)}>
                    {t("Delete")}
                  </button>
                </>
              )}
            </div>
            {open && c.description && <p className="muted small" style={{ margin: "0 22px 8px" }}>{c.description}</p>}
            {open &&
              (c.test_cases.length ? (
                <div className="scroll-x">
                  <table className="table cards-sm">
                    <thead>
                      <tr>
                        <th>{t("Test case")}</th>
                        <th>{t("ATT&CK")}</th>
                        <th>{t("Red")}</th>
                        <th>{t("Blue")}</th>
                        <th>{t("Outcome")}</th>
                        <th>{t("Findings")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.test_cases.map((tc) => (
                        <tr key={tc.id}>
                          <td data-label={t("Test case")}>
                            <Link to={`/purple/test-cases/${tc.id}`}>{tc.name}</Link>
                            {tc.tags.length > 0 && <div className="small muted">{tc.tags.join(", ")}</div>}
                          </td>
                          <td data-label={t("ATT&CK")} className="mono small">
                            {tc.techniques.join(", ") || "–"}
                          </td>
                          <td data-label={t("Red")}>
                            <div className="pt-cell-stack">
                              <RunState status={tc.red_status} start={tc.attack_start} stop={tc.attack_stop ?? null} size="sm" />
                              {editor ? (
                                <AssigneePicker
                                  compact
                                  quiet
                                  label={t("Red team operator of {test}", { test: tc.name })}
                                  value={tc.red_assignee}
                                  me={user?.username}
                                  onChange={(v) => void assign(tc.id, "red", v)}
                                />
                              ) : (
                                tc.red_assignee && <div className="small muted">{tc.red_assignee}</div>
                              )}
                            </div>
                          </td>
                          <td data-label={t("Blue")}>
                            <div className="pt-cell-stack">
                              <BluePill status={tc.blue_status} />
                              {editor ? (
                                <AssigneePicker
                                  compact
                                  quiet
                                  label={t("Blue team analyst of {test}", { test: tc.name })}
                                  value={tc.blue_assignee}
                                  me={user?.username}
                                  onChange={(v) => void assign(tc.id, "blue", v)}
                                />
                              ) : (
                                tc.blue_assignee && <div className="small muted">{tc.blue_assignee}</div>
                              )}
                            </div>
                          </td>
                          <td data-label={t("Outcome")}>
                            <OutcomePill outcome={tc.outcome} overridden={tc.overridden} />
                          </td>
                          <td data-label={t("Findings")}>{tc.has_findings ? <span className="pill pill-warn">{t("Noted")}</span> : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted small" style={{ margin: "0 22px 16px" }}>
                  {t("No test cases in this campaign.")}
                </p>
              ))}
          </section>
        );
      })}

      <section className="card stack-sm" aria-labelledby="pt-heat">
        <h2 id="pt-heat" className="h-sm">
          {t("ATT&CK results")}
        </h2>
        <Heatmap a={a} />
      </section>

      {editing && (
        <AssessmentDialog
          a={a}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            replace(next);
            setEditing(false);
          }}
        />
      )}
      {campaignDialog && (
        <CampaignDialog
          a={a}
          campaign={campaignDialog === "new" ? undefined : campaignDialog}
          onClose={() => setCampaignDialog(null)}
          onSaved={(next) => {
            replace(next);
            setCampaignDialog(null);
          }}
        />
      )}
      {adding && (
        <AddTestsDialog
          campaign={adding}
          onClose={() => setAdding(null)}
          onSaved={(next, created) => {
            replace(next);
            setAdding(null);
            if (created.length === 1) navigate(`/purple/test-cases/${created[0]}`);
          }}
        />
      )}
    </>
  );
}
