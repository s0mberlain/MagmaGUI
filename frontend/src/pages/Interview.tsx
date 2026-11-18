import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  api,
  type ComponentView,
  type Interview as IV,
  type InterviewAttachment,
  type InterviewCompare,
  type InterviewSave,
  type AddedUseCase,
  type L2,
  type L3,
  type Proposal,
  type RefItem,
  type RiskRow,
  type Stride,
  type ThreatRef,
  type ThreatState,
} from "../api";
import { useAuth } from "../auth";
import {
  confirmDialog,
  DraftRestoreBanner,
  ErrorNote,
  Modal,
  MultiSelect,
  StatusPill,
  useDraftBackup,
  useLoad,
  useUnsavedGuard,
} from "../components/ui";
import { Markdown, MarkdownField } from "../components/Markdown";
import { RiskCoverage, useCaseHref, type RiskUseCase } from "../components/RiskCoverage";
import { fmtDate, fmtTime, today } from "../lib/format";
import { INTERVIEW_STATUS_LABEL, registerCustomThreats, riskLevel, STATE_LABEL, STRIDE, STRIDE_HINT, STRIDE_LABEL, threatLabel } from "../lib/stride";
import EvidenceFiles from "../components/EvidenceFiles";
import TechniquePicker from "../components/TechniquePicker";
import { getLang, t } from "../i18n";

type Form = Omit<InterviewSave, "expected_version">;
type FormComponent = Form["components"][number];
type FormThreat = FormComponent["threats"][number];

const RATINGS = [1, 2, 3, 4, 5];

function newKey(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formOf(iv: IV): Form {
  const v = iv.view;
  return {
    interview_date: iv.interview_date,
    participants: iv.participants,
    notes: iv.notes,
    components: v.components.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      log_source_ids: c.log_sources.map((s) => s.id),
      threats: c.threats
        .filter((x) => !x.custom)
        .map((x) => ({
          category: x.category as Stride,
          state: x.state,
          description: x.description,
          likelihood: x.likelihood,
          impact: x.impact,
        })),
      custom_threats: c.threats
        .filter((x) => x.custom)
        .map((x) => ({
          key: x.category.slice("custom:".length),
          title: x.title ?? "",
          description: x.description,
          techniques: x.techniques ?? [],
          likelihood: x.likelihood,
          impact: x.impact,
        })),
    })),
    added: v.added.map((a): AddedUseCase => (a.l3_id ? { l3_id: a.l3_id, threats: a.threats } : { l2_id: a.l2_id!, threats: a.threats })),
    removed: v.removed.map((r) =>
      r.threats?.length
        ? { l2_id: r.l2_id, reason: r.reason ?? "", threats: r.threats.map((x) => ({ component: x.component, category: x.category })) }
        : { l2_id: r.l2_id, reason: r.reason ?? "" },
    ),
    requests: v.requests.map((r) => ({
      key: r.key,
      text: r.text,
      threat: { component: r.component, category: r.category },
    })),
  };
}

function threatOf(c: FormComponent, cat: Stride): FormThreat {
  return (
    c.threats.find((x) => x.category === cat) ?? {
      category: cat,
      state: "not_discussed",
      description: "",
      likelihood: null,
      impact: null,
    }
  );
}

const applies = (f: Form) =>
  new Set(
    f.components.flatMap((c) => [
      ...c.threats.filter((x) => x.state === "applies").map((x) => `${c.key}:${x.category}`),
      // custom ATT&CK threats always apply (#60)
      ...(c.custom_threats ?? []).map((x) => `${c.key}:custom:${x.key}`),
    ]),
  );

/** Drop manual additions and detection requests whose threat no longer applies. */
function pruned(f: Form): Form {
  const ok = applies(f);
  const has = (r: ThreatRef) => ok.has(`${r.component}:${r.category}`);
  return {
    ...f,
    added: f.added.map((a) => ({ ...a, threats: a.threats.filter(has) })).filter((a) => a.threats.length),
    // a removal from single risks (#57) must not turn into a removal of the whole use case
    removed: f.removed.flatMap((r) => {
      if (!r.threats?.length) return [r];
      const threats = r.threats.filter(has);
      return threats.length ? [{ ...r, threats }] : [];
    }),
    requests: f.requests.filter((r) => has(r.threat)),
  };
}

const sameRef = (a: ThreatRef, b: ThreatRef) => a.component === b.component && a.category === b.category;

function dependents(f: Form, match: (r: ThreatRef) => boolean): number {
  return f.requests.filter((r) => match(r.threat)).length + f.added.filter((a) => a.threats.length && a.threats.every(match)).length;
}

function score(x: FormThreat): number | null {
  return x.state === "applies" && x.likelihood && x.impact ? x.likelihood * x.impact : null;
}

function incomplete(x: FormThreat): boolean {
  return x.state === "applies" && (!x.description.trim() || !x.likelihood || !x.impact);
}

function RiskScore({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">–</span>;
  return (
    <span className={`risk risk-${riskLevel(value)}`} title={t("Risk level {r}", { r: riskLevel(value) })}>
      {value}
    </span>
  );
}

export default function Interview() {
  const { id } = useParams();
  const ivId = Number(id);
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const navigate = useNavigate();
  const loaded = useLoad<IV>(() => api.interview(ivId), [ivId]);
  const [iv, setIv] = useState<IV | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (loaded.data) {
      setIv(loaded.data);
      setForm(formOf(loaded.data));
      setDirty(false);
      setConflict(false);
    }
  }, [loaded.data]);
  useUnsavedGuard(dirty);
  // #60: labels of custom ATT&CK threats in lists and dialogs
  if (iv) registerCustomThreats(iv.view.components.flatMap((c) => c.threats));
  if (form) registerCustomThreats(form.components.flatMap((c) => (c.custom_threats ?? []).map((x) => ({ category: `custom:${x.key}`, title: x.title }))));
  const backup = useDraftBackup(
    `magma-draft:interview:${ivId}`,
    form,
    dirty,
    iv && iv.status === "draft" ? String(iv.version) : null,
  );

  const draft = iv?.status === "draft";
  /** Evidence files are saved on their own, not with the draft (#34). */
  const setAttachments = (list: InterviewAttachment[]) => setIv((x) => (x ? { ...x, attachments: list } : x));
  const canEdit = editor && draft;

  const update = (fn: (f: Form) => Form) => {
    setForm((f) => (f ? fn(f) : f));
    setDirty(true);
    if (!conflict) setError(null);
  };

  /** Save the draft (with optional last-second changes); resolves to the new interview. */
  async function save(next?: Form): Promise<IV | null> {
    if (!iv || !form) return null;
    const body = pruned(next ?? form);
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveInterview(iv.id, { ...body, expected_version: iv.version });
      setIv(saved);
      setForm(formOf(saved));
      setDirty(false);
      backup.clear();
      setSavedAt(new Date().toISOString());
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      const msg = (e as Error).message;
      setError(
        e instanceof ApiError
          ? msg
          : t("Saving failed: {error}. Your input is still here; try again.", { error: msg }),
      );
      if (next) {
        setForm(next);
        setDirty(true);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Change the form and save at once (step 3 actions re-evaluate the proposals). */
  const saveWith = (fn: (f: Form) => Form) => (form ? save(fn(form)) : Promise.resolve(null));

  const dateError = useMemo(() => {
    if (!form) return null;
    if (!form.interview_date) return t("Enter the interview date.");
    if (form.interview_date > today()) return t("The interview date cannot be in the future.");
    if (iv?.min_date && form.interview_date < iv.min_date)
      return t("The interview date must be on or after the previous interview ({date}).", { date: fmtDate(iv.min_date) });
    return null;
  }, [form, iv]);

  const dupNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of form?.components ?? []) {
      const k = c.name.trim().toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [form]);

  async function goto(n: number) {
    if (!form) return;
    setError(null);
    if (n > 1 && dateError) {
      setError(dateError);
      setStep(1);
      return;
    }
    if (n > 2 && !form.components.length) {
      setError(t("Add at least one component before you continue."));
      setStep(2);
      return;
    }
    if (n > 2 && (dupNames.size || form.components.some((c) => !c.name.trim()))) {
      setError(t("Every component needs a name, and names must be unique."));
      setStep(2);
      return;
    }
    if (canEdit && (dirty || n === 3)) {
      const ok = await save();
      if (!ok) return;
    }
    setStep(n);
  }

  async function complete() {
    if (!iv || !form) return;
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    const fresh = await api.interview(iv.id).catch(() => iv);
    const missing = fresh.view.incomplete;
    if (!form.components.length) {
      setError(t("Add at least one component before you continue."));
      return;
    }
    if (missing.length) {
      setError(
        t("Complete description, likelihood and impact of these threats: {list}", {
          list: missing.map((m) => `${m.component} / ${threatLabel(m.category)}`).join(", "),
        }),
      );
      setStep(2);
      return;
    }
    const n = fresh.view.proposals.length;
    const ok = await confirmDialog(
      n
        ? t("Complete the interview? {n} use cases will be linked to {system}, replacing the links of the previous interview. The interview becomes read-only.", {
            n,
            system: fresh.system_name,
          })
        : t("Complete the interview without accepted use cases? {system} will have no linked use cases. The interview becomes read-only.", {
            system: fresh.system_name,
          }),
      { confirmLabel: t("Complete interview") },
    );
    if (!ok) return;
    try {
      const done = await api.completeInterview(fresh.id, fresh.version);
      setIv(done);
      setForm(formOf(done));
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeDraft() {
    if (!iv) return;
    const ok = await confirmDialog(t("Delete this draft interview? The links of the system do not change."), {
      danger: true,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    try {
      await api.deleteInterview(iv.id);
      setDirty(false);
      navigate(`/systems/${iv.system_id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!iv || !form) {
    return (
      <>
        <ErrorNote error={loaded.error} />
        {!loaded.error && <p className="muted">{t("Loading…")}</p>}
      </>
    );
  }

  const pdf = api.interviewPdfUrl(iv.id, getLang());

  return (
    <>
      <nav className="crumbs" aria-label={t("Breadcrumb")}>
        <Link to="/systems">{t("Systems")}</Link> / <Link to={`/systems/${iv.system_id}`}>{iv.system_name}</Link> /{" "}
        <span>{t("Interview {date}", { date: fmtDate(iv.interview_date) })}</span>
      </nav>
      <header className="page-header">
        <div>
          <h1>{t("Interview: {system}", { system: iv.system_name })}</h1>
          <div className="subtitle">
            <span className={`pill iv-${iv.status}`}>{INTERVIEW_STATUS_LABEL[iv.status]}</span>{" "}
            {t("Analyst {name}", { name: iv.analyst })}
            {draft && iv.updated_at && ` · ${t("last saved {time} by {user}", { time: fmtTime(iv.updated_at), user: iv.updated_by })}`}
            {!draft && iv.completed_at && ` · ${t("completed {time} by {user}", { time: fmtTime(iv.completed_at), user: iv.completed_by ?? "" })}`}
          </div>
        </div>
        <div className="row-actions">
          <a className="btn" href={pdf} download>
            {t("Export PDF")}
          </a>
          {canEdit && (
            <>
              <button type="button" className="btn" disabled={busy || !dirty} onClick={() => void save()}>
                {t("Save draft")}
              </button>
              <button
                type="button"
                className={"btn" + (step === 3 ? " btn-primary" : "")}
                disabled={busy || !form.components.length}
                title={form.components.length ? undefined : t("Add at least one component before you continue.")}
                onClick={() => void complete()}
              >
                {t("Complete interview")}
              </button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="form-error-box" role="alert">
          <span>{error}</span>
          {conflict && (
            <button type="button" className="btn btn-sm" onClick={() => void loaded.reload()}>
              {t("Reload")}
            </button>
          )}
        </div>
      )}
      {savedAt && !dirty && !error && draft && (
        <p className="saved-tick small" role="status">
          {t("Draft saved.")}
        </p>
      )}
      {backup.offer && canEdit && (
        <DraftRestoreBanner
          at={backup.offer.at}
          onRestore={() => {
            setForm(backup.offer!.value);
            setDirty(true);
            backup.dismiss();
          }}
          onDiscard={backup.clear}
        />
      )}
      {iv.archived && draft && <p className="form-notice">{t("The system is archived. You can still complete or delete this draft.")}</p>}

      {draft ? (
        <>
          <div className="tabs" role="tablist" aria-label={t("Interview steps")}>
            {[t("1 · Context"), t("2 · Components and threats"), t("3 · Risks and use cases")].map((label, i) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={step === i + 1}
                className={"tab" + (step === i + 1 ? " active" : "")}
                onClick={() => void goto(i + 1)}
              >
                {label}
                {i === 2 && iv.view.log_source_mismatch.length > 0 && (
                  <span className="tab-count" title={t("Held back: log sources do not match ({n} use cases)", { n: iv.view.log_source_mismatch.length })}>
                    {t("{n} held back", { n: iv.view.log_source_mismatch.length })}
                  </span>
                )}
              </button>
            ))}
          </div>
          {step === 1 && (
            <StepContext
              iv={iv}
              form={form}
              update={update}
              readOnly={!canEdit}
              dateError={dateError}
              onAttachments={setAttachments}
            />
          )}
          {step === 2 && (
            <StepComponents form={form} update={update} readOnly={!canEdit} dupNames={dupNames} />
          )}
          {step === 3 && <StepProposals iv={iv} readOnly={!canEdit} saveWith={saveWith} busy={busy} />}
          {canEdit && (
            <div className="row-actions">
              <button type="button" className="btn btn-danger" onClick={() => void removeDraft()}>
                {t("Delete draft")}
              </button>
              <span className="grow" />
              {step > 1 && (
                <button type="button" className="btn" onClick={() => void goto(step - 1)}>
                  {t("Back")}
                </button>
              )}
              {step < 3 && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void goto(step + 1)}>
                  {t("Save and continue")}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <CompletedView iv={iv} editor={editor} onChange={(x) => setIv(x)} onAttachments={setAttachments} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ step 1 */

function StepContext({
  iv,
  form,
  update,
  readOnly,
  dateError,
  onAttachments,
}: {
  iv: IV;
  form: Form;
  update: (fn: (f: Form) => Form) => void;
  readOnly: boolean;
  dateError: string | null;
  onAttachments: (list: InterviewAttachment[]) => void;
}) {
  return (
    <>
      <section className="card stack">
        <div className="form-grid">
          <label className="field">
            {t("Interview date")} *
            <input
              className={"input" + (dateError ? " is-invalid" : "")}
              type="date"
              max={today()}
              min={iv.min_date ?? undefined}
              value={form.interview_date}
              disabled={readOnly}
              aria-invalid={!!dateError}
              onChange={(e) => update((f) => ({ ...f, interview_date: e.target.value }))}
            />
            {dateError && <span className="field-error">{dateError}</span>}
          </label>
          <label className="field">
            {t("Participants")}
            <input
              className="input"
              value={form.participants}
              maxLength={10000}
              disabled={readOnly}
              onChange={(e) => update((f) => ({ ...f, participants: e.target.value }))}
            />
          </label>
        </div>
        <MarkdownField
          label={t("Notes")}
          rows={6}
          value={form.notes}
          readOnly={readOnly}
          placeholder={t("Markdown: **bold**, *italic*, lists, links, tables")}
          onChange={(v) => update((f) => ({ ...f, notes: v }))}
        />
        <p className="muted small" style={{ margin: 0 }}>
          {t("System details such as owner, criticality and review interval are changed on the system page.")}{" "}
          <Link to={`/systems/${iv.system_id}`}>{t("Open system")}</Link>
        </p>
      </section>
      <Evidence iv={iv} editable={!readOnly} onChange={onAttachments} />
    </>
  );
}

/* ------------------------------------------------------------------ evidence (#34) */

const EVIDENCE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.vsd,.vsdx,.dia,.excalidraw,.tm7";


const KIND_LABEL: Record<InterviewAttachment["kind"], string> = {
  pdf: "PDF",
  image: t("Image"),
  diagram: t("Diagram"),
  threat_model: t("Threat model"),
};

function Evidence({
  iv,
  editable,
  onChange,
}: {
  iv: IV;
  editable: boolean;
  onChange: (list: InterviewAttachment[]) => void;
}) {
  return (
    <EvidenceFiles
      title={t("Evidence")}
      headingId="evh"
      files={iv.attachments ?? []}
      editable={editable}
      accept={EVIDENCE_ACCEPT}
      hint={t("PDF, images (JPG, PNG), diagrams (Visio, Dia, Excalidraw) and Threat Modeling Tool files (.tm7), up to 20 MB each. PDFs and images can be viewed here.")}
      upload={(f) => api.uploadAttachment(iv.id, f)}
      remove={(a) => api.deleteAttachment(a.id)}
      url={(a, download) => api.attachmentUrl(a.id, download)}
      onChange={onChange}
      label={(a) => <span className="chip chip-neutral">{KIND_LABEL[a.kind]}</span>}
      removeQuestion={(a) => t("Remove {file} from the interview?", { file: a.filename })}
    />
  );
}

/* ------------------------------------------------------------------ step 2 */

function StepComponents({
  form,
  update,
  readOnly,
  dupNames,
}: {
  form: Form;
  update: (fn: (f: Form) => Form) => void;
  readOnly: boolean;
  dupNames: Set<string>;
}) {
  const refs = useLoad<RefItem[]>(() => api.refs("log_source"));
  const techniques = useLoad(() => api.attackTechniques());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [extraRefs, setExtraRefs] = useState<RefItem[]>([]);
  const options = [...(refs.data ?? []), ...extraRefs]
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
    .map((r) => ({ value: String(r.id), label: r.name }));

  const setComp = (key: string, patch: Partial<FormComponent>) =>
    update((f) => ({ ...f, components: f.components.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));

  async function setThreat(c: FormComponent, cat: Stride, patch: Partial<FormThreat>) {
    const cur = threatOf(c, cat);
    if (patch.state && patch.state !== "applies" && cur.state === "applies") {
      const n = dependents(form, (r) => r.component === c.key && r.category === cat);
      if (
        n &&
        !(await confirmDialog(
          t("{n} detection requests or added use cases belong to this threat. They are removed when you save. Continue?", { n }),
        ))
      )
        return;
    }
    const next = { ...cur, ...patch };
    setComp(c.key, { threats: [...c.threats.filter((x) => x.category !== cat), next] });
  }

  async function removeCustom(c: FormComponent, x: CustomThreatForm) {
    const cat = `custom:${x.key}`;
    const n = dependents(form, (r) => r.component === c.key && r.category === cat);
    const ok = await confirmDialog(
      n
        ? t("Remove the threat {name}? {n} detection requests or added use cases tied to it are removed too.", { name: x.title || "–", n })
        : t("Remove the threat {name}?", { name: x.title || "–" }),
      { danger: true, confirmLabel: t("Remove") },
    );
    if (ok) setComp(c.key, { custom_threats: (c.custom_threats ?? []).filter((y) => y.key !== x.key) });
  }

  async function removeComp(c: FormComponent) {
    const n = dependents(form, (r) => r.component === c.key);
    const ok = await confirmDialog(
      n
        ? t("Remove component {name}? {n} detection requests or added use cases tied to its threats are removed too.", { name: c.name || "–", n })
        : t("Remove component {name}?", { name: c.name || "–" }),
      { danger: true, confirmLabel: t("Remove") },
    );
    if (ok) update((f) => ({ ...f, components: f.components.filter((x) => x.key !== c.key) }));
  }

  const addComp = () =>
    update((f) => ({
      ...f,
      components: [...f.components, { key: newKey(), name: "", description: "", log_source_ids: [], threats: [], custom_threats: [] }],
    }));

  return (
    <div className="stack">
      <ErrorNote error={refs.error} />
      {!form.components.length && (
        <div className="note-box">
          {t("Split the system into a few components (e.g. web front end, API, database, admin access) and go through the six STRIDE categories for each.")}
        </div>
      )}
      {form.components.map((c, idx) => {
        const open = !collapsed.has(c.key);
        const dup = dupNames.has(c.name.trim().toLowerCase());
        const bad = c.threats.filter(incomplete).length + (c.custom_threats ?? []).filter(customIncomplete).length;
        return (
          <section key={c.key} className="card stack-sm iv-comp" aria-label={c.name || t("Component {n}", { n: idx + 1 })}>
            <div className="section-head">
              <button
                type="button"
                className="link-btn iv-toggle"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s);
                    if (n.has(c.key)) n.delete(c.key);
                    else n.add(c.key);
                    return n;
                  })
                }
              >
                {open ? "▾" : "▸"} {c.name || t("Component {n}", { n: idx + 1 })}
              </button>
              <span className="small muted">
                {t("{n} threats apply", { n: c.threats.filter((x) => x.state === "applies").length + (c.custom_threats ?? []).length })}
                {bad > 0 && (
                  <>
                    {" · "}
                    <span className="text-err">{t("{n} incomplete", { n: bad })}</span>
                  </>
                )}
              </span>
              <span className="grow" />
              {!readOnly && (
                <button type="button" className="btn btn-sm" onClick={() => void removeComp(c)}>
                  {t("Remove")}
                </button>
              )}
            </div>
            {open && (
              <>
                <div className="form-grid">
                  <label className="field">
                    {t("Component name")} *
                    <input
                      className={"input" + (dup || !c.name.trim() ? " is-invalid" : "")}
                      value={c.name}
                      maxLength={255}
                      disabled={readOnly}
                      aria-invalid={dup || !c.name.trim()}
                      onChange={(e) => setComp(c.key, { name: e.target.value })}
                    />
                    {dup && <span className="field-error">{t("Another component has this name.")}</span>}
                  </label>
                  <MultiSelect
                    label={t("Log sources the component delivers")}
                    options={options}
                    value={c.log_source_ids.map(String)}
                    disabled={readOnly}
                    onChange={(v) => setComp(c.key, { log_source_ids: v.map(Number) })}
                    onCreate={async (name) => {
                      const item = await api.createRef("log_source", { name, description: "" });
                      setExtraRefs((x) => [...x, item]);
                      return String(item.id);
                    }}
                  />
                </div>
                <label className="field">
                  {t("Description")}
                  <textarea
                    className="input textarea"
                    rows={2}
                    maxLength={10000}
                    value={c.description}
                    disabled={readOnly}
                    onChange={(e) => setComp(c.key, { description: e.target.value })}
                  />
                </label>
                <div className="iv-threats">
                  {STRIDE.map((cat) => {
                    const x = threatOf(c, cat);
                    const s = score(x);
                    const inc = incomplete(x);
                    return (
                      <div key={cat} className={"iv-threat" + (inc ? " is-incomplete" : "")}>
                        <div className="iv-threat-head">
                          <div>
                            <strong>{STRIDE_LABEL[cat]}</strong>
                            <div className="small muted">{STRIDE_HINT[cat]}</div>
                          </div>
                          <div className="view-toggle" role="radiogroup" aria-label={STRIDE_LABEL[cat]}>
                            {(["applies", "does_not_apply", "not_discussed"] as ThreatState[]).map((st) => (
                              <button
                                key={st}
                                type="button"
                                role="radio"
                                aria-checked={x.state === st}
                                disabled={readOnly}
                                className={"filter-chip" + (x.state === st ? " active" : "")}
                                onClick={() => void setThreat(c, cat, { state: st })}
                              >
                                {STATE_LABEL[st]}
                              </button>
                            ))}
                          </div>
                        </div>
                        {x.state === "applies" && (
                          <div className="iv-threat-body">
                            <label className="field grow-2">
                              {t("Threat description")} *
                              <textarea
                                className={"input textarea" + (inc && !x.description.trim() ? " is-invalid" : "")}
                                rows={2}
                                maxLength={10000}
                                value={x.description}
                                disabled={readOnly}
                                onChange={(e) => void setThreat(c, cat, { description: e.target.value })}
                              />
                            </label>
                            <label className="field">
                              {t("Likelihood (1–5)")} *
                              <select
                                className={"input" + (inc && !x.likelihood ? " is-invalid" : "")}
                                value={x.likelihood ?? ""}
                                disabled={readOnly}
                                onChange={(e) =>
                                  void setThreat(c, cat, { likelihood: e.target.value ? Number(e.target.value) : null })
                                }
                              >
                                <option value="">–</option>
                                {RATINGS.map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              {t("Impact (1–5)")} *
                              <select
                                className={"input" + (inc && !x.impact ? " is-invalid" : "")}
                                value={x.impact ?? ""}
                                disabled={readOnly}
                                onChange={(e) =>
                                  void setThreat(c, cat, { impact: e.target.value ? Number(e.target.value) : null })
                                }
                              >
                                <option value="">–</option>
                                {RATINGS.map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="field">
                              {t("Risk score")}
                              <div className="iv-score" aria-live="polite">
                                <RiskScore value={s} />
                              </div>
                            </div>
                            {inc && (
                              <span className="field-error iv-inc">
                                {t("Incomplete: description, likelihood and impact are needed.")}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <CustomThreats
                  c={c}
                  readOnly={readOnly}
                  techniques={techniques.data ?? []}
                  onChange={(list) => setComp(c.key, { custom_threats: list })}
                  onRemove={(x) => void removeCustom(c, x)}
                />
              </>
            )}
          </section>
        );
      })}
      {!readOnly && (
        <div>
          <button type="button" className="btn" onClick={addComp}>
            {t("+ Component")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ custom ATT&CK threats (#60) */

type CustomThreatForm = FormComponent["custom_threats"][number];

const customScore = (x: CustomThreatForm) => (x.likelihood && x.impact ? x.likelihood * x.impact : null);
const customIncomplete = (x: CustomThreatForm) => !x.title.trim() || !x.techniques.length || !x.likelihood || !x.impact;

function CustomThreats({
  c,
  readOnly,
  techniques,
  onChange,
  onRemove,
}: {
  c: FormComponent;
  readOnly: boolean;
  techniques: { id: string; name: string }[];
  onChange: (list: CustomThreatForm[]) => void;
  onRemove: (x: CustomThreatForm) => void;
}) {
  const list = c.custom_threats ?? [];
  const names = useMemo(() => new Map(techniques.map((x) => [x.id, x.name])), [techniques]);
  const set = (key: string, patch: Partial<CustomThreatForm>) => onChange(list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const add = () =>
    onChange([...list, { key: newKey(), title: "", description: "", techniques: [], likelihood: null, impact: null }]);
  if (readOnly && !list.length) return null;
  return (
    <div className="iv-custom stack-sm">
      <div className="section-head">
        <div>
          <strong>{t("Further threats (MITRE ATT&CK)")}</strong>
          <div className="small muted">
            {t("Optional: a detailed threat beyond STRIDE, linked to ATT&CK techniques. Use cases whose rules cover a technique are proposed.")}
          </div>
        </div>
        {!readOnly && (
          <button type="button" className="btn btn-sm" onClick={add}>
            {t("+ Custom threat")}
          </button>
        )}
      </div>
      {list.map((x) => {
        const inc = customIncomplete(x);
        return (
          <div key={x.key} className={"iv-threat" + (inc ? " is-incomplete" : "")}>
            <div className="iv-threat-body">
              <label className="field grow-2">
                {t("Threat")} *
                <input
                  className={"input" + (inc && !x.title.trim() ? " is-invalid" : "")}
                  value={x.title}
                  maxLength={255}
                  disabled={readOnly}
                  placeholder={t("e.g. Password spraying against the login")}
                  onChange={(e) => set(x.key, { title: e.target.value })}
                />
              </label>
              <label className="field">
                {t("Likelihood (1–5)")} *
                <select
                  className={"input" + (inc && !x.likelihood ? " is-invalid" : "")}
                  value={x.likelihood ?? ""}
                  disabled={readOnly}
                  onChange={(e) => set(x.key, { likelihood: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">–</option>
                  {RATINGS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("Impact (1–5)")} *
                <select
                  className={"input" + (inc && !x.impact ? " is-invalid" : "")}
                  value={x.impact ?? ""}
                  disabled={readOnly}
                  onChange={(e) => set(x.key, { impact: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">–</option>
                  {RATINGS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                {t("Risk score")}
                <div className="iv-score" aria-live="polite">
                  <RiskScore value={customScore(x)} />
                </div>
              </div>
              <TechniquePicker
                value={x.techniques}
                names={names}
                techniques={techniques}
                disabled={readOnly}
                invalid={inc && !x.techniques.length}
                onChange={(v) => set(x.key, { techniques: v })}
              />
              <label className="field grow-2">
                {t("Threat description")}
                <textarea
                  className="input textarea"
                  rows={2}
                  maxLength={10000}
                  value={x.description}
                  disabled={readOnly}
                  onChange={(e) => set(x.key, { description: e.target.value })}
                />
              </label>
              {!readOnly && (
                <div className="field">
                  <span aria-hidden="true">&nbsp;</span>
                  <button type="button" className="btn btn-sm" onClick={() => onRemove(x)}>
                    {t("Remove")}
                  </button>
                </div>
              )}
              {inc && (
                <span className="field-error iv-inc">{t("Incomplete: threat, at least one ATT&CK technique, likelihood and impact are needed.")}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ step 3 */

const proposalKey = (p: Proposal) => (p.level === "L3" ? `l3-${p.l3_id}` : `l2-${p.l2_id}`);

function ProposalCard({ p, children }: { p: Proposal; children?: ReactNode }) {
  const level = p.level ?? "L2";
  return (
    <div className="iv-proposal">
      <div className="iv-proposal-head">
        <span className={`lvl lvl-${level}`}>{level}</span>
        <Link className="code-link" to={useCaseHref({ level, code: p.code })}>
          <span className="code-tag">{p.code}</span>
          <span>{p.name}</span>
        </Link>
        {level === "L3" && p.l2_code && (
          <span className="small muted">{t("rule of {code} {name}", { code: p.l2_code, name: p.l2_name ?? "" })}</span>
        )}
        {p.deleted && <span className="badge-gap">{t("deleted")}</span>}
        {!p.l1_applicable && <span className="chip chip-neutral">{t("L1 not applicable")}</span>}
        {p.manual && <span className="chip chip-info">{t("added by hand")}</span>}
        {p.detection === "no_rules" && p.rules.length > 0 && (
          <span className="badge-gap">{level === "L3" ? t("Rule not active") : t("No active rule")}</span>
        )}
        <span className="grow" />
        <span className="small muted">{t("Risk score")}</span> <RiskScore value={p.risk_score} />
        {children}
      </div>
      {p.sources.length > 0 && (
        <div className="small muted">
          {t("From")}: {p.sources.map((s) => `${s.component_name} / ${threatLabel(s.category)} (${s.score ?? "–"})`).join("; ")}
        </div>
      )}
      {p.threats && p.threats.length > 0 && (
        <div className="small">
          {t("Removed from")}: {p.threats.map((x) => `${x.component_name} / ${threatLabel(x.category)}`).join("; ")}
        </div>
      )}
      {p.reason && <div className="small">{t("Reason: {reason}", { reason: p.reason })}</div>}
      {p.rules.length > 0 ? (
        <ul className="plain-list iv-rules">
          {p.rules.map((r) => (
            <li key={r.code} className={r.active === false ? "muted" : undefined}>
              <span className="mono small">{r.code}</span> {r.name} <StatusPill status={r.lifecycle_status} />{" "}
              {r.active === false ? (
                <span className="small muted">{t("not counted (inactive)")}</span>
              ) : r.unknown ? (
                <span className="pill pill-none">{t("Log source unknown")}</span>
              ) : r.coverage === "partial" ? (
                <span className="chip chip-neutral" title={r.missing.join(", ")}>
                  {t("Partly delivered, missing: {list}", { list: r.missing.join(", ") })}
                </span>
              ) : r.missing.length ? (
                <span className="badge-gap" title={r.missing.join(", ")}>
                  {t("Log source missing: {list}", { list: r.missing.join(", ") })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        !p.reason && !p.threats?.length && <div className="small"><span className="badge-gap">{t("No rules")}</span></div>
      )}
    </div>
  );
}

function StepProposals({
  iv,
  readOnly,
  saveWith,
  busy,
}: {
  iv: IV;
  readOnly: boolean;
  saveWith: (fn: (f: Form) => Form) => Promise<IV | null>;
  busy: boolean;
}) {
  const v = iv.view;
  const [removing, setRemoving] = useState<Proposal | null>(null);
  const [adding, setAdding] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"risk" | "usecase">("risk");
  const [showBelow, setShowBelow] = useState(false);
  const [showMismatch, setShowMismatch] = useState(true);
  const [request, setRequest] = useState<{ text: string; threat: string }>({ text: "", threat: "" });
  const threatOptions = v.components.flatMap((c) =>
    c.threats
      .filter((x) => x.state === "applies")
      .map((x) => ({ value: `${c.key}:${x.category}`, label: `${c.name} / ${threatLabel(x.category)}` })),
  );
  const ref = (value: string): ThreatRef => {
    const i = value.lastIndexOf(":");
    return { component: value.slice(0, i), category: value.slice(i + 1) as Stride };
  };
  const addL2 = (l2_id: number, threats: ThreatRef[]) =>
    saveWith((f) => {
      const existing = f.added.find((a) => a.l2_id === l2_id);
      const added = existing
        ? f.added.map((a) =>
            a.l2_id === l2_id
              ? { ...a, threats: [...a.threats, ...threats.filter((x) => !a.threats.some((y) => y.component === x.component && y.category === x.category))] }
              : a,
          )
        : [...f.added, { l2_id, threats }];
      // a whole removal ends; a removal from single risks (#57) ends for the risks added again
      const removed = f.removed.flatMap((r) => {
        if (r.l2_id !== l2_id) return [r];
        const rest = (r.threats ?? []).filter((x) => !threats.some((y) => sameRef(x, y)));
        return rest.length ? [{ ...r, threats: rest }] : [];
      });
      return { ...f, added, removed };
    });
  const addL3 = (l3_id: number, threats: ThreatRef[]) =>
    saveWith((f) => {
      const existing = f.added.find((a) => a.l3_id === l3_id);
      const added = existing
        ? f.added.map((a) =>
            a.l3_id === l3_id
              ? { ...a, threats: [...a.threats, ...threats.filter((x) => !a.threats.some((y) => y.component === x.component && y.category === x.category))] }
              : a,
          )
        : [...f.added, { l3_id, threats }];
      return { ...f, added };
    });
  const removeL3 = (l3_id: number) => saveWith((f) => ({ ...f, added: f.added.filter((a) => a.l3_id !== l3_id) }));
  /** #57: take a use case off one risk; a proposed L2 keeps the other risks it was proposed for */
  const unassign = (r: RiskRow, u: RiskUseCase, reason = "") =>
    saveWith((f) => {
      const ref: ThreatRef = { component: r.component, category: r.category };
      const isL3 = u.level === "L3";
      const added = f.added
        .map((a) =>
          (isL3 ? a.l3_id === u.l3_id : !a.l3_id && a.l2_id === u.l2_id)
            ? { ...a, threats: a.threats.filter((x) => !sameRef(x, ref)) }
            : a,
        )
        .filter((a) => a.threats.length);
      if (isL3 || !u.auto) return { ...f, added };
      const cur = f.removed.find((x) => x.l2_id === u.l2_id);
      const threats = [...(cur?.threats ?? []).filter((x) => !sameRef(x, ref)), ref];
      return {
        ...f,
        added,
        removed: [...f.removed.filter((x) => x.l2_id !== u.l2_id), { l2_id: u.l2_id, reason: reason || cur?.reason || "", threats }],
      };
    });
  const [unassigning, setUnassigning] = useState<{ r: RiskRow; u: RiskUseCase } | null>(null);
  const switcher = (
    <div className="view-switch" role="group" aria-label={t("View")}>
      <button type="button" className={mode === "risk" ? "active" : ""} aria-pressed={mode === "risk"} onClick={() => setMode("risk")}>
        {t("By risk")}
      </button>
      <button type="button" className={mode === "usecase" ? "active" : ""} aria-pressed={mode === "usecase"} onClick={() => setMode("usecase")}>
        {t("By use case")}
      </button>
    </div>
  );

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        {t("Proposed: every L2 use case mapped to the STRIDE category of a threat with a risk score of at least {n} (likelihood × impact).", {
          n: v.threshold,
        })}{" "}
        {v.components.some((c) => c.threats.some((x) => x.custom)) &&
          t("Custom threats propose the L2 use cases whose rules cover one of their ATT&CK techniques.")}{" "}
        {v.log_source_filter && t("Use cases whose active rules need other log sources than the component delivers are held back.")}{" "}
        <Link to="/stride-mapping">{t("STRIDE mapping")}</Link>
      </p>
      {(v.components_without_log_sources?.length ?? 0) > 0 && (
        <div className="note-box">
          {t("These components deliver no log source yet, so their proposals cannot be checked: {list}. Add their log sources in step 2.", {
            list: (v.components_without_log_sources ?? []).join(", "),
          })}
        </div>
      )}
      {(v.no_detection?.length ?? 0) > 0 && (
        <div className="note-box">
          {t("Nothing detects these accepted use cases yet (no active rule): {list}. They become gaps of the system.", {
            list: (v.no_detection ?? []).join(", "),
          })}
        </div>
      )}
      {v.mapping_empty && <div className="note-box">{t("There is no STRIDE mapping yet, so nothing is proposed automatically. You can add use cases by hand.")}</div>}

      {mode === "risk" && (
        <RiskCoverage
          risks={v.risks ?? []}
          components={v.components}
          onAdd={readOnly ? undefined : (r) => setAdding([`${r.component}:${r.category}`])}
          onRemove={
            readOnly
              ? undefined
              : (r, u) => (u.level !== "L3" && u.auto ? setUnassigning({ r, u }) : void unassign(r, u))
          }
          addDisabled={busy}
          actions={
            <div className="row-actions">
              {switcher}
              {!readOnly && (
                <button type="button" className="btn btn-sm" disabled={busy || !threatOptions.length} onClick={() => setAdding([])}>
                  {t("+ Add use case")}
                </button>
              )}
            </div>
          }
        />
      )}

      {mode === "usecase" && (
      <section className="card stack-sm" aria-labelledby="proph">
        <div className="section-head">
          <h2 id="proph">{t("Accepted use cases ({n})", { n: v.proposals.length })}</h2>
          <div className="row-actions">
            {switcher}
            {!readOnly && (
              <button type="button" className="btn btn-sm" disabled={busy || !threatOptions.length} onClick={() => setAdding([])}>
                {t("+ Add use case")}
              </button>
            )}
          </div>
        </div>
        {!v.proposals.length && (
          <p className="muted" style={{ margin: 0 }}>
            {threatOptions.length
              ? t("No use case is proposed for the threats of this interview.")
              : t("No threat applies, so nothing is proposed.")}
          </p>
        )}
        {v.proposals.map((p) => (
          <ProposalCard key={proposalKey(p)} p={p}>
            {!readOnly && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => (p.level === "L3" && p.l3_id ? void removeL3(p.l3_id) : setRemoving(p))}
              >
                {t("Remove")}
              </button>
            )}
          </ProposalCard>
        ))}
      </section>
      )}

      {v.below_threshold.length > 0 && (
        <section className="card stack-sm">
          <button type="button" className="link-btn iv-toggle" aria-expanded={showBelow} onClick={() => setShowBelow((x) => !x)}>
            {showBelow ? "▾" : "▸"} {t("Below threshold ({n} threats)", { n: v.below_threshold.length })}
          </button>
          {showBelow &&
            v.below_threshold.map((b) => (
              <div key={`${b.component}:${b.category}`} className="iv-below">
                <div>
                  <strong>
                    {b.component_name} / {threatLabel(b.category)}
                  </strong>{" "}
                  <RiskScore value={b.score} />
                </div>
                {b.l2s.length ? (
                  <ul className="plain-list">
                    {b.l2s.map((l) => {
                      const shown = v.proposals.some((p) => p.l2_id === l.l2_id);
                      return (
                        <li key={l.l2_id}>
                          <span className="mono small">{l.code}</span> {l.name}{" "}
                          {!l.l1_applicable && <span className="chip chip-neutral">{t("L1 not applicable")}</span>}{" "}
                          {shown ? (
                            <span className="small muted">{t("accepted")}</span>
                          ) : (
                            !readOnly && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={busy}
                                onClick={() => void addL2(l.l2_id, [{ component: b.component, category: b.category }])}
                              >
                                {t("Add")}
                              </button>
                            )
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    {t("No use case is mapped to this category.")}
                  </p>
                )}
              </div>
            ))}
        </section>
      )}

      {v.log_source_mismatch.length > 0 && (
        <section className="card stack-sm">
          <button type="button" className="link-btn iv-toggle" aria-expanded={showMismatch} onClick={() => setShowMismatch((x) => !x)}>
            {showMismatch ? "▾" : "▸"} {t("Held back: log sources do not match ({n} use cases)", { n: v.log_source_mismatch.length })}
          </button>
          {showMismatch && (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                {t("Mapped to a threat at or above the threshold, but no active rule of the use case uses a log source the component delivers. Add log sources to the component, or add the use case anyway.")}
              </p>
              {v.log_source_mismatch.map((m) => (
                <div key={m.l2_id} className="iv-below">
                  <div>
                    <span className="mono small">{m.code}</span> {m.name} <RiskScore value={m.risk_score} />{" "}
                    {!readOnly && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void addL2(
                            m.l2_id,
                            m.sources.map((s) => ({ component: s.component, category: s.category })),
                          )
                        }
                      >
                        {t("Add anyway")}
                      </button>
                    )}
                  </div>
                  <div className="small muted">
                    {t("Use case needs")}: {m.log_sources.length ? m.log_sources.join(", ") : t("no log source recorded on its rules")}
                  </div>
                  <ul className="plain-list small">
                    {m.sources.map((s) => (
                      <li key={`${s.component}:${s.category}`}>
                        {s.component_name} / {threatLabel(s.category)} ({s.score ?? "–"}) ·{" "}
                        <span className="muted">
                          {t("component delivers")}: {s.component_log_sources.length ? s.component_log_sources.join(", ") : t("no log sources")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {v.removed.length > 0 && (
        <section className="card stack-sm" aria-labelledby="remh">
          <h2 id="remh" className="h-sm">
            {t("Removed ({n})", { n: v.removed.length })}
          </h2>
          {v.removed.map((p) => (
            <ProposalCard key={proposalKey(p)} p={{ ...p, rules: [] }}>
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => void saveWith((f) => ({ ...f, removed: f.removed.filter((r) => r.l2_id !== p.l2_id) }))}
                >
                  {t("Restore")}
                </button>
              )}
            </ProposalCard>
          ))}
        </section>
      )}

      <section className="card stack-sm" aria-labelledby="reqh">
        <h2 id="reqh" className="h-sm">
          {t("Detection requests")}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {t("Detection needs from the interview that no use case covers yet.")}
        </p>
        {v.requests.length > 0 && (
          <ul className="plain-list">
            {v.requests.map((r) => (
              <li key={r.key || r.text}>
                {r.text}{" "}
                <span className="small muted">
                  · {r.component_name} / {threatLabel(r.category)}
                </span>{" "}
                {!readOnly && (
                  <button
                    type="button"
                    className="link-btn small"
                    disabled={busy}
                    onClick={() =>
                      void saveWith((f) => ({ ...f, requests: f.requests.filter((x) => !(x.key === r.key && x.text === r.text)) }))
                    }
                  >
                    {t("Remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!request.text.trim() || !request.threat) return;
              void saveWith((f) => ({
                ...f,
                requests: [...f.requests, { key: newKey(), text: request.text.trim(), threat: ref(request.threat) }],
              })).then((ok) => ok && setRequest({ text: "", threat: "" }));
            }}
          >
            <label className="field grow-2">
              {t("Detection request")}
              <input
                className="input"
                value={request.text}
                maxLength={10000}
                onChange={(e) => setRequest((r) => ({ ...r, text: e.target.value }))}
              />
            </label>
            <label className="field">
              {t("Threat")}
              <select className="input" value={request.threat} onChange={(e) => setRequest((r) => ({ ...r, threat: e.target.value }))}>
                <option value="">{t("Choose a threat")}</option>
                {threatOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn" disabled={busy || !request.text.trim() || !request.threat}>
              {t("Add")}
            </button>
          </form>
        )}
      </section>

      {removing && (
        <RemoveDialog
          p={removing}
          onClose={() => setRemoving(null)}
          onRemove={(reason) =>
            void saveWith((f) => ({
              ...f,
              added: f.added.filter((a) => a.l2_id !== removing.l2_id),
              removed: [...f.removed.filter((r) => r.l2_id !== removing.l2_id), { l2_id: removing.l2_id, reason }],
            })).then(() => setRemoving(null))
          }
        />
      )}
      {unassigning && (
        <RemoveDialog
          p={{ code: unassigning.u.code }}
          title={t("Remove {code} from {risk}?", {
            code: unassigning.u.code,
            risk: `${unassigning.r.component_name} / ${threatLabel(unassigning.r.category)}`,
          })}
          hint={t("The use case was proposed automatically. It stays accepted for its other risks; you can restore it under Removed.")}
          onClose={() => setUnassigning(null)}
          onRemove={(reason) => void unassign(unassigning.r, unassigning.u, reason).then(() => setUnassigning(null))}
        />
      )}
      {adding && (
        <AddDialog
          options={threatOptions}
          initial={adding}
          excludeL2={new Set(v.proposals.filter((p) => p.level !== "L3").map((p) => p.l2_id))}
          excludeL3={new Set(v.proposals.filter((p) => p.level === "L3").map((p) => p.l3_id!))}
          onClose={() => setAdding(null)}
          onAdd={(level, id, refs) =>
            void (level === "L3" ? addL3(id, refs.map(ref)) : addL2(id, refs.map(ref))).then((ok) => ok && setAdding(null))
          }
        />
      )}
    </div>
  );
}

function RemoveDialog({
  p,
  title,
  hint,
  onClose,
  onRemove,
}: {
  p: { code: string };
  title?: string;
  hint?: string;
  onClose: () => void;
  onRemove: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={title ?? t("Remove {code}?", { code: p.code })} open onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onRemove(reason);
        }}
      >
        {hint && <p className="muted small" style={{ margin: 0 }}>{hint}</p>}
        <label className="field">
          {t("Reason (optional)")}
          <textarea className="input textarea" rows={3} maxLength={10000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary">
            {t("Remove")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddDialog({
  options,
  initial,
  excludeL2,
  excludeL3,
  initialTechnique,
  onClose,
  onAdd,
}: {
  options: { value: string; label: string }[];
  /** threats ticked when the dialog opens (e.g. the risk it was opened from) */
  initial: string[];
  excludeL2: Set<number>;
  excludeL3: Set<number>;
  /** ATT&CK technique filter set when the dialog opens */
  initialTechnique?: string;
  onClose: () => void;
  onAdd: (level: "L2" | "L3", id: number, threats: string[]) => void;
}) {
  const l2s = useLoad<L2[]>(() => api.l2s());
  const l3s = useLoad<L3[]>(() => api.l3s());
  const l1s = useLoad(() => api.l1s());
  const [level, setLevel] = useState<"L2" | "L3">("L2");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<{ level: "L2" | "L3"; id: number } | null>(null);
  const [threats, setThreats] = useState<string[]>(initial);
  const [tried, setTried] = useState(false);
  // #58: narrow the list to use cases whose rules use a log source or ATT&CK technique
  const [logSource, setLogSource] = useState("");
  const [technique, setTechnique] = useState(initialTechnique ?? "");
  const na = new Set((l1s.data ?? []).filter((x) => !x.applicable).map((x) => x.code));
  const q = query.trim().toLowerCase();
  const match = (code: string, name: string) => !q || code.toLowerCase().includes(q) || name.toLowerCase().includes(q);
  const facets = useMemo(() => {
    const ls = new Set<string>();
    const tt = new Set<string>();
    // L2 code -> log sources / techniques of its rules
    const byL2 = new Map<string, { ls: Set<string>; tt: Set<string> }>();
    for (const r of l3s.data ?? []) {
      const e = byL2.get(r.l2_code) ?? { ls: new Set<string>(), tt: new Set<string>() };
      byL2.set(r.l2_code, e);
      for (const x of r.log_sources) {
        ls.add(x);
        e.ls.add(x);
      }
      for (const x of r.attack_techniques) {
        tt.add(x);
        e.tt.add(x);
      }
    }
    const sort = (x: Set<string>) => [...x].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { logSources: sort(ls), techniques: sort(tt), byL2 };
  }, [l3s.data]);
  const tq = technique.trim().toUpperCase();
  // T1059 also finds its sub-techniques (T1059.001)
  const ttpMatch = (list: Iterable<string>) => {
    if (!tq) return true;
    for (const x of list) if (x.toUpperCase() === tq || x.toUpperCase().startsWith(tq + ".")) return true;
    return false;
  };
  const lsMatch = (list: Iterable<string>) => {
    if (!logSource) return true;
    for (const x of list) if (x === logSource) return true;
    return false;
  };
  const facetMatch = (lsList: Iterable<string>, ttList: Iterable<string>) => lsMatch(lsList) && ttpMatch(ttList);
  const filtering = !!logSource || !!tq;
  const items =
    level === "L2"
      ? (l2s.data ?? [])
          .filter((x) => !excludeL2.has(x.id) && match(x.code, x.name))
          .filter((x) => {
            if (!filtering) return true;
            const f = facets.byL2.get(x.code);
            return !!f && facetMatch(f.ls, f.tt);
          })
          .map((x) => ({ id: x.id, code: x.code, name: x.name, sub: "", l1: x.l1_code, status: null }))
      : (l3s.data ?? [])
          .filter((x) => !excludeL3.has(x.id) && match(x.code, x.name) && facetMatch(x.log_sources, x.attack_techniques))
          .map((x) => ({ id: x.id, code: x.code, name: x.name, sub: x.l2_code, l1: x.l1_code, status: x.lifecycle_status }));
  const LIMIT = 200;
  const pick = chosen && chosen.level === level ? chosen : null;
  const pickedItem = pick ? items.find((x) => x.id === pick.id) : undefined;
  const loading = level === "L2" ? !l2s.data && !l2s.error : !l3s.data && !l3s.error;
  return (
    <Modal title={t("Add a use case by hand")} open onClose={onClose} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!pick || !threats.length) return;
          onAdd(pick.level, pick.id, threats);
        }}
      >
        <ErrorNote error={l2s.error ?? l3s.error} />
        <div className="section-head">
          <div className="view-switch" role="group" aria-label={t("Level")}>
            <button type="button" className={level === "L2" ? "active" : ""} aria-pressed={level === "L2"} onClick={() => setLevel("L2")}>
              {t("L2 use case")}
            </button>
            <button type="button" className={level === "L3" ? "active" : ""} aria-pressed={level === "L3"} onClick={() => setLevel("L3")}>
              {t("L3 rule")}
            </button>
          </div>
          <span className="small muted">
            {level === "L2" ? t("All active rules of the use case count.") : t("Only this rule counts; its priority is raised by the system risk.")}
          </span>
        </div>
        <label className="field">
          {t("Search")}
          <input
            className="input"
            type="search"
            value={query}
            placeholder={level === "L2" ? t("Code or name, e.g. AO-ACC") : t("Code or name, e.g. AO-ACC-01")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="inline-form uc-picker-filters">
          <label className="field">
            {t("Log source")}
            <select className="input" value={logSource} onChange={(e) => setLogSource(e.target.value)}>
              <option value="">{t("Any log source")}</option>
              {facets.logSources.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("MITRE ATT&CK technique")}
            <input
              className="input mono"
              list="uc-picker-ttps"
              value={technique}
              placeholder={t("e.g. T1110 or T1059.001")}
              onChange={(e) => setTechnique(e.target.value)}
            />
            <datalist id="uc-picker-ttps">
              {facets.techniques.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          {filtering && (
            <button
              type="button"
              className="link-btn small"
              onClick={() => {
                setLogSource("");
                setTechnique("");
              }}
            >
              {t("Clear filters")}
            </button>
          )}
        </div>
        {filtering && (
          <p className="muted small" style={{ margin: 0 }}>
            {level === "L2"
              ? t("Showing L2 use cases with at least one rule that matches the filters.")
              : t("Showing L3 rules that match the filters.")}
          </p>
        )}
        <div className={"uc-picker-list" + (tried && !pick ? " is-invalid" : "")} role="radiogroup" aria-label={level === "L2" ? t("L2 use case") : t("L3 rule")}>
          {loading && <p className="muted small" style={{ margin: 8 }}>{t("Loading…")}</p>}
          {!loading && !items.length && <p className="muted small" style={{ margin: 8 }}>{t("Nothing matches.")}</p>}
          {items.slice(0, LIMIT).map((x) => (
            <label key={x.id} className={pick?.id === x.id ? "is-chosen" : undefined}>
              <input type="radio" name="uc" checked={pick?.id === x.id} onChange={() => setChosen({ level, id: x.id })} />
              <span>
                <span className="mono small">{x.code}</span> {x.name}
                <span className="uc-sub">
                  {x.sub && ` · ${t("in {code}", { code: x.sub })}`}
                  {na.has(x.l1) && ` · ${t("L1 not applicable")}`}
                </span>{" "}
                {x.status && <StatusPill status={x.status} />}
              </span>
            </label>
          ))}
          {items.length > LIMIT && <p className="muted small" style={{ margin: 8 }}>{t("{n} more; refine the search.", { n: items.length - LIMIT })}</p>}
        </div>
        {tried && !pick && <span className="field-error">{t("Choose a use case.")}</span>}
        {pickedItem && na.has(pickedItem.l1) && <p className="form-notice">{t("This use case belongs to an L1 marked as not applicable.")}</p>}
        <fieldset className="fieldset">
          <legend className="small strong">{t("Threats it covers (at least one)")}</legend>
          {options.map((o) => (
            <label key={o.value} className="check">
              <input
                type="checkbox"
                checked={threats.includes(o.value)}
                onChange={() => setThreats((x) => (x.includes(o.value) ? x.filter((y) => y !== o.value) : [...x, o.value]))}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
        {tried && !threats.length && <span className="field-error">{t("Choose at least one threat of the interview.")}</span>}
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary">
            {t("Add")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ completed interview */

function ThreatTable({ components }: { components: ComponentView[] }) {
  return (
    <div className="stack-sm">
      {components.map((c) => {
        const on = c.threats.filter((x) => x.state === "applies");
        return (
          <div key={c.key} className="iv-done-comp">
            <h3 className="h-sm" style={{ margin: 0 }}>
              {c.name}
            </h3>
            {c.description && <p className="small ink-2" style={{ margin: 0 }}>{c.description}</p>}
            <p className="small muted" style={{ margin: 0 }}>
              {t("Log sources")}: {c.log_sources.map((s) => s.name).join(", ") || t("none")}
            </p>
            {on.length ? (
              <table className="table table-plain table-compact">
                <thead>
                  <tr>
                    <th>{t("STRIDE category")}</th>
                    <th>{t("Threat description")}</th>
                    <th className="num">{t("Likelihood")}</th>
                    <th className="num">{t("Impact")}</th>
                    <th className="num">{t("Risk score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {on.map((x) => (
                    <tr key={x.category}>
                      <td>{threatLabel(x.category)}</td>
                      <td className="small">{x.description}</td>
                      <td className="num">{x.likelihood}</td>
                      <td className="num">{x.impact}</td>
                      <td className="num">
                        <RiskScore value={x.score} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                {t("No threat applies.")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompletedView({
  iv,
  editor,
  onChange,
  onAttachments,
}: {
  iv: IV;
  editor: boolean;
  onChange: (iv: IV) => void;
  onAttachments: (list: InterviewAttachment[]) => void;
}) {
  const v = iv.view;
  const cmp = useLoad<InterviewCompare | null>(
    () => (iv.previous_id ? api.compareInterview(iv.id).catch(() => null) : Promise.resolve(null)),
    [iv.id, iv.previous_id],
  );
  const [confirming, setConfirming] = useState(false);
  const [unconfirming, setUnconfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signoff = iv.attachments.find((a) => a.signoff) ?? null;
  const evidence = iv.attachments.filter((a) => !a.signoff);

  async function removeSignoff(a: InterviewAttachment) {
    const ok = await confirmDialog(t('Remove the sign-off file "{name}"?', { name: a.filename }), { danger: true, confirmLabel: t("Remove") });
    if (!ok) return;
    try {
      await api.deleteAttachment(a.id);
      onAttachments(iv.attachments.filter((x) => x.id !== a.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <ErrorNote error={error} />
      <section className="card stack-sm" aria-labelledby="confh">
        <div className="section-head">
          <h2 id="confh" className="h-sm">
            {t("Owner confirmation")}
          </h2>
          {editor && iv.status === "completed" && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setConfirming(true)}>
              {t("Record confirmation")}
            </button>
          )}
          {editor && iv.status === "confirmed" && (
            <button type="button" className="btn btn-sm" onClick={() => setUnconfirming(true)}>
              {t("Remove confirmation")}
            </button>
          )}
        </div>
        {iv.status === "confirmed" ? (
          <p style={{ margin: 0 }}>
            {t("Confirmed by {name} on {date}", { name: iv.confirmed_by ?? "", date: fmtDate(iv.confirmed_at) })}
            {iv.confirmation_recorded_by && (
              <span className="muted small"> · {t("recorded by {user}", { user: iv.confirmation_recorded_by })}</span>
            )}
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {t("Not confirmed yet. Send the PDF to the business owner and record the confirmation here.")}
          </p>
        )}
        {signoff && (
          <p className="small" style={{ margin: 0 }}>
            {t("Sign-off")}:{" "}
            <a href={api.attachmentUrl(signoff.id)} target="_blank" rel="noopener noreferrer">
              {signoff.filename}
            </a>{" "}
            <span className="muted">· {t("added {time} by {user}", { time: fmtTime(signoff.uploaded_at), user: signoff.uploaded_by })}</span>{" "}
            {editor && iv.status === "completed" && (
              <button type="button" className="link-btn" onClick={() => void removeSignoff(signoff)}>
                {t("Remove")}
              </button>
            )}
          </p>
        )}
      </section>

      <section className="card stack-sm">
        <h2 className="h-sm">{t("Context")}</h2>
        <dl className="facts">
          <dt>{t("Interview date")}</dt>
          <dd>{fmtDate(iv.interview_date)}</dd>
          <dt>{t("Participants")}</dt>
          <dd>{iv.participants || "–"}</dd>
          <dt>{t("Notes")}</dt>
          <dd>{iv.notes ? <Markdown text={iv.notes} /> : "–"}</dd>
        </dl>
      </section>

      {evidence.length > 0 && <Evidence iv={{ ...iv, attachments: evidence }} editable={false} onChange={onAttachments} />}

      {cmp.data && <Comparison c={cmp.data} />}

      <RiskCoverage risks={v.risks ?? []} components={v.components} />

      <section className="card stack-sm">
        <h2 className="h-sm">{t("Components and threats")}</h2>
        <ThreatTable components={v.components} />
      </section>

      <section className="card stack-sm">
        <h2 className="h-sm">{t("Accepted use cases ({n})", { n: v.proposals.length })}</h2>
        {!v.proposals.length && <p className="muted" style={{ margin: 0 }}>{t("No use cases accepted.")}</p>}
        {v.proposals.map((p) => (
          <ProposalCard key={proposalKey(p)} p={p} />
        ))}
      </section>

      {v.removed.length > 0 && (
        <section className="card stack-sm">
          <h2 className="h-sm">{t("Removed ({n})", { n: v.removed.length })}</h2>
          {v.removed.map((p) => (
            <ProposalCard key={proposalKey(p)} p={{ ...p, rules: [] }} />
          ))}
        </section>
      )}

      <section className="card stack-sm">
        <h2 className="h-sm">{t("Detection requests")}</h2>
        {v.requests.length ? (
          <ul className="plain-list">
            {v.requests.map((r) => (
              <li key={r.key || r.text}>
                {r.text}{" "}
                <span className="small muted">
                  · {r.component_name} / {threatLabel(r.category)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {t("No detection requests.")}
          </p>
        )}
      </section>

      {confirming && (
        <ConfirmDialog
          iv={iv}
          hasSignoff={!!signoff}
          onClose={() => setConfirming(false)}
          onDone={(x) => {
            setConfirming(false);
            onChange(x);
          }}
        />
      )}
      {unconfirming && (
        <UnconfirmDialog
          iv={iv}
          onClose={() => setUnconfirming(false)}
          onDone={(x) => {
            setUnconfirming(false);
            onChange(x);
          }}
        />
      )}
    </div>
  );
}

function Comparison({ c }: { c: InterviewCompare }) {
  const rows: [string, string[]][] = [
    [t("Components added"), c.components_added],
    [t("Components removed"), c.components_removed],
    [t("Threats added"), c.threats_added.map((x) => `${x.component} / ${threatLabel(x.category)}`)],
    [t("Threats removed"), c.threats_removed.map((x) => `${x.component} / ${threatLabel(x.category)}`)],
    [
      t("Threats re-rated"),
      c.threats_rerated.map((x) => `${x.component} / ${threatLabel(x.category)}: ${x.old_score ?? "–"} → ${x.new_score ?? "–"}`),
    ],
    [t("Use cases added"), c.use_cases_added.map((x) => `${x.code} ${x.name}`)],
    [t("Use cases removed"), c.use_cases_removed.map((x) => `${x.code} ${x.name}`)],
  ];
  const changed = rows.filter(([, items]) => items.length);
  return (
    <section className="card stack-sm" aria-labelledby="cmph">
      <h2 id="cmph" className="h-sm">
        {t("Changes since the interview of {date}", { date: fmtDate(c.previous_date) })}{" "}
        <Link className="small" to={`/interviews/${c.previous_id}`}>
          {t("Open")}
        </Link>
      </h2>
      {changed.length ? (
        <dl className="facts">
          {changed.map(([k, items]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{items.join("; ")}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {t("Nothing changed.")}
        </p>
      )}
    </section>
  );
}

/** Removing a confirmation needs a reason (#42); it is kept in the audit log. */
function UnconfirmDialog({ iv, onClose, onDone }: { iv: IV; onClose: () => void; onDone: (iv: IV) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("Remove the confirmation")} open onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim()) {
            setError(t("Enter why the confirmation is removed."));
            return;
          }
          try {
            onDone(await api.unconfirmInterview(iv.id, reason.trim()));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <p style={{ margin: 0 }}>
          {t("Confirmed by {name} on {date}", { name: iv.confirmed_by ?? "", date: fmtDate(iv.confirmed_at) })}.{" "}
          {t("The interview goes back to Completed.")}
        </p>
        <label className="field">
          {t("Reason")}
          <textarea className="input textarea" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-danger-solid">
            {t("Remove confirmation")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({
  iv,
  hasSignoff,
  onClose,
  onDone,
}: {
  iv: IV;
  hasSignoff: boolean;
  onClose: () => void;
  onDone: (iv: IV) => void;
}) {
  const [by, setBy] = useState(iv.owner_name);
  const [on, setOn] = useState(today());
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bad =
    !on
      ? t("Enter the date.")
      : on < iv.interview_date
        ? t("The confirmation date cannot be before the interview date.")
        : on > today()
          ? t("The confirmation date cannot be in the future.")
          : null;
  return (
    <Modal title={t("Record the owner's confirmation")} open onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (bad || !by.trim()) {
            setError(bad ?? t("Enter who confirmed."));
            return;
          }
          try {
            if (file) await api.uploadAttachment(iv.id, file, true);
            onDone(await api.confirmInterview(iv.id, { confirmed_by: by.trim(), confirmed_at: on }));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label className="field">
          {t("Confirmed by")}
          <input className="input" value={by} maxLength={255} onChange={(e) => setBy(e.target.value)} />
        </label>
        <label className="field">
          {t("Confirmation date")}
          <input
            className={"input" + (bad ? " is-invalid" : "")}
            type="date"
            min={iv.interview_date}
            max={today()}
            value={on}
            onChange={(e) => setOn(e.target.value)}
          />
          {bad && <span className="field-error">{bad}</span>}
        </label>
        {!hasSignoff && (
          <label className="field">
            {t("Sign-off file (optional)")}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="small muted">{t("The owner's signed PDF or e-mail as PDF or image. It is kept with the interview.")}</span>
          </label>
        )}
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
