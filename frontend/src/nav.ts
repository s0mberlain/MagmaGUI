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
  group: "work" | "threat" | "purple" | "analysis" | "admin";
  /** Other paths under which this entry is the active one (prefixes). */
  also?: string[];
}

/** Sidebar groups by domain: each feature lives in one place (critique 2026-11-21). The group
 * heading names the domain, so entries inside it stay short ("Systems", "Trends"). */
export const NAV_GROUPS: { key: NavItem["group"]; label: string }[] = [
  { key: "work", label: t("Daily work") },
  { key: "threat", label: t("Threat modelling") },
  { key: "purple", label: t("Purple teaming") },
  { key: "analysis", label: t("Analysis") },
  { key: "admin", label: t("Setup") },
];

export const NAV_ITEMS: NavItem[] = [
  { label: t("Dashboard"), path: "/", group: "work" },
  { label: t("Use cases"), path: "/usecases", group: "work" },
  { label: t("Verification"), path: "/verification", group: "work" },
  { label: t("Priorities"), path: "/priorities", group: "work" },
  { label: t("Systems"), path: "/systems", group: "threat", also: ["/interviews/"] },
  { label: t("STRIDE mapping"), path: "/stride-mapping", group: "threat" },
  { label: t("Assessments"), path: "/purple", group: "purple", also: ["/purple/assessments/", "/purple/test-cases/"] },
  { label: t("Trends"), path: "/purple/trends", group: "purple" },
  { label: t("Library"), path: "/purple/library", group: "purple" },
  { label: t("ATT&CK coverage"), path: "/attack", group: "analysis" },
  { label: t("Output metrics"), path: "/output", group: "analysis" },
  { label: t("History & trends"), path: "/history", group: "analysis" },
  { label: t("Business drivers"), path: "/drivers", group: "admin" },
  { label: t("Reference lists"), path: "/references", group: "admin" },
  { label: t("Import / Export"), path: "/import-export", group: "admin" },
  { label: t("Integrations"), path: "/integrations", group: "admin" },
  { label: t("Audit log"), path: "/audit", roles: ["admin", "auditor"], group: "admin" },
  { label: t("Users"), path: "/admin/users", roles: ["admin"], group: "admin" },
  { label: t("Settings"), path: "/settings", roles: ["admin"], group: "admin" },
];

/** Whether a nav entry is the current one: its own path exactly, or one of its `also` prefixes,
 * or a sub-path that no other entry claims (e.g. /usecases/l3/X under Use cases). */
export function navActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.path) return true;
  if (item.path === "/") return false;
  if (item.also?.some((p) => pathname.startsWith(p))) return true;
  if (!pathname.startsWith(item.path + "/")) return false;
  return !NAV_ITEMS.some((o) => o !== item && o.path.startsWith(item.path + "/") && pathname.startsWith(o.path));
}
