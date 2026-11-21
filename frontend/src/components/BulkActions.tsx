import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, LIFECYCLES, type Lifecycle, type LifecycleMeta } from "../api";
import { STATUS_LABEL } from "../lib/format";
import { DRIVER_TYPE_LABEL, loadMeta } from "./LifecyclePanel";
import { ErrorNote, Modal } from "./ui";
import { useRiseIn } from "../lib/motion";
import { t } from "../i18n";

/**
 * Bulk actions on many L3 rules at once (critique 2026-11-21: 129 rules due one click at a
 * time). There is no bulk endpoint on purpose: every rule goes through the same API call as on
 * its own page, so permissions, the definition of done and the audit log apply per rule.
 * Calls run one after the other; failures are listed and the rest carry on.
 */

/** Selection of rule codes in a table, with "select all shown". */
export function useSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (code: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const setAll = (codes: string[], on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      for (const c of codes) {
        if (on) n.add(c);
        else n.delete(c);
      }
      return n;
    });
  return { sel, toggle, setAll, clear: () => setSel(new Set()), has: (c: string) => sel.has(c) };
}

/** Header checkbox: checks all shown rows, shows "mixed" when only some are selected. */
export function SelectAll({ codes, sel, setAll }: { codes: string[]; sel: Set<string>; setAll: (codes: string[], on: boolean) => void }) {
  const n = codes.filter((c) => sel.has(c)).length;
  return (
    <input
      type="checkbox"
      aria-label={t("Select all shown rules")}
      checked={n > 0 && n === codes.length}
      ref={(el) => {
        if (el) el.indeterminate = n > 0 && n < codes.length;
      }}
      onChange={(e) => setAll(codes, e.target.checked)}
    />
  );
}

/** Floating bar while rules are selected: the count, the actions and "Clear". */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  // rises into place when the first rule is selected (lib/motion.ts)
  const ref = useRiseIn<HTMLDivElement>(count > 0);
  if (!count) return null;
  return (
    <div className="unsaved-bar bulk-bar" role="region" aria-label={t("Selected rules")} ref={ref}>
      <span>
        <strong>{t("{n} rules selected", { n: count })}</strong>
      </span>
      <span className="row-actions">
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          {t("Clear selection")}
        </button>
        {children}
      </span>
    </div>
  );
}

interface Failure {
  code: string;
  message: string;
}

/** Runs `fn` for each code in turn; reports progress and collects failures. */
async function runEach(codes: string[], fn: (code: string) => Promise<unknown>, onStep: (i: number) => void) {
  const failures: Failure[] = [];
  for (let i = 0; i < codes.length; i++) {
    onStep(i);
    try {
      await fn(codes[i]);
    } catch (e) {
      failures.push({ code: codes[i], message: (e as Error).message });
    }
  }
  onStep(codes.length);
  return failures;
}

function Outcome({ done, failures, total, onClose }: { done: string; failures: Failure[]; total: number; onClose: () => void }) {
  return (
    <div className="stack">
      <p className={failures.length ? "form-notice" : "form-success"} role="status">
        {done} {failures.length > 0 && t("{n} of {total} could not be changed:", { n: failures.length, total })}
      </p>
      {failures.length > 0 && (
        <ul className="plain-list small bulk-failures">
          {failures.map((f) => (
            <li key={f.code}>
              <span className="mono">{f.code}</span> · {f.message}
            </li>
          ))}
        </ul>
      )}
      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </div>
  );
}

/** Record one verification result for every selected rule. */
export function BulkVerifyDialog({ codes, onClose, onDone }: { codes: string[]; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState<"ok" | "issues">("ok");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [step, setStep] = useState<number | null>(null);
  const [failures, setFailures] = useState<Failure[] | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const f = await runEach(
      codes,
      (code) => api.verify("l3", code, { result, note, ...(when ? { verified_at: when } : {}) }),
      setStep,
    );
    setFailures(f);
    onDone();
  }

  const running = step !== null && failures === null;
  return (
    <Modal title={t("Verify {n} rules", { n: codes.length })} open onClose={running ? () => undefined : onClose}>
      {failures ? (
        <Outcome
          done={t("Recorded a verification for {n} rules.", { n: codes.length - failures.length })}
          failures={failures}
          total={codes.length}
          onClose={onClose}
        />
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="muted small" style={{ margin: 0 }}>
            {t("Records the same result, note and date for each selected rule, as if verified one by one. Each rule's configuration is tagged.")}
          </p>
          <p className="small mono bulk-codes">{codes.join(", ")}</p>
          <fieldset className="radio-row">
            <legend>{t("Result")}</legend>
            <label>
              <input type="radio" checked={result === "ok"} onChange={() => setResult("ok")} /> {t("Works as expected")}
            </label>
            <label>
              <input type="radio" checked={result === "issues"} onChange={() => setResult("issues")} /> {t("Issues found")}
            </label>
          </fieldset>
          <label className="field">
            {t("Note")}
            <textarea
              className="input textarea"
              rows={3}
              value={note}
              placeholder={t("How the rules were tested, e.g. replayed logs of the purple team exercise")}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="field">
            {t("Date (leave empty for today)")}
            <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          {running && (
            <p className="small muted" role="status">
              {t("Verifying {i} of {n}…", { i: Math.min(step + 1, codes.length), n: codes.length })}
            </p>
          )}
          <div className="row-actions">
            <button type="button" className="btn" onClick={onClose} disabled={running}>
              {t("Cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={running}>
              {t("Verify {n} rules", { n: codes.length })}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Move every selected rule to one lifecycle status with one change driver and note. */
export function BulkStatusDialog({
  codes,
  statusOf,
  onClose,
  onDone,
}: {
  codes: string[];
  statusOf: (code: string) => Lifecycle | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [meta, setMeta] = useState<LifecycleMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState<Lifecycle>("maintenance");
  const [driverType, setDriverType] = useState("");
  const [driver, setDriver] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<number | null>(null);
  const [failures, setFailures] = useState<Failure[] | null>(null);

  useEffect(() => {
    loadMeta()
      .then((m) => {
        setMeta(m);
        const first = Object.keys(m.drivers)[0];
        setDriverType(first);
        setDriver(m.drivers[first][0].key);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  // rules already in the target status are left alone
  const todo = codes.filter((c) => statusOf(c) !== to);
  const same = codes.length - todo.length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const f = await runEach(todo, (code) => api.changeStatus("l3", code, { to_status: to, driver_type: driverType, driver, note }), setStep);
    setFailures(f);
    onDone();
  }

  const running = step !== null && failures === null;
  return (
    <Modal title={t("Change status of {n} rules", { n: codes.length })} open onClose={running ? () => undefined : onClose}>
      {failures ? (
        <Outcome
          done={t("Changed the status of {n} rules.", { n: todo.length - failures.length })}
          failures={failures}
          total={todo.length}
          onClose={onClose}
        />
      ) : (
        <form className="stack" onSubmit={submit}>
          <ErrorNote error={error} />
          <p className="small mono bulk-codes">{codes.join(", ")}</p>
          <label className="field">
            {t("To")}
            <select className="input" value={to} onChange={(e) => setTo(e.target.value as Lifecycle)}>
              {LIFECYCLES.map((x) => (
                <option key={x} value={x}>
                  {STATUS_LABEL[x]}
                </option>
              ))}
            </select>
          </label>
          {meta && driverType && (
            <fieldset className="field fieldset">
              <legend>{t("Change driver")}</legend>
              <div className="radio-row">
                {Object.keys(meta.drivers).map((k) => (
                  <label key={k}>
                    <input
                      type="radio"
                      name="bulk-driver-type"
                      checked={driverType === k}
                      onChange={() => {
                        setDriverType(k);
                        setDriver(meta.drivers[k][0].key);
                      }}
                    />
                    {DRIVER_TYPE_LABEL[k] ?? k}
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
          )}
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
          <p className="small muted" style={{ margin: 0 }}>
            {same > 0 && `${t("{n} rules already have this status and are left as they are.", { n: same })} `}
            {to === "operational" &&
              t("Rules whose definition of done is incomplete are not changed; they are listed afterwards. An admin override is only possible on the rule page.")}
          </p>
          {running && (
            <p className="small muted" role="status">
              {t("Changing {i} of {n}…", { i: Math.min(step + 1, todo.length), n: todo.length })}
            </p>
          )}
          <div className="row-actions">
            <button type="button" className="btn" onClick={onClose} disabled={running}>
              {t("Cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={running || !todo.length || !meta}>
              {t("Change {n} rules", { n: todo.length })}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
