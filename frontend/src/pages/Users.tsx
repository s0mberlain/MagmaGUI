import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Role, type User } from "../api";
import { ROLE_LABEL, useAuth } from "../auth";
import { t } from "../i18n";

const ROLES: Role[] = ["admin", "analyst", "auditor"];

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : "never";
}

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seed, setSeed] = useState(42);
  const [form, setForm] = useState({ username: "", display_name: "", role: "analyst" as Role, password: "" });

  const reload = useCallback(() => {
    api
      .users()
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  async function run(action: () => Promise<unknown>, ok: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(ok);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed"));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(() => api.createUser(form), t("User {user} created", { user: form.username }));
    setForm({ username: "", display_name: "", role: "analyst", password: "" });
  }

  function resetPassword(u: User) {
    const pw = window.prompt(t("New password for {user} (at least 12 characters)", { user: u.username }));
    if (pw)
      void run(() => api.updateUser(u.id, { password: pw }), t("Password of {user} changed", { user: u.username }));
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Users")}</h1>
          <div className="subtitle">
            {t(
              "Local accounts and roles. SSO users appear after their first login; their role comes from the IdP groups and is updated at every sign-in.",
            )}
          </div>
        </div>
      </header>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}

      <section className="card table-card" aria-label={t("User list")}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("User")}</th>
              <th>{t("Role")}</th>
              <th>{t("Login")}</th>
              <th>{t("Last login")}</th>
              <th>{t("Status")}</th>
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.display_name || u.username}</div>
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    {u.username}
                  </div>
                </td>
                <td>
                  <label className="sr-only" htmlFor={`role-${u.id}`}>
                    {t("Role of")} {u.username}
                  </label>
                  <select
                    id={`role-${u.id}`}
                    className="input input-sm"
                    value={u.role}
                    onChange={(e) =>
                      void run(
                        () => api.updateUser(u.id, { role: e.target.value as Role }),
                        t("Role of {user} changed", { user: u.username }),
                      )
                    }
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {u.auth_source === "sso" ? "SSO" : t("Local")}
                  {u.totp_enabled && <span className="chip chip-info chip-2fa">2FA</span>}
                </td>
                <td>{fmt(u.last_login_at)}</td>
                <td>
                  <span className={"pill " + (u.active ? "pill-ok" : "pill-warn")}>
                    {u.active ? t("Active") : t("Disabled")}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    {u.auth_source === "local" && (
                      <button type="button" className="btn btn-sm" onClick={() => resetPassword(u)}>
                        {t("Reset password")}
                      </button>
                    )}
                    {u.totp_enabled && u.id !== me?.id && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          if (!window.confirm(t("Turn off two-factor login for {user}?", { user: u.username }))) return;
                          void run(
                            () => api.resetTotp(u.id),
                            t("Two-factor login of {user} turned off", { user: u.username }),
                          );
                        }}
                      >
                        {t("Reset 2FA")}
                      </button>
                    )}
                    {u.id !== me?.id && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          void run(
                            () => api.updateUser(u.id, { active: !u.active }),
                            `${u.username} ${u.active ? "disabled" : "enabled"}`,
                          )
                        }
                      >
                        {u.active ? t("Disable") : t("Enable")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="new-user">
        <h2 id="new-user" style={{ marginBottom: 14 }}>
          {t("Add local user")}
        </h2>
        <form className="form-grid" onSubmit={create}>
          <label className="field">
            {t("Username")}
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              pattern="[A-Za-z0-9._@\-]{2,64}"
            />
          </label>
          <label className="field">
            {t("Display name")}
            <input
              className="input"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </label>
          <label className="field">
            {t("Role")}
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("Initial password")}
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" className="btn btn-primary">
              {t("Add user")}
            </button>
          </div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="demo-h">
        <h2 id="demo-h">{t("Demo data")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t(
            "Fills the catalogue with random but reproducible metrics, statuses, data sources, dates and verification history, and adds sample rules to empty L2 use cases. Existing values of these fields are overwritten.",
          )}
        </p>
        <div className="inline-form-plain">
          <label className="field">
            {t("Seed")}
            <input
              className="input input-sm"
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              style={{ width: 120 }}
            />
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              if (window.confirm(t("Overwrite use case data with generated demo data?")))
                void run(
                  () => api.demoData(seed),
                  t("Demo data applied (seed {seed}). Open the dashboard to see the scores.", { seed }),
                );
            }}
          >
            {t("Load demo data")}
          </button>
        </div>
      </section>
    </>
  );
}
