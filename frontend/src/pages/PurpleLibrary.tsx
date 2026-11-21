import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  purple,
  type PtCampaignTemplate,
  type PtImportFormat,
  type PtImportResult,
  type PtTemplate,
  type PtTemplateInput,
} from "../api";
import { useAuth } from "../auth";
import { MarkdownField } from "../components/Markdown";
import TechniquePicker from "../components/TechniquePicker";
import { confirmDialog, ErrorNote, Modal, useLoad, useShowMore, ShowMore } from "../components/ui";
import { joinList, splitList } from "../lib/purple";
import { t } from "../i18n";

type Tab = "procedures" | "campaigns" | "atomics" | "import";

const EMPTY: PtTemplateInput = {
  name: "",
  description: "",
  techniques: [],
  tactic: "",
  platforms: [],
  executor: "",
  command: "",
  cleanup: "",
  operator_guidance: "",
  expected_defenses: [],
  detection_steps: "",
  prevention_steps: "",
  references: [],
  tags: [],
  archived: false,
};

const SOURCE_LABEL: Record<PtTemplate["source"], string> = {
  custom: t("Own"),
  atomic: "Atomic Red Team",
  vectr: t("Threat Simulation Index"),
  csv: "CSV",
  demo: t("Demo"),
};

function TemplateDialog({ initial, id, onClose, onSaved }: { initial: PtTemplateInput; id?: number; onClose: () => void; onSaved: () => void }) {
  const techniques = useLoad(() => api.attackTechniques());
  const tools = useLoad(() => api.refs("detection_technology"));
  const names = useMemo(() => new Map((techniques.data ?? []).map((x) => [x.id, x.name])), [techniques.data]);
  const [form, setForm] = useState(initial);
  const [lists, setLists] = useState({
    platforms: joinList(initial.platforms),
    expected_defenses: joinList(initial.expected_defenses),
    references: initial.references.join("\n"),
    tags: joinList(initial.tags),
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...form,
      platforms: splitList(lists.platforms),
      expected_defenses: splitList(lists.expected_defenses),
      references: splitList(lists.references),
      tags: splitList(lists.tags),
    };
    try {
      if (id) await purple.updateTemplate(id, body);
      else await purple.createTemplate(body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={id ? t("Edit test procedure") : t("New test procedure")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            {t("Name")} *
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            {t("Executor")}
            <input className="input" value={form.executor} placeholder="powershell, command_prompt, manual" onChange={(e) => setForm({ ...form, executor: e.target.value })} />
          </label>
          <label className="field">
            {t("Platforms")}
            <input className="input" value={lists.platforms} placeholder="windows, linux" onChange={(e) => setLists({ ...lists, platforms: e.target.value })} />
          </label>
        </div>
        <TechniquePicker value={form.techniques} names={names} techniques={techniques.data ?? []} onChange={(v) => setForm({ ...form, techniques: v })} required={false} />
        <MarkdownField label={t("Description")} value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        <label className="field">
          {t("Command / procedure")}
          <textarea className="input mono" rows={4} value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
        </label>
        <label className="field">
          {t("Cleanup")}
          <textarea className="input mono" rows={2} value={form.cleanup} onChange={(e) => setForm({ ...form, cleanup: e.target.value })} />
        </label>
        <MarkdownField label={t("Operator guidance")} value={form.operator_guidance} onChange={(v) => setForm({ ...form, operator_guidance: v })} />
        <label className="field">
          {t("Expected defenses (become rows on the blue team side)")}
          <input
            className="input"
            list="tpl-tools"
            value={lists.expected_defenses}
            placeholder={t("e.g. SIEM, EDR, Firewall")}
            onChange={(e) => setLists({ ...lists, expected_defenses: e.target.value })}
          />
          <datalist id="tpl-tools">
            {(tools.data ?? []).map((x) => (
              <option key={x.id} value={x.name} />
            ))}
          </datalist>
        </label>
        <div className="two-col even">
          <MarkdownField label={t("Detection steps")} value={form.detection_steps} onChange={(v) => setForm({ ...form, detection_steps: v })} />
          <MarkdownField label={t("Prevention steps")} value={form.prevention_steps} onChange={(v) => setForm({ ...form, prevention_steps: v })} />
        </div>
        <div className="form-grid">
          <label className="field">
            {t("Tags")}
            <input className="input" value={lists.tags} onChange={(e) => setLists({ ...lists, tags: e.target.value })} />
          </label>
          <label className="field">
            {t("References (one per line)")}
            <textarea className="input" rows={2} value={lists.references} onChange={(e) => setLists({ ...lists, references: e.target.value })} />
          </label>
        </div>
        {id && (
          <label className="check small">
            <input type="checkbox" checked={form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} />
            {t("Archived (hidden when adding test cases)")}
          </label>
        )}
        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!form.name.trim()}>
            {t("Save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Procedures({ editor }: { editor: boolean }) {
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const list = useLoad(() => purple.templates({ archived }), [archived]);
  const [editing, setEditing] = useState<PtTemplate | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (x) => !needle || x.name.toLowerCase().includes(needle) || x.techniques.some((id) => id.toLowerCase().startsWith(needle)) || x.tags.some((g) => g.toLowerCase().includes(needle)),
  );
  const more = useShowMore(rows, 50);

  async function remove(x: PtTemplate) {
    const ok = await confirmDialog(
      t("Delete the test procedure {name}? Test cases made from it keep their copy.", { name: x.name }),
      { danger: true, confirmLabel: t("Delete") },
    );
    if (!ok) return;
    try {
      await purple.deleteTemplate(x.id);
      void list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <section className="card uc-filters">
        <input className="input input-sm" style={{ minWidth: 240 }} placeholder={t("Search by name, technique or tag")} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        <label className="check small">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          {t("Show archived")}
        </label>
        {editor && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing("new")}>
            {t("+ Procedure")}
          </button>
        )}
      </section>
      <ErrorNote error={list.error ?? error} />
      <section className="card table-card">
        {list.data && !list.data.length && (
          <p className="muted" style={{ padding: 20, margin: 0 }}>
            {t("No test procedures yet. Add your own, adopt Atomic Red Team tests or import a Threat Simulation Index.")}
          </p>
        )}
        {rows.length > 0 && (
          <div className="scroll-x">
            <table className="table cards-sm">
              <thead>
                <tr>
                  <th>{t("Procedure")}</th>
                  <th>{t("ATT&CK")}</th>
                  <th>{t("Expected defenses")}</th>
                  <th>{t("Source")}</th>
                  <th className="num">{t("Used")}</th>
                  <th>
                    <span className="sr-only">{t("Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {more.shown.map((x) => (
                  <tr key={x.id}>
                    <td data-label={t("Procedure")}>
                      {x.name}
                      {x.archived && <span className="pill pill-none"> {t("archived")}</span>}
                      {x.platforms.length > 0 && <div className="small muted">{x.platforms.join(", ")}</div>}
                    </td>
                    <td data-label={t("ATT&CK")} className="mono small">
                      {x.techniques.join(", ") || "–"}
                    </td>
                    <td data-label={t("Expected defenses")} className="small">
                      {x.expected_defenses.join(", ") || "–"}
                    </td>
                    <td data-label={t("Source")} className="small">
                      {SOURCE_LABEL[x.source] ?? x.source}
                    </td>
                    <td data-label={t("Used")} className="num">
                      {x.used}
                    </td>
                    <td className="row-actions">
                      {editor && (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(x)}>
                            {t("Edit")}
                          </button>
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(x)}>
                            {t("Delete")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ShowMore rest={more.rest} more={more.more} all={more.all} />
      </section>
      {editing && (
        <TemplateDialog
          initial={editing === "new" ? EMPTY : { ...editing }}
          id={editing === "new" ? undefined : editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void list.reload();
          }}
        />
      )}
    </>
  );
}

function CampaignTemplateDialog({ initial, onClose, onSaved }: { initial: PtCampaignTemplate | null; onClose: () => void; onSaved: () => void }) {
  const templates = useLoad(() => purple.templates());
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [ids, setIds] = useState<number[]>(initial?.template_ids ?? []);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const byId = new Map((templates.data ?? []).map((x) => [x.id, x]));
  const needle = q.trim().toLowerCase();
  const available = (templates.data ?? []).filter((x) => !ids.includes(x.id) && (!needle || x.name.toLowerCase().includes(needle) || x.techniques.some((id) => id.toLowerCase().startsWith(needle))));
  const move = (i: number, d: number) => {
    const next = [...ids];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setIds(next);
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const body = { name, description, template_ids: ids };
      if (initial) await purple.updateCampaignTemplate(initial.id, body);
      else await purple.createCampaignTemplate(body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title={initial ? t("Edit campaign template") : t("New campaign template")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          {t("Name")} *
          <input className="input" required value={name} placeholder={t("e.g. Ransomware operator emulation")} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t("Description")}
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="two-col even">
          <div className="stack-sm">
            <span className="strong-500">{t("Procedures in order ({n})", { n: ids.length })}</span>
            <ol className="pt-order">
              {ids.map((id, i) => (
                <li key={id}>
                  <span className="grow">{byId.get(id)?.name ?? `#${id}`}</span>
                  <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Move up")}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-sm" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label={t("Move down")}>
                    ↓
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setIds(ids.filter((x) => x !== id))} aria-label={t("Remove")}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="stack-sm">
            <input className="input input-sm" placeholder={t("Search by name or technique")} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="pt-pick-list">
              {available.slice(0, 200).map((x) => (
                <button key={x.id} type="button" className="link-btn pt-pick" onClick={() => setIds([...ids, x.id])}>
                  + {x.name} <span className="small muted mono">{x.techniques.join(", ")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <ErrorNote error={error} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {t("Save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CampaignTemplates({ editor }: { editor: boolean }) {
  const list = useLoad(() => purple.campaignTemplates());
  const [editing, setEditing] = useState<PtCampaignTemplate | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function remove(ct: PtCampaignTemplate) {
    const ok = await confirmDialog(t("Delete the campaign template {name}?", { name: ct.name }), { danger: true, confirmLabel: t("Delete") });
    if (!ok) return;
    try {
      await purple.deleteCampaignTemplate(ct.id);
      void list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      {editor && (
        <div className="row-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing("new")}>
            {t("+ Campaign template")}
          </button>
        </div>
      )}
      <ErrorNote error={list.error ?? error} />
      {list.data && !list.data.length && <p className="muted">{t("No campaign templates yet. A campaign template is an ordered set of procedures, e.g. an adversary emulation plan.")}</p>}
      <div className="stack">
        {list.data?.map((ct) => (
          <section key={ct.id} className="card stack-sm">
            <div className="section-head">
              <h2 className="h-sm">
                {ct.name} <span className="count">{ct.templates.length}</span>
              </h2>
              {editor && (
                <span className="row-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(ct)}>
                    {t("Edit")}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(ct)}>
                    {t("Delete")}
                  </button>
                </span>
              )}
            </div>
            {ct.description && <p className="muted small" style={{ margin: 0 }}>{ct.description}</p>}
            <ol className="small pt-order-read">
              {ct.templates.map((x) => (
                <li key={x.id}>
                  {x.name} <span className="muted mono">{x.techniques.join(", ")}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      {editing && (
        <CampaignTemplateDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void list.reload();
          }}
        />
      )}
    </>
  );
}

function Atomics({ editor }: { editor: boolean }) {
  const [technique, setTechnique] = useState("");
  const [platform, setPlatform] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ technique: "", platform: "", q: "" });
  const data = useLoad(() => purple.atomics({ ...applied, limit: 100 }), [applied.technique, applied.platform, applied.q]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function adopt(guid: string) {
    try {
      await purple.adoptAtomic(guid);
      void data.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <form
        className="card uc-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ technique, platform, q });
        }}
      >
        <input className="input input-sm" placeholder={t("Technique, e.g. T1003")} value={technique} onChange={(e) => setTechnique(e.target.value)} />
        <select className="input input-sm" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label={t("Platform")}>
          <option value="">{t("All platforms")}</option>
          {(data.data?.platforms ?? []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input className="input input-sm" placeholder={t("Search by name")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-sm">
          {t("Search")}
        </button>
      </form>
      <ErrorNote error={data.error ?? error} />
      {data.data && (
        <p className="muted small" style={{ margin: 0 }}>
          {t("{n} of {total} atomic tests match (showing up to 100). Bundled offline from Atomic Red Team (MIT license, Red Canary).", {
            n: data.data.matches,
            total: data.data.total,
          })}{" "}
          <a href={data.data.source} target="_blank" rel="noreferrer">
            {t("Project page")}
          </a>
        </p>
      )}
      <section className="card table-card">
        <div className="scroll-x">
          <table className="table cards-sm">
            <thead>
              <tr>
                <th>{t("Atomic test")}</th>
                <th>{t("ATT&CK")}</th>
                <th>{t("Platforms")}</th>
                <th>{t("Executor")}</th>
                <th>
                  <span className="sr-only">{t("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data?.tests.map((x) => (
                <tr key={x.guid}>
                  <td data-label={t("Atomic test")}>
                    <button type="button" className="link-btn" aria-expanded={open === x.guid} onClick={() => setOpen(open === x.guid ? null : x.guid)}>
                      {x.name}
                    </button>
                    {open === x.guid && (
                      <div className="stack-xs small">
                        <span className="muted">{x.description}</span>
                        <pre className="pt-command">{x.command}</pre>
                      </div>
                    )}
                  </td>
                  <td data-label={t("ATT&CK")} className="small">
                    <span className="mono">{x.technique}</span> {x.technique_name}
                  </td>
                  <td data-label={t("Platforms")} className="small">
                    {x.platforms.join(", ")}
                  </td>
                  <td data-label={t("Executor")} className="small">
                    {x.executor}
                    {x.elevation ? ` · ${t("admin")}` : ""}
                  </td>
                  <td>
                    {x.adopted ? (
                      <span className="pill pill-ok">{t("In library")}</span>
                    ) : (
                      editor && (
                        <button type="button" className="btn btn-sm" onClick={() => void adopt(x.guid)}>
                          {t("Add to library")}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Import() {
  const [format, setFormat] = useState<PtImportFormat>("vectr_tsi");
  const [file, setFile] = useState<File | null>(null);
  const [update, setUpdate] = useState(false);
  const [preview, setPreview] = useState<PtImportResult | null>(null);
  const [done, setDone] = useState<PtImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await purple.importLibrary(format, file, dryRun, update);
      if (dryRun) setPreview(r);
      else {
        setDone(r);
        setPreview(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ACTION: Record<string, string> = { create: t("new"), update: t("update"), skip: t("exists, skipped") };
  const shown = preview ?? done;
  return (
    <section className="card stack">
      <div className="form-grid">
        <label className="field">
          {t("Format")}
          <select
            className="input"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as PtImportFormat);
              setPreview(null);
              setDone(null);
            }}
          >
            <option value="vectr_tsi">{t("Threat Simulation Index YAML (SRA / VECTR)")}</option>
            <option value="atomic">{t("Atomic Red Team YAML (technique file or index.yaml)")}</option>
            <option value="csv">{t("CSV (as exported from an assessment)")}</option>
          </select>
        </label>
        <label className="field">
          {t("File")}
          <input
            className="input"
            type="file"
            accept={format === "csv" ? ".csv" : ".yml,.yaml"}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setDone(null);
            }}
          />
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {format === "vectr_tsi" &&
          t("Each campaign of the index becomes a campaign template; the controls become expected defenses, block and detect become prevention and detection steps.")}
        {format === "atomic" && t("Input arguments are filled in with their default values.")}
        {format === "csv" && t("Columns: Campaign, Test case, Techniques, Tactic, Command, Tags (Description and Operator guidance optional).")}
      </p>
      <label className="check small">
        <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
        {t("Update procedures that were imported before (otherwise they are skipped)")}
      </label>
      <ErrorNote error={error} />
      <div className="row-actions">
        <button type="button" className="btn" disabled={!file || busy} onClick={() => void go(true)}>
          {t("Preview")}
        </button>
        <button type="button" className="btn btn-primary" disabled={!file || busy || !preview} onClick={() => void go(false)}>
          {t("Import")}
        </button>
      </div>
      {done && (
        <p className="form-success" role="status">
          {t("Imported {bundle}: {create} new, {update} updated, {skip} skipped.", { bundle: done.bundle, ...done.counts })}{" "}
          <Link to="/purple/library">{t("Show procedures")}</Link>
        </p>
      )}
      {shown && (
        <div className="stack-sm">
          <h2 className="h-sm">
            {shown.bundle}: {t("{create} new, {update} updated, {skip} skipped", shown.counts)}
          </h2>
          {shown.errors.length > 0 && (
            <ul className="form-error small">
              {shown.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {shown.campaigns.length > 0 && (
            <p className="small">
              {t("Campaign templates")}: {shown.campaigns.map((c) => `${c.name} (${c.templates})`).join(" · ")}
            </p>
          )}
          <div className="scroll-x pt-import-list">
            <table className="table table-compact">
              <tbody>
                {shown.templates.slice(0, 300).map((x, i) => (
                  <tr key={i}>
                    <td>{x.name}</td>
                    <td className="mono small">{x.techniques.join(", ")}</td>
                    <td className="small">{ACTION[x.action]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default function PurpleLibrary() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const [params, setParams] = useSearchParams();
  const tabs: [Tab, string][] = [
    ["procedures", t("Procedures")],
    ["campaigns", t("Campaign templates")],
    ["atomics", "Atomic Red Team"],
    ...(editor ? ([["import", t("Import")]] as [Tab, string][]) : []),
  ];
  const tab = (tabs.find(([k]) => k === params.get("tab"))?.[0] ?? "procedures") as Tab;
  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Purple team library")}</h1>
          <div className="subtitle">
            {t("Reusable test procedures and campaign templates. Test cases are copied from them, so a change here does not alter past results.")}
          </div>
        </div>
      </header>
      <div className="tabs" role="tablist" aria-label={t("Library")}>
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={"tab" + (tab === k ? " active" : "")}
            onClick={() => setParams(k === "procedures" ? {} : { tab: k })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "procedures" && <Procedures editor={editor} />}
      {tab === "campaigns" && <CampaignTemplates editor={editor} />}
      {tab === "atomics" && <Atomics editor={editor} />}
      {tab === "import" && editor && <Import />}
    </>
  );
}
