import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Lifecycle } from "../api";
import { STATUS_LABEL } from "../lib/format";
import { t } from "../i18n";

/** Load data on mount and when deps change; `reload` refetches. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(() => {
    setLoading(true);
    return load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function StatusPill({ status }: { status: Lifecycle }) {
  return <span className={`pill status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Chips({ items, tone = "info" }: { items: string[]; tone?: "info" | "neutral" }) {
  if (!items.length) return <span className="muted">–</span>;
  return (
    <div className="chips">
      {items.map((s) => (
        <span key={s} className={`chip chip-${tone}`}>
          {s}
        </span>
      ))}
    </div>
  );
}

export function MetricBars({ e, i, c }: { e: number | null; i: number | null; c: number | null }) {
  const bar = (v: number | null, cls: string, label: string) => (
    <div className="bar" title={`${label}: ${v === null ? "–" : Math.round(v * 100) + " %"}`}>
      <div className={cls} style={{ width: `${Math.round((v ?? 0) * 100)}%` }} />
    </div>
  );
  return (
    <div className="metric-bars">
      {bar(e, "d1", t("Effectiveness"))}
      {bar(i, "d2", t("Implementation"))}
      {bar(c, "d3", t("Coverage"))}
    </div>
  );
}

export function MetricLegend() {
  return (
    <div className="legend">
      <span>
        <i className="d1" />
        {t("Effectiveness")}
      </span>
      <span>
        <i className="d2" />
        {t("Implementation")}
      </span>
      <span>
        <i className="d3" />
        {t("Coverage")}
      </span>
    </div>
  );
}

export function GapBadge({ children = t("Detection gap") }: { children?: ReactNode }) {
  return <span className="badge-gap">{children}</span>;
}

/** Modal dialog using the native <dialog> element (focus trap and Esc for free). */
export function Modal({
  title,
  open,
  onClose,
  children,
  wide,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // Rendered into <body>: a dialog opened from inside a page <form> (the rule editor) would otherwise
  // nest its own <form> in it, and submitting the dialog would submit (and reload) the page form.
  // React still bubbles events through the component tree, so submit events stop at the dialog.
  return createPortal(
    <dialog
      ref={ref}
      className={"modal" + (wide ? " modal-wide" : "")}
      aria-labelledby={id}
      onClose={onClose}
      onCancel={onClose}
      onSubmit={(e) => e.stopPropagation()}
      onReset={(e) => e.stopPropagation()}
    >
      {open && (
        <>
          <div className="modal-head">
            <h2 id={id}>{title}</h2>
            <button type="button" className="icon-btn" aria-label={t("Close")} onClick={onClose}>
              ×
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>,
    document.body,
  );
}

/** Checkbox list in a disclosure, for picking several entries from a reference list. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  /** options with a `group` are listed under that heading (in the order the groups appear) */
  options: { value: string; label: string; group?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const chosen = options.filter((o) => value.includes(o.value));
  return (
    <div className="field">
      <span id={id}>{label}</span>
      <details className="multi">
        <summary className={"input multi-summary" + (disabled ? " is-disabled" : "")} aria-labelledby={id}>
          {chosen.length ? (
            <span className="chips">
              {chosen.map((o) => (
                <span key={o.value} className="chip chip-info">
                  {o.label}
                </span>
              ))}
            </span>
          ) : (
            <span className="muted">{t("None")}</span>
          )}
        </summary>
        {!disabled && (
          <fieldset className="multi-list" aria-labelledby={id}>
            {[...new Set(options.map((o) => o.group ?? ""))].map((g) => (
              <div key={g} className="multi-group" role="group" aria-label={g || undefined}>
                {g && <span className="multi-group-head">{g}</span>}
                {options
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <label key={o.value}>
                      <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                      {o.label}
                    </label>
                  ))}
              </div>
            ))}
            {!options.length && <span className="muted">{t("The reference list is empty.")}</span>}
          </fieldset>
        )}
      </details>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
