import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type SystemDetail as Detail } from "../api";
import { useAuth } from "../auth";
import { confirmDialog, ErrorNote, useLoad } from "../components/ui";
import { fmtDate, fmtTime, num, pct } from "../lib/format";
import { CLASSIFICATION_LABEL, INTERVIEW_STATUS_LABEL, STRIDE_LABEL } from "../lib/stride";
import { StatePill, SystemDialog, systemInput } from "./Systems";
import { t } from "../i18n";

export default function SystemDetail() {
  const { id } = useParams();
  const sid = Number(id);
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const navigate = useNavigate();
  const sys = useLoad<Detail>(() => api.system(sid), [sid]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = sys.data;

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await sys.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function startInterview() {
    if (!s) return;
    if (s.draft_id) {
      navigate(`/interviews/${s.draft_id}`);
      return;
    }
    setError(null);
    try {
      const iv = await api.startInterview(s.id);
      navigate(`/interviews/${iv.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function archive(on: boolean) {
    if (!s) return;
    const ok = await confirmDialog(
      on
        ? t("Archive {name}? It is hidden from the list, not counted as due and has no effect on priorities.", { name: s.name })
        : t("Reactivate {name}?", { name: s.name }),
    );
    if (ok) await run(() => api.updateSystem(s.id, { ...systemInput(s), archived: on }));
  }

  async function remove() {
    if (!s) return;
    const ok = await confirmDialog(t("Delete {name}? This cannot be undone.", { name: s.name }), {
      danger: true,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    try {
      await api.deleteSystem(s.id);
      navigate("/systems");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!s) {
    return (
      <>
        <ErrorNote error={sys.error} />
        {!sys.error && <p className="muted">{t("Loading…")}</p>}
      </>
    );
  }

  const facts: [string, string][] = [
    [t("Business owner"), s.owner_name],
    [t("Owner department"), s.owner_department || "–"],
    [t("Owner e-mail"), s.owner_email || "–"],
    [t("Criticality"), `${s.criticality}/5`],
    [t("Internet-facing"), s.internet_facing ? t("Yes") : t("No")],
    [t("Data classification"), CLASSIFICATION_LABEL[s.data_classification as keyof typeof CLASSIFICATION_LABEL] ?? s.data_classification],
    [t("Review interval"), t("{n} months", { n: s.review_interval_months })],
    [t("Next interview due"), s.next_due ? fmtDate(s.next_due) : t("now")],
  ];
  const blind = s.gap_log_sources.filter((g) => g.blind);
  const partial = s.gap_log_sources.filter((g) => !g.blind);
  const gapCount = s.gap_no_rules.length + blind.length + s.gap_requests.length;

  return (
    <>
      <nav className="crumbs" aria-label={t("Breadcrumb")}>
        <Link to="/systems">{t("Systems")}</Link> / <span>{s.name}</span>
      </nav>
      <header className="page-header">
        <div>
          <h1>
            {s.name} {s.archived && <span className="chip chip-neutral">{t("Archived")}</span>}
          </h1>
          <div className="subtitle">
            <StatePill state={s.state} />{" "}
            {s.last_interview && t("Last interview {date}", { date: fmtDate(s.last_interview) })}
          </div>
        </div>
        {editor && (
          <div className="row-actions">
            {!s.archived && (
              <button type="button" className="btn btn-primary" onClick={() => void startInterview()}>
                {s.draft_id ? t("Continue draft") : t("Start interview")}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              {t("Edit")}
            </button>
            <button type="button" className="btn" onClick={() => void archive(!s.archived)}>
              {s.archived ? t("Reactivate") : t("Archive")}
            </button>
            {s.can_delete && (
              <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                {t("Delete")}
              </button>
            )}
          </div>
        )}
      </header>
      <ErrorNote error={error ?? sys.error} />
      {s.archived && s.draft_id && (
        <p className="form-notice">
          {t("This system is archived but has a draft interview.")}{" "}
          <Link to={`/interviews/${s.draft_id}`}>{t("Open draft")}</Link>
        </p>
      )}

      <div className="split">
        <section className="card split-side stack-sm" aria-labelledby="ownh">
          <h2 id="ownh" className="h-sm">
            {t("System and owner")}
          </h2>
          {s.description && <p className="ink-2" style={{ margin: 0 }}>{s.description}</p>}
          <dl className="facts">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card split-main" aria-labelledby="covh">
          <div className="section-head">
            <h2 id="covh">{t("Linked use cases")}</h2>
            {s.links.length > 0 && (
              <Link className="btn btn-sm" to={`/usecases?sys=${s.id}&view=table`}>
                {t("Show on Use cases")}
              </Link>
            )}
          </div>
          <dl className="stat-grid">
            <div>
              <dt>{t("Detection coverage")}</dt>
              <dd>{pct(s.coverage)}</dd>
            </div>
            <div>
              <dt>{t("Linked L2")}</dt>
              <dd>{s.links.length}</dd>
            </div>
            <div>
              <dt>{t("Gaps")}</dt>
              <dd>{gapCount}</dd>
            </div>
          </dl>
          <p className="muted small" style={{ margin: 0 }}>
            {t("Coverage = average weight of the linked L2 use cases; L2 without scored rules count as 0.")}
          </p>
          {s.links.length ? (
            <div className="scroll-x">
              <table className="table table-plain">
                <thead>
                  <tr>
                    <th>{t("Use case")}</th>
                    <th>{t("From threats")}</th>
                    <th className="num">{t("Risk score")}</th>
                    <th className="num">{t("Weight")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.links.map((l) => (
                    <tr key={l.l2_id}>
                      <td>
                        <Link className="code-link" to={`/usecases?l2=${encodeURIComponent(l.code)}`}>
                          <span className="code-tag">{l.code}</span>
                          <span>{l.name}</span>
                        </Link>
                      </td>
                      <td className="small">
                        {l.sources.map((x) => `${x.component}: ${STRIDE_LABEL[x.category]}`).join("; ")}
                      </td>
                      <td className="num">
                        <span className={`risk risk-${l.risk_level ?? 0}`} title={t("Risk level {r}", { r: l.risk_level ?? "–" })}>
                          {l.risk_score || "–"}
                        </span>
                      </td>
                      <td className="num">{num(l.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="note-box">
              {t("No use cases are linked yet. They are linked when an interview is completed.")}{" "}
              {editor && !s.archived && (
                <button type="button" className="link-btn" onClick={() => void startInterview()}>
                  {s.draft_id ? t("Continue draft") : t("Start interview")}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="card stack-sm" aria-labelledby="gaph">
        <h2 id="gaph" className="h-sm">
          {t("Gaps")}{" "}
          {gapCount > 0 && (
            <span className="muted small">
              {t("{a} without rules · {b} blind · {c} requests", { a: s.gap_no_rules.length, b: blind.length, c: s.gap_requests.length })}
            </span>
          )}
        </h2>
        {!gapCount && <p className="muted" style={{ margin: 0 }}>{t("No gaps.")}</p>}
        {s.gap_no_rules.length > 0 && (
          <div>
            <h3 className="small strong">{t("Linked use cases without rules")}</h3>
            <ul className="plain-list">
              {s.gap_no_rules.map((g) => (
                <li key={g.code}>
                  <span className="badge-gap">{t("No rules")}</span>{" "}
                  <Link to={`/usecases?l2=${encodeURIComponent(g.code)}`}>
                    <span className="mono small">{g.code}</span> {g.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {blind.length > 0 && (
          <div>
            <h3 className="small strong">{t("Linked use cases whose rules get none of their log sources")}</h3>
            <GapGroups groups={blind} />
          </div>
        )}
        {partial.length > 0 && (
          <details>
            <summary className="small strong">{t("Rules that get only some of their log sources ({n} use cases)", { n: partial.length })}</summary>
            <GapGroups groups={partial} />
          </details>
        )}
        {s.gap_requests.length > 0 && (
          <div>
            <h3 className="small strong">{t("Open detection requests")}</h3>
            <ul className="plain-list">
              {s.gap_requests.map((g, i) => (
                <li key={i}>
                  {g.text}{" "}
                  <span className="muted small">
                    · {g.component} / {STRIDE_LABEL[g.category]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card table-card" aria-labelledby="ivh">
        <h2 id="ivh" className="table-title">
          {t("Interviews")}
        </h2>
        {s.interviews.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t("Date")}</th>
                <th>{t("Analyst")}</th>
                <th>{t("Status")}</th>
                <th>{t("Confirmed by / on")}</th>
              </tr>
            </thead>
            <tbody>
              {s.interviews.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={`/interviews/${i.id}`}>{fmtDate(i.interview_date)}</Link>
                    {i.completed_at && <span className="muted small"> · {t("completed {time}", { time: fmtTime(i.completed_at) })}</span>}
                    {i.previous_id && (
                      <div className="small muted">
                        {t("Re-interview of {date}", {
                          date: fmtDate(s.interviews.find((x) => x.id === i.previous_id)?.interview_date ?? null),
                        })}
                      </div>
                    )}
                  </td>
                  <td>{i.analyst}</td>
                  <td>
                    <span className={`pill iv-${i.status}`}>{INTERVIEW_STATUS_LABEL[i.status]}</span>
                  </td>
                  <td>{i.confirmed_by ? `${i.confirmed_by} · ${fmtDate(i.confirmed_at)}` : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted empty-flat">{t("No interview yet.")}</p>
        )}
      </section>

      {editing && (
        <SystemDialog
          id={s.id}
          initial={systemInput(s)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void sys.reload();
          }}
        />
      )}
    </>
  );
}

/** Log source gaps grouped by L2 use case (#41). */
function GapGroups({ groups }: { groups: Detail["gap_log_sources"] }) {
  return (
    <ul className="plain-list gap-groups">
      {groups.map((g) => (
        <li key={g.l2_code}>
          <Link to={`/usecases?l2=${encodeURIComponent(g.l2_code)}`}>
            <span className="mono small">{g.l2_code}</span> {g.l2_name}
          </Link>{" "}
          <span className="muted small">· {g.components.join(", ")}</span>
          <ul className="plain-list small gap-rules">
            {g.rules.map((r) => (
              <li key={r.rule_code}>
                <Link to={`/usecases/l3/${encodeURIComponent(r.rule_code)}`}>
                  <span className="mono">{r.rule_code}</span> {r.rule_name}
                </Link>{" "}
                <span className="muted">· {t("missing: {list}", { list: r.missing.join(", ") })}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
