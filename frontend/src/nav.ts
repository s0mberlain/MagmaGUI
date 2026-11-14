import { t } from "./i18n";
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
  { label: t("Dashboard"), path: "/" },
  { label: t("Use cases"), path: "/usecases" },
  { label: t("Verification"), path: "/verification" },
  { label: t("Priorities"), path: "/priorities" },
  { label: t("ATT&CK coverage"), path: "/attack" },
  { label: t("Output metrics"), path: "/output" },
  { label: t("Business drivers"), path: "/drivers" },
  { label: t("Reference lists"), path: "/references" },
  { label: t("History & trends"), path: "/history" },
  { label: t("Maturity"), path: "/maturity" },
  { label: t("Import / Export"), path: "/import-export" },
  { label: t("Audit log"), path: "/audit", roles: ["admin", "auditor"] },
  { label: t("Users"), path: "/admin/users", roles: ["admin"] },
];
