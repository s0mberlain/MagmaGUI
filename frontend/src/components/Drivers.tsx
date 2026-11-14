import { useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type BusinessDriver,
  type ComplianceRef,
  type ComplianceSource,
  type DriverCoverage,
  type LinkedUseCase,
} from "../api";
import { pct } from "../lib/format";
import { t } from "../i18n";
import { ErrorNote, Modal, MultiSelect, useLoad } from "./ui";

/** Business driver codes as chips; the name shows on hover when the list is known. */
export function BusinessChips({ codes, drivers }: { codes: string[]; drivers?: BusinessDriver[] }) {
  if (!codes.length) return <span className="muted small">{t("None")}</span>;
  const name = new Map(drivers?.map((d) => [d.code, d.name]) ?? []);
  return (
    <span className="chips">
      {codes.map((c) => (
        <span key={c} className="chip chip-info" title={name.get(c)}>
          {c}
        </span>
      ))}
    </span>
  );
}

/** Compliance drivers as chips, grouped by source. */
export function ComplianceChips({ items }: { items: ComplianceRef[] }) {
  if (!items.length) return <span className="muted small">{t("None")}</span>;
  return (
    <span className="chips">
      {items.map((c) => (
        <span key={c.id} className="chip chip-info" title={c.name || undefined}>
          <span className="chip-src">{c.source}</span>
          {c.ref}
        </span>
      ))}
    </span>
  );
}

/** Read-only block with both kinds of drivers, used on L2, L3 (inherited) and L1 (inherited). */
export function DriverBlock({
  business,
  compliance,
  drivers,
  note,
}: {
  business: string[];
  compliance: ComplianceRef[];
  drivers?: BusinessDriver[];
  note?: string;
}) {
  return (
    <div className="stack-xs">
      <dl className="driver-block">
        <dt>{t("Business drivers")}</dt>
        <dd>
          <BusinessChips codes={business} drivers={drivers} />
        </dd>
        <dt>{t("Compliance drivers")}</dt>
        <dd>
          <ComplianceChips items={compliance} />
        </dd>
      </dl>
      {note && <span className="small muted">{note}</span>}
    </div>
  );
}

export function businessOptions(drivers: BusinessDriver[]) {
  return drivers.map((b) => ({ value: b.code, label: `${b.code} · ${b.name}` }));
}

export function complianceOptions(sources: ComplianceSource[]) {
  return sources.flatMap((s) =>
    s.drivers.map((c) => ({ value: String(c.id), label: c.name ? `${c.ref} · ${c.name}` : c.ref, group: s.name })),
  );
}

/** The two multi-selects; compliance drivers are grouped by their source. */
export function DriverPickers({
  drivers,
  sources,
  business,
  compliance,
  onChange,
}: {
  drivers: BusinessDriver[];
  sources: ComplianceSource[];
  business: string[];
  compliance: string[];
  onChange: (patch: { business_drivers?: string[]; compliance_driver_ids?: string[] }) => void;
}) {
  return (
    <>
      <MultiSelect
        label={t("Business drivers")}
        options={businessOptions(drivers)}
        value={business}
        onChange={(v) => onChange({ business_drivers: v })}
      />
      <MultiSelect
        label={t("Compliance drivers")}
        options={complianceOptions(sources)}
        value={compliance}
        onChange={(v) => onChange({ compliance_driver_ids: v })}
      />
    </>
  );
}

/** Dialog to change only the drivers of one L2 use case. */
export function EditDriversDialog({
  l2,
  onClose,
  onSaved,
}: {
  l2: { code: string; name: string; business_drivers: string[]; compliance_driver_ids: number[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const lists = useLoad(async () => {
    const [drivers, sources] = await Promise.all([api.drivers(), api.compliance()]);
    return { drivers, sources };
  });
  const [business, setBusiness] = useState(l2.business_drivers);
  const [compliance, setCompliance] = useState(l2.compliance_driver_ids.map(String));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateL2(l2.code, {
        business_drivers: business,
        compliance_driver_ids: compliance.map(Number),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Drivers of {code}", { code: l2.code })} open onClose={onClose} wide>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          {l2.name}. {t("The L3 rules and the L1 use case inherit these drivers.")}
        </p>
        <ErrorNote error={error ?? lists.error} />
        {lists.data && (
          <div className="form-grid two">
            <DriverPickers
              drivers={lists.data.drivers}
              sources={lists.data.sources}
              business={business}
              compliance={compliance}
              onChange={(p) => {
                if (p.business_drivers) setBusiness(p.business_drivers);
                if (p.compliance_driver_ids) setCompliance(p.compliance_driver_ids);
              }}
            />
          </div>
        )}
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !lists.data} onClick={save}>
            {t("Save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Coverage as a bar with the value, or a gap badge when no use case is linked. */
export function CoverageCell({ d }: { d: Pick<DriverCoverage, "coverage" | "gap" | "low"> }) {
  if (d.gap) return <span className="badge-gap">{t("Gap · no use case")}</span>;
  return (
    <span className="cov-cell">
      <span className="bar" aria-hidden="true">
        <div className={d.low ? "bar-accent" : "d1"} style={{ width: `${Math.round((d.coverage ?? 0) * 100)}%` }} />
      </span>
      <span className="small strong">{pct(d.coverage)}</span>
      {d.low && <span className="badge-low">{t("low")}</span>}
    </span>
  );
}

/** Asks before a linked driver (or a whole source) is deleted and lists the affected use cases. */
export function ConfirmDeleteDialog({
  title,
  load,
  onConfirm,
  onClose,
}: {
  title: string;
  load: () => Promise<LinkedUseCase[]>;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const linked = useLoad(load);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = linked.data ?? [];

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} open onClose={onClose}>
      <div className="stack">
        <ErrorNote error={error ?? linked.error} />
        {linked.data && list.length === 0 && <p style={{ margin: 0 }}>{t("No use case is linked to it.")}</p>}
        {list.length > 0 && (
          <>
            <p style={{ margin: 0 }}>
              {t("It is linked to {n} L2 use cases. Deleting it removes these links:", { n: list.length })}
            </p>
            <ul className="affected">
              {list.map((u) => (
                <li key={u.code}>
                  <Link to={`/usecases?l2=${u.code}`} className="mono small">
                    {u.code}
                  </Link>{" "}
                  {u.name}
                  {u.l3_count > 0 && (
                    <span className="small muted"> · {t("{n} L3 rules inherit it", { n: u.l3_count })}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn btn-danger" disabled={busy || !linked.data} onClick={confirm}>
            {list.length ? t("Delete and remove links") : t("Delete")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
