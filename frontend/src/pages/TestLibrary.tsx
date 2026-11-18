import { useMemo, useState, type FormEvent } from "react";
import { api, type TestTemplate } from "../api";
import { useAuth } from "../auth";
import { confirmDialog, ErrorNote, Modal, useLoad } from "../components/ui";
import { fmtDate } from "../lib/format";
import { t } from "../i18n";

/** Reusable test procedures per ATT&CK technique (PROJ-3). */
export default function TestLibrary() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const list = useLoad<TestTemplate[]>(() => api.testLibrary());
  const techniques = useLoad(() => api.campaignTechniques());
  const [q, setQ] = useState("");
  const [technique, setTechnique] = useState("");
  const [editing, setEditing] = useState<TestTemplate | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (x) =>
        (!technique || x.technique === technique || x.technique.startsWith(technique + ".")) &&
        (!needle ||
          `${x.title} ${x.technique} ${x.technique_name ?? ""} ${x.procedure} ${x.tools}`.toLowerCase().includes(needle)),
    );
  }, [list.data, q, technique]);
  const techOptions = useMemo(() => [...new Set((list.data ?? []).map((x) => x.technique))].sort(), [list.data]);

  async function remove(x: TestTemplate) {
    const ok = await confirmDialog(
      t("Delete the template {title}? Tests made from it stay unchanged.", { title: x.title }),
      { danger: true, confirmLabel: t("Delete") },
    );
    if (!ok) return;
    try {
      await api.deleteTemplate(x.id);
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Test library")}</h1>
          <div className="subtitle">
            {t("Reusable test procedures per ATT&CK technique. Campaigns propose them for the techniques of the chosen rules.")}
          </div>
        </div>
        {editor && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            {t("New template")}
          </button>
        )}
      </header>
      <ErrorNote error={error ?? list.error} />

      <div className="filters">
        <input
          className="input input-sm"
          type="search"
          placeholder={t("Search templates…")}
          aria-label={t("Search templates")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input input-sm" aria-label={t("Technique")} value={technique} onChange={(e) => setTechnique(e.target.value)}>
          <option value="">{t("All techniques")}</option>
          {techOptions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <span className="small muted">{t("{n} of {total} templates", { n: shown.length, total: list.data?.length ?? 0 })}</span>
      </div>

      {list.data && !list.data.length && (
        <div className="empty">
          <h3>{t("The test library is empty")}</h3>
          <p>{t("Add templates here or use “Save to library” on a test of a campaign.")}</p>
        </div>
      )}
      {!!shown.length && (
        <section className="card table-card" aria-label={t("Test library")}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("Template")}</th>
                <th>{t("Procedure")}</th>
                <th>{t("Tools")}</th>
                <th>{t("Changed")}</th>
                {editor && <th aria-label={t("Actions")} />}
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id}>
                  <td>
                    <div className="strong-500">{x.title}</div>
                    <div className="small muted">
                      <span className="mono">{x.technique}</span> {x.technique_name}
                    </div>
                  </td>
                  <td>
                    <pre className="pre-code" style={{ maxHeight: 90 }}>
                      {x.procedure || "–"}
                    </pre>
                  </td>
                  <td>{x.tools || "–"}</td>
                  <td className="small">
                    {fmtDate(x.updated_at)}
                    <div className="muted">{x.created_by}</div>
                  </td>
                  {editor && (
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn-sm" onClick={() => setEditing(x)}>
                          {t("Edit")}
                        </button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(x)}>
                          {t("Delete")}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editing && (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          techniques={techniques.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => void list.reload()}
        />
      )}
    </>
  );
}

function TemplateDialog({
  template,
  techniques,
  onClose,
  onSaved,
}: {
  template: TestTemplate | null;
  techniques: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: template?.title ?? "",
    technique: template?.technique ?? "",
    procedure: template?.procedure ?? "",
    tools: template?.tools ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = techniques.find((x) => x.id === form.technique)?.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (template) await api.updateTemplate(template.id, form);
      else await api.createTemplate(form);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={template ? t("Edit template") : t("New template")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="form-grid two">
          <label className="field">
            {t("Title")}
            <input
              className="input"
              required
              autoFocus
              maxLength={255}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="field">
            {t("ATT&CK technique")}
            <input
              className="input mono"
              required
              list="tpl-tech"
              pattern="T\d{4}(\.\d{3})?"
              placeholder="T1059.001"
              value={form.technique}
              onChange={(e) => setForm({ ...form, technique: e.target.value.trim().toUpperCase() })}
            />
            <datalist id="tpl-tech">
              {techniques.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </datalist>
            <span className="small muted">{name ?? (form.technique ? t("Unknown technique") : " ")}</span>
          </label>
        </div>
        <label className="field">
          {t("Procedure")}
          <textarea
            className="input textarea mono"
            rows={6}
            maxLength={10000}
            value={form.procedure}
            onChange={(e) => setForm({ ...form, procedure: e.target.value })}
          />
        </label>
        <label className="field">
          {t("Tools")}
          <input className="input" maxLength={10000} value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("Saving…") : t("Save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
