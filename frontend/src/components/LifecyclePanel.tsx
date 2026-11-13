import { useState, type FormEvent } from "react";
import { api, LIFECYCLES, type Level, type Lifecycle, type LifecycleMeta, type LifecycleState } from "../api";
import { useAuth } from "../auth";
import { fmtDate, STATUS_LABEL } from "../lib/format";
import { ErrorNote, Modal, StatusPill, useLoad } from "./ui";

let metaCache: Promise<LifecycleMeta> | null = null;
export function loadMeta(): Promise<LifecycleMeta> {
  metaCache ??= api.lifecycleMeta().catch((e) => {
    metaCache = null;
    throw e;
  });
  return metaCache;
}

export const DRIVER_TYPE_LABEL: Record<string, string> = {
  environmental: "Environmental",
  operational: "Operational",
  other: "Other",
  unspecified: "Not given",
};

export function driverLabel(meta: LifecycleMeta | null, type: string, key: string): string {
  if (type === "unspecified") return "No driver given";
  const d = meta?.drivers[type]?.find((x) => x.key === key);
  return `${DRIVER_TYPE_LABEL[type] ?? type} · ${d?.label ?? key}`;
}

/** Lifecycle status, "Operational" definition of done and the change log of one use case. */
export default function LifecyclePanel({
  level,
  code,
  onChanged,
}: {
  level: Level;
  code: string;
  onChanged?: (status: Lifecycle) => void;
}) {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const meta = useLoad(loadMeta);
  const state = useLoad(() => api.lifecycle(level, code), [level, code]);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const s = state.data;
  const m = meta.data;
  const doneCount = s?.dod.filter((d) => d.done).length ?? 0;

  async function tick(key: string, done: boolean) {
    setError(null);
    try {
      state.setData(await api.setDod(level, code, { [key]: done }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const events = s ? (showAll ? s.events : s.events.slice(0, 5)) : [];

  return (
    <section className="card stack" aria-labelledby={`lc-${code}`}>
      <div className="section-head">
        <h2 id={`lc-${code}`}>Lifecycle</h2>
        <div className="row-actions lc-actions">
          {s && <StatusPill status={s.status} />}
          {editor && s && (
            <button type="button" className="btn btn-sm" onClick={() => setDialog(true)}>
              Change status
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={error ?? state.error ?? meta.error} />

      <div className="stack-sm">
        <div className="section-head">
          <h3 className="h-sm">Definition of done</h3>
          <span className={doneCount === 5 ? "pill pill-ok" : "pill pill-warn"}>
            {doneCount} of {s?.dod.length ?? 5}
          </span>
        </div>
        <ul className="dod">
          {s &&
            m?.dod_items.map((item) => {
              const st = s.dod.find((d) => d.key === item.key);
              return (
                <li key={item.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!st?.done}
                      disabled={!editor}
                      onChange={(e) => void tick(item.key, e.target.checked)}
                    />
                    <span className="stack-xs">
                      <span className="strong-500">{item.label}</span>
                      <span className="small muted">{st?.done ? `Done ${fmtDate(st.at)} · ${st.by}` : item.hint}</span>
                    </span>
                  </label>
                </li>
              );
            })}
        </ul>
      </div>

      <div className="stack-sm">
        <h3 className="h-sm">Change log</h3>
        {s && !s.events.length && <p className="muted small">No status changes recorded.</p>}
        <ul className="history">
          {events.map((ev) => (
            <li key={ev.id}>
              <StatusPill status={ev.to_status} />
              <span className="stack-xs">
                <span className="strong-500">
                  {ev.from_status ? `${STATUS_LABEL[ev.from_status]} → ${STATUS_LABEL[ev.to_status]}` : "Created"}
                  {ev.dod_override && <span className="badge-gap lc-override">DoD skipped</span>}
                </span>
                <span className="small ink-2">{driverLabel(m, ev.driver_type, ev.driver)}</span>
                {ev.note && <span className="ink-2">{ev.note}</span>}
                <span className="small muted">
                  {fmtDate(ev.at)} · {ev.username}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {s && s.events.length > 5 && (
          <button type="button" className="link-btn small" onClick={() => setShowAll((x) => !x)}>
            {showAll ? "Show fewer" : `Show all ${s.events.length}`}
          </button>
        )}
      </div>

      {dialog && s && m && (
        <ChangeDialog
          level={level}
          code={code}
          state={s}
          meta={m}
          onClose={() => setDialog(false)}
          onSaved={(next) => {
            state.setData(next);
            onChanged?.(next.status);
          }}
        />
      )}
    </section>
  );
}

function ChangeDialog({
  level,
  code,
  state,
  meta,
  onClose,
  onSaved,
}: {
  level: Level;
  code: string;
  state: LifecycleState;
  meta: LifecycleMeta;
  onClose: () => void;
  onSaved: (s: LifecycleState) => void;
}) {
  const { can } = useAuth();
  const admin = can("admin");
  const choices = LIFECYCLES.filter((x) => x !== state.status);
  const [to, setTo] = useState<Lifecycle>(
    state.status === "onboarding" ? "operational" : state.status === "operational" ? "maintenance" : choices[0],
  );
  const [driverType, setDriverType] = useState("operational");
  const [driver, setDriver] = useState(meta.drivers.operational[0].key);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const missing =
    to === "operational" ? meta.dod_items.filter((i) => !state.dod.find((d) => d.key === i.key)?.done) : [];
  const blocked = missing.length > 0 && !(admin && override);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await api.changeStatus(level, code, {
        to_status: to,
        driver_type: driverType,
        driver,
        note,
        override: missing.length > 0 && override,
      });
      onSaved(next);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Change status of ${code}`} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="form-grid">
          <label className="field">
            From
            <input className="input" disabled value={STATUS_LABEL[state.status]} />
          </label>
          <label className="field">
            To
            <select className="input" value={to} onChange={(e) => setTo(e.target.value as Lifecycle)}>
              {choices.map((x) => (
                <option key={x} value={x}>
                  {STATUS_LABEL[x]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="field fieldset">
          <legend>Change driver</legend>
          <div className="radio-row">
            {Object.keys(meta.drivers).map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="driver-type"
                  checked={driverType === t}
                  onChange={() => {
                    setDriverType(t);
                    setDriver(meta.drivers[t][0].key);
                  }}
                />
                {DRIVER_TYPE_LABEL[t] ?? t}
              </label>
            ))}
          </div>
          <select className="input" aria-label="Driver" value={driver} onChange={(e) => setDriver(e.target.value)}>
            {meta.drivers[driverType].map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </fieldset>
        <label className="field">
          Note
          <textarea
            className="input textarea"
            rows={3}
            value={note}
            placeholder="What happened and why the status changes"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {missing.length > 0 && (
          <div className="form-notice stack-xs">
            <strong>The definition of done is not complete.</strong>
            <span>Missing: {missing.map((x) => x.label).join(", ")}.</span>
            {admin ? (
              <label className="check">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Make it operational anyway (recorded in the change log)
              </label>
            ) : (
              <span>Tick the checklist first, or ask an admin.</span>
            )}
          </div>
        )}
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || blocked}>
            {busy ? "Saving…" : `Set to ${STATUS_LABEL[to]}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
