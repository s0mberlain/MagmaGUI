import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  ApiError,
  type Campaign,
  type CampaignTest,
  type ExecStatus,
  type L2,
  type L3,
  type Proposals,
  type TestIn,
  type TestOutcome,
  type TestPatch,
  type TestTemplate,
} from "../api";
import { useAuth } from "../auth";
import { Chips, confirmDialog, ErrorNote, Modal, StatusPill, useLoad } from "../components/ui";
import { fmtDate, fmtTime } from "../lib/format";
import {
  CAMPAIGN_STATUS_LABEL,
  campaignClass,
  EXEC_LABEL,
  EXEC_STATES,
  fmtTtd,
  fromLocalInput,
  nowLocalInput,
  OUTCOME_LABEL,
  outcomeClass,
  OUTCOMES,
  toLocalInput,
} from "../lib/purple";
import { translateServer } from "../serverTexts";
import { CampaignDialog, OutcomeBar } from "./Campaigns";
import { t } from "../i18n";

type Techniques = { id: string; name: string }[];

export default function CampaignDetail() {
  const id = Number(useParams().id);
  const { can, user } = useAuth();
  const editor = can("admin", "analyst");
  const red = user?.role === "red_team";
  const camp = useLoad(() => api.campaign(id), [id]);
  const techniques = useLoad<Techniques>(() => api.campaignTechniques());
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [warnings, setWarnings] = useState<string[]>(
    ((location.state as { warnings?: string[] } | null)?.warnings ?? []).map(translateServer),
  );
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [incomplete, setIncomplete] = useState<{ id: number; title: string; technique: string; reason: string }[] | null>(
    null,
  );
  const [filter, setFilter] = useState({ q: "", technique: "", exec: "", outcome: "" });

  const c = camp.data;
  const openTestId = Number(params.get("test")) || null;
  const openTest = c?.tests?.find((x) => x.id === openTestId) ?? null;
  const setOpenTest = (tid: number | null) =>
    setParams(
      (p) => {
        if (tid) p.set("test", String(tid));
        else p.delete("test");
        return p;
      },
      { replace: true },
    );

  const tests = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return (c?.tests ?? []).filter(
      (x) =>
        (!q ||
          `${x.title} ${x.technique} ${x.technique_name ?? ""} ${(x.rules ?? []).map((r) => r.code).join(" ")}`
            .toLowerCase()
            .includes(q)) &&
        (!filter.technique || x.technique === filter.technique) &&
        (!filter.exec || x.exec_status === filter.exec) &&
        (!filter.outcome || (filter.outcome === "none" ? !x.outcome : x.outcome === filter.outcome)),
    );
  }, [c, filter]);
  const techOptions = useMemo(() => [...new Set((c?.tests ?? []).map((x) => x.technique))].sort(), [c]);

  if (camp.error) return <ErrorNote error={camp.error} />;
  if (!c) return null;

  const closed = c.status === "closed";
  const running = c.status === "running";
  const resultsVisible = !red || closed;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await camp.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed"));
    }
  }

  async function changeStatus(action: "start" | "close" | "reopen") {
    const question = {
      start: t("Start the campaign? The red team can then record its tests and analysts the outcomes."),
      close: t("Close the campaign? All tests become read-only and the red team sees the outcomes."),
      reopen: t("Reopen the campaign? Tests can be changed again."),
    }[action];
    if (!(await confirmDialog(question, { confirmLabel: t("Continue") }))) return;
    setError(null);
    try {
      camp.setData(await api.campaignStatus(c!.id, action));
      setIncomplete(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data && typeof e.data === "object" && "incomplete" in e.data) {
        setIncomplete((e.data as { incomplete: typeof incomplete }).incomplete);
        return;
      }
      setError((e as Error).message);
    }
  }

  async function remove() {
    const ok = await confirmDialog(
      t("Delete the campaign {name} with its {n} tests? Verifications already written stay. This cannot be undone.", {
        name: c!.name,
        n: c!.test_count,
      }),
      { title: t("Delete campaign"), confirmLabel: t("Delete"), danger: true },
    );
    if (!ok) return;
    try {
      await api.deleteCampaign(c!.id);
      navigate("/campaigns");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const canDelete = can("admin") && (c.status === "planned" || !c.tests?.some((x) => x.outcome));

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Link to="/campaigns" className="small">
            ← {t("Campaigns")}
          </Link>
          <h1>
            {c.name}{" "}
            <span className={campaignClass(c.status)} style={{ verticalAlign: "middle" }}>
              {CAMPAIGN_STATUS_LABEL[c.status]}
            </span>
            {c.white_box && (
              <span className="chip chip-info" style={{ marginLeft: 8, verticalAlign: "middle" }}>
                {t("White box")}
              </span>
            )}
          </h1>
          <div className="subtitle">
            {t("Planned {start} – {end}", { start: fmtDate(c.planned_start), end: fmtDate(c.planned_end) })}
            {c.red_team.length > 0 &&
              ` · ${t("Red team")}: ${c.red_team.map((u) => u.display_name || u.username).join(", ")}`}
            {closed && c.closed_at && ` · ${t("closed {time}", { time: fmtTime(c.closed_at) })}`}
          </div>
        </div>
        <div className="row-actions">
          {editor && !closed && (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              {t("Edit")}
            </button>
          )}
          {editor && c.status === "planned" && (
            <button type="button" className="btn btn-primary" onClick={() => void changeStatus("start")}>
              {t("Start campaign")}
            </button>
          )}
          {editor && running && (
            <button type="button" className="btn btn-dark" onClick={() => void changeStatus("close")}>
              {t("Close campaign")}
            </button>
          )}
          {editor && closed && (
            <button type="button" className="btn" onClick={() => void changeStatus("reopen")}>
              {t("Reopen")}
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn-danger" onClick={() => void remove()}>
              {t("Delete")}
            </button>
          )}
        </div>
      </header>

      {c.description && <p className="pre-text ink-2">{c.description}</p>}
      <ErrorNote error={error} />
      {warnings.map((w) => (
        <p key={w} className="form-error" role="status">
          {w}
        </p>
      ))}
      {red && !resultsVisible && (
        <div className="note-box small">
          {t("Outcomes and detection times are shown to you once the campaign is closed.")}
          {c.white_box && " " + t("This is a white box campaign: each test shows the linked rules.")}
        </div>
      )}
      {red && c.status === "planned" && (
        <div className="note-box small">{t("The campaign has not started yet. You can record your tests once it is running.")}</div>
      )}

      <section className="card">
        <dl className="stat-grid">
          <div>
            <dt>{t("Tests")}</dt>
            <dd>{c.test_count}</dd>
          </div>
          <div>
            <dt>{t("Executed")}</dt>
            <dd>{c.exec_counts.executed}</dd>
          </div>
          <div>
            <dt>{t("Could not execute")}</dt>
            <dd>{c.exec_counts.not_executed}</dd>
          </div>
          <div>
            <dt>{t("Not run")}</dt>
            <dd>{c.exec_counts.not_run}</dd>
          </div>
          {c.outcome_counts && (
            <div>
              <dt>{t("Detected (blocked or alerted)")}</dt>
              <dd>{c.outcome_counts.blocked + c.outcome_counts.alerted}</dd>
            </div>
          )}
          {c.outcome_counts && (
            <div>
              <dt>{t("Median time to detect")}</dt>
              <dd>{fmtTtd(c.median_ttd_seconds)}</dd>
            </div>
          )}
        </dl>
        {c.outcome_counts && c.test_count > 0 && (
          <div style={{ marginTop: 14 }}>
            <OutcomeBar counts={c.outcome_counts} total={c.test_count} />
          </div>
        )}
      </section>

      {incomplete && (
        <section className="card stack-sm" role="alert">
          <h2>{t("The campaign cannot be closed yet")}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {t("Every test needs an execution status and every executed test an outcome. Incomplete tests:")}
          </p>
          <ul className="stack-xs" style={{ margin: 0 }}>
            {incomplete.map((x) => (
              <li key={x.id}>
                <button type="button" className="link-btn" onClick={() => setOpenTest(x.id)}>
                  {x.title}
                </button>{" "}
                <span className="mono small">{x.technique}</span> ·{" "}
                {x.reason === "not_run" ? t("not run yet") : t("no outcome")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card stack" aria-labelledby="tests-h">
        <div className="section-head">
          <h2 id="tests-h">{t("Tests")}</h2>
          <div className="row-actions">
            {editor && !closed && (
              <button type="button" className="btn btn-primary" onClick={() => setProposing(true)}>
                {t("Add from use cases")}
              </button>
            )}
            {((editor && !closed) || (red && running)) && (
              <button type="button" className="btn" onClick={() => setAdding(true)}>
                {t("Add test")}
              </button>
            )}
          </div>
        </div>
        {!!c.tests?.length && (
          <div className="filters">
            <input
              className="input input-sm"
              type="search"
              placeholder={t("Search tests…")}
              aria-label={t("Search tests")}
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            />
            <select
              className="input input-sm"
              aria-label={t("Technique")}
              value={filter.technique}
              onChange={(e) => setFilter({ ...filter, technique: e.target.value })}
            >
              <option value="">{t("All techniques")}</option>
              {techOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <select
              className="input input-sm"
              aria-label={t("Execution status")}
              value={filter.exec}
              onChange={(e) => setFilter({ ...filter, exec: e.target.value })}
            >
              <option value="">{t("Any execution status")}</option>
              {EXEC_STATES.map((x) => (
                <option key={x} value={x}>
                  {EXEC_LABEL[x]}
                </option>
              ))}
            </select>
            {resultsVisible && (
              <select
                className="input input-sm"
                aria-label={t("Outcome")}
                value={filter.outcome}
                onChange={(e) => setFilter({ ...filter, outcome: e.target.value })}
              >
                <option value="">{t("Any outcome")}</option>
                <option value="none">{t("No outcome")}</option>
                {OUTCOMES.map((x) => (
                  <option key={x} value={x}>
                    {OUTCOME_LABEL[x]}
                  </option>
                ))}
              </select>
            )}
            <span className="small muted">{t("{n} of {total} tests", { n: tests.length, total: c.test_count })}</span>
          </div>
        )}
        {!c.tests?.length && (
          <p className="muted small" style={{ margin: 0 }}>
            {editor
              ? t("No tests yet. Add them from use cases (one per ATT&CK technique of their rules) or by hand.")
              : t("No tests yet.")}
          </p>
        )}
        {!!tests.length && (
          <div className="table-card" style={{ margin: "0 -18px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Test")}</th>
                  {!red && <th>{t("Rules")}</th>}
                  <th>{t("Execution")}</th>
                  <th>{t("Executed at")}</th>
                  {resultsVisible && <th>{t("Outcome")}</th>}
                  {resultsVisible && <th className="num">{t("TTD")}</th>}
                </tr>
              </thead>
              <tbody>
                {tests.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <button type="button" className="link-btn strong-500" onClick={() => setOpenTest(x.id)}>
                        {x.title}
                      </button>
                      <div className="small muted">
                        <span className="mono">{x.technique}</span> {x.technique_name}
                      </div>
                    </td>
                    {!red && (
                      <td>
                        {x.rules?.length ? (
                          <Chips items={x.rules.map((r) => r.code)} href={(code) => `/usecases/l3/${encodeURIComponent(code)}`} />
                        ) : (
                          <span className="badge-gap">{t("No rule linked")}</span>
                        )}
                      </td>
                    )}
                    <td>
                      <span className={x.exec_status === "executed" ? "pill pill-info" : x.exec_status === "not_executed" ? "pill pill-warn" : "pill"}>
                        {EXEC_LABEL[x.exec_status]}
                      </span>
                    </td>
                    <td>{x.executed_at ? fmtTime(x.executed_at) : "–"}</td>
                    {resultsVisible && (
                      <td>{x.outcome ? <span className={outcomeClass(x.outcome)}>{OUTCOME_LABEL[x.outcome]}</span> : "–"}</td>
                    )}
                    {resultsVisible && <td className="num">{fmtTtd(x.ttd_seconds)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <CampaignDialog
          campaign={c}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            camp.setData(saved);
            setWarnings((saved.warnings ?? []).map(translateServer));
          }}
        />
      )}
      {proposing && (
        <ProposeDialog campaign={c} onClose={() => setProposing(false)} onSaved={(saved) => camp.setData(saved)} />
      )}
      {adding && (
        <AddTestDialog
          campaign={c}
          techniques={techniques.data ?? []}
          red={red}
          onClose={() => setAdding(false)}
          onSaved={() => void camp.reload()}
        />
      )}
      {openTest && (
        <TestDialog
          key={openTest.id + ":" + openTest.version}
          test={openTest}
          campaign={c}
          techniques={techniques.data ?? []}
          onClose={() => setOpenTest(null)}
          onChanged={() => run(async () => undefined)}
          onConflict={setError}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- rule picker

function useRules() {
  return useLoad<L3[]>(() => api.l3s());
}

/** Searchable list of L3 rules with checkboxes. */
function RulePicker({
  rules,
  value,
  onChange,
  label = t("Linked rules"),
}: {
  rules: L3[];
  value: number[];
  onChange: (v: number[]) => void;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const chosen = rules.filter((r) => value.includes(r.id));
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rules.filter((r) => `${r.code} ${r.name} ${r.attack_techniques.join(" ")}`.toLowerCase().includes(needle)).slice(0, 60)
    : [];
  return (
    <div className="field">
      <span>{label}</span>
      {chosen.length ? (
        <div className="chips">
          {chosen.map((r) => (
            <span key={r.id} className="chip chip-info">
              {r.code}{" "}
              <button
                type="button"
                className="icon-btn"
                style={{ height: 16, width: 16, fontSize: 12 }}
                aria-label={t("Remove {code}", { code: r.code })}
                onClick={() => onChange(value.filter((x) => x !== r.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <span className="small muted">{t("No rule linked")}</span>
      )}
      <input
        className="input input-sm"
        type="search"
        placeholder={t("Search rules by ID, name or technique…")}
        aria-label={t("Search rules")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!!shown.length && (
        <div className="multi-list" style={{ maxHeight: 220, overflow: "auto", position: "static" }}>
          {shown.map((r) => (
            <label key={r.id} className="check-row">
              <input
                type="checkbox"
                checked={value.includes(r.id)}
                onChange={() => onChange(value.includes(r.id) ? value.filter((x) => x !== r.id) : [...value, r.id])}
              />
              <span>
                <span className="mono">{r.code}</span> {r.name}
                {r.lifecycle_status === "retired" && (
                  <>
                    {" "}
                    <StatusPill status="retired" />
                  </>
                )}
                {!!r.attack_techniques.length && <span className="small muted"> · {r.attack_techniques.join(", ")}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function TechniqueInput({
  techniques,
  value,
  onChange,
  id,
}: {
  techniques: Techniques;
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  const name = techniques.find((x) => x.id === value)?.name;
  return (
    <label className="field">
      {t("ATT&CK technique")}
      <input
        className="input mono"
        required
        list={id}
        pattern="T\d{4}(\.\d{3})?"
        placeholder="T1059.001"
        value={value}
        onChange={(e) => onChange(e.target.value.trim().toUpperCase())}
      />
      <datalist id={id}>
        {techniques.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </datalist>
      <span className="small muted">{name ?? (value ? t("Unknown technique") : " ")}</span>
    </label>
  );
}

// ---------------------------------------------------------------- add a test by hand

function AddTestDialog({
  campaign,
  techniques,
  red,
  onClose,
  onSaved,
}: {
  campaign: Campaign;
  techniques: Techniques;
  red: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const library = useLoad<TestTemplate[]>(() => (red ? Promise.resolve([]) : api.testLibrary()));
  const rules = useLoad<L3[]>(() => (red ? Promise.resolve([]) : api.l3s()));
  const [form, setForm] = useState<TestIn>({ title: "", technique: "", procedure: "", tools: "", rule_ids: [], template_id: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function fromTemplate(tid: string) {
    const tpl = library.data?.find((x) => String(x.id) === tid);
    if (!tpl) {
      setForm({ ...form, template_id: null });
      return;
    }
    setForm({ ...form, template_id: tpl.id, title: tpl.title, technique: tpl.technique, procedure: tpl.procedure, tools: tpl.tools });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTest(campaign.id, red ? { ...form, rule_ids: [], template_id: null } : form);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Add test")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        {!red && !!library.data?.length && (
          <label className="field">
            {t("From the test library")}
            <select className="input" value={form.template_id ?? ""} onChange={(e) => fromTemplate(e.target.value)}>
              <option value="">{t("None, enter by hand")}</option>
              {library.data.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.technique} · {x.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-grid two">
          <label className="field">
            {t("Title")}
            <input className="input" required maxLength={255} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <TechniqueInput id="add-tech" techniques={techniques} value={form.technique} onChange={(v) => setForm({ ...form, technique: v })} />
        </div>
        <label className="field">
          {t("Procedure")}
          <textarea
            className="input textarea mono"
            rows={5}
            maxLength={10000}
            value={form.procedure}
            onChange={(e) => setForm({ ...form, procedure: e.target.value })}
          />
        </label>
        <label className="field">
          {t("Tools")}
          <input className="input" maxLength={10000} value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} />
        </label>
        {!red && rules.data && (
          <RulePicker rules={rules.data} value={form.rule_ids ?? []} onChange={(v) => setForm({ ...form, rule_ids: v })} />
        )}
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("Saving…") : t("Add test")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- one test

function TestDialog({
  test,
  campaign,
  techniques,
  onClose,
  onChanged,
  onConflict,
}: {
  test: CampaignTest;
  campaign: Campaign;
  techniques: Techniques;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onConflict: (message: string) => void;
}) {
  const { can, user } = useAuth();
  const editor = can("admin", "analyst");
  const red = user?.role === "red_team";
  const closed = campaign.status === "closed";
  const running = campaign.status === "running";
  const canDefine = editor && !closed;
  const canRed = running && (editor || red);
  const canBlue = running && editor;
  const rules = useLoad<L3[]>(() => (canDefine ? api.l3s() : Promise.resolve([])));

  const [def, setDef] = useState({
    title: test.title,
    technique: test.technique,
    procedure: test.procedure,
    tools: test.tools,
    rule_ids: (test.rules ?? []).map((r) => r.id),
  });
  const [redF, setRedF] = useState({
    exec_status: test.exec_status,
    executed_at: toLocalInput(test.executed_at),
    red_notes: test.red_notes,
  });
  const [blue, setBlue] = useState({
    outcome: (test.outcome ?? "") as TestOutcome | "",
    detected_at: toLocalInput(test.detected_at),
    blue_notes: test.blue_notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsDetect = blue.outcome === "blocked" || blue.outcome === "alerted";
  const noDetect = blue.outcome === "not_detected" || blue.outcome === "";

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: TestPatch = { version: test.version };
    if (canDefine) {
      if (def.title !== test.title) body.title = def.title;
      if (def.technique !== test.technique) body.technique = def.technique;
      if (def.procedure !== test.procedure) body.procedure = def.procedure;
      if (def.tools !== test.tools) body.tools = def.tools;
      const old = (test.rules ?? []).map((r) => r.id).sort().join();
      if ([...def.rule_ids].sort().join() !== old) body.rule_ids = def.rule_ids;
    }
    if (canRed) {
      if (redF.exec_status !== test.exec_status) body.exec_status = redF.exec_status;
      const ex = fromLocalInput(redF.executed_at);
      if (toLocalInput(ex) !== toLocalInput(test.executed_at)) body.executed_at = ex;
      if (redF.red_notes !== test.red_notes) body.red_notes = redF.red_notes;
    }
    if (canBlue) {
      const outcome = blue.outcome || null;
      if (outcome !== (test.outcome ?? null)) body.outcome = outcome;
      const det = noDetect && blue.outcome !== "" ? null : fromLocalInput(blue.detected_at);
      if (toLocalInput(det) !== toLocalInput(test.detected_at)) body.detected_at = det;
      if (blue.blue_notes !== (test.blue_notes ?? "")) body.blue_notes = blue.blue_notes;
    }
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateTest(test.id, body);
      await onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // someone else saved in between: show their version, keep the message on the page
        await onChanged();
        onConflict((err as Error).message);
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog(t("Delete the test {title}?", { title: test.title }), {
      danger: true,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    try {
      await api.deleteTest(test.id);
      await onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toLibrary() {
    try {
      await api.testToLibrary(test.id);
      setNotice(t("Saved to the test library."));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={test.title} open onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <ErrorNote error={error} />
        {notice && (
          <p className="form-notice" role="status">
            {notice}
          </p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          {t("Added by {user} on {date}", { user: test.created_by, date: fmtDate(test.created_at) })}
        </p>

        {/* definition */}
        {canDefine ? (
          <>
            <div className="form-grid two">
              <label className="field">
                {t("Title")}
                <input className="input" required maxLength={255} value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} />
              </label>
              <TechniqueInput id="test-tech" techniques={techniques} value={def.technique} onChange={(v) => setDef({ ...def, technique: v })} />
            </div>
            <label className="field">
              {t("Procedure")}
              <textarea
                className="input textarea mono"
                rows={5}
                maxLength={10000}
                value={def.procedure}
                onChange={(e) => setDef({ ...def, procedure: e.target.value })}
              />
            </label>
            <label className="field">
              {t("Tools")}
              <input className="input" maxLength={10000} value={def.tools} onChange={(e) => setDef({ ...def, tools: e.target.value })} />
            </label>
            {rules.data && <RulePicker rules={rules.data} value={def.rule_ids} onChange={(v) => setDef({ ...def, rule_ids: v })} />}
            {(test.rules ?? []).some((r) => r.lifecycle_status === "retired") && (
              <p className="small muted" style={{ margin: 0 }}>
                {t("Retired rules stay linked; outcomes are still recorded as their verification.")}
              </p>
            )}
          </>
        ) : (
          <div className="stack-sm">
            <div>
              <span className="mono">{test.technique}</span> {test.technique_name}
            </div>
            {test.procedure && <pre className="pre-code">{test.procedure}</pre>}
            {test.tools && (
              <div className="small">
                <span className="muted">{t("Tools")}:</span> {test.tools}
              </div>
            )}
            {test.rules && (
              <div className="field">
                <span>{t("Linked rules")}</span>
                {test.rules.length ? (
                  <ul className="stack-xs" style={{ margin: 0, paddingLeft: 18 }}>
                    {test.rules.map((r) => (
                      <li key={r.id}>
                        <Link to={`/usecases/l3/${encodeURIComponent(r.code)}`} className="mono">
                          {r.code}
                        </Link>{" "}
                        {r.name} {r.lifecycle_status === "retired" && <StatusPill status="retired" />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="badge-gap" style={{ alignSelf: "flex-start" }}>
                    {t("No rule linked")}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* white box: the use case definitions (red team) */}
        {test.white_box_rules && (
          <div className="test-section stack-sm">
            <h3>{t("Linked use cases (white box)")}</h3>
            {!test.white_box_rules.length && <p className="small muted">{t("No rule linked")}</p>}
            {test.white_box_rules.map((r) => (
              <div key={r.code} className="whitebox stack-xs">
                <strong>
                  <span className="mono">{r.code}</span> {r.name}
                </strong>
                <span className="small muted">
                  {r.l2_code} · {r.l2_name}
                </span>
                {r.description && <p className="pre-text">{r.description}</p>}
                <span className="small">
                  <span className="muted">{t("Log sources")}:</span> {r.log_sources.join(", ") || "–"}
                </span>
                <span className="small">
                  <span className="muted">{t("Detection technologies")}:</span> {r.detection_technologies.join(", ") || "–"}
                </span>
                <span className="small">
                  <span className="muted">{t("ATT&CK techniques")}:</span> {r.attack_techniques.join(", ") || "–"}
                </span>
                <span className="small muted">{t("Current configuration")}</span>
                {r.config ? <pre className="pre-code">{r.config}</pre> : <span className="small muted">–</span>}
              </div>
            ))}
          </div>
        )}

        {/* red team */}
        <div className="test-section stack-sm">
          <h3>{t("Red team")}</h3>
          <div className="form-grid two">
            <label className="field">
              {t("Execution status")}
              <select
                className="input"
                disabled={!canRed}
                value={redF.exec_status}
                onChange={(e) => {
                  const v = e.target.value as ExecStatus;
                  setRedF({ ...redF, exec_status: v, executed_at: v === "executed" && !redF.executed_at ? nowLocalInput() : redF.executed_at });
                }}
              >
                {EXEC_STATES.map((x) => (
                  <option key={x} value={x}>
                    {EXEC_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("Executed at")}
              <input
                className="input"
                type="datetime-local"
                disabled={!canRed}
                value={redF.executed_at}
                onChange={(e) => setRedF({ ...redF, executed_at: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            {t("Red team notes")}
            <textarea
              className="input textarea"
              rows={3}
              maxLength={10000}
              disabled={!canRed}
              value={redF.red_notes}
              onChange={(e) => setRedF({ ...redF, red_notes: e.target.value })}
            />
          </label>
        </div>

        {/* blue team */}
        {(test.outcome !== undefined || test.blue_notes !== undefined) && (
          <div className="test-section stack-sm">
            <h3>{t("Blue team")}</h3>
            <div className="form-grid two">
              <label className="field">
                {t("Outcome")}
                <select
                  className="input"
                  disabled={!canBlue || redF.exec_status === "not_executed"}
                  value={blue.outcome}
                  onChange={(e) => {
                    const v = e.target.value as TestOutcome | "";
                    setBlue({
                      ...blue,
                      outcome: v,
                      detected_at: v === "not_detected" || v === "" ? "" : blue.detected_at || nowLocalInput(),
                    });
                  }}
                >
                  <option value="">{t("No outcome yet")}</option>
                  {OUTCOMES.map((x) => (
                    <option key={x} value={x}>
                      {OUTCOME_LABEL[x]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {needsDetect ? t("Detected at (required)") : t("Detected at")}
                <input
                  className="input"
                  type="datetime-local"
                  disabled={!canBlue || noDetect}
                  required={needsDetect}
                  min={redF.executed_at || undefined}
                  value={noDetect ? "" : blue.detected_at}
                  onChange={(e) => setBlue({ ...blue, detected_at: e.target.value })}
                />
              </label>
            </div>
            {test.ttd_seconds !== undefined && (
              <p className="small" style={{ margin: 0 }}>
                <span className="muted">{t("Time to detect")}:</span> {fmtTtd(test.ttd_seconds)}
                {test.outcome_by && <span className="muted"> · {t("outcome by {user}", { user: test.outcome_by })}</span>}
              </p>
            )}
            {test.blue_notes !== undefined && (
              <label className="field">
                {t("Blue team notes")}
                <textarea
                  className="input textarea"
                  rows={3}
                  maxLength={10000}
                  disabled={!canBlue}
                  value={blue.blue_notes}
                  onChange={(e) => setBlue({ ...blue, blue_notes: e.target.value })}
                />
              </label>
            )}
            {canBlue && (
              <p className="small muted" style={{ margin: 0 }}>
                {t("Saving an outcome adds a verification to each linked rule: OK for Blocked and Alerted, Issues found for Logged and Not detected.")}
              </p>
            )}
          </div>
        )}

        <div className="row-actions" style={{ justifyContent: "space-between" }}>
          <span className="row-actions">
            {editor && (
              <button type="button" className="btn btn-sm" onClick={() => void toLibrary()}>
                {t("Save to library")}
              </button>
            )}
            {editor && !closed && !test.outcome && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
                {t("Delete")}
              </button>
            )}
          </span>
          <span className="row-actions">
            <button type="button" className="btn" onClick={onClose}>
              {canDefine || canRed || canBlue ? t("Cancel") : t("Close")}
            </button>
            {(canDefine || canRed || canBlue) && (
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t("Saving…") : t("Save")}
              </button>
            )}
          </span>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- proposals from use cases

interface Draft {
  key: string;
  technique: string;
  technique_name: string | null;
  replaces: string[];
  selected: boolean;
  title: string;
  procedure: string;
  tools: string;
  template_id: number | null;
  rule_ids: number[];
  rule_codes: string[];
  templates: { id: number; title: string; procedure: string; tools: string }[];
  existing: { id: number; title: string; rule_ids: number[] }[];
  /** add the rules to this existing test instead of creating a new one */
  add_to: number | null;
}

function ProposeDialog({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: Campaign;
  onClose: () => void;
  onSaved: (c: Campaign) => void;
}) {
  const l2s = useLoad<L2[]>(() => api.l2s());
  const rules = useRules();
  const [l2Ids, setL2Ids] = useState<number[]>([]);
  const [l3Ids, setL3Ids] = useState<number[]>([]);
  const [l2q, setL2q] = useState("");
  const [result, setResult] = useState<Proposals | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setResult(null), [l2Ids, l3Ids]);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.proposeTests(campaign.id, { l2_ids: l2Ids, l3_ids: l3Ids });
      setResult(r);
      setDrafts(
        r.proposals.map((p) => {
          const tpl = p.templates[0];
          return {
            key: p.technique,
            technique: p.technique,
            technique_name: p.technique_name,
            replaces: p.replaces,
            selected: !p.existing_tests.length,
            title: tpl?.title ?? p.technique_name ?? p.technique,
            procedure: tpl?.procedure ?? "",
            tools: tpl?.tools ?? "",
            template_id: tpl?.id ?? null,
            rule_ids: p.rules.map((x) => x.id),
            rule_codes: p.rules.map((x) => x.code),
            templates: p.templates,
            existing: p.existing_tests,
            add_to: null,
          };
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const upd = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  function pickTemplate(d: Draft, v: string) {
    const tpl = d.templates.find((x) => String(x.id) === v);
    upd(d.key, tpl ? { template_id: tpl.id, title: tpl.title, procedure: tpl.procedure, tools: tpl.tools } : { template_id: null });
  }

  const chosen = drafts.filter((d) => d.selected || d.add_to);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.createTests(campaign.id, {
        tests: drafts
          .filter((d) => d.selected && !d.add_to)
          .map((d) => ({
            title: d.title,
            technique: d.technique,
            procedure: d.procedure,
            tools: d.tools,
            rule_ids: d.rule_ids,
            template_id: d.template_id,
          })),
        add_rules: drafts.filter((d) => d.add_to).map((d) => ({ test_id: d.add_to!, rule_ids: d.rule_ids })),
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const l2Shown = (l2s.data ?? []).filter((x) => !l2q || `${x.code} ${x.name}`.toLowerCase().includes(l2q.toLowerCase()));

  return (
    <Modal title={t("Add tests from use cases")} open onClose={onClose} wide>
      <div className="stack">
        <ErrorNote error={error ?? l2s.error ?? rules.error} />
        <p className="small muted" style={{ margin: 0 }}>
          {t(
            "Pick L2 use cases (all their rules that are not retired) and single L3 rules. Magma proposes one test per ATT&CK technique, linked to every chosen rule with that technique.",
          )}
        </p>
        <div className="form-grid two">
          <div className="field">
            <span>{t("L2 use cases")}</span>
            <input
              className="input input-sm"
              type="search"
              placeholder={t("Search L2 use cases…")}
              aria-label={t("Search L2 use cases")}
              value={l2q}
              onChange={(e) => setL2q(e.target.value)}
            />
            <div className="multi-list" style={{ maxHeight: 220, overflow: "auto", position: "static" }}>
              {l2Shown.map((x) => (
                <label key={x.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={l2Ids.includes(x.id)}
                    onChange={() => setL2Ids(l2Ids.includes(x.id) ? l2Ids.filter((y) => y !== x.id) : [...l2Ids, x.id])}
                  />
                  <span>
                    <span className="mono">{x.code}</span> {x.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
          {rules.data && <RulePicker rules={rules.data} value={l3Ids} onChange={setL3Ids} label={t("Single L3 rules")} />}
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || (!l2Ids.length && !l3Ids.length)}
            onClick={() => void propose()}
          >
            {t("Propose tests")}
          </button>
        </div>

        {result && (
          <div className="stack">
            {!result.proposals.length && <p className="muted small">{t("The chosen rules have no ATT&CK technique to test.")}</p>}
            {drafts.map((d) => (
              <div key={d.key} className={"proposal stack-sm" + (d.selected || d.add_to ? "" : " is-off")}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={(e) => upd(d.key, { selected: e.target.checked, add_to: e.target.checked ? null : d.add_to })}
                  />
                  <span>
                    <strong className="mono">{d.technique}</strong> {d.technique_name}
                    {!!d.replaces.length && (
                      <span className="small muted"> · {t("replaces {ids}", { ids: d.replaces.join(", ") })}</span>
                    )}
                    <br />
                    <span className="small muted">
                      {t("Rules")}: {d.rule_codes.join(", ")}
                    </span>
                  </span>
                </label>
                {!!d.existing.length && (
                  <div className="note-box small stack-xs">
                    <span>{t("Already tested here ({n} tests)", { n: d.existing.length })}</span>
                    <label className="check-row">
                      <span>{t("Add the rules to an existing test instead:")}</span>
                      <select
                        className="input input-sm"
                        value={d.add_to ?? ""}
                        onChange={(e) => {
                          const v = Number(e.target.value) || null;
                          upd(d.key, { add_to: v, selected: v ? false : d.selected });
                        }}
                      >
                        <option value="">{t("No")}</option>
                        {d.existing.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {d.selected && (
                  <div className="form-grid two">
                    {d.templates.length > 0 && (
                      <label className="field">
                        {t("Library template")}
                        <select className="input input-sm" value={d.template_id ?? ""} onChange={(e) => pickTemplate(d, e.target.value)}>
                          <option value="">{t("None")}</option>
                          {d.templates.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="field">
                      {t("Title")}
                      <input
                        className="input input-sm"
                        required
                        maxLength={255}
                        value={d.title}
                        onChange={(e) => upd(d.key, { title: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      {t("Procedure")}
                      <textarea
                        className="input textarea mono"
                        rows={2}
                        maxLength={10000}
                        value={d.procedure}
                        onChange={(e) => upd(d.key, { procedure: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      {t("Tools")}
                      <input className="input input-sm" maxLength={10000} value={d.tools} onChange={(e) => upd(d.key, { tools: e.target.value })} />
                    </label>
                  </div>
                )}
              </div>
            ))}
            {!!result.skipped_techniques.length && (
              <div className="note-box small">
                <strong>{t("Not proposed (deprecated or unknown techniques):")}</strong>{" "}
                {result.skipped_techniques.map((s) => `${s.technique} (${s.rules.join(", ")})`).join("; ")}
              </div>
            )}
            {!!result.no_technique.length && (
              <div className="note-box small">
                <strong>{t("No technique: add a test by hand")}</strong>{" "}
                {result.no_technique.map((r) => r.code).join(", ")}
              </div>
            )}
            <div className="row-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !chosen.length || drafts.some((d) => d.selected && !d.title.trim())}
                onClick={() => void accept()}
              >
                {t("Add {n} tests", { n: drafts.filter((d) => d.selected && !d.add_to).length })}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
