import { NavLink, Outlet } from "react-router-dom";
import { ROLE_LABEL, useAuth } from "../auth";
import { NAV_ITEMS } from "../nav";
import LanguageSelect from "./LanguageSelect";
import Logo from "./Logo";
import { t } from "../i18n";

function initials(name: string): string {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const name = user?.display_name || user?.username || "";

  return (
    <div className="shell">
      <nav className="sidebar" aria-label={t("Main")}>
        <div className="brand">
          <Logo />
          <span className="brand-name">{t("Magma UCF")}</span>
        </div>
        {NAV_ITEMS.filter((item) => !item.roles || can(...item.roles)).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            {item.label}
          </NavLink>
        ))}
        <div className="nav-spacer" />
        <LanguageSelect save className="lang-dark" />
        {user && (
          <div className="user-box">
            <div className="avatar" aria-hidden="true">
              {initials(name)}
            </div>
            <NavLink className="user-meta" to="/account" title={t("Account and two-factor login")}>
              <span>{name}</span>
              <span>
                {ROLE_LABEL[user.role]} · {user.auth_source === "sso" ? "SSO" : t("Local")}
              </span>
            </NavLink>
            <button type="button" className="signout" onClick={() => void logout()}>
              {t("Sign out")}
            </button>
          </div>
        )}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
