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
  { label: "Use cases", path: "/usecases" },
  { label: "Verification", path: "/verification" },
  { label: "ATT&CK coverage", path: "/attack", milestone: "M6" },
  { label: "Business drivers", path: "/drivers" },
  { label: "Reference lists", path: "/references" },
  { label: "History & trends", path: "/history", milestone: "M4" },
  { label: "Import / Export", path: "/import-export" },
  { label: "Audit log", path: "/audit", roles: ["admin", "auditor"] },
  { label: "Users", path: "/admin/users", roles: ["admin"] },
];
