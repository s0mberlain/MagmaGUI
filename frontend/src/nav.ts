import type { Role } from "./api";

export interface NavItem {
  label: string;
  path: string;
  /** Milestone from docs/PLAN.md in which the screen gets built. */
  milestone?: string;
  /** Only these roles see the entry (default: everyone). */
  roles?: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/" },
  { label: "Use cases", path: "/usecases", milestone: "M2" },
  { label: "Verification", path: "/verification", milestone: "M2" },
  { label: "ATT&CK coverage", path: "/attack", milestone: "M6" },
  { label: "Business drivers", path: "/drivers", milestone: "M2" },
  { label: "Reference lists", path: "/references", milestone: "M2" },
  { label: "History & trends", path: "/history", milestone: "M4" },
  { label: "Import / Export", path: "/import-export", milestone: "M3" },
  { label: "Audit log", path: "/audit", roles: ["admin", "auditor"] },
  { label: "Users", path: "/admin/users", roles: ["admin"] },
];
