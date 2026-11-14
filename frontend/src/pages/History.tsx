import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type LifecycleEvent, type SnapshotCompare, type Trends } from "../api";
import { useAuth } from "../auth";
import { driverLabel, DRIVER_TYPE_LABEL, loadMeta } from "../components/LifecyclePanel";
import TrendChart from "../components/TrendChart";
import { ErrorNote, Modal, StatusPill, useLoad } from "../components/ui";
import { fmtDate, pct, STATUS_LABEL } from "../lib/format";
import { t } from "../i18n";

const SCHEDULE_LABEL: Record<string, string> = {
  off: t("Automatic snapshots are off"),
  daily: t("A snapshot is taken every day"),
  weekly: t("A snapshot is taken every week"),
  monthly: t("A snapshot is taken every month"),
};

const KIND_LABEL: Record<string, string> = {
  manual: t("Manual"),
  scheduled: t("Scheduled"),
  demo: t("Demo"),
  live: t("Now"),
};

function fmtMetric(v: number | null | undefined, unit: string) {
  if (v === null || v === undefined) return "–";
  return unit === "pct" ? pct(v) : String(v);
}

function Delta({ a, b, unit }: { a: number | null | undefined; b: number | null | undefined; unit: string }) {
  if (a === null || a === undefined || b === null || b === undefined) return <span className="muted">–</span>;
  const d = b - a;
  if (Math.abs(d) < 1e-9) return <span className="muted">±0</span>;
  const txt =
    unit === "pct" ? `${d > 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pt` : `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
  return <span className={d > 0 ? "delta-up" : "delta-down"}>{txt}</span>;
}

export default function History() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const trends = useLoad<Trends>(() => api.trends());
  const snaps = useLoad(() => api.snapshots());
  const meta = useLoad(loadMeta);
  const [driverType, setDriverType] = useState("");
  const changes = useLoad<LifecycleEvent[]>(() => api.changes(100, driverType), [driverType]);
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("live");
  const [cmp, setCmp] = useState<SnapshotCompare | null>(null);
  const [cmpBusy, setCmpBusy] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const tt = trends.data;
  const points = tt?.points ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  const options = snaps.data ?? [];

  async function compare(ev?: FormEvent, from = a, to = b) {
    ev?.preventDefault();
    if (!from) return;
    setCmpBusy(true);
    setError(null);
    try {
      setCmp(await api.compareSnapshots(from, to));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCmpBusy(false);
    }
  }

  async function remove(id: number, label: string) {
    if (!window.confirm(t("Delete snapshot “{name}”?", { name: label || id }))) return;
    try {
      await api.deleteSnapshot(id);
      void snaps.reload();
      void trends.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const changeMax = Math.max(1, ...points.slice(1).map((p) => p.lifecycle_changes + p.config_commits));

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("History & trends")}</h1>
          <div className="subtitle">
            {tt ? (SCHEDULE_LABEL[tt.schedule] ?? tt.schedule) : "…"}
            {first &&
              last &&
              points.length > 1 &&
              ` · ${t("{n} snapshots since {date}", { n: points.length - 1, date: fmtDate(first.taken_at) })}`}
          </div>
        </div>
        {editor && (
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={() => setTaking(true)}>
              {t("Take snapshot")}
            </button>
          </div>
        )}
      </header>

      <ErrorNote error={error ?? trends.error ?? snaps.error} />

      <section aria-labelledby="th" className="stack">
        <div className="section-head">
          <h2 id="th">{t("Control metrics")}</h2>
          <button type="button" className="link-btn small" onClick={() => setShowTable((x) => !x)}>
            {showTable ? t("Show charts") : t("Show as table")}
          </button>
        </div>
        {tt && points.length < 2 && (
          <p className="muted">{t("Only the current state exists. Take a snapshot to start the trend lines.")}</p>
        )}
        {tt && !showTable && (
          <div className="trend-grid">
            {tt.metrics.map((m) => (
              <div className="card trend-card" key={m.key}>
                <div className="trend-head">
                  <span className="kpi-label">{t(m.label)}</span>
                  <Delta a={first?.kpis[m.key]} b={last?.kpis[m.key]} unit={m.unit} />
                </div>
                <span className="trend-value">{fmtMetric(last?.kpis[m.key], m.unit)}</span>
                <TrendChart
                  title={t(m.label)}
                  unit={m.unit}
                  data={points.map((p) => ({
                    label: p.label || fmtDate(p.taken_at),
                    at: p.taken_at,
                    value: p.kpis[m.key] ?? null,
                    live: p.kind === "live",
                  }))}
                />
              </div>
            ))}
            <div className="card trend-card">
              <div className="trend-head">
                <span className="kpi-label">{t("Framework changes per period")}</span>
              </div>
              <div className="legend">
                <span>
                  <i className="d1" />
                  {t("Status changes")}
                </span>
                <span>
                  <i className="d3" />
                  {t("Config commits")}
                </span>
              </div>
              <div className="change-bars" role="img" aria-label={t("Status changes and config commits per period")}>
                {points.slice(1).map((p) => (
                  <div
                    key={p.taken_at}
                    className="change-bar"
                    title={t("{label}: {a} status changes, {b} config commits", {
                      label: p.label,
                      a: p.lifecycle_changes,
                      b: p.config_commits,
                    })}
                  >
                    <div className="seg d3" style={{ height: `${(p.config_commits / changeMax) * 100}%` }} />
                    <div className="seg d1" style={{ height: `${(p.lifecycle_changes / changeMax) * 100}%` }} />
                  </div>
                ))}
              </div>
              <span className="small muted">
                {t("First period left out: it holds everything before the first snapshot.")}
              </span>
            </div>
          </div>
        )}
        {tt && showTable && (
          <div className="card table-card scroll-x">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>{t("Snapshot")}</th>
                  {tt.metrics.map((m) => (
                    <th key={m.key} className="num">
                      {t(m.label)}
                    </th>
                  ))}
                  <th className="num">{t("Status changes")}</th>
                  <th className="num">{t("Config commits")}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.taken_at}>
                    <td className="nowrap">{p.kind === "live" ? t("Now") : `${fmtDate(p.taken_at)}`}</td>
                    {tt.metrics.map((m) => (
                      <td key={m.key} className="num">
                        {fmtMetric(p.kpis[m.key], m.unit)}
                      </td>
                    ))}
                    <td className="num">{p.lifecycle_changes}</td>
                    <td className="num">{p.config_commits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="split">
        <section className="card split-main stack" aria-labelledby="sh">
          <h2 id="sh">{t("Snapshots")}</h2>
          <form className="inline-form" onSubmit={compare}>
            <label className="field">
              {t("Compare")}
              <select className="input" value={a} onChange={(e) => setA(e.target.value)} required>
                <option value="">{t("Choose a snapshot")}</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label || fmtDate(s.taken_at)} ({fmtDate(s.taken_at)})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("with")}
              <select className="input" value={b} onChange={(e) => setB(e.target.value)}>
                <option value="live">{t("Now")}</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label || fmtDate(s.taken_at)} ({fmtDate(s.taken_at)})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn" disabled={!a || cmpBusy}>
              {cmpBusy ? t("Comparing…") : t("Compare")}
            </button>
          </form>
          {snaps.data && !snaps.data.length && <p className="muted">{t("No snapshots yet.")}</p>}
          <div className="scroll-x">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>{t("Snapshot")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Taken")}</th>
                  <th className="num">{t("SOC score")}</th>
                  <th className="num">{t("Rules")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {options.slice(0, 15).map((s) => (
                  <tr key={s.id}>
                    <td className="strong-500">{s.label || "–"}</td>
                    <td>
                      <span className="chip chip-neutral">{KIND_LABEL[s.kind] ?? s.kind}</span>
                    </td>
                    <td className="nowrap">
                      {fmtDate(s.taken_at)}
                      {s.kind === "manual" && <span className="muted"> · {s.taken_by}</span>}
                    </td>
                    <td className="num">{pct(s.kpis.soc_detection_score ?? null)}</td>
                    <td className="num">{s.kpis.rules ?? "–"}</td>
                    <td className="num nowrap">
                      <button
                        type="button"
                        className="link-btn small"
                        onClick={() => {
                          setA(String(s.id));
                          setB("live");
                          void compare(undefined, String(s.id), "live");
                        }}
                      >
                        {t("Compare with now")}
                      </button>
                      {can("admin") && (
                        <button
                          type="button"
                          className="link-btn small text-err"
                          style={{ marginLeft: 12 }}
                          onClick={() => void remove(s.id, s.label)}
                        >
                          {t("Delete")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {options.length > 15 && (
            <p className="small muted">
              {options.length - 15} {t("older snapshots not shown.")}
            </p>
          )}
        </section>

        <section className="card split-side stack-sm" aria-labelledby="clh">
          <div className="section-head">
            <h2 id="clh">{t("Change log")}</h2>
            <select
              className="input input-sm"
              aria-label={t("Filter by driver")}
              value={driverType}
              onChange={(e) => setDriverType(e.target.value)}
            >
              <option value="">{t("All drivers")}</option>
              {Object.entries(DRIVER_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <ErrorNote error={changes.error} />
          {changes.data && !changes.data.length && <p className="muted small">{t("No status changes.")}</p>}
          <ul className="history change-log">
            {changes.data?.map((ev) => (
              <li key={ev.id}>
                <StatusPill status={ev.to_status} />
                <span className="stack-xs">
                  <Link
                    className="strong-500"
                    to={ev.level === "l3" ? `/usecases/l3/${ev.code}` : `/usecases?l2=${ev.code}`}
                  >
                    <span className="mono small">{ev.code}</span> {ev.name}
                  </Link>
                  <span className="small ink-2">
                    {ev.from_status ? `${STATUS_LABEL[ev.from_status]} → ${STATUS_LABEL[ev.to_status]}` : t("Created")}{" "}
                    · {driverLabel(meta.data, ev.driver_type, ev.driver)}
                    {ev.dod_override && t(" · DoD skipped")}
                  </span>
                  {ev.note && <span className="small ink-2">{ev.note}</span>}
                  <span className="small muted">
                    {fmtDate(ev.at)} · {ev.username}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {cmp && tt && <CompareDialog cmp={cmp} metrics={tt.metrics} onClose={() => setCmp(null)} />}
      {taking && (
        <SnapshotDialog
          onClose={() => setTaking(false)}
          onSaved={() => {
            void snaps.reload();
            void trends.reload();
          }}
        />
      )}
    </>
  );
}

function SnapshotDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.takeSnapshot(label);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Take snapshot")} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <p className="muted" style={{ margin: 0 }}>
          {t("Freezes all scores, statuses and counts as they are now, for trends and later comparison.")}
        </p>
        <label className="field">
          {t("Label")}
          <input
            className="input"
            value={label}
            maxLength={200}
            placeholder={t("e.g. Before Q4 purple team")}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("Saving…") : t("Take snapshot")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompareDialog({
  cmp,
  metrics,
  onClose,
}: {
  cmp: SnapshotCompare;
  metrics: Trends["metrics"];
  onClose: () => void;
}) {
  const name = (s: SnapshotCompare["a"]) => (s.kind === "live" ? t("Now") : s.label || fmtDate(s.taken_at));
  const w = (x: Record<string, unknown> | null) => (x ? (x.weight as number | null) : null);
  return (
    <Modal title={`${name(cmp.a)} → ${name(cmp.b)}`} open onClose={onClose} wide>
      <div className="stack">
        <table className="table table-plain">
          <thead>
            <tr>
              <th>{t("Metric")}</th>
              <th className="num">{name(cmp.a)}</th>
              <th className="num">{name(cmp.b)}</th>
              <th className="num">{t("Change")}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.key}>
                <td>{t(m.label)}</td>
                <td className="num">{fmtMetric(cmp.kpis[m.key]?.a, m.unit)}</td>
                <td className="num">{fmtMetric(cmp.kpis[m.key]?.b, m.unit)}</td>
                <td className="num">
                  <Delta a={cmp.kpis[m.key]?.a} b={cmp.kpis[m.key]?.b} unit={m.unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(["l1", "l2"] as const).map((lvl) =>
          cmp[lvl].length ? (
            <div key={lvl} className="stack-sm">
              <h3 className="h-sm">
                {lvl.toUpperCase()} {t("use cases with a different weight")}
              </h3>
              <table className="table table-plain">
                <tbody>
                  {cmp[lvl].map((g) => (
                    <tr key={g.code}>
                      <td>
                        <span className="code-tag">{g.code}</span> {g.name}
                      </td>
                      <td className="num">{pct(w(g.a), 1)}</td>
                      <td className="num">{pct(w(g.b), 1)}</td>
                      <td className="num">
                        <Delta a={w(g.a)} b={w(g.b)} unit="pct" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null,
        )}

        <div className="stack-sm">
          <h3 className="h-sm">
            {t("Rules that changed (")}
            {cmp.rules.length})
          </h3>
          {!cmp.rules.length && <p className="muted small">{t("No rule changed.")}</p>}
          <ul className="history">
            {cmp.rules.slice(0, 60).map((r) => {
              const sa = r.a?.status as keyof typeof STATUS_LABEL | undefined;
              const sb = r.b?.status as keyof typeof STATUS_LABEL | undefined;
              return (
                <li key={r.code}>
                  <span className="mono small" style={{ minWidth: 92 }}>
                    {r.code}
                  </span>
                  <span className="stack-xs grow">
                    <span className="strong-500">{r.name}</span>
                    <span className="small ink-2">
                      {r.change === "added"
                        ? t("New rule")
                        : r.change === "removed"
                          ? t("Removed")
                          : sa !== sb
                            ? `${STATUS_LABEL[sa!]} → ${STATUS_LABEL[sb!]}`
                            : t("Metrics changed")}
                      {t(" · weight ")}
                      {pct(w(r.a), 1)} → {pct(w(r.b), 1)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {cmp.rules.length > 60 && (
            <p className="small muted">
              {cmp.rules.length - 60} {t("more not shown.")}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
