import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Role, type User } from "../api";
import { ROLE_LABEL, useAuth } from "../auth";
import { confirmDialog, ErrorNote, Modal } from "../components/ui";
import { locale, t } from "../i18n";
import { parseTime } from "../lib/format";

const ROLES: Role[] = ["admin", "analyst", "auditor"];

function fmt(ts: string | null): string {
  return ts ? parseTime(ts).toLocaleString(locale()) : t("never");
}

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pwUser, setPwUser] = useState<User | null>(null);
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

  async function changeRole(u: User, role: Role) {
    const ok = await confirmDialog(
      t("Change the role of {user} from {old} to {new}? They are signed out everywhere and sign in again with the new role.", {
        user: u.username,
        old: ROLE_LABEL[u.role],
        new: ROLE_LABEL[role],
      }),
      { title: t("Change role"), confirmLabel: t("Change role") },
    );
    if (ok) await run(() => api.updateUser(u.id, { role }), t("Role of {user} changed", { user: u.username }));
  }

  async function toggleActive(u: User) {
    if (u.active) {
      const ok = await confirmDialog(
        t("Disable {user}? They are signed out and cannot sign in until the account is enabled again.", {
          user: u.username,
        }),
        { title: t("Disable account"), confirmLabel: t("Disable"), danger: true },
      );
      if (!ok) return;
    }
    await run(
      () => api.updateUser(u.id, { active: !u.active }),
      u.active ? t("{user} disabled", { user: u.username }) : t("{user} enabled", { user: u.username }),
    );
  }

  async function remove(u: User) {
    const ok = await confirmDialog(
      t("Delete the account {user}? What they did stays in the audit log under their name. This cannot be undone; to only block the sign-in, disable the account instead.", {
        user: u.username,
      }),
      { title: t("Delete account"), confirmLabel: t("Delete"), danger: true },
    );
    if (ok) await run(() => api.deleteUser(u.id), t("{user} deleted", { user: u.username }));
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
                    disabled={u.auth_source === "sso"}
                    title={
                      u.auth_source === "sso"
                        ? t("The role of an SSO account comes from the groups at the identity provider")
                        : undefined
                    }
                    onChange={(e) => void changeRole(u, e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {u.auth_source === "sso" ? "SSO" : u.auth_source === "service" ? t("API token") : t("Local")}
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
                      <button type="button" className="btn btn-sm" onClick={() => setPwUser(u)}>
                        {t("Reset password")}
                      </button>
                    )}
                    {u.totp_enabled && u.id !== me?.id && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          const ok = await confirmDialog(
                            t("Turn off two-factor login for {user}?", { user: u.username }),
                            { title: t("Reset 2FA"), confirmLabel: t("Turn off"), danger: true },
                          );
                          if (ok)
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
                      <button type="button" className="btn btn-sm" onClick={() => void toggleActive(u)}>
                        {u.active ? t("Disable") : t("Enable")}
                      </button>
                    )}
                    {u.id !== me?.id && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(u)}>
                        {t("Delete")}
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

      {pwUser && (
        <PasswordDialog
          user={pwUser}
          onClose={() => setPwUser(null)}
          onSaved={() => {
            setNotice(t("Password of {user} changed", { user: pwUser.username }));
            reload();
          }}
        />
      )}
    </>
  );
}

/** Set a new password for someone: typed twice and hidden, instead of a browser prompt. */
function PasswordDialog({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== again) {
      setError(t("The two passwords are not the same."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(user.id, { password: pw });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Reset password of {user}", { user: user.username })} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>
          {t("The account is unlocked and signed out everywhere. Give the new password to the person in a safe way.")}
        </p>
        <ErrorNote error={error} />
        <label className="field">
          {t("New password (at least 12 characters)")}
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label className="field">
          {t("Repeat the password")}
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("Saving…") : t("Set password")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
