import { NavLink, Outlet } from "react-router-dom";
import { NAV_ITEMS } from "../nav";
import Logo from "./Logo";

export default function Layout() {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <Logo />
          <span className="brand-name">Magma UCF</span>
        </div>
        {NAV_ITEMS.map((item) => (
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
        {/* Real user and role come with login in M1. */}
        <div className="user-box">
          <div className="avatar" aria-hidden="true">?</div>
          <div className="user-meta">
            <span>Not signed in</span>
            <span>Login arrives in M1</span>
          </div>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
