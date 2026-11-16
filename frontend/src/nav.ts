import { t } from "./i18n";
import type { Role } from "./api";

export interface NavItem {
  label: string;
  path: string;
  /** Milestone from docs/PLAN.md in which the screen gets built. */
  milestone?: string;
  /** Only these roles see the entry (default: everyone). */
  roles?: Role[];
  /** Heading the entry is listed under in the sidebar. */
  group: "work" | "analysis" | "admin";
}

export const NAV_GROUPS: { key: NavItem["group"]; label: string }[] = [
  { key: "work", label: t("Daily work") },
  { key: "analysis", label: t("Analysis") },
  { key: "admin", label: t("Setup") },
];

export const NAV_ITEMS: NavItem[] = [
  { label: t("Dashboard"), path: "/", group: "work" },
  { label: t("Use cases"), path: "/usecases", group: "work" },
  { label: t("Verification"), path: "/verification", group: "work" },
  { label: t("Priorities"), path: "/priorities", group: "work" },
  { label: t("Usecase Threat Modelling"), path: "/systems", group: "work" },
  { label: t("ATT&CK coverage"), path: "/attack", group: "analysis" },
  { label: t("Output metrics"), path: "/output", group: "analysis" },
  { label: t("History & trends"), path: "/history", group: "analysis" },
  { label: t("Business drivers"), path: "/drivers", group: "admin" },
  { label: t("STRIDE mapping"), path: "/stride-mapping", group: "admin" },
  { label: t("Reference lists"), path: "/references", group: "admin" },
  { label: t("Import / Export"), path: "/import-export", group: "admin" },
  { label: t("Integrations"), path: "/integrations", group: "admin" },
  { label: t("Audit log"), path: "/audit", roles: ["admin", "auditor"], group: "admin" },
  { label: t("Users"), path: "/admin/users", roles: ["admin"], group: "admin" },
  { label: t("Settings"), path: "/settings", roles: ["admin"], group: "admin" },
];
