import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  ApiError,
  purple,
  type PtAttachment,
  type PtBlueInput,
  type PtDetection,
  type PtOutcome,
  type PtPlan,
  type PtRedInput,
  type PtTestCase,
} from "../api";
import { useAuth } from "../auth";
import EvidenceFiles from "../components/EvidenceFiles";
import { Markdown, MarkdownField } from "../components/Markdown";
import { AssigneePicker, RunState } from "../components/RunStatus";
import TechniquePicker from "../components/TechniquePicker";
import { ConflictBox, confirmDialog, ErrorNote, useLoad, useUnsavedGuard } from "../components/ui";
import { fmtDate, fmtTime } from "../lib/format";
import {
  BLUE_STATUS_LABEL,
  BluePill,
  fromLocalInput,
  joinList,
  OUTCOME_HINT,
  OUTCOME_LABEL,
  OUTCOMES,
  OutcomePill,
  RED_STATUS_LABEL,
  RedPill,
  SEVERITIES,
  SEVERITY_LABEL,
  splitList,
  toLocalInput,
  TrendPill,
} from "../lib/purple";
import { t } from "../i18n";

const TACTICS = [
  "reconnaissance",
  "resource-development",
  "initial-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "defense-evasion",
  "credential-access",
  "discovery",
  "lateral-movement",
  "collection",
  "command-and-control",
  "exfiltration",
  "impact",
];

const EVIDENCE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,.log,.csv,.json,.xml,.evtx,.pcap,.pcapng";

type Tab = "plan" | "red" | "blue" | "history";

interface PlanForm extends Omit<PtPlan, "platforms" | "references" | "tags"> {
  platforms: string;
  references: string;
  tags: string;
  campaign_id: number;
}

interface RedForm extends Omit<PtRedInput, "expected_version" | "targets" | "sources" | "red_tools"> {
  targets: string;
  sources: string;
  red_tools: string;
}

type BlueForm = Omit<PtBlueInput, "expected_version">;

const planForm = (x: PtTestCase): PlanForm => ({
  name: x.name,
  description: x.description,
  techniques: x.techniques,
  tactic: x.tactic,
  platforms: joinList(x.platforms),
  executor: x.executor,
  command: x.command,
  cleanup: x.cleanup,
  operator_guidance: x.operator_guidance,
  references: x.references.join("\n"),
  tags: joinList(x.tags),
  campaign_id: x.campaign_id,
});

const redForm = (x: PtTestCase): RedForm => ({
  red_status: x.red_status,
  red_assignee: x.red_assignee,
  attack_start: x.attack_start,
  attack_stop: x.attack_stop,
  targets: joinList(x.targets),
  sources: joinList(x.sources),
  red_tools: joinList(x.red_tools),
  red_notes: x.red_notes,
});

const blueForm = (x: PtTestCase): BlueForm => ({
  blue_status: x.blue_status,
  blue_assignee: x.blue_assignee,
  blue_notes: x.blue_notes,
  detection_steps: x.detection_steps,
  prevention_steps: x.prevention_steps,
  outcome_override: x.outcome_override,
  detections: x.detection_list.map((d) => ({ ...d })),
  record_verification: true,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const bestOutcome = (list: PtDetection[]): PtOutcome =>
  OUTCOMES.find((o) => list.some((d) => d.outcome === o)) ?? "tbd";

function newDetection(kind: "rule" | "tool", extra: Partial<PtDetection> = {}): PtDetection {
  return {
    id: null,
    kind,
    rule_code: "",
    tool: "",
    outcome: "tbd",
    expected: false,
    alert_name: "",
    severity: "",
    detected_at: null,
    note: "",
    ...extra,
  };
}

export default function PurpleTestCase() {
  const { id = "" } = useParams();
  const tid = Number(id);
  const { can, user } = useAuth();
  const editor = can("admin", "analyst");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (["plan", "red", "blue", "history"].includes(params.get("tab") ?? "") ? params.get("tab") : null) as Tab | null;
  const load = useLoad(() => purple.testCase(tid), [tid]);
  const tc = load.data;
  const techniques = useLoad(() => api.attackTechniques());
  const names = useMemo(() => new Map((techniques.data ?? []).map((x) => [x.id, x.name])), [techniques.data]);
  const tools = useLoad(() => api.refs("detection_technology"));
  const rules = useLoad(() => api.l3s());
  const suggested = useLoad(() => purple.suggestedRules(tid), [tid, tc?.plan_version]);

  const [plan, setPlan] = useState<PlanForm | null>(null);
  const [red, setRed] = useState<RedForm | null>(null);
  const [blue, setBlue] = useState<BlueForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // a save refused with 409: someone else saved this test case since it was loaded
  const [conflict, setConflict] = useState(false);
  const seen = useRef<{ plan?: number; red?: number; blue?: number; blueStatus?: string; id?: number }>({});

  // Each side keeps its own form; a save of one side must not throw away edits on another.
  useEffect(() => {
    if (!tc) return;
    const s = seen.current;
    if (s.id !== tc.id) seen.current = {};
    if (seen.current.plan !== tc.plan_version) setPlan(planForm(tc));
    if (seen.current.red !== tc.red_version) setRed(redForm(tc));
    if (seen.current.blue !== tc.blue_version) setBlue(blueForm(tc));
    else if (seen.current.blueStatus !== tc.blue_status) {
      // the red side moved the blue status (attack executed): adopt it unless it was edited
      const before = seen.current.blueStatus;
      setBlue((b) => (b && b.blue_status === before ? { ...b, blue_status: tc.blue_status } : b));
    }
    seen.current = { id: tc.id, plan: tc.plan_version, red: tc.red_version, blue: tc.blue_version, blueStatus: tc.blue_status };
  }, [tc]);

  const planDirty = !!tc && !!plan && !same(plan, planForm(tc));
  const redDirty = !!tc && !!red && !same(red, redForm(tc));
  const blueDirty = !!tc && !!blue && !same({ ...blue, record_verification: true }, blueForm(tc));
  useUnsavedGuard(planDirty || redDirty || blueDirty);

  const currentTab: Tab = tab ?? (tc && tc.red_status === "executed" ? "blue" : "red");
  const setTab = (k: Tab) => setParams({ tab: k }, { replace: true });

  if (load.error) return <ErrorNote error={load.error} />;
  if (!tc || !plan || !red || !blue) return <p className="muted">{t("Loading…")}</p>;
  const readOnly = !editor;

  async function run<T>(fn: () => Promise<T>, message: string): Promise<T | null> {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const r = await fn();
      setSaved(message);
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** 409: take the other person's version but keep every edit made here; the next save
   * then overwrites theirs (like a config conflict). */
  const keepMine = async () => {
    const fresh = await run(() => purple.testCase(tid), "");
    if (!fresh) return;
    // tell the form sync that these versions are already seen, so it keeps the local forms
    seen.current = { id: fresh.id, plan: fresh.plan_version, red: fresh.red_version, blue: fresh.blue_version, blueStatus: fresh.blue_status };
    load.setData(fresh);
    setSaved(null);
    setConflict(false);
    setError(null);
  };
  const loadTheirs = () => {
    seen.current = {};
    setConflict(false);
    setError(null);
    load.reload();
  };

  const apply = (next: PtTestCase | null) => {
    if (next) load.setData(next);
  };

  const savePlan = async () => {
    const body = {
      ...plan,
      platforms: splitList(plan.platforms),
      references: splitList(plan.references),
      tags: splitList(plan.tags),
      expected_version: tc.plan_version,
    };
    apply(await run(() => purple.savePlan(tc.id, body), t("Test case saved")));
  };

  const redBody = (r: RedForm): PtRedInput => ({
    ...r,
    targets: splitList(r.targets),
    sources: splitList(r.sources),
    red_tools: splitList(r.red_tools),
    expected_version: tc.red_version,
  });
  const saveRed = async () => apply(await run(() => purple.saveRed(tc.id, redBody(red)), t("Red team side saved")));

  type RunAction = "start" | "stop" | "pause" | "resume" | "abandon";
  const RUN_DONE: Record<RunAction, string> = {
    start: t("Attack started"),
    stop: t("Attack completed"),
    pause: t("Attack paused"),
    resume: t("Attack resumed"),
    abandon: t("Test abandoned"),
  };
  const runAction = async (what: RunAction) => {
    if (what === "start" && tc.red_status === "executed") {
      const ok = await confirmDialog(t("Run this test again? The new start time replaces the recorded attack times."), {
        confirmLabel: t("Run again"),
      });
      if (!ok) return;
    }
    if (what === "abandon") {
      const ok = await confirmDialog(t("Abandon this test? It counts as not executed."), { confirmLabel: t("Abandon") });
      if (!ok) return;
    }
    if (redDirty) {
      const ok = await confirmDialog(t("Save the red team changes first?"), { confirmLabel: t("Save and continue") });
      if (!ok) return;
      const next = await run(() => purple.saveRed(tc.id, redBody(red)), t("Red team side saved"));
      if (!next) return;
      apply(next);
      apply(await run(() => purple[what](tc.id, next.red_version), RUN_DONE[what]));
      return;
    }
    apply(await run(() => purple[what](tc.id, tc.red_version), RUN_DONE[what]));
  };

  const saveBlue = async (done = false) => {
    const body: PtBlueInput = { ...blue, ...(done ? { blue_status: "done" as const } : {}), expected_version: tc.blue_version };
    const next = await run(() => purple.saveBlue(tc.id, body), done ? t("Blue team review completed") : t("Blue team side saved"));
    if (next?.verified?.length) {
      setSaved(
        t("Saved. Recorded a verification for {rules}.", {
          rules: next.verified.map((v) => `${v.rule} (${v.result === "ok" ? "OK" : t("issues")})`).join(", "),
        }),
      );
    }
    apply(next);
  };

  const remove = async () => {
    const ok = await confirmDialog(t("Delete the test case {name} with its results and evidence?", { name: tc.name }), {
      danger: true,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    if (await run(() => purple.deleteTestCase(tc.id), "") !== null) navigate(`/purple/assessments/${tc.assessment_id}`);
  };

  const setDetection = (i: number, patch: Partial<PtDetection>) =>
    setBlue({ ...blue, detections: blue.detections.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const derived = bestOutcome(blue.detections);
  const shownOutcome = blue.outcome_override ?? derived;
  const usedRules = new Set(blue.detections.filter((d) => d.kind === "rule").map((d) => d.rule_code));
  const ruleNames = new Map((rules.data ?? []).map((r) => [r.code, r.name]));

  const evidence = (side: "red" | "blue") => (
    <EvidenceFiles<PtAttachment>
      title={side === "red" ? t("Red team evidence") : t("Blue team evidence")}
      headingId={`ev-${side}`}
      files={tc.attachments.filter((a) => a.side === side)}
      editable={editor}
      accept={EVIDENCE_ACCEPT}
      hint={
        side === "red"
          ? t("Screenshots, tool output, logs of the attack (PDF, images, text, .evtx, .pcap), up to 20 MB each.")
          : t("Screenshots of alerts, log extracts, tickets (PDF, images, text, .evtx, .pcap), up to 20 MB each.")
      }
      upload={(f) => purple.uploadAttachment(tc.id, side, f)}
      remove={(a) => purple.deleteAttachment(a.id)}
      url={(a, download) => purple.attachmentUrl(a.id, download)}
      onChange={(list) =>
        load.setData({ ...tc, attachments: [...tc.attachments.filter((a) => a.side !== side), ...list] })
      }
      removeQuestion={(a) => t("Remove {file} from the test case?", { file: a.filename })}
    />
  );

  return (
    <>
      <nav className="crumbs" aria-label={t("Breadcrumb")}>
        <Link to="/purple">{t("Purple team assessments")}</Link> /
        {tc.assessment_kind === "quick" ? (
          <Link to="/purple?tab=quick">{t("Quick tests")}</Link>
        ) : (
          <>
            <Link to={`/purple/assessments/${tc.assessment_id}`}>{tc.assessment_name}</Link> /
            <span>{tc.campaign_name}</span>
          </>
        )}
      </nav>
      <header className="page-header">
        <div>
          <h1>{tc.name}</h1>
          <div className="subtitle pt-head-pills">
            <span className="pill-labelled">
              <span className="pill-label">{t("Outcome")}</span>
              <OutcomePill outcome={tc.outcome} overridden={tc.overridden} />
            </span>
            <span className="pill-labelled">
              <span className="pill-label">{t("Red team")}</span>
              <RedPill status={tc.red_status} />
            </span>
            <span className="pill-labelled">
              <span className="pill-label">{t("Blue team")}</span>
              <BluePill status={tc.blue_status} />
            </span>
            {["improved", "regressed", "unchanged"].includes(tc.trend) && (
              <span className="pill-labelled">
                <span className="pill-label">{t("Since last run")}</span>
                <TrendPill trend={tc.trend} />
              </span>
            )}
            {tc.techniques.map((x) => (
              <span key={x} className="code-tag" title={names.get(x) ?? x}>
                {x}
              </span>
            ))}
          </div>
        </div>
        {editor && (
          <div className="row-actions">
            <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
              {t("Delete")}
            </button>
          </div>
        )}
      </header>
      {conflict ? (
        <ConflictBox message={error} busy={busy} onKeepMine={() => void keepMine()} onLoadTheirs={loadTheirs} />
      ) : (
        <ErrorNote error={error} />
      )}
      {saved && (
        <p className="form-success" role="status">
          {saved}
        </p>
      )}

      <div className="tabs" role="tablist" aria-label={t("Test case")}>
        {(
          [
            ["plan", t("Procedure"), planDirty],
            ["red", t("Red team"), redDirty],
            ["blue", t("Blue team"), blueDirty],
            ["history", t("Runs ({n})", { n: tc.history.length }), false],
          ] as [Tab, string, boolean][]
        ).map(([k, label, dirty]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={currentTab === k}
            className={"tab" + (currentTab === k ? " active" : "")}
            onClick={() => setTab(k)}
          >
            {label}
            {dirty && <span className="tab-count">{t("unsaved")}</span>}
          </button>
        ))}
      </div>

      {currentTab === "plan" && (
        <section className="card stack" aria-label={t("Procedure")}>
          <div className="form-grid">
            <label className="field">
              {t("Name")} *
              <input className="input" disabled={readOnly} value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} />
            </label>
            <label className="field">
              {t("Campaign")}
              <select
                className="input"
                disabled={readOnly}
                value={plan.campaign_id}
                onChange={(e) => setPlan({ ...plan, campaign_id: Number(e.target.value) })}
              >
                {tc.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("Tactic")}
              <select className="input" disabled={readOnly} value={plan.tactic} onChange={(e) => setPlan({ ...plan, tactic: e.target.value })}>
                <option value="">–</option>
                {TACTICS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TechniquePicker
            value={plan.techniques}
            names={names}
            techniques={techniques.data ?? []}
            disabled={readOnly}
            onChange={(v) => setPlan({ ...plan, techniques: v })}
            required={false}
          />
          <MarkdownField label={t("Description")} value={plan.description} onChange={(v) => setPlan({ ...plan, description: v })} readOnly={readOnly} />
          <div className="form-grid">
            <label className="field">
              {t("Platforms")}
              <input className="input" disabled={readOnly} value={plan.platforms} placeholder="windows, linux" onChange={(e) => setPlan({ ...plan, platforms: e.target.value })} />
            </label>
            <label className="field">
              {t("Executor")}
              <input className="input" disabled={readOnly} value={plan.executor} placeholder="powershell, command_prompt, manual" onChange={(e) => setPlan({ ...plan, executor: e.target.value })} />
            </label>
            <label className="field">
              {t("Tags")}
              <input className="input" disabled={readOnly} value={plan.tags} placeholder={t("e.g. retest, fix-priority-1")} onChange={(e) => setPlan({ ...plan, tags: e.target.value })} />
            </label>
          </div>
          <label className="field">
            {t("Command / procedure")}
            <textarea className="input mono" rows={4} disabled={readOnly} value={plan.command} onChange={(e) => setPlan({ ...plan, command: e.target.value })} />
          </label>
          <label className="field">
            {t("Cleanup")}
            <textarea className="input mono" rows={2} disabled={readOnly} value={plan.cleanup} onChange={(e) => setPlan({ ...plan, cleanup: e.target.value })} />
          </label>
          <MarkdownField label={t("Operator guidance")} value={plan.operator_guidance} onChange={(v) => setPlan({ ...plan, operator_guidance: v })} readOnly={readOnly} />
          <label className="field">
            {t("References (one per line)")}
            <textarea className="input" rows={2} disabled={readOnly} value={plan.references} onChange={(e) => setPlan({ ...plan, references: e.target.value })} />
          </label>
          {editor && (
            <div className="row-actions">
              <button type="button" className="btn" disabled={!planDirty || busy} onClick={() => setPlan(planForm(tc))}>
                {t("Discard")}
              </button>
              <button type="button" className="btn btn-primary" disabled={!planDirty || busy || !plan.name.trim()} onClick={() => void savePlan()}>
                {t("Save procedure")}
              </button>
            </div>
          )}
        </section>
      )}

      {currentTab === "red" && (
        <>
          <div className="two-col">
            <section className="card stack" aria-label={t("Red team")}>
              <div className="pt-runbar">
                <div className="pt-runbar-main">
                  <RunState status={tc.red_status} start={tc.attack_start} stop={tc.attack_stop} />
                  {editor && (
                    <span className="pt-runbar-btns">
                      {(tc.red_status === "planned" || tc.red_status === "not_executed") && (
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void runAction("start")}>
                          ▶ {t("Start")}
                        </button>
                      )}
                      {tc.red_status === "in_progress" && (
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void runAction("pause")}>
                          ❚❚ {t("Pause")}
                        </button>
                      )}
                      {tc.red_status === "paused" && (
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void runAction("resume")}>
                          ▶ {t("Resume")}
                        </button>
                      )}
                      {(tc.red_status === "in_progress" || tc.red_status === "paused") && (
                        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void runAction("stop")}>
                          ■ {t("Complete")}
                        </button>
                      )}
                      {tc.red_status === "executed" && (
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void runAction("start")}>
                          ↻ {t("Run again")}
                        </button>
                      )}
                      {(tc.red_status === "planned" || tc.red_status === "in_progress" || tc.red_status === "paused") && (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void runAction("abandon")}>
                          {t("Abandon")}
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <label className="field">
                  {t("Red team operator")}
                  <AssigneePicker
                    label={t("Red team operator")}
                    value={red.red_assignee}
                    disabled={readOnly}
                    me={user?.username}
                    onChange={(v) => setRed({ ...red, red_assignee: v })}
                  />
                </label>
                <div className="pt-runbar-meta">
                  {tc.attack_start ? t("Started {time}", { time: fmtTime(tc.attack_start) }) : t("Not started")}
                  {tc.attack_stop ? ` · ${t("stopped {time}", { time: fmtTime(tc.attack_stop) })}` : ""}
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  {t("Execution status")}
                  <select className="input" disabled={readOnly} value={red.red_status} onChange={(e) => setRed({ ...red, red_status: e.target.value as RedForm["red_status"] })}>
                    {(Object.keys(RED_STATUS_LABEL) as RedForm["red_status"][]).map((k) => (
                      <option key={k} value={k}>
                        {RED_STATUS_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {t("Attack start")}
                  <input
                    className="input"
                    type="datetime-local"
                    disabled={readOnly}
                    value={toLocalInput(red.attack_start)}
                    onChange={(e) => setRed({ ...red, attack_start: fromLocalInput(e.target.value) })}
                  />
                </label>
                <label className="field">
                  {t("Attack stop")}
                  <input
                    className="input"
                    type="datetime-local"
                    disabled={readOnly}
                    value={toLocalInput(red.attack_stop)}
                    onChange={(e) => setRed({ ...red, attack_stop: fromLocalInput(e.target.value) })}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label className="field">
                  {t("Targets")}
                  <input className="input" disabled={readOnly} value={red.targets} placeholder={t("hosts, accounts, IPs")} onChange={(e) => setRed({ ...red, targets: e.target.value })} />
                </label>
                <label className="field">
                  {t("Sources")}
                  <input className="input" disabled={readOnly} value={red.sources} placeholder={t("attacking hosts or IPs")} onChange={(e) => setRed({ ...red, sources: e.target.value })} />
                </label>
                <label className="field">
                  {t("Red team tools")}
                  <input className="input" disabled={readOnly} value={red.red_tools} placeholder="Cobalt Strike, Rubeus" onChange={(e) => setRed({ ...red, red_tools: e.target.value })} />
                </label>
              </div>
              <MarkdownField
                label={t("Red team notes")}
                value={red.red_notes}
                onChange={(v) => setRed({ ...red, red_notes: v })}
                readOnly={readOnly}
                rows={4}
                placeholder={t("What was run exactly, deviations from the procedure, what worked")}
              />
              {tc.red_updated_by && <p className="small muted">{t("Last saved by {user}", { user: tc.red_updated_by })}</p>}
            </section>
            <div className="stack">
              <section className="card stack-sm" aria-labelledby="pt-proc">
                <h2 id="pt-proc" className="h-sm">
                  {t("Procedure")}
                </h2>
                {tc.command ? <pre className="pt-command">{tc.command}</pre> : <p className="muted small">{t("No command recorded.")}</p>}
                {tc.operator_guidance && <Markdown text={tc.operator_guidance} />}
                {tc.cleanup && (
                  <>
                    <span className="small muted">{t("Cleanup")}</span>
                    <pre className="pt-command">{tc.cleanup}</pre>
                  </>
                )}
              </section>
              {evidence("red")}
            </div>
          </div>
          {editor && (
            // floats over the page only while there is something to save; otherwise it rests at
            // the end of the tab and keeps the run actions reachable without covering content
            <div className={"unsaved-bar" + (redDirty ? "" : " is-clean")} role="status">
              <span>{redDirty ? t("Unsaved changes to the red team side.") : t("All red team changes are saved.")}</span>
              <span className="row-actions">
                <button type="button" className="btn btn-ghost" disabled={!redDirty || busy} onClick={() => setRed(redForm(tc))}>
                  {t("Discard")}
                </button>
                <button type="button" className="btn btn-primary" disabled={!redDirty || busy} onClick={() => void saveRed()}>
                  {busy ? t("Saving…") : t("Save red team side")}
                </button>
              </span>
            </div>
          )}
        </>
      )}

      {currentTab === "blue" && (
        <>
          {tc.red_status !== "executed" && (
            <p className="form-notice">{t("The red team has not finished this test yet. You can prepare the expected defenses already.")}</p>
          )}
          <section className="card stack" aria-labelledby="pt-det">
            <div className="section-head">
              <h2 id="pt-det" className="h-sm">
                {t("What did the defenses do?")}
              </h2>
              {editor && (
                <span className="row-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setBlue({ ...blue, detections: [...blue.detections, newDetection("rule")] })}>
                    {t("+ Use case rule")}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setBlue({ ...blue, detections: [...blue.detections, newDetection("tool")] })}>
                    {t("+ Other detection")}
                  </button>
                </span>
              )}
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {t(
                "One row per defense. Link the L3 use case rules that should catch the test, and add any other detection: an EDR or Defender alert, a firewall block, events only visible in the logs.",
              )}
            </p>
            {editor && !!suggested.data?.filter((r) => !usedRules.has(r.code)).length && (
              <div className="pt-suggest small">
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
                      onClick={() => setBlue({ ...blue, detections: [...blue.detections, newDetection("rule", { rule_code: r.code, expected: true })] })}
                    >
                      + {r.code}
                    </button>
                  ))}
              </div>
            )}
            {blue.detections.length === 0 ? (
              <p className="muted">{t("No defenses recorded yet.")}</p>
            ) : (
              <div className="scroll-x">
                <table className="table pt-det-table">
                  <thead>
                    <tr>
                      <th>{t("Defense")}</th>
                      <th>{t("Outcome")}</th>
                      <th>{t("Alert / event")}</th>
                      <th>{t("Severity")}</th>
                      <th>{t("Detected at")}</th>
                      <th>{t("Note")}</th>
                      <th>
                        <span className="sr-only">{t("Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {blue.detections.map((d, i) => (
                      <tr key={i}>
                        <td>
                          {d.kind === "rule" ? (
                            <span className="stack-xs">
                              <input
                                className={"input input-sm mono" + (d.rule_missing ? " is-invalid" : "")}
                                list="pt-rules"
                                disabled={readOnly}
                                value={d.rule_code}
                                placeholder={t("L3 rule, e.g. AO-BRU-01")}
                                aria-label={t("L3 rule")}
                                onChange={(e) => setDetection(i, { rule_code: e.target.value.split(" ")[0].toUpperCase(), rule_missing: false })}
                              />
                              <span className="small muted">
                                {d.rule_missing ? (
                                  t("This rule was deleted")
                                ) : ruleNames.get(d.rule_code) ? (
                                  <Link to={`/usecases/l3/${d.rule_code}`}>{ruleNames.get(d.rule_code)}</Link>
                                ) : (
                                  t("Use case rule")
                                )}
                                {d.expected ? ` · ${t("expected")}` : ""}
                              </span>
                            </span>
                          ) : (
                            <span className="stack-xs">
                              <input
                                className="input input-sm"
                                list="pt-tools"
                                disabled={readOnly}
                                value={d.tool}
                                placeholder={t("e.g. Microsoft Defender, Firewall, DC logs")}
                                aria-label={t("Tool or source")}
                                onChange={(e) => setDetection(i, { tool: e.target.value })}
                              />
                              <span className="small muted">
                                {t("Other detection")}
                                {d.expected ? ` · ${t("expected")}` : ""}
                              </span>
                            </span>
                          )}
                        </td>
                        <td>
                          <select
                            className={`input input-sm pt-sel-${d.outcome}`}
                            disabled={readOnly}
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
                          <input className="input input-sm" disabled={readOnly} value={d.alert_name} aria-label={t("Alert / event")} onChange={(e) => setDetection(i, { alert_name: e.target.value })} />
                        </td>
                        <td>
                          <select className="input input-sm" disabled={readOnly} value={d.severity} aria-label={t("Severity")} onChange={(e) => setDetection(i, { severity: e.target.value as PtDetection["severity"] })}>
                            {SEVERITIES.map((s) => (
                              <option key={s} value={s}>
                                {SEVERITY_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            type="datetime-local"
                            disabled={readOnly}
                            value={toLocalInput(d.detected_at)}
                            aria-label={t("Detected at")}
                            onChange={(e) => setDetection(i, { detected_at: fromLocalInput(e.target.value) })}
                          />
                        </td>
                        <td>
                          <input className="input input-sm" disabled={readOnly} value={d.note} aria-label={t("Note")} onChange={(e) => setDetection(i, { note: e.target.value })} />
                        </td>
                        <td>
                          {editor && (
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t("Remove")}
                              onClick={() => setBlue({ ...blue, detections: blue.detections.filter((_, j) => j !== i) })}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <datalist id="pt-rules">
              {(suggested.data ?? []).map((r) => (
                <option key={"s" + r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
              {(rules.data ?? []).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </datalist>
            <datalist id="pt-tools">
              {(tools.data ?? []).map((x) => (
                <option key={x.id} value={x.name} />
              ))}
              <option value={t("Only in the logs")} />
            </datalist>
            <div className="pt-outcome-row">
              <span>
                {t("Test outcome")}: <OutcomePill outcome={shownOutcome} overridden={!!blue.outcome_override} />
              </span>
              <label className="field field-inline">
                {t("Override")}
                <select
                  className="input input-sm"
                  disabled={readOnly}
                  value={blue.outcome_override ?? ""}
                  onChange={(e) => setBlue({ ...blue, outcome_override: (e.target.value || null) as PtOutcome | null })}
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
          </section>

          <div className="two-col even">
            <section className="card stack" aria-labelledby="pt-find">
              <h2 id="pt-find" className="h-sm">
                {t("Findings")}
              </h2>
              <MarkdownField
                label={t("What was seen, what is missing, what should be fixed")}
                value={blue.blue_notes}
                onChange={(v) => setBlue({ ...blue, blue_notes: v })}
                readOnly={readOnly}
                rows={6}
                placeholder={t("e.g. Sysmon event 10 present, but no SIEM rule. Recommendation: create a rule for LSASS access; ticket SOC-123.")}
              />
              <MarkdownField label={t("Detection steps")} value={blue.detection_steps} onChange={(v) => setBlue({ ...blue, detection_steps: v })} readOnly={readOnly} />
              <MarkdownField label={t("Prevention steps")} value={blue.prevention_steps} onChange={(v) => setBlue({ ...blue, prevention_steps: v })} readOnly={readOnly} />
            </section>
            <div className="stack">
              <section className="card stack" aria-labelledby="pt-review">
                <h2 id="pt-review" className="h-sm">
                  {t("Review")}
                </h2>
                <div className="form-grid">
                  <label className="field">
                    {t("Blue team status")}
                    <select className="input" disabled={readOnly} value={blue.blue_status} onChange={(e) => setBlue({ ...blue, blue_status: e.target.value as BlueForm["blue_status"] })}>
                      {(Object.keys(BLUE_STATUS_LABEL) as BlueForm["blue_status"][]).map((k) => (
                        <option key={k} value={k}>
                          {BLUE_STATUS_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    {t("Blue team analyst")}
                    <AssigneePicker
                      label={t("Blue team analyst")}
                      value={blue.blue_assignee}
                      disabled={readOnly}
                      me={user?.username}
                      onChange={(v) => setBlue({ ...blue, blue_assignee: v })}
                    />
                  </label>
                </div>
                {editor && tc.blue_status !== "done" && (
                  <label className="check small">
                    <input
                      type="checkbox"
                      checked={blue.record_verification}
                      onChange={(e) => setBlue({ ...blue, record_verification: e.target.checked })}
                    />
                    {t("When done, record the result as a verification of the linked use case rules (blocked or alerted = OK, logged or not detected = issues)")}
                  </label>
                )}
                {tc.blue_updated_by && <p className="small muted">{t("Last saved by {user}", { user: tc.blue_updated_by })}</p>}
              </section>
              {evidence("blue")}
            </div>
          </div>
          {editor && (
            // the blue side form is long (defenses, findings, review): while it has unsaved changes
            // the bar floats so Save stays in reach; when clean it rests at the end of the tab
            <div className={"unsaved-bar" + (blueDirty ? "" : " is-clean")} role="status">
              <span>{blueDirty ? t("Unsaved changes to the blue team side.") : t("All blue team changes are saved.")}</span>
              <span className="row-actions">
                <button type="button" className="btn btn-ghost" disabled={!blueDirty || busy} onClick={() => setBlue(blueForm(tc))}>
                  {t("Discard")}
                </button>
                <button
                  type="button"
                  className={tc.blue_status === "done" ? "btn btn-primary" : "btn"}
                  disabled={!blueDirty || busy}
                  onClick={() => void saveBlue()}
                >
                  {busy ? t("Saving…") : t("Save blue team side")}
                </button>
                {tc.blue_status !== "done" && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveBlue(true)}>
                    {t("Save and mark done")}
                  </button>
                )}
              </span>
            </div>
          )}
        </>
      )}

      {currentTab === "history" && (
        <section className="card table-card" aria-label={t("Runs")}>
          <p className="muted small" style={{ margin: "16px 22px 0" }}>
            {t("The same procedure in every assessment (re-runs and test cases from the same library procedure).")}
          </p>
          <div className="scroll-x">
            <table className="table cards-sm">
              <thead>
                <tr>
                  <th>{t("Assessment")}</th>
                  <th>{t("Date")}</th>
                  <th>{t("Red")}</th>
                  <th>{t("Outcome")}</th>
                </tr>
              </thead>
              <tbody>
                {tc.history.map((h) => (
                  <tr key={h.test_case_id} className={h.current ? "pt-current" : undefined}>
                    <td data-label={t("Assessment")}>
                      {h.current ? (
                        <strong>{h.assessment}</strong>
                      ) : (
                        <Link to={`/purple/test-cases/${h.test_case_id}`}>{h.assessment}</Link>
                      )}
                    </td>
                    <td data-label={t("Date")}>{fmtDate(h.date)}</td>
                    <td data-label={t("Red")}>
                      <RedPill status={h.red_status} />
                    </td>
                    <td data-label={t("Outcome")}>{h.outcome ? <OutcomePill outcome={h.outcome} /> : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
