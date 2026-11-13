import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AttackCoverage, type AttackTech, type RemapResult } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Modal, useLoad } from "../components/ui";
import { pct } from "../lib/format";

/** Single-hue sequential ramp for the best rule weight of a technique. */
const RAMP = [
  { min: 0, label: "under 20 %" },
  { min: 0.2, label: "20–40 %" },
  { min: 0.4, label: "40–60 %" },
  { min: 0.6, label: "60–80 %" },
  { min: 0.8, label: "80 % and more" },
];

function level(t: AttackTech): string {
  if (!t.rules.length) return "none";
  if (t.best === null) return "unscored";
  let i = 0;
  RAMP.forEach((r, k) => {
    if (t.best! >= r.min) i = k;
  });
  return `w${i}`;
}

export default function AttackPage() {
  const { can } = useAuth();
  const cov = useLoad<AttackCoverage>(() => api.attackCoverage());
  const [sel, setSel] = useState<AttackTech | null>(null);
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [q, setQ] = useState("");
  const [remapOpen, setRemapOpen] = useState(false);
  const c = cov.data;

  const query = q.trim().toLowerCase();
  const match = (t: AttackTech) =>
    (!onlyCovered || t.rules.length > 0) &&
    (!query ||
      t.id.toLowerCase().includes(query) ||
      t.name.toLowerCase().includes(query) ||
      t.rules.some((r) => r.code.toLowerCase().includes(query)));

  const outdatedRules = useMemo(() => new Set(c?.outdated.map((o) => o.code)).size, [c]);
  const replaceable = c?.outdated.filter((o) => o.status === "revoked").length ?? 0;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>ATT&amp;CK coverage</h1>
          <div className="subtitle">
            MITRE ATT&amp;CK Enterprise {c ? `(data ${c.version})` : ""} · colour = best weight of an operational rule
            for the technique
          </div>
        </div>
        <div className="row-actions">
          <a className="btn" href="/api/attack/navigator.json" download>
            Download Navigator layer
          </a>
        </div>
      </header>
      <ErrorNote error={cov.error} />

      {c && c.outdated.length > 0 && (
        <div className="notice-bar" role="status">
          <div>
            <strong>
              {c.outdated.length} technique IDs in {outdatedRules} rules are outdated.
            </strong>{" "}
            {replaceable > 0
              ? `${replaceable} were replaced by newer techniques in ATT&CK and can be updated automatically; they count under their replacement here.`
              : "They have no successor in ATT&CK; edit the rules to map them to current techniques."}
          </div>
          {can("admin") && replaceable > 0 ? (
            <button type="button" className="btn btn-dark" onClick={() => setRemapOpen(true)}>
              Review update
            </button>
          ) : (
            replaceable > 0 && <span className="small muted">An admin can update them.</span>
          )}
        </div>
      )}

      <section className="kpi-grid" aria-label="Summary">
        <div className="card kpi">
          <span className="kpi-label">Techniques with a rule</span>
          <span className="kpi-value">{c ? c.techniques_with_rules : "–"}</span>
          <span className="kpi-sub">
            {c ? `${pct(c.techniques_with_rules / c.techniques_total)} of ${c.techniques_total} techniques` : "…"}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">With a scored rule</span>
          <span className="kpi-value">{c ? c.techniques_scored : "–"}</span>
          <span className="kpi-sub">Operational or maintenance, all metrics set</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Rules mapped to ATT&amp;CK</span>
          <span className="kpi-value">{c ? c.rules_mapped : "–"}</span>
          <span className="kpi-sub">{c ? `of ${c.rules_total} active rules` : "…"}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Tactics without coverage</span>
          <span className="kpi-value">{c ? c.tactics.filter((t) => !t.covered).length : "–"}</span>
          <span className="kpi-sub">
            {c
              ? c.tactics
                  .filter((t) => !t.covered)
                  .map((t) => t.name)
                  .join(", ") || "Every tactic has at least one rule"
              : "…"}
          </span>
        </div>
      </section>

      <div className="split">
        <section className="card attack-card split-main" aria-label="Coverage matrix">
          <div className="filters">
            <input
              className="input input-sm"
              type="search"
              placeholder="Find technique or rule"
              aria-label="Find technique or rule"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="check small">
              <input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />
              Only techniques with rules
            </label>
            <span className="grow" />
            <div className="legend attack-legend" aria-label="Legend">
              <span>
                <i className="t-none" />
                No rule
              </span>
              <span>
                <i className="t-unscored" />
                Rule, not scored
              </span>
              <span className="ramp">
                Weight
                {RAMP.map((r, i) => (
                  <i key={r.min} className={`t-w${i}`} title={r.label} />
                ))}
                <span className="small muted">0 → 100 %</span>
              </span>
            </div>
          </div>
          <div className="attack-matrix">
            {c?.tactics.map((t) => {
              const techs = t.techniques.filter((x) => match(x) || x.subs.some(match));
              return (
                <div key={t.id} className="tactic">
                  <div className="tactic-head" title={t.id}>
                    <span>{t.name}</span>
                    <span className="small muted">
                      {t.covered} of {t.total} covered
                    </span>
                    <div className="bar">
                      <div className="d1" style={{ width: `${t.total ? (t.covered / t.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                  {techs.map((x) => (
                    <button
                      type="button"
                      key={x.id}
                      className={`tech t-${level(x)}` + (sel?.id === x.id ? " sel" : "")}
                      onClick={() => setSel(x)}
                      title={`${x.id} ${x.name}${x.rules.length ? ` · ${x.rules.length} rule(s)` : ""}`}
                    >
                      <span className="tech-name">{x.name}</span>
                      {x.subs.length > 0 && <span className="tech-subs">{x.subs.length}</span>}
                    </button>
                  ))}
                  {!techs.length && <span className="small muted tech-empty">No match</span>}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="card split-side stack attack-detail" aria-live="polite">
          {sel ? <TechDetail t={sel} onPick={setSel} /> : <p className="muted">Pick a technique to see its rules.</p>}
        </aside>
      </div>

      {remapOpen && (
        <RemapDialog
          onClose={() => setRemapOpen(false)}
          onDone={() => {
            setSel(null);
            void cov.reload();
          }}
        />
      )}
    </>
  );
}

function TechDetail({ t, onPick }: { t: AttackTech; onPick: (t: AttackTech) => void }) {
  const url = `https://attack.mitre.org/techniques/${t.id.replace(".", "/")}/`;
  return (
    <>
      <div className="stack-xs">
        <span className="mono small muted">{t.id}</span>
        <h2>{t.name}</h2>
        <a className="small" href={url} target="_blank" rel="noreferrer">
          Open on attack.mitre.org
        </a>
      </div>
      <dl className="facts">
        <dt>Best weight</dt>
        <dd>{t.rules.length ? pct(t.best) : "No rule"}</dd>
        <dt>Rules</dt>
        <dd>{t.rules.length}</dd>
      </dl>
      {t.rules.length > 0 && (
        <ul className="link-list attack-rules">
          {t.rules.map((r) => (
            <li key={r.code}>
              <Link className="rule-link" to={`/usecases/l3/${r.code}`}>
                <span className="mono small muted">{r.code}</span>
                <span>{r.name}</span>
              </Link>
              <span className="small muted nowrap">
                {r.weight === null ? "not scored" : pct(r.weight)}
                {!r.direct && " · via sub-technique"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {t.subs.length > 0 && (
        <div className="stack-sm">
          <h3 className="h-sm">Sub-techniques</h3>
          <div className="sub-grid">
            {t.subs.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`tech t-${level(s)}`}
                onClick={() => onPick(s)}
                title={`${s.id} ${s.name}`}
              >
                <span className="mono tech-id">{s.id}</span>
                <span className="tech-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function RemapDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const preview = useLoad<RemapResult>(() => api.remapPreview());
  const [result, setResult] = useState<RemapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = result ?? preview.data;

  async function apply() {
    setBusy(true);
    try {
      setResult(await api.remapApply());
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Update technique IDs" open onClose={onClose} wide>
      <div className="stack">
        <ErrorNote error={preview.error ?? error} />
        {p && (
          <p className="ink-2" style={{ margin: 0 }}>
            {result
              ? `Done: ${p.ids_replaced} IDs replaced in ${p.rules} rules. The change is in the audit log.`
              : `${p.ids_replaced} IDs in ${p.rules} rules will be replaced by their successor in ATT&CK ${p.version}. Deprecated IDs without a successor stay as they are.`}
          </p>
        )}
        <div className="remap-list">
          <table className="table table-plain">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {p?.changes.map((ch) => (
                <tr key={ch.code}>
                  <td>
                    <span className="mono small">{ch.code}</span> <span className="small muted">{ch.name}</span>
                  </td>
                  <td className="mono small">
                    {ch.before.map((id) => (
                      <span key={id} className={ch.after.includes(id) ? "" : "strike"}>
                        {id}{" "}
                      </span>
                    ))}
                  </td>
                  <td className="mono small">{ch.after.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !p || !p.ids_replaced}
              onClick={() => void apply()}
            >
              Update {p?.ids_replaced ?? ""} IDs
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
