import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AttackCoverage, type AttackTech, type RemapResult } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Modal, useLoad } from "../components/ui";
import { pct } from "../lib/format";
import { t } from "../i18n";

/** Single-hue sequential ramp for the best rule weight of a technique. */
const RAMP = [
  { min: 0, label: t("under 20 %") },
  { min: 0.2, label: "20–40 %" },
  { min: 0.4, label: "40–60 %" },
  { min: 0.6, label: "60–80 %" },
  { min: 0.8, label: t("80 % and more") },
];

function level(tt: AttackTech): string {
  if (!tt.rules.length) return "none";
  if (tt.best === null) return "unscored";
  let i = 0;
  RAMP.forEach((r, k) => {
    if (tt.best! >= r.min) i = k;
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
  const match = (tt: AttackTech) =>
    (!onlyCovered || tt.rules.length > 0) &&
    (!query ||
      tt.id.toLowerCase().includes(query) ||
      tt.name.toLowerCase().includes(query) ||
      tt.rules.some((r) => r.code.toLowerCase().includes(query)));

  const outdatedRules = useMemo(() => new Set(c?.outdated.map((o) => o.code)).size, [c]);
  const replaceable = c?.outdated.filter((o) => o.status === "revoked").length ?? 0;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("ATT&CK coverage")}</h1>
          <div className="subtitle">
            {t("MITRE ATT&CK Enterprise")} {c ? t("(data {v})", { v: c.version }) : ""}{" "}
            {t("· colour = best weight of an operational rule for the technique")}
          </div>
        </div>
        <div className="row-actions">
          <a className="btn" href="/api/attack/navigator.json" download>
            {t("Download Navigator layer")}
          </a>
        </div>
      </header>
      <ErrorNote error={cov.error} />

      {c && c.outdated.length > 0 && (
        <div className="notice-bar" role="status">
          <div>
            <strong>
              {c.outdated.length} {t("technique IDs in")} {outdatedRules} {t("rules are outdated.")}
            </strong>{" "}
            {replaceable > 0
              ? t(
                  "{n} were replaced by newer techniques in ATT&CK and can be updated automatically; they count under their replacement here.",
                  { n: replaceable },
                )
              : t("They have no successor in ATT&CK; edit the rules to map them to current techniques.")}
          </div>
          {can("admin") && replaceable > 0 ? (
            <button type="button" className="btn btn-dark" onClick={() => setRemapOpen(true)}>
              {t("Review update")}
            </button>
          ) : (
            replaceable > 0 && <span className="small muted">{t("An admin can update them.")}</span>
          )}
        </div>
      )}

      <section className="kpi-grid" aria-label={t("Summary")}>
        <div className="card kpi">
          <span className="kpi-label">{t("Techniques with a rule")}</span>
          <span className="kpi-value">{c ? c.techniques_with_rules : "–"}</span>
          <span className="kpi-sub">
            {c
              ? t("{p} of {n} techniques", {
                  p: pct(c.techniques_with_rules / c.techniques_total),
                  n: c.techniques_total,
                })
              : "…"}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t("With a scored rule")}</span>
          <span className="kpi-value">{c ? c.techniques_scored : "–"}</span>
          <span className="kpi-sub">{t("Operational or maintenance, all metrics set")}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t("Rules mapped to ATT&CK")}</span>
          <span className="kpi-value">{c ? c.rules_mapped : "–"}</span>
          <span className="kpi-sub">{c ? t("of {n} active rules", { n: c.rules_total }) : "…"}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{t("Tactics without coverage")}</span>
          <span className="kpi-value">{c ? c.tactics.filter((tt) => !tt.covered).length : "–"}</span>
          <span className="kpi-sub">
            {c
              ? c.tactics
                  .filter((tt) => !tt.covered)
                  .map((tt) => tt.name)
                  .join(", ") || t("Every tactic has at least one rule")
              : "…"}
          </span>
        </div>
      </section>

      <div className="split">
        <section className="card attack-card split-main" aria-label={t("Coverage matrix")}>
          <div className="filters">
            <input
              className="input input-sm"
              type="search"
              placeholder={t("Find technique or rule")}
              aria-label={t("Find technique or rule")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="check small">
              <input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />
              {t("Only techniques with rules")}
            </label>
            <span className="grow" />
            <div className="legend attack-legend" aria-label={t("Legend")}>
              <span>
                <i className="tt-none" />
                {t("No rule")}
              </span>
              <span>
                <i className="tt-unscored" />
                {t("Rule, not scored")}
              </span>
              <span>
                <span className="tech-count">n</span>
                {t("Number of rules")}
              </span>
              <span className="ramp">
                {t("Weight")}
                {RAMP.map((r, i) => (
                  <i key={r.min} className={`tt-w${i}`} title={r.label} />
                ))}
                <span className="small muted">0 → 100 %</span>
              </span>
            </div>
          </div>
          <div className="attack-matrix">
            {c?.tactics.map((tt) => {
              const techs = tt.techniques.filter((x) => match(x) || x.subs.some(match));
              return (
                <div key={tt.id} className="tactic">
                  <div className="tactic-head" title={tt.id}>
                    <span>{tt.name}</span>
                    <span className="small muted">
                      {tt.covered} {t("of")} {tt.total} {t("covered")}
                    </span>
                    <div className="bar">
                      <div className="d1" style={{ width: `${tt.total ? (tt.covered / tt.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                  {techs.map((x) => (
                    <button
                      type="button"
                      key={x.id}
                      className={`tech tt-${level(x)}` + (sel?.id === x.id ? " sel" : "")}
                      onClick={() => setSel(x)}
                      title={`${x.id} ${x.name}${x.rules.length ? ` · ${t("{n} rule(s)", { n: x.rules.length })}` : ""}`}
                    >
                      <span className="tech-name">{x.name}</span>
                      <TechNumbers tt={x} />
                    </button>
                  ))}
                  {!techs.length && <span className="small muted tech-empty">{t("No match")}</span>}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="card split-side stack attack-detail" aria-live="polite">
          {sel ? (
            <TechDetail tt={sel} onPick={setSel} />
          ) : (
            <p className="muted">{t("Pick a technique to see its rules.")}</p>
          )}
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

/** Number of rules on the technique and, for a parent, sub-techniques with a rule (#32). */
function TechNumbers({ tt }: { tt: AttackTech }) {
  const subsCovered = tt.subs.filter((s) => s.rules.length > 0).length;
  return (
    <>
      {tt.subs.length > 0 && (
        <span className="tech-subs" title={t("{n} of {total} sub-techniques have a rule", { n: subsCovered, total: tt.subs.length })}>
          {subsCovered}/{tt.subs.length}
        </span>
      )}
      {tt.rules.length > 0 && (
        <span className="tech-count" title={t("{n} rule(s)", { n: tt.rules.length })}>
          {tt.rules.length}
        </span>
      )}
    </>
  );
}

function TechDetail({ tt, onPick }: { tt: AttackTech; onPick: (tt: AttackTech) => void }) {
  const url = `https://attack.mitre.org/techniques/${tt.id.replace(".", "/")}/`;
  return (
    <>
      <div className="stack-xs">
        <span className="mono small muted">{tt.id}</span>
        <h2>{tt.name}</h2>
        <a className="small" href={url} target="_blank" rel="noreferrer">
          {t("Open on attack.mitre.org")}
        </a>
      </div>
      <dl className="facts">
        <dt>{t("Best weight")}</dt>
        <dd>{tt.rules.length ? pct(tt.best) : t("No rule")}</dd>
        <dt>{t("Rules")}</dt>
        <dd>{tt.rules.length}</dd>
      </dl>
      {tt.rules.length > 0 && (
        <ul className="link-list attack-rules">
          {tt.rules.map((r) => (
            <li key={r.code}>
              <Link className="rule-link" to={`/usecases/l3/${r.code}`}>
                <span className="mono small muted">{r.code}</span>
                <span>{r.name}</span>
              </Link>
              <span className="small muted nowrap">
                {r.weight === null ? t("not scored") : pct(r.weight)}
                {!r.direct && t(" · via sub-technique")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {tt.subs.length > 0 && (
        <div className="stack-sm">
          <h3 className="h-sm">{t("Sub-techniques")}</h3>
          <div className="sub-grid">
            {tt.subs.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`tech tt-${level(s)}`}
                onClick={() => onPick(s)}
                title={`${s.id} ${s.name}`}
              >
                <span className="mono tech-id">
                  {s.id} {s.rules.length > 0 && <span className="tech-count">{s.rules.length}</span>}
                </span>
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
    <Modal title={t("Update technique IDs")} open onClose={onClose} wide>
      <div className="stack">
        <ErrorNote error={preview.error ?? error} />
        {p && (
          <p className="ink-2" style={{ margin: 0 }}>
            {result
              ? t("Done: {ids} IDs replaced in {rules} rules. The change is in the audit log.", {
                  ids: p.ids_replaced,
                  rules: p.rules,
                })
              : t(
                  "{ids} IDs in {rules} rules will be replaced by their successor in ATT&CK {version}. Deprecated IDs without a successor stay as they are.",
                  { ids: p.ids_replaced, rules: p.rules, version: p.version },
                )}
          </p>
        )}
        <div className="remap-list">
          <table className="table table-plain">
            <thead>
              <tr>
                <th>{t("Rule")}</th>
                <th>{t("Before")}</th>
                <th>{t("After")}</th>
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
            {result ? t("Close") : t("Cancel")}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !p || !p.ids_replaced}
              onClick={() => void apply()}
            >
              {t("Update")} {p?.ids_replaced ?? ""} {t("IDs")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
