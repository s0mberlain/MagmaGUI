import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type ApiTokenCreated,
  type ApiTokenInfo,
  type SiemOverview,
  type SiemSourceInfo,
  type TokenScope,
} from "../api";
import { ROLE_LABEL, useAuth } from "../auth";
import { confirmDialog, ErrorNote, StatusPill, useLoad } from "../components/ui";
import { t } from "../i18n";
import { fmtDate, fmtTime } from "../lib/format";

const BASE = typeof window !== "undefined" ? window.location.origin : "";

function SourceCard({ s, editor, onDelete }: { s: SiemSourceInfo; editor: boolean; onDelete?: () => void }) {
  const [open, setOpen] = useState(s.unlinked.length > 0 && s.unlinked.length <= 8);
  const rep = s.alerts_report;
  return (
    <section className="card stack" aria-labelledby={`src-${s.name}`}>
      <div className="section-head">
        <h2 id={`src-${s.name}`} className="mono">
          {s.name}
        </h2>
        {onDelete && (
          <button type="button" className="btn btn-sm" onClick={onDelete}>
            {t("Remove source")}
          </button>
        )}
      </div>
      <div className="kpi-grid">
        <div className="kpi-mini">
          <span className="kpi-label">{t("SIEM rules")}</span>
          <span className="kpi-value-sm">{s.rules_total}</span>
          <span className="kpi-sub">{t("{n} enabled", { n: s.enabled })}</span>
        </div>
        <div className="kpi-mini">
          <span className="kpi-label">{t("Linked to a use case")}</span>
          <span className="kpi-value-sm">{s.linked}</span>
          <span className="kpi-sub">{s.rules_total ? Math.round((s.linked / s.rules_total) * 100) : 0} %</span>
        </div>
        <div className="kpi-mini">
          <span className="kpi-label">{t("Without use case")}</span>
          <span className={`kpi-value-sm ${s.unlinked.length ? "accent" : ""}`}>{s.unlinked.length}</span>
          <span className="kpi-sub">{t("Detections the framework does not know")}</span>
        </div>
        <div className="kpi-mini">
          <span className="kpi-label">{t("Disabled in the SIEM")}</span>
          <span className={`kpi-value-sm ${s.disabled_but_operational.length ? "accent" : ""}`}>
            {s.disabled_but_operational.length}
          </span>
          <span className="kpi-sub">{t("but operational in the app")}</span>
        </div>
      </div>
      <dl className="facts">
        <dt>{t("Rule inventory")}</dt>
        <dd>
          {fmtTime(s.inventory_at)}
          {s.inventory_by && <span className="muted"> · {s.inventory_by}</span>}
        </dd>
        <dt>{t("Alert counts")}</dt>
        <dd>
          {fmtTime(s.alerts_at)}
          {s.alerts_by && <span className="muted"> · {s.alerts_by}</span>}
          {s.alerts_at && (
            <span className="muted">
              {" · "}
              {t("{a} new, {b} updated months", { a: rep.created ?? 0, b: rep.updated ?? 0 })}
            </span>
          )}
        </dd>
      </dl>
      {!!rep.unmatched?.length && (
        <div className="note-box small">
          <strong>{t("Alert counts for unknown SIEM rules")}</strong>{" "}
          <span className="mono">{rep.unmatched.slice(0, 20).join(" · ")}</span>
          {rep.unmatched.length > 20 && ` … +${rep.unmatched.length - 20}`}
          <div className="muted">{t("Add these ids to a rule (field SIEM rule IDs) to count them.")}</div>
        </div>
      )}
      {s.disabled_but_operational.length > 0 && (
        <div className="stack-sm">
          <h3 className="h-sm">{t("Disabled in the SIEM but operational in the app")}</h3>
          <ul className="plain-list">
            {s.disabled_but_operational.map((d) => (
              <li key={d.rule_id + d.code}>
                <Link to={`/usecases/l3/${d.code}`} className="mono">
                  {d.code}
                </Link>{" "}
                ← <span className="mono small">{d.rule_id}</span> <span className="muted">{d.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.unlinked.length > 0 && (
        <div className="stack-sm">
          <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "▾" : "▸"} {t("SIEM rules without a use case ({n})", { n: s.unlinked.length })}
          </button>
          {open && (
            <div className="scroll-x">
              <table className="table table-plain">
                <thead>
                  <tr>
                    <th>{t("SIEM rule")}</th>
                    <th>{t("ATT&CK")}</th>
                    <th>{t("Suggested use cases")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.unlinked.map((u) => (
                    <tr key={u.rule_id} className={u.enabled ? "" : "row-muted"}>
                      <td>
                        <div className="mono small">{u.rule_id}</div>
                        <div>
                          {u.name}
                          {!u.enabled && <span className="muted"> · {t("disabled")}</span>}
                          {u.severity && <span className="muted"> · {u.severity}</span>}
                        </div>
                      </td>
                      <td className="mono small">{u.techniques.join(", ") || "–"}</td>
                      <td>
                        {u.suggestions.length ? (
                          <span className="chips">
                            {u.suggestions.map((c) => (
                              <Link key={c} to={`/usecases/l3/${c}`} className="chip chip-info mono">
                                {c}
                              </Link>
                            ))}
                          </span>
                        ) : (
                          <span className="muted">{t("none by ATT&CK")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editor && (
                <p className="muted small">
                  {t("Open a use case and add the SIEM rule id under SIEM rule IDs to link it.")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type Access = "siem" | "siem+read" | "read";
const ACCESS_SCOPES: Record<Access, TokenScope[]> = { siem: ["siem"], "siem+read": ["siem", "read"], read: ["read"] };

function accessLabel(scopes: TokenScope[]): string {
  const siem = scopes.includes("siem");
  const read = scopes.includes("read");
  if (siem && read) return t("SIEM push + read");
  if (siem) return t("SIEM push only");
  return t("Read only");
}

function Tokens() {
  const tokens = useLoad<ApiTokenInfo[]>(() => api.apiTokens());
  const [form, setForm] = useState({
    name: "",
    role: "analyst" as "analyst" | "auditor",
    access: "siem" as Access,
    days: "365",
  });
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const tok = await api.createApiToken({
        name: form.name,
        role: form.role,
        scopes: ACCESS_SCOPES[form.access],
        expires_days: form.days ? Number(form.days) : null,
      });
      setCreated(tok);
      setForm({ ...form, name: "" });
      void tokens.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function revoke(tok: ApiTokenInfo) {
    const ok = await confirmDialog(t("Revoke the token {name}? Scripts using it stop working.", { name: tok.name }), {
      title: t("Revoke API token"),
      confirmLabel: t("Revoke"),
      danger: true,
    });
    if (!ok) return;
    await api.revokeApiToken(tok.id).catch((e: Error) => setError(e.message));
    void tokens.reload();
  }

  return (
    <section className="card stack" aria-labelledby="tok-h">
      <div className="section-head">
        <h2 id="tok-h">{t("API tokens")}</h2>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {t(
          "A token signs a script in as its own service account. Send it as Authorization: Bearer <token>. Its access limits what it may call: SIEM push tokens can only use the SIEM API below, so a leaked token cannot change the catalogue.",
        )}
      </p>
      <ErrorNote error={error ?? tokens.error} />
      {created && (
        <div className="note-box">
          <strong>{t("Copy the token now. It is not shown again.")}</strong>
          <div className="token-row">
            <code className="mono">{created.token}</code>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void navigator.clipboard?.writeText(created.token)}
            >
              {t("Copy")}
            </button>
          </div>
        </div>
      )}
      {tokens.data && tokens.data.length > 0 && (
        <div className="scroll-x">
          <table className="table table-plain">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th>{t("Token")}</th>
                <th>{t("Role")}</th>
                <th>{t("Access")}</th>
                <th>{t("Last used")}</th>
                <th>{t("Expires")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((tok) => (
                <tr key={tok.id}>
                  <td>
                    <div className="strong-500">{tok.name}</div>
                    <div className="small muted mono">{tok.username}</div>
                  </td>
                  <td className="mono small">{tok.prefix}…</td>
                  <td>{ROLE_LABEL[tok.role]}</td>
                  <td>{accessLabel(tok.scopes)}</td>
                  <td>{fmtTime(tok.last_used_at)}</td>
                  <td>{tok.expires_at ? fmtDate(tok.expires_at) : t("never")}</td>
                  <td className="num">
                    <button type="button" className="btn btn-sm" onClick={() => void revoke(tok)}>
                      {t("Revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="inline-form" onSubmit={create}>
        <label className="field">
          {t("Name")}
          <input
            className="input"
            required
            minLength={2}
            maxLength={48}
            placeholder={t("e.g. Splunk production")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="field">
          {t("Role")}
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as "analyst" | "auditor" })}
          >
            <option value="analyst">{ROLE_LABEL.analyst}</option>
            <option value="auditor">{ROLE_LABEL.auditor}</option>
          </select>
        </label>
        <label className="field">
          {t("Access")}
          <select
            className="input"
            value={form.access}
            onChange={(e) => setForm({ ...form, access: e.target.value as Access })}
          >
            <option value="siem">{t("SIEM push only")}</option>
            <option value="siem+read">{t("SIEM push + read")}</option>
            <option value="read">{t("Read only")}</option>
          </select>
        </label>
        <label className="field">
          {t("Valid for (days, empty = no expiry)")}
          <input
            className="input"
            type="number"
            min={1}
            max={3650}
            value={form.days}
            onChange={(e) => setForm({ ...form, days: e.target.value })}
          />
        </label>
        <div className="field">
          <span>&nbsp;</span>
          <button type="submit" className="btn btn-primary">
            {t("Create token")}
          </button>
        </div>
      </form>
    </section>
  );
}

const EXAMPLE_RULES = `curl -X PUT ${BASE}/api/integrations/siem/splunk/rules \\
  -H "Authorization: Bearer $MAGMA_TOKEN" -H "Content-Type: application/json" \\
  -d '{"rules": [{"id": "Credential Dumping - LSASS", "name": "LSASS access",
                  "enabled": true, "severity": "high", "techniques": ["T1003.001"]}]}'`;

const EXAMPLE_ALERTS = `curl -X POST "${BASE}/api/integrations/siem/splunk/alerts" \\
  -H "Authorization: Bearer $MAGMA_TOKEN" -H "Content-Type: application/json" \\
  -d '{"mode": "replace", "batch_id": "2026-10-monthly", "items": [{"rule": "Credential Dumping - LSASS",
       "period": "2026-10", "alerts": 42, "incidents": 3, "false_positives": 30}]}'`;

export default function Integrations() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const admin = can("admin");
  const data = useLoad<SiemOverview>(() => api.siem());
  const d = data.data;

  async function removeSource(name: string) {
    const ok = await confirmDialog(t("Remove the SIEM source {name} and its rule inventory?", { name }), {
      title: t("Remove SIEM source"),
      confirmLabel: t("Remove"),
      danger: true,
    });
    if (!ok) return;
    await api.deleteSiemSource(name);
    void data.reload();
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Integrations")}</h1>
          <div className="subtitle">
            {t("SIEMs push their rule inventory and alert counts here; the app compares them with the use cases.")}
          </div>
        </div>
      </header>
      <ErrorNote error={data.error} />

      <div className="stack-lg">
        {d && d.sources.length === 0 && (
          <section className="card empty">
            <h2 className="h-sm">{t("No SIEM has reported yet")}</h2>
            <p>
              {t(
                "Create an API token, then let your SIEM or a scheduled script push its rules and monthly alert counts with the calls below.",
              )}
            </p>
          </section>
        )}
        {d?.sources.map((s) => (
          <SourceCard
            key={s.name}
            s={s}
            editor={editor}
            onDelete={admin ? () => void removeSource(s.name) : undefined}
          />
        ))}

        {d && d.missing_in_siem.length > 0 && (
          <section className="card stack-sm" aria-labelledby="miss-h">
            <h2 id="miss-h">{t("Linked SIEM rules that no SIEM reports")}</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {t(
                "The rule id is set on the use case, but no rule inventory contains it. Renamed or deleted in the SIEM?",
              )}
            </p>
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>{t("Rule")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("SIEM rule id")}</th>
                </tr>
              </thead>
              <tbody>
                {d.missing_in_siem.map((m) => (
                  <tr key={m.code + m.rule_id}>
                    <td>
                      <Link to={`/usecases/l3/${m.code}`} className="code-link">
                        <span className="code-tag">{m.code}</span> <span>{m.name}</span>
                      </Link>
                    </td>
                    <td>
                      <StatusPill status={m.status} />
                    </td>
                    <td className="mono small">{m.rule_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {admin && <Tokens />}

        <section className="card stack" aria-labelledby="api-h">
          <h2 id="api-h">{t("Push API")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t(
              "A SIEM rule is matched to a use case by the rule's SIEM rule IDs or by its L3 code. The source name is free (e.g. splunk, sentinel, qradar). The full description is in the API docs.",
            )}{" "}
            <a href="/api/docs#/integrations" target="_blank" rel="noreferrer">
              /api/docs
            </a>
          </p>
          <h3 className="h-sm">{t("1. Rule inventory (full list, replaces the previous one)")}</h3>
          <pre className="code-block">{EXAMPLE_RULES}</pre>
          <h3 className="h-sm">{t("2. Alert counts per rule and month")}</h3>
          <pre className="code-block">{EXAMPLE_ALERTS}</pre>
          <p className="muted small" style={{ margin: 0 }}>
            {t(
              "mode replace sets the month's totals, add adds to them (for daily pushes). ?dry_run=true only checks. Example searches for Splunk and Sentinel are in deploy/siem/ in the repository.",
            )}
          </p>
        </section>
      </div>
    </>
  );
}
