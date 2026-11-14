import { useState, type FormEvent } from "react";
import { api, type Maturity } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Modal, useLoad } from "../components/ui";
import { fmtDate, today } from "../lib/format";
import { t } from "../i18n";

export default function MaturityPage() {
  const { can } = useAuth();
  const m = useLoad<Maturity>(() => api.maturity());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = m.data;
  const cur = d?.current ?? null;

  async function remove(id: number) {
    if (!window.confirm(t("Delete this assessment?"))) return;
    try {
      await api.deleteMaturity(id);
      void m.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Maturity")}</h1>
          <div className="subtitle">
            {t("Self-assessment of the use case process on the CMMI scale, as in the MaGMa framework.")}
          </div>
        </div>
        {can("admin", "analyst") && (
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              {t("New assessment")}
            </button>
          </div>
        )}
      </header>
      <ErrorNote error={error ?? m.error} />

      <div className="split">
        <section className="card split-main stack" aria-labelledby="lh">
          <div className="section-head">
            <h2 id="lh">{t("Current level")}</h2>
            {cur && (
              <span className="small muted">
                {t("Assessed")} {fmtDate(cur.assessed_at)} {t("by")} {cur.assessed_by}
              </span>
            )}
          </div>
          {d && !cur && <p className="muted">{t("No assessment yet. Start with where the SOC stands today.")}</p>}
          <ol className="ladder">
            {d?.levels
              .slice()
              .reverse()
              .map((l) => {
                const isCur = cur?.level === l.level;
                const isTarget = cur?.target_level === l.level;
                const reached = cur ? l.level <= cur.level : false;
                return (
                  <li key={l.level} className={(isCur ? "current " : "") + (reached ? "reached" : "")}>
                    <span className="ladder-n">{l.level}</span>
                    <span className="stack-xs grow">
                      <span className="strong-500">
                        {t(l.name)}
                        {isCur && <span className="pill pill-ok ladder-tag">{t("Current")}</span>}
                        {isTarget && <span className="pill pill-warn ladder-tag">{t("Target")}</span>}
                      </span>
                      <span className="small ink-2">{t(l.description)}</span>
                    </span>
                  </li>
                );
              })}
          </ol>
          {cur && Object.keys(cur.aspects).length > 0 && d && (
            <div className="stack-sm">
              <h3 className="h-sm">{t("Per aspect")}</h3>
              <div className="aspects">
                {Object.entries(d.aspects).map(([k, label]) => (
                  <div key={k} className="aspect">
                    <span className="small muted">{t(label)}</span>
                    <div
                      className="dots"
                      aria-label={t("{label}: level {n}", { label: t(label), n: cur.aspects[k] ?? t("not rated") })}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <i key={n} className={n <= (cur.aspects[k] ?? 0) ? "on" : ""} />
                      ))}
                    </div>
                    <span className="strong">{cur.aspects[k] ?? "–"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {cur?.notes && (
            <p className="ink-2" style={{ margin: 0 }}>
              {cur.notes}
            </p>
          )}
        </section>

        <section className="card split-side stack-sm" aria-labelledby="hh">
          <h2 id="hh">{t("History")}</h2>
          {d && !d.history.length && <p className="muted small">{t("Nothing yet.")}</p>}
          <ul className="history">
            {d?.history.map((a) => (
              <li key={a.id}>
                <span className="level-badge">{a.level}</span>
                <span className="stack-xs grow">
                  <span className="strong-500">
                    {t(d.levels.find((l) => l.level === a.level)?.name ?? "")}
                    {a.target_level && (
                      <span className="muted">
                        {" "}
                        {t("→ target")} {a.target_level}
                      </span>
                    )}
                  </span>
                  {a.notes && <span className="small ink-2">{a.notes}</span>}
                  <span className="small muted">
                    {fmtDate(a.assessed_at)} · {a.assessed_by}
                  </span>
                </span>
                {can("admin") && (
                  <button type="button" className="link-btn small text-err" onClick={() => void remove(a.id)}>
                    {t("Delete")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="small muted">{t("The level is also a trend line on History & trends.")}</p>
        </section>
      </div>

      {open && d && <AssessDialog m={d} onClose={() => setOpen(false)} onSaved={() => void m.reload()} />}
    </>
  );
}

function AssessDialog({ m, onClose, onSaved }: { m: Maturity; onClose: () => void; onSaved: () => void }) {
  const cur = m.current;
  const [level, setLevel] = useState(cur?.level ?? 1);
  const [target, setTarget] = useState<string>(cur?.target_level?.toString() ?? "");
  const [aspects, setAspects] = useState<Record<string, string>>(
    Object.fromEntries(Object.keys(m.aspects).map((k) => [k, cur?.aspects[k]?.toString() ?? ""])),
  );
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.assessMaturity({
        level,
        target_level: target ? Number(target) : null,
        aspects: Object.fromEntries(
          Object.entries(aspects)
            .filter(([, v]) => v)
            .map(([k, v]) => [k, Number(v)]),
        ),
        notes,
        assessed_at: when,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("New maturity assessment")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <fieldset className="field fieldset">
          <legend>{t("Overall level")}</legend>
          <div className="level-pick">
            {m.levels.map((l) => (
              <label key={l.level} className={level === l.level ? "on" : ""}>
                <input type="radio" name="level" checked={level === l.level} onChange={() => setLevel(l.level)} />
                <span className="ladder-n">{l.level}</span>
                <span className="small">{t(l.name)}</span>
              </label>
            ))}
          </div>
          <span className="small muted">{t(m.levels.find((l) => l.level === level)?.description ?? "")}</span>
        </fieldset>
        <div className="form-grid">
          {Object.entries(m.aspects).map(([k, label]) => (
            <label key={k} className="field">
              {t(label)}
              <select
                className="input"
                value={aspects[k]}
                onChange={(e) => setAspects((a) => ({ ...a, [k]: e.target.value }))}
              >
                <option value="">{t("Not rated")}</option>
                {m.levels.map((l) => (
                  <option key={l.level} value={l.level}>
                    {l.level} · {t(l.name)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="field">
            {t("Target level")}
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t("None")}</option>
              {m.levels.map((l) => (
                <option key={l.level} value={l.level}>
                  {l.level} · {t(l.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("Assessed on")}
            <input className="input" type="date" max={today()} value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        </div>
        <label className="field">
          {t("Notes")}
          <textarea
            className="input textarea"
            rows={3}
            value={notes}
            placeholder={t("What supports this level, what is missing for the next one")}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("Save assessment")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
