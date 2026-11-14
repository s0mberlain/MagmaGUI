import { useState, type FormEvent } from "react";
import { api, type RefItem, type RefKind } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, useLoad } from "../components/ui";
import { REF_KINDS } from "../lib/format";
import { t } from "../i18n";

export default function References() {
  const [kind, setKind] = useState<RefKind>("log_source");
  const info = REF_KINDS.find((k) => k.kind === kind)!;
  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Reference lists")}</h1>
          <div className="subtitle">
            {t("Pick lists used by use cases and rules. Renaming an entry updates every rule.")}
          </div>
        </div>
      </header>
      <div role="tablist" aria-label={t("Lists")} className="tabs">
        {REF_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            className={"tab" + (kind === k.kind ? " active" : "")}
            onClick={() => setKind(k.kind)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {info.hint}
      </p>
      <RefList key={kind} kind={kind} />
    </>
  );
}

function RefList({ kind }: { kind: RefKind }) {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const list = useLoad<RefItem[]>(() => api.refs(kind), [kind]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState<{ id: number; name: string; description: string } | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await list.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.createRef(kind, draft))) setDraft({ name: "", description: "" });
  }

  return (
    <>
      <ErrorNote error={error ?? list.error} />
      {editor && (
        <form className="card inline-form" onSubmit={add}>
          <label className="field grow">
            {t("Name")}
            <input
              className="input input-sm"
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="field grow-2">
            {t("Description")}
            <input
              className="input input-sm"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">
            {t("Add")}
          </button>
        </form>
      )}
      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>{t("Name")}</th>
              <th>{t("Description")}</th>
              {editor && <th className="num">{t("Actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {list.data?.map((item) =>
              editing?.id === item.id ? (
                <tr key={item.id}>
                  <td>
                    <input
                      className="input input-sm"
                      aria-label={t("Name")}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input input-sm"
                      style={{ width: "100%" }}
                      aria-label={t("Description")}
                      value={editing.description}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                        {t("Cancel")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={async () => {
                          if (await run(() => api.updateRef(kind, item.id, editing))) setEditing(null);
                        }}
                      >
                        {t("Save")}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={item.id}>
                  <td className="strong-500">{item.name}</td>
                  <td className="ink-2">{item.description || <span className="muted">–</span>}</td>
                  {editor && (
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setEditing({ id: item.id, name: item.name, description: item.description })}
                        >
                          {t("Edit")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            if (
                              window.confirm(
                                t('Delete "{name}"? It is removed from every use case.', { name: item.name }),
                              )
                            )
                              void run(() => api.deleteRef(kind, item.id));
                          }}
                        >
                          {t("Delete")}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
