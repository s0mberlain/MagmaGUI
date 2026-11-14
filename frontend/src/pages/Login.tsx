import { useEffect, useState, type FormEvent } from "react";
import { api, type AuthConfig } from "../api";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import Logo from "../components/Logo";
import { t } from "../i18n";
import LanguageSelect from "../components/LanguageSelect";

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const ssoError = new URLSearchParams(location.search).get("sso_error");

  useEffect(() => {
    api
      .authConfig()
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  if (!loading && user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password, needOtp ? otp : undefined);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof Error && err.message === "totp_required") {
        setNeedOtp(true);
        return;
      }
      setError(err instanceof Error ? err.message : t("Sign in failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-hero">
        <div className="brand">
          <Logo size={36} />
          <span className="brand-name" style={{ fontSize: 22 }}>
            {t("Magma UCF")}
          </span>
        </div>
        <div>
          <h1>{t("Manage your SOC use cases with the MaGMa framework.")}</h1>
          <p>
            {t(
              "Business drivers, threats and detection rules in one place, with scores, verification dates and versioned rule configs.",
            )}
          </p>
        </div>
        <span style={{ fontSize: 13, color: "var(--c-nav-muted)" }}>
          {t("Based on the FI-ISAC MaGMa Use Case Framework")}
        </span>
      </div>
      <div className="login-panel">
        <LanguageSelect className="lang-corner" />
        <form className="login-form" onSubmit={submit}>
          <h2 style={{ fontSize: 24 }}>{t("Sign in")}</h2>
          {ssoError && (
            <p className="form-error" role="alert">
              {ssoError}
            </p>
          )}
          {cfg?.sso_enabled && (
            <a className="btn btn-dark" href={`/api/auth/oidc/login?next=${encodeURIComponent(from)}`}>
              {cfg.sso_label}
            </a>
          )}
          {cfg?.sso_enabled && cfg.local_login_enabled && <div className="divider">{t("or with a local account")}</div>}
          {cfg && !cfg.local_login_enabled && !cfg.sso_enabled && (
            <p className="form-error">{t("No sign-in method is enabled. Ask your administrator.")}</p>
          )}
          {cfg?.local_login_enabled !== false && (
            <>
              <label className="field">
                {t("Username")}
                <input
                  className="input"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setNeedOtp(false);
                  }}
                  required
                  autoFocus
                />
              </label>
              <label className="field">
                {t("Password")}
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {needOtp && (
                <label className="field">
                  {t("Authentication code")}
                  <input
                    className="input mono"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t("123456 or a recovery code")}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                    autoFocus
                  />
                  <span className="small muted">
                    {t("From your authenticator app. Lost your phone? Use a recovery code.")}
                  </span>
                </label>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t("Signing in…") : t("Sign in")}
              </button>
            </>
          )}
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
            {t("Your role (admin, analyst or auditor) is set by your administrator.")}
          </p>
        </form>
      </div>
    </div>
  );
}
