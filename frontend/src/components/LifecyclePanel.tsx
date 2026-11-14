import { useState, type FormEvent } from "react";
import { api, LIFECYCLES, type Level, type Lifecycle, type LifecycleMeta, type LifecycleState } from "../api";
import { useAuth } from "../auth";
import { fmtDate, STATUS_LABEL } from "../lib/format";
import { ErrorNote, Modal, StatusPill, useLoad } from "./ui";
import { t } from "../i18n";

let metaCache: Promise<LifecycleMeta> | null = null;
export function loadMeta(): Promise<LifecycleMeta> {
  metaCache ??= api.lifecycleMeta().catch((e) => {
    metaCache = null;
    throw e;
  });
  return metaCache;
}

export const DRIVER_TYPE_LABEL: Record<string, string> = {
  environmental: t("Environmental"),
  operational: t("Operational"),
  other: t("Other"),
  unspecified: t("Not given"),
};

export function driverLabel(meta: LifecycleMeta | null, type: string, key: string): string {
  if (type === "unspecified") return t("No driver given");
  const d = meta?.drivers[type]?.find((x) => x.key === key);
  return `${DRIVER_TYPE_LABEL[type] ?? type} · ${d ? t(d.label) : key}`;
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
  const [ticked, setTicked] = useState(false);

  const s = state.data;
  const m = meta.data;
  const doneCount = s?.dod.filter((d) => d.done).length ?? 0;

  async function tick(key: string, done: boolean) {
    setError(null);
    setTicked(false);
    try {
      const next = await api.setDod(level, code, { [key]: done });
      state.setData(next);
      setTicked(true);
      onChanged?.(next.status); // the use case changed: pages reload their copy of it
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const events = s ? (showAll ? s.events : s.events.slice(0, 5)) : [];

  return (
    <section className="card stack" aria-labelledby={`lc-${code}`}>
      <div className="section-head">
        <h2 id={`lc-${code}`}>{t("Lifecycle")}</h2>
        <div className="row-actions lc-actions">
          {s && <StatusPill status={s.status} />}
          {editor && s && (
            <button type="button" className="btn btn-sm" onClick={() => setDialog(true)}>
              {t("Change status")}
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={error ?? state.error ?? meta.error} />

      <div className="stack-sm">
        <div className="section-head">
          <h3 className="h-sm">{t("Definition of done")}</h3>
          <span className="chips">
            {ticked && (
              <span className="saved-tick" role="status">
                {t("Saved")}
              </span>
            )}
            <span className={s && doneCount === s.dod.length ? "pill pill-ok" : "pill pill-warn"}>
              {doneCount} {t("of")} {s?.dod.length ?? 5}
            </span>
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
                      <span className="strong-500">{t(item.label)}</span>
                      <span className="small muted">
                        {st?.done ? `${t("Done {date}", { date: fmtDate(st.at) })} · ${st.by}` : t(item.hint)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
        </ul>
      </div>

      <div className="stack-sm">
        <h3 className="h-sm">{t("Change log")}</h3>
        {s && !s.events.length && <p className="muted small">{t("No status changes recorded.")}</p>}
        <ul className="history">
          {events.map((ev) => (
            <li key={ev.id}>
              <StatusPill status={ev.to_status} />
              <span className="stack-xs">
                <span className="strong-500">
                  {ev.from_status ? `${STATUS_LABEL[ev.from_status]} → ${STATUS_LABEL[ev.to_status]}` : t("Created")}
                  {ev.dod_override && <span className="badge-gap lc-override">{t("DoD skipped")}</span>}
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
            {showAll ? t("Show fewer") : t("Show all {n}", { n: s.events.length })}
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
  // the server says what may follow (a retired use case starts again with onboarding)
  const choices = LIFECYCLES.filter((x) => x !== state.status && (state.allowed ?? LIFECYCLES).includes(x));
  const [to, setTo] = useState<Lifecycle>(
    state.status === "onboarding" ? "operational" : state.status === "operational" ? "maintenance" : choices[0]!,
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
    <Modal title={t("Change status of {code}", { code })} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="form-grid">
          <label className="field">
            {t("From")}
            <input className="input" disabled value={STATUS_LABEL[state.status]} />
          </label>
          <label className="field">
            {t("To")}
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
          <legend>{t("Change driver")}</legend>
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
          <select className="input" aria-label={t("Driver")} value={driver} onChange={(e) => setDriver(e.target.value)}>
            {meta.drivers[driverType].map((d) => (
              <option key={d.key} value={d.key}>
                {t(d.label)}
              </option>
            ))}
          </select>
        </fieldset>
        <label className="field">
          {t("Note")}
          <textarea
            className="input textarea"
            rows={3}
            value={note}
            placeholder={t("What happened and why the status changes")}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {to === "onboarding" && state.dod.some((d) => d.done) && (
          <p className="form-notice">
            {t("Back to onboarding empties the definition of done: the way to Operational needs a fresh checklist.")}
          </p>
        )}
        {missing.length > 0 && (
          <div className="form-notice stack-xs">
            <strong>{t("The definition of done is not complete.")}</strong>
            <span>
              {t("Missing:")} {missing.map((x) => t(x.label)).join(", ")}.
            </span>
            {admin ? (
              <label className="check">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                {t("Make it operational anyway (recorded in the change log)")}
              </label>
            ) : (
              <span>{t("Tick the checklist first, or ask an admin.")}</span>
            )}
          </div>
        )}
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || blocked}>
            {busy ? t("Saving…") : t("Set to {status}", { status: STATUS_LABEL[to] })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
