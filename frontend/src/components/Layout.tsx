import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ROLE_LABEL, useAuth } from "../auth";
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from "../nav";
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
  // one title per screen, so browser tabs and history entries can be told apart
  useEffect(() => {
    const path = location.pathname;
    const hit = NAV_ITEMS.filter((n) => (n.path === "/" ? path === "/" : path === n.path || path.startsWith(n.path + "/"))).sort(
      (x, y) => y.path.length - x.path.length,
    )[0];
    document.title = hit ? `${hit.label} · ${t("Vulcan UCF")}` : t("Vulcan UCF");
  }, [location.pathname]);
  const visible = NAV_ITEMS.filter((item) => !item.roles || can(...item.roles));
  // entries with sub-entries open and close; the one with the current page is open
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const isOpen = (item: NavItem) =>
    opened.has(item.path) || visible.some((c) => c.parent === item.path && location.pathname.startsWith(c.path));
  const expand = (path: string) => setOpened((x) => (x.has(path) ? x : new Set(x).add(path)));
  const toggle = (path: string) =>
    setOpened((x) => {
      const next = new Set(x);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div className="shell">
      <nav
        className={"sidebar" + (open ? " is-open" : "") + (collapsed ? " is-collapsed" : "")}
        aria-label={t("Main")}
      >
        <div className="brand">
          <Logo />
          <span className="brand-name">{t("Vulcan UCF")}</span>
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
                {items
                  .filter((item) => !item.parent)
                  .map((item) => {
                    const subs = items.filter((c) => c.parent === item.path);
                    const open = isOpen(item);
                    const onSub = subs.some((c) => location.pathname.startsWith(c.path));
                    return (
                      <div key={item.path} className="nav-branch">
                        <div className="nav-row">
                          <NavLink
                            to={item.path}
                            end={item.path === "/"}
                            className={({ isActive }) => "nav-link grow" + (isActive && !onSub ? " active" : "")}
                            // a click on the entry opens its sub-entries (the arrow also closes them)
                            onClick={() => subs.length > 0 && expand(item.path)}
                          >
                            {item.label}
                          </NavLink>
                          {subs.length > 0 && (
                            <button
                              type="button"
                              className="nav-expand"
                              aria-expanded={open}
                              aria-controls={`nav-sub-${item.path}`}
                              aria-label={t("Show entries under {name}", { name: item.label })}
                              title={t("Show entries under {name}", { name: item.label })}
                              onClick={() => toggle(item.path)}
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                                <path
                                  d={open ? "M2 4l4 4 4-4" : "M4 2l4 4-4 4"}
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                        {subs.length > 0 && open && (
                          <div id={`nav-sub-${item.path}`} className="nav-sub">
                            {subs.map((c) => (
                              <NavLink
                                key={c.path}
                                to={c.path}
                                className={({ isActive }) => "nav-link nav-link-sub" + (isActive ? " active" : "")}
                              >
                                {c.label}
                              </NavLink>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
