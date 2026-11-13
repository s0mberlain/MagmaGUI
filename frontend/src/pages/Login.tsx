import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import Logo from "../components/Logo";

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
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
            Magma UCF
          </span>
        </div>
        <div>
          <h1>Manage your SOC use cases with the MaGMa framework.</h1>
          <p>
            Business drivers, threats and detection rules in one place, with scores, verification
            dates and versioned rule configs.
          </p>
        </div>
        <span style={{ fontSize: 13, color: "var(--c-nav-muted)" }}>
          Based on the FI-ISAC MaGMa Use Case Framework
        </span>
      </div>
      <div className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <h2 style={{ fontSize: 24 }}>Sign in</h2>
          <button type="button" className="btn btn-dark" disabled title="SSO arrives in M3">
            Sign in with SSO
          </button>
          <div className="divider">or with a local account</div>
          <label className="field">
            Username
            <input
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
            Your role (admin, analyst or auditor) is set by your administrator.
          </p>
        </form>
      </div>
    </div>
  );
}
