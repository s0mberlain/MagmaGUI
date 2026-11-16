import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ROLE_LABEL, useAuth } from "../auth";
import { NAV_GROUPS, NAV_ITEMS } from "../nav";
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

const COLLAPSE_KEY = "magma.sidebar.collapsed";

export default function Layout() {
  const { user, logout, can } = useAuth();
  const name = user?.display_name || user?.username || "";
  // On a phone the menu is folded away behind a button and closes again after a choice.
  const [open, setOpen] = useState(false);
  // On a wide screen the whole sidebar can be folded to a thin rail; the choice is remembered.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((x) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, x ? "0" : "1");
      } catch {
        /* storage blocked: keep the choice for this visit only */
      }
      return !x;
    });
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const visible = NAV_ITEMS.filter((item) => !item.roles || can(...item.roles));

  return (
    <div className="shell">
      <nav
        className={"sidebar" + (open ? " is-open" : "") + (collapsed ? " is-collapsed" : "")}
        aria-label={t("Main")}
      >
        <div className="brand">
          <Logo />
          <span className="brand-name">{t("Magma UCF")}</span>
          <button
            type="button"
            className="nav-collapse"
            aria-expanded={!collapsed}
            aria-controls="nav-menu"
            title={collapsed ? t("Show menu") : t("Hide menu")}
            aria-label={collapsed ? t("Show menu") : t("Hide menu")}
            onClick={toggleCollapsed}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d={collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="nav-menu"
            onClick={() => setOpen((x) => !x)}
          >
            {open ? t("Close menu") : t("Menu")}
          </button>
        </div>
        <div id="nav-menu" className="nav-menu">
          {NAV_GROUPS.map((g) => {
            const items = visible.filter((item) => item.group === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key} className="nav-group" role="group" aria-label={g.label}>
                <span className="nav-group-head">{g.label}</span>
                {items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
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
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
