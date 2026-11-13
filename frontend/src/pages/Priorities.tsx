import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type GapRow, type Gaps, type L1 } from "../api";
import { ErrorNote, StatusPill, useLoad } from "../components/ui";
import { num, pct } from "../lib/format";

const SOURCE_LABEL: Record<string, string> = { rule: "own value", l2: "from L2", risk: "from risk level" };

/** Implementation bar with a marker at the target. */
function TargetBar({ impl, target }: { impl: number | null; target: number | null }) {
  const below = target !== null && (impl ?? 0) < target;
  return (
    <div className="target-bar" title={`Implementation ${pct(impl)} · target ${pct(target)}`}>
      <div className={below ? "fill below" : "fill"} style={{ width: `${Math.round((impl ?? 0) * 100)}%` }} />
      {target !== null && <i style={{ left: `${Math.round(target * 100)}%` }} />}
    </div>
  );
}

function RiskBadge({ r }: { r: GapRow }) {
  if (r.risk === null) return <span className="muted">–</span>;
  return (
    <span className={`risk risk-${r.risk}`} title={`Risk ${r.risk} (${SOURCE_LABEL[r.risk_source ?? ""] ?? ""})`}>
      {r.risk}
    </span>
  );
}

export default function Priorities() {
  const cat = useLoad<L1[]>(() => api.l1s());
  const [l1, setL1] = useState("");
  const [minRisk, setMinRisk] = useState(1);
  const [below, setBelow] = useState(true);
  const gaps = useLoad<Gaps>(() => api.gaps({ l1, min_risk: minRisk, below_target: below }), [l1, minRisk, below]);
  const [limit, setLimit] = useState(50);
  const g = gaps.data;
  const s = g?.summary;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Priorities</h1>
          <div className="subtitle">
            Gap to target per rule, highest priority first. Priority = potential × risk level ÷ 5.
          </div>
        </div>
      </header>
      <ErrorNote error={gaps.error ?? cat.error} />

      <section className="kpi-grid" aria-label="Summary">
        <div className="card kpi">
          <span className="kpi-label">Below target</span>
          <span className="kpi-value">{s ? s.below_target : "–"}</span>
          <span className="kpi-sub">{s ? `of ${s.with_target} active rules with a target` : "…"}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Average gap</span>
          <span className="kpi-value">{s ? pct(s.avg_gap) : "–"}</span>
          <span className="kpi-sub">Implementation missing to reach the target</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">No risk level</span>
          <span className="kpi-value">{s ? s.no_risk : "–"}</span>
          <span className="kpi-sub">Set a risk level on the L2 use case or the rule</span>
        </div>
        <div className="card kpi risk-kpi">
          <span className="kpi-label">Below target per risk level</span>
          <div className="risk-rows">
            {s &&
              [5, 4, 3, 2, 1].map((lvl) => {
                const b = s.by_risk[lvl] ?? { rules: 0, below_target: 0 };
                return (
                  <div key={lvl} className="risk-row">
                    <span className={`risk risk-${lvl}`}>{lvl}</span>
                    <div className="bar">
                      <div
                        className="bar-accent"
                        style={{ width: `${b.rules ? (b.below_target / b.rules) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="small muted num-cell">
                      {b.below_target}/{b.rules}
                    </span>
                    <span className="small muted">target {pct(s.risk_targets[lvl])}</span>
                  </div>
                );
              })}
          </div>
        </div>
      </section>

      <section className="card table-card" aria-labelledby="gh">
        <div className="table-title filters">
          <h2 id="gh">Rules</h2>
          <select
            className="input input-sm"
            aria-label="L1 use case"
            value={l1}
            onChange={(e) => setL1(e.target.value)}
          >
            <option value="">All L1 use cases</option>
            {cat.data?.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
          <select
            className="input input-sm"
            aria-label="Minimum risk level"
            value={minRisk}
            onChange={(e) => setMinRisk(Number(e.target.value))}
          >
            <option value={1}>Any risk</option>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Risk {n}
                {n < 5 ? " or higher" : ""}
              </option>
            ))}
          </select>
          <label className="check small">
            <input type="checkbox" checked={below} onChange={(e) => setBelow(e.target.checked)} />
            Only below target
          </label>
          <span className="grow" />
          <span className="small muted">{g ? `${g.rows.length} rules` : ""}</span>
        </div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th className="num" style={{ width: 48 }}>
                  #
                </th>
                <th>Rule</th>
                <th>Status</th>
                <th className="num">Risk</th>
                <th style={{ width: "22%" }}>Implementation vs target</th>
                <th className="num">Gap</th>
                <th className="num">Potential</th>
                <th className="num">Priority</th>
              </tr>
            </thead>
            <tbody>
              {g?.rows.slice(0, limit).map((r, idx) => (
                <tr key={r.code}>
                  <td className="num muted">{idx + 1}</td>
                  <td>
                    <Link className="rule-link" to={`/usecases/l3/${r.code}`}>
                      <span className="mono small muted">{r.code}</span>
                      <span>{r.name}</span>
                    </Link>
                  </td>
                  <td>
                    <StatusPill status={r.lifecycle_status} />
                  </td>
                  <td className="num">
                    <RiskBadge r={r} />
                  </td>
                  <td>
                    <TargetBar impl={r.implementation} target={r.target} />
                    <span className="small muted">
                      {pct(r.implementation)} of {pct(r.target)}
                      {r.target_source && ` · ${SOURCE_LABEL[r.target_source]}`}
                    </span>
                  </td>
                  <td className="num">{r.gap ? pct(r.gap) : <span className="text-ok">reached</span>}</td>
                  <td className="num">{num(r.potential)}</td>
                  <td className="num strong">{num(r.priority)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {g && !g.rows.length && <p className="muted empty-flat">No rule matches the filters.</p>}
        {g && g.rows.length > limit && (
          <div className="row-actions start" style={{ padding: "12px 16px" }}>
            <button type="button" className="btn btn-sm" onClick={() => setLimit((n) => n + 100)}>
              Show more ({g.rows.length - limit} left)
            </button>
          </div>
        )}
      </section>
    </>
  );
}
