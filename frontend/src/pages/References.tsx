import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type RefItem, type RefKind } from "../api";
import { useAuth } from "../auth";
import { confirmDialog, ErrorNote, useLoad } from "../components/ui";
import { codeList, REF_KINDS, refHref } from "../lib/format";
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
  const [sort, setSort] = useState<{ key: "name" | "used"; desc: boolean }>({ key: "name", desc: false });
  const actors = kind === "threat_actor";

  const rows = useMemo(() => {
    const items = [...(list.data ?? [])];
    const used = (i: RefItem) => i.used_by?.length ?? 0;
    items.sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      const d = sort.key === "used" ? used(a) - used(b) || byName : byName;
      return sort.desc ? -d : d;
    });
    return items;
  }, [list.data, sort]);

  /** Column header that sorts by `key`; a second click reverses the order. */
  const sortHead = (key: "name" | "used", label: string, className?: string, style?: CSSProperties) => {
    const active = sort.key === key;
    return (
      <th
        className={className}
        style={style}
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      >
        <button
          type="button"
          className="sort-btn"
          onClick={() => setSort({ key, desc: active ? !sort.desc : false })}
        >
          {label}
          <span aria-hidden="true" className={active ? "" : "muted"}>
            {active ? (sort.desc ? " ▾" : " ▴") : " ↕"}
          </span>
        </button>
      </th>
    );
  };

  const usedCell = (item: RefItem) => {
    const codes = item.used_by ?? [];
    const systems = item.used_by_systems ?? [];
    const sys = systems.length > 0 && (
      <span className="small muted" title={systems.join(", ")}>
        {" "}
        {t("+ {n} systems", { n: systems.length })}
      </span>
    );
    if (!codes.length) return <span className="muted">0{sys}</span>;
    return (
      <>
        <Link
          to={refHref(kind, item.name)}
          title={codeList(codes)}
          aria-label={
            actors
              ? t("{n} L2 use cases use {name}", { n: codes.length, name: item.name })
              : t("{n} L3 rules use {name}", { n: codes.length, name: item.name })
          }
        >
          {codes.length}
        </Link>
        {sys}
      </>
    );
  };

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

  /** Delete an entry. One that is still in use is only removed after the list of use cases was
   *  shown and confirmed. */
  async function remove(item: RefItem) {
    setError(null);
    const sure = await confirmDialog(t('Delete "{name}"?', { name: item.name }), {
      title: t("Delete entry"),
      confirmLabel: t("Delete"),
      danger: true,
    });
    if (!sure) return;
    try {
      await api.deleteRef(kind, item.id);
    } catch (e) {
      const data = e instanceof ApiError && e.status === 409 ? (e.data as { used_by?: string[]; used_by_systems?: string[] }) : null;
      const used = data?.used_by ?? null;
      const systems = data?.used_by_systems ?? [];
      if (!used) {
        setError((e as Error).message);
        return;
      }
      const ok = await confirmDialog(
        t('"{name}" is used by {n} use cases or rules. Deleting it removes it from all of them.', {
          name: item.name,
          n: used.length,
        }),
        {
          title: t("Entry is in use"),
          confirmLabel: t("Delete and remove everywhere"),
          danger: true,
          body: (
            <>
              <ul className="confirm-list mono">
                {used.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {systems.length > 0 && (
                <p className="small">
                  {t("Interviews of these systems list it on a component: {list}", { list: systems.join(", ") })}
                </p>
              )}
            </>
          ),
        },
      );
      if (!ok) return;
      await run(() => api.deleteRef(kind, item.id, true));
      return;
    }
    await list.reload();
  }

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
              {sortHead("name", t("Name"), undefined, { width: "30%" })}
              <th>{t("Description")}</th>
              {sortHead("used", actors ? t("Used by (L2)") : t("Used by (L3)"), "num")}
              {editor && <th className="num">{t("Actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) =>
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
                  <td className="num">{usedCell(item)}</td>
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
                  <td className="num">{usedCell(item)}</td>
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
                          onClick={() => void remove(item)}
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
