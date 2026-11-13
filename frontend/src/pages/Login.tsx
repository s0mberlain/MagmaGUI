import { Link } from "react-router-dom";
import Logo from "../components/Logo";

// Visual shell only; authentication (local + OIDC SSO) is implemented in M1/M3.
export default function Login() {
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
        <form className="login-form" onSubmit={(e) => e.preventDefault()}>
          <h2 style={{ fontSize: 24 }}>Sign in</h2>
          <button type="button" className="btn btn-dark" disabled title="Available in M3">
            Sign in with SSO
          </button>
          <div className="divider">or with a local account</div>
          <label className="field">
            Username
            <input className="input" type="text" autoComplete="username" />
          </label>
          <label className="field">
            Password
            <input className="input" type="password" autoComplete="current-password" />
          </label>
          <button type="submit" className="btn btn-primary" disabled title="Available in M1">
            Sign in
          </button>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
            Login is not active yet. <Link to="/">Continue to the dashboard</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
