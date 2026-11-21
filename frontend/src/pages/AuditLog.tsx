import { useEffect, useState } from "react";
import { api, type AuditEntry, type AuditFilter } from "../api";
import { ErrorNote, useLoad } from "../components/ui";
import { t } from "../i18n";
import { fmtTime } from "../lib/format";

const PAGE = 200;

/** "review_interval_months" → "review interval months": field names read as words. */
const field = (k: string) => k.replace(/_/g, " ");

function value(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 117)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function Changes({ changes }: { changes: Record<string, unknown> }) {
  const rows = Object.entries(changes);
  if (!rows.length) return <span className="muted">–</span>;
  return (
    <ul className="plain-list audit-changes">
      {rows.map(([k, v]) => (
        <li key={k}>
          <span className="muted">{field(k)}:</span>{" "}
          {Array.isArray(v) && v.length === 2 ? (
            <>
              <span className="audit-old">{value(v[0])}</span> → <span>{value(v[1])}</span>
            </>
          ) : (
            <span>{value(v)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AuditLog() {
  const [filter, setFilter] = useState<AuditFilter>({});
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const facets = useLoad(() => api.auditFacets());
  const set = (patch: AuditFilter) => setFilter((f) => ({ ...f, ...patch }));
  const active = Object.values(filter).some(Boolean);

  useEffect(() => {
    let live = true;
    setBusy(true);
    api
      .audit(PAGE, filter)
      .then((list) => {
        if (!live) return;
        setEntries(list);
        setMore(list.length === PAGE);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [filter]);

  async function loadMore() {
    setBusy(true);
    try {
      const list = await api.audit(PAGE, filter, entries.length);
      setEntries((x) => [...x, ...list]);
      setMore(list.length === PAGE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const f = facets.data;
  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Audit log")}</h1>
          <div className="subtitle">{t("Every change and sign-in, newest first.")}</div>
        </div>
      </header>
      <section className="card filters" role="search" aria-label={t("Filter the audit log")}>
        <select className="input input-sm" aria-label={t("User")} value={filter.user ?? ""} onChange={(e) => set({ user: e.target.value })}>
          <option value="">{t("All users")}</option>
          {f?.users.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select className="input input-sm" aria-label={t("Action")} value={filter.action ?? ""} onChange={(e) => set({ action: e.target.value })}>
          <option value="">{t("All actions")}</option>
          {f?.actions.map((x) => (
            <option key={x} value={x}>
              {field(x)}
            </option>
          ))}
        </select>
        <select className="input input-sm" aria-label={t("Object type")} value={filter.entity ?? ""} onChange={(e) => set({ entity: e.target.value })}>
          <option value="">{t("All object types")}</option>
          {f?.entities.map((x) => (
            <option key={x} value={x}>
              {field(x)}
            </option>
          ))}
        </select>
        <input
          className="input input-sm"
          aria-label={t("Object")}
          placeholder={t("Object, e.g. AO-CRE-01")}
          defaultValue=""
          onKeyDown={(e) => {
            if (e.key === "Enter") set({ search: (e.target as HTMLInputElement).value.trim() });
          }}
          onBlur={(e) => set({ search: e.target.value.trim() })}
        />
        <label className="field field-inline small">
          {t("From")}
          <input className="input input-sm" type="date" value={filter.since ?? ""} onChange={(e) => set({ since: e.target.value })} />
        </label>
        <label className="field field-inline small">
          {t("To")}
          <input className="input input-sm" type="date" value={filter.until ?? ""} onChange={(e) => set({ until: e.target.value })} />
        </label>
        {active && (
          <button type="button" className="btn btn-sm" onClick={() => setFilter({})}>
            {t("Clear filters")}
          </button>
        )}
      </section>
      <ErrorNote error={error} />
      <section className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>{t("When")}</th>
              <th>{t("User")}</th>
              <th>{t("Action")}</th>
              <th>{t("Object")}</th>
              <th>{t("Changes")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtTime(e.at, true)}</td>
                <td>
                  {e.username}
                  {e.ip && <div className="small muted mono">{e.ip}</div>}
                </td>
                <td>{field(e.action)}</td>
                <td>
                  <span className="muted">{field(e.entity)}</span> <span className="mono">{e.entity_key}</span>
                </td>
                <td className="changes">
                  <Changes changes={e.changes} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!busy && !entries.length && <p className="muted empty-flat">{active ? t("No entry matches the filters.") : t("No entries yet.")}</p>}
        {more && (
          <div className="row-actions start" style={{ padding: "12px 16px" }}>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void loadMore()}>
              {t("Load {n} more", { n: PAGE })}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
