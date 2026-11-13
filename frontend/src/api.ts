export type Role = "admin" | "analyst" | "auditor";

export interface User {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: Role;
  auth_source: "local" | "sso";
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface VersionInfo {
  name: string;
  version: string;
}

export interface CatalogueSummary {
  l1: number;
  l2: number;
  l3: number;
  business_drivers: number;
  compliance_drivers: number;
  references: Record<string, number>;
}

export interface AuditEntry {
  id: number;
  at: string;
  username: string;
  action: string;
  entity: string;
  entity_key: string;
  changes: Record<string, unknown>;
}

export type Lifecycle = "onboarding" | "operational" | "maintenance" | "offloading" | "retired";
export const LIFECYCLES: Lifecycle[] = ["onboarding", "operational", "maintenance", "offloading", "retired"];
export type RefKind = "threat_actor" | "detection_technology" | "log_source" | "scope";

export interface Metrics {
  effectiveness: number | null;
  implementation: number | null;
  coverage: number | null;
  weight: number | null;
  potential: number | null;
}

export interface Kpis {
  soc_detection_score: number | null;
  growth_potential: number | null;
  detection_gap: number | null;
  framework_completeness: number | null;
  l2_with_scored_rules: number;
  applicable_l2: number;
  assessment_coverage: number | null;
  assessed_rules: number;
  active_rules: number;
  verification_health: number | null;
  verified_in_time: number;
  verification_overdue: number;
  operational_rules: number;
  default_verification_days: number;
}

export interface GroupScore extends Metrics {
  code: string;
  name: string;
  rules: number;
  scored_rules: number;
}
export interface L1Score extends GroupScore {
  applicable: boolean;
  l2_count: number;
  scored_l2: number;
}
export interface L2Score extends GroupScore {
  l1_code: string;
}
export interface Scores {
  overall: Metrics;
  kpis: Kpis;
  l1: L1Score[];
  l2: L2Score[];
}

export interface DueRule {
  code: string;
  name: string;
  l2_code: string;
  lifecycle_status: Lifecycle;
  last_verified_at: string | null;
  last_verified_by: string | null;
  due: string | null;
  overdue: boolean;
  days_left: number | null;
}

export interface Verification {
  id: number;
  verified_at: string;
  username: string;
  result: "ok" | "issues";
  note: string;
  config_tag?: string | null;
}

export interface L1 {
  id: number;
  code: string;
  name: string;
  threat_category: string;
  purpose: string;
  stakeholders: string;
  description: string;
  applicable: boolean;
  sort_order: number;
  l2_count: number;
  l3_count: number;
}

export interface L2 {
  id: number;
  code: string;
  l1_code: string;
  name: string;
  description: string;
  lifecycle_status: Lifecycle;
  risk_level: number | null;
  target_implementation: number | null;
  onboarded_at: string | null;
  last_verified_at: string | null;
  last_verified_by: string | null;
  actors: string[];
  business_drivers: string[];
  compliance_driver_ids: number[];
  l3_count: number;
}

export interface L3 {
  id: number;
  code: string;
  l1_code: string;
  l2_code: string;
  name: string;
  description: string;
  effectiveness: number | null;
  implementation: number | null;
  coverage: number | null;
  lifecycle_status: Lifecycle;
  comments: string;
  attack_techniques: string[];
  onboarded_at: string | null;
  last_verified_at: string | null;
  last_verified_by: string | null;
  verification_interval_days: number | null;
  log_sources: string[];
  detection_technologies: string[];
  scopes: string[];
  updated_at: string;
  weight: number | null;
  potential: number | null;
  assessed: boolean;
  scored: boolean;
  verification_due: string | null;
  verification_overdue: boolean;
}

export type L2Input = Partial<Omit<L2, "id" | "l1_code" | "l3_count" | "last_verified_by">>;
export type L3Input = Partial<
  Omit<
    L3,
    | "id"
    | "l1_code"
    | "l2_code"
    | "updated_at"
    | "weight"
    | "potential"
    | "assessed"
    | "scored"
    | "verification_due"
    | "verification_overdue"
    | "last_verified_by"
  >
>;

export interface RefItem {
  id: number;
  kind: RefKind;
  name: string;
  description: string;
}
export interface BusinessDriver {
  id: number;
  code: string;
  name: string;
  description: string;
}
export interface ComplianceDriver {
  id: number;
  source_id: number;
  ref: string;
  name: string;
  description: string;
}
export interface ComplianceSource {
  id: number;
  name: string;
  drivers: ComplianceDriver[];
}

export interface AuthConfig {
  local_login_enabled: boolean;
  sso_enabled: boolean;
  sso_label: string;
}

export interface ConfigTag {
  name: string;
  created_by: string;
  created_at: string;
}
export interface ConfigCommit {
  rev: number;
  sha: string;
  short: string;
  parent_sha: string | null;
  message: string;
  author: string;
  created_at: string;
  restored_from: string | null;
  tags: ConfigTag[];
}
export interface ConfigState {
  head: ConfigCommit | null;
  content: string;
  commits: number;
}
export interface DiffLine {
  kind: "hunk" | "ctx" | "add" | "del";
  text: string;
  old?: number | null;
  new?: number | null;
}
export interface ConfigDiff {
  from: ConfigCommit | null;
  to: ConfigCommit;
  lines: DiffLine[];
  unified: string;
  added: number;
  removed: number;
}
export interface RecentCommit extends ConfigCommit {
  level: "l2" | "l3";
  code: string;
  name: string;
}
export interface YamlCheck {
  valid: boolean;
  error: string | null;
  line: number | null;
  column: number | null;
}
export interface ImportReport {
  mode: "merge" | "replace";
  dry_run: boolean;
  sheets: string[];
  counts: Record<string, { created: number; updated: number; unchanged: number; deleted: number }>;
  warnings: { sheet: string; row: number | null; message: string }[];
  errors: { sheet: string; row: number | null; message: string }[];
}

/** 409 from a config save: someone committed in between. */
export class ConflictError extends Error {
  constructor(
    message: string,
    public head: ConfigCommit | null,
    public diff: { lines: DiffLine[]; added: number; removed: number },
  ) {
    super(message);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Called on any 401 so the app can send the user to the login page. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 409 && data && typeof data === "object" && "diff" in data) {
      const d = data as { detail: string; head: ConfigCommit | null; diff: ConflictError["diff"] };
      throw new ConflictError(d.detail, d.head, d.diff);
    }
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized();
    throw new ApiError(res.status, detailMessage(data) ?? `${res.status} ${res.statusText}`);
  }
  return data as T;
}

function detailMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("detail" in data)) return null;
  const d = (data as { detail: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg ?? String(e)).join("; ");
  return null;
}

export const api = {
  version: () => request<VersionInfo>("GET", "/api/version"),
  login: (username: string, password: string) => request<User>("POST", "/api/auth/login", { username, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<User>("GET", "/api/auth/me"),
  changePassword: (current_password: string, new_password: string) =>
    request<void>("POST", "/api/auth/me/password", { current_password, new_password }),
  summary: () => request<CatalogueSummary>("GET", "/api/catalogue/summary"),
  users: () => request<User[]>("GET", "/api/users"),
  createUser: (u: { username: string; display_name: string; role: Role; password: string; email?: string | null }) =>
    request<User>("POST", "/api/users", u),
  updateUser: (id: number, u: Partial<{ display_name: string; role: Role; active: boolean; password: string }>) =>
    request<User>("PATCH", `/api/users/${id}`, u),
  deleteUser: (id: number) => request<void>("DELETE", `/api/users/${id}`),
  audit: (limit = 100) => request<AuditEntry[]>("GET", `/api/audit?limit=${limit}`),

  scores: () => request<Scores>("GET", "/api/scores"),
  due: (withinDays = 30) => request<DueRule[]>("GET", `/api/verification/due?within_days=${withinDays}`),
  verify: (level: "l2" | "l3", code: string, body: { result: "ok" | "issues"; note: string; verified_at?: string }) =>
    request<Verification>("POST", `/api/${level}/${enc(code)}/verify`, body),
  verifications: (level: "l2" | "l3", code: string) =>
    request<Verification[]>("GET", `/api/${level}/${enc(code)}/verifications`),

  l1s: () => request<L1[]>("GET", "/api/l1"),
  l2s: (l1?: string) => request<L2[]>("GET", `/api/l2${l1 ? `?l1=${enc(l1)}` : ""}`),
  l2: (code: string) => request<L2>("GET", `/api/l2/${enc(code)}`),
  createL2: (body: L2Input & { code: string; name: string }) => request<L2>("POST", "/api/l2", body),
  updateL2: (code: string, body: L2Input) => request<L2>("PATCH", `/api/l2/${enc(code)}`, body),
  deleteL2: (code: string) => request<void>("DELETE", `/api/l2/${enc(code)}`),
  l3s: (filter: { l2?: string; l1?: string } = {}) =>
    request<L3[]>("GET", `/api/l3?${new URLSearchParams(filter as Record<string, string>)}`),
  l3: (code: string) => request<L3>("GET", `/api/l3/${enc(code)}`),
  createL3: (body: L3Input & { code: string; name: string }) => request<L3>("POST", "/api/l3", body),
  updateL3: (code: string, body: L3Input) => request<L3>("PATCH", `/api/l3/${enc(code)}`, body),
  deleteL3: (code: string) => request<void>("DELETE", `/api/l3/${enc(code)}`),
  nextL3Code: (l2: string) => request<{ code: string }>("GET", `/api/l3/next-code/${enc(l2)}`),

  refs: (kind: RefKind) => request<RefItem[]>("GET", `/api/references/${kind}`),
  createRef: (kind: RefKind, body: { name: string; description: string }) =>
    request<RefItem>("POST", `/api/references/${kind}`, body),
  updateRef: (kind: RefKind, id: number, body: { name: string; description: string }) =>
    request<RefItem>("PATCH", `/api/references/${kind}/${id}`, body),
  deleteRef: (kind: RefKind, id: number) => request<void>("DELETE", `/api/references/${kind}/${id}`),

  drivers: () => request<BusinessDriver[]>("GET", "/api/business-drivers"),
  createDriver: (body: Omit<BusinessDriver, "id">) => request<BusinessDriver>("POST", "/api/business-drivers", body),
  updateDriver: (id: number, body: Omit<BusinessDriver, "id">) =>
    request<BusinessDriver>("PATCH", `/api/business-drivers/${id}`, body),
  deleteDriver: (id: number) => request<void>("DELETE", `/api/business-drivers/${id}`),
  compliance: () => request<ComplianceSource[]>("GET", "/api/compliance"),
  createSource: (name: string) => request<ComplianceSource>("POST", "/api/compliance", { name }),
  deleteSource: (id: number) => request<void>("DELETE", `/api/compliance/${id}`),
  createComplianceDriver: (sourceId: number, body: { ref: string; name: string; description: string }) =>
    request<ComplianceDriver>("POST", `/api/compliance/${sourceId}/drivers`, body),
  updateComplianceDriver: (id: number, body: { ref: string; name: string; description: string }) =>
    request<ComplianceDriver>("PATCH", `/api/compliance/drivers/${id}`, body),
  deleteComplianceDriver: (id: number) => request<void>("DELETE", `/api/compliance/drivers/${id}`),

  authConfig: () => request<AuthConfig>("GET", "/api/auth/config"),

  config: (level: Level, code: string) => request<ConfigState>("GET", cfgUrl(level, code)),
  saveConfig: (level: Level, code: string, body: { content: string; message: string; base_sha: string | null }) =>
    request<ConfigCommit>("PUT", cfgUrl(level, code), body),
  configHistory: (level: Level, code: string) => request<ConfigCommit[]>("GET", `${cfgUrl(level, code)}/history`),
  configCommit: (level: Level, code: string, ref: string) =>
    request<ConfigCommit & { content: string }>("GET", `${cfgUrl(level, code)}/commits/${enc(ref)}`),
  configDiff: (level: Level, code: string, to: string, from?: string) =>
    request<ConfigDiff>("GET", `${cfgUrl(level, code)}/diff?${new URLSearchParams({ to, ...(from ? { from } : {}) })}`),
  restoreConfig: (level: Level, code: string, ref: string, message = "") =>
    request<ConfigCommit>("POST", `${cfgUrl(level, code)}/restore/${enc(ref)}`, { message }),
  tagConfig: (level: Level, code: string, name: string, ref?: string) =>
    request<ConfigCommit>("POST", `${cfgUrl(level, code)}/tags`, { name, ref }),
  configDownloadUrl: (level: Level, code: string, ref?: string) =>
    `${cfgUrl(level, code)}/download${ref ? `?ref=${enc(ref)}` : ""}`,
  validateYaml: (content: string) => request<YamlCheck>("POST", "/api/config/validate", { content }),
  recentCommits: (limit = 6) => request<RecentCommit[]>("GET", `/api/config/recent?limit=${limit}`),
  configHeads: (level: Level, prefix = "") =>
    request<Record<string, ConfigCommit>>("GET", `/api/config/heads/${level}?prefix=${enc(prefix)}`),

  importExcel: async (file: File, mode: "merge" | "replace", dryRun: boolean): Promise<ImportReport> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    fd.append("dry_run", String(dryRun));
    const res = await fetch("/api/import/excel", { method: "POST", body: fd, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, detailMessage(data) ?? `${res.status} ${res.statusText}`);
    return data as ImportReport;
  },

  demoData: (seed: number) => request<Record<string, number>>("POST", "/api/admin/demo-data", { seed }),
};

const enc = encodeURIComponent;
export type Level = "l2" | "l3";
const cfgUrl = (level: Level, code: string) => `/api/${level}/${enc(code)}/config`;
