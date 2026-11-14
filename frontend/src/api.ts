import type { Lang } from "./i18n";
export type Role = "admin" | "analyst" | "auditor";

export interface User {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: Role;
  auth_source: "local" | "sso" | "service";
  active: boolean;
  totp_enabled: boolean;
  locale: Lang | null;
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
  siem_rule_ids?: string[];
  onboarded_at: string | null;
  last_verified_at: string | null;
  last_verified_by: string | null;
  verification_interval_days: number | null;
  risk_level: number | null;
  target_implementation: number | null;
  effective_risk: number | null;
  risk_source: "rule" | "l2" | null;
  effective_target: number | null;
  target_source: "rule" | "l2" | "risk" | null;
  implementation_gap: number | null;
  priority: number | null;
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
    | "effective_risk"
    | "risk_source"
    | "effective_target"
    | "target_source"
    | "implementation_gap"
    | "priority"
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
  git_sha?: string | null;
  /** "git" when the commit was made directly in the connected repository (two-way sync). */
  source?: "app" | "git";
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

export interface LifecycleMeta {
  dod_items: { key: string; label: string; hint: string }[];
  drivers: Record<string, { key: string; label: string }[]>;
}
export interface LifecycleEvent {
  id: number;
  level: Level;
  code: string;
  name: string;
  from_status: Lifecycle | null;
  to_status: Lifecycle;
  driver_type: string;
  driver: string;
  note: string;
  dod_override: boolean;
  username: string;
  at: string;
}
export interface LifecycleState {
  status: Lifecycle;
  dod: { key: string; done: boolean; by: string | null; at: string | null }[];
  dod_complete: boolean;
  events: LifecycleEvent[];
}
export interface LifecycleChange {
  to_status: Lifecycle;
  driver_type: string;
  driver: string;
  note: string;
  override?: boolean;
}
export type KpiMap = Record<string, number | null>;
export interface Snapshot {
  id: number;
  label: string;
  kind: "manual" | "scheduled" | "demo" | "live";
  taken_at: string;
  taken_by: string;
  kpis: KpiMap;
}
export interface TrendPoint {
  id: number | null;
  label: string;
  kind: Snapshot["kind"];
  taken_at: string;
  kpis: KpiMap;
  lifecycle_changes: number;
  config_commits: number;
}
export interface Trends {
  metrics: { key: string; label: string; unit: "pct" | "count" }[];
  schedule: string;
  points: TrendPoint[];
}
export interface GroupChange {
  code: string;
  name: string;
  change: "added" | "removed" | "changed";
  a: Record<string, unknown> | null;
  b: Record<string, unknown> | null;
}
export interface SnapshotCompare {
  a: Snapshot;
  b: Snapshot;
  kpis: Record<string, { a: number | null; b: number | null }>;
  l1: GroupChange[];
  l2: GroupChange[];
  rules: GroupChange[];
}
export interface GitStatus {
  enabled: boolean;
  remote: string;
  branch: string;
  auth: string;
  auto_sync: boolean;
  running: boolean;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  head_sha: string | null;
  commits_total: number;
  commits_unsynced: number;
  pull: boolean;
  pull_interval_minutes: number;
  webhook: boolean;
  commits_from_git: number;
  last_import_at: string | null;
  last_imported_sha: string | null;
  import_notes: string[];
}

export interface ApiTokenInfo {
  id: number;
  name: string;
  prefix: string;
  role: Role;
  username: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}
export interface ApiTokenCreated extends ApiTokenInfo {
  token: string;
}
export interface SiemUnlinked {
  rule_id: string;
  name: string;
  enabled: boolean;
  severity: string;
  techniques: string[];
  suggestions: string[];
}
export interface SiemSourceInfo {
  name: string;
  inventory_at: string | null;
  inventory_by: string | null;
  alerts_at: string | null;
  alerts_by: string | null;
  alerts_report: { created?: number; updated?: number; matched?: number; unmatched?: string[]; errors?: string[] };
  rules_total: number;
  enabled: number;
  linked: number;
  unlinked: SiemUnlinked[];
  disabled_but_operational: { rule_id: string; name: string; code: string }[];
}
export interface SiemOverview {
  sources: SiemSourceInfo[];
  missing_in_siem: { code: string; name: string; rule_id: string; status: Lifecycle }[];
  linked_rules: number;
}

export interface GapRow {
  code: string;
  name: string;
  l2_code: string;
  l2_name: string;
  lifecycle_status: Lifecycle;
  effectiveness: number | null;
  implementation: number | null;
  coverage: number | null;
  weight: number | null;
  potential: number | null;
  risk: number | null;
  risk_source: string | null;
  target: number | null;
  target_source: string | null;
  gap: number | null;
  priority: number | null;
}
export interface Gaps {
  summary: {
    rules: number;
    with_target: number;
    below_target: number;
    no_risk: number;
    avg_gap: number | null;
    by_risk: Record<string, { rules: number; below_target: number }>;
    risk_targets: Record<string, number>;
  };
  rows: GapRow[];
}
export interface MaturityAssessment {
  id: number;
  level: number;
  target_level: number | null;
  aspects: Record<string, number>;
  notes: string;
  assessed_by: string;
  assessed_at: string;
  created_at: string;
}
export interface Maturity {
  levels: { level: number; name: string; description: string }[];
  aspects: Record<string, string>;
  current: MaturityAssessment | null;
  history: MaturityAssessment[];
}
export interface TotpSetup {
  secret: string;
  uri: string;
  qr_svg: string;
}

/** 409 from a config save: someone committed in between. */
export interface AttackHit {
  code: string;
  name: string;
  weight: number | null;
  direct: boolean;
}
export interface AttackTech {
  id: string;
  name: string;
  best: number | null;
  rules: AttackHit[];
  subs: AttackTech[];
}
export interface AttackTactic {
  id: string;
  short: string;
  name: string;
  techniques: AttackTech[];
  covered: number;
  total: number;
}
export interface AttackOutdated {
  code: string;
  name: string;
  id: string;
  status: "revoked" | "deprecated" | "unknown";
  replacement: string | null;
}
export interface AttackCoverage {
  version: string;
  tactics: AttackTactic[];
  techniques_total: number;
  techniques_with_rules: number;
  techniques_scored: number;
  rules_total: number;
  rules_mapped: number;
  outdated: AttackOutdated[];
}
export interface RemapResult {
  version: string;
  rules: number;
  ids_replaced: number;
  applied: boolean;
  changes: { code: string; name: string; before: string[]; after: string[]; kept: string[] }[];
}
export interface OutputMetric {
  period: string;
  alerts: number;
  incidents: number;
  false_positives: number;
  false_negatives: number | null;
  fp_rate: number | null;
  note: string;
  source: string;
  updated_by: string;
}
export type OutputMetricInput = Pick<
  OutputMetric,
  "alerts" | "incidents" | "false_positives" | "false_negatives" | "note"
>;
export interface OutputTotal {
  period: string;
  rules: number;
  alerts: number;
  incidents: number;
  false_positives: number;
  false_negatives: number;
  fp_rate: number | null;
}
export interface OutputRuleTotal {
  code: string;
  name: string;
  months: number;
  alerts: number;
  incidents: number;
  false_positives: number;
  false_negatives: number;
  fp_rate: number | null;
}
export interface OutputSummary {
  months: OutputTotal[];
  rules: OutputRuleTotal[];
  rules_reporting: number;
  totals: OutputTotal;
}
export interface CsvReport {
  dry_run: boolean;
  rows: number;
  created: number;
  updated: number;
  errors: string[];
}

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
  login: (username: string, password: string, otp?: string) =>
    request<User>("POST", "/api/auth/login", { username, password, ...(otp ? { otp } : {}) }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<User>("GET", "/api/auth/me"),
  apiTokens: () => request<ApiTokenInfo[]>("GET", "/api/integrations/tokens"),
  createApiToken: (body: { name: string; role: "analyst" | "auditor"; expires_days: number | null }) =>
    request<ApiTokenCreated>("POST", "/api/integrations/tokens", body),
  revokeApiToken: (id: number) => request<void>("DELETE", `/api/integrations/tokens/${id}`),
  siem: () => request<SiemOverview>("GET", "/api/integrations/siem"),
  deleteSiemSource: (name: string) => request<void>("DELETE", `/api/integrations/siem/${enc(name)}`),
  setLocale: (locale: Lang | null) => request<User>("PUT", "/api/auth/me/locale", { locale }),
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

  lifecycleMeta: () => request<LifecycleMeta>("GET", "/api/lifecycle/meta"),
  lifecycle: (level: Level, code: string) => request<LifecycleState>("GET", `/api/${level}/${enc(code)}/lifecycle`),
  changeStatus: (level: Level, code: string, body: LifecycleChange) =>
    request<LifecycleState>("POST", `/api/${level}/${enc(code)}/lifecycle`, body),
  setDod: (level: Level, code: string, items: Record<string, boolean>) =>
    request<LifecycleState>("PUT", `/api/${level}/${enc(code)}/dod`, { items }),
  changes: (limit = 50, driverType = "") =>
    request<LifecycleEvent[]>(
      "GET",
      `/api/changes?${new URLSearchParams({ limit: String(limit), ...(driverType ? { driver_type: driverType } : {}) })}`,
    ),
  snapshots: () => request<Snapshot[]>("GET", "/api/snapshots"),
  takeSnapshot: (label: string) => request<Snapshot>("POST", "/api/snapshots", { label }),
  deleteSnapshot: (id: number) => request<void>("DELETE", `/api/snapshots/${id}`),
  compareSnapshots: (a: string, b: string) =>
    request<SnapshotCompare>("GET", `/api/snapshots/compare?${new URLSearchParams({ a, b })}`),
  trends: () => request<Trends>("GET", "/api/trends"),
  gitStatus: () => request<GitStatus>("GET", "/api/admin/git"),
  gitSync: () => request<GitStatus>("POST", "/api/admin/git/sync"),

  gaps: (f: { l1?: string; min_risk?: number; below_target?: boolean } = {}) =>
    request<Gaps>(
      "GET",
      `/api/growth/gaps?${new URLSearchParams(
        Object.entries(f)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      )}`,
    ),
  maturity: () => request<Maturity>("GET", "/api/maturity"),
  assessMaturity: (body: {
    level: number;
    target_level: number | null;
    aspects: Record<string, number>;
    notes: string;
    assessed_at?: string;
  }) => request<MaturityAssessment>("POST", "/api/maturity", body),
  deleteMaturity: (id: number) => request<void>("DELETE", `/api/maturity/${id}`),
  totpSetup: (password: string) => request<TotpSetup>("POST", "/api/auth/me/totp/setup", { password }),
  totpEnable: (code: string) => request<{ recovery_codes: string[] }>("POST", "/api/auth/me/totp/enable", { code }),
  totpDisable: (password: string, code: string) =>
    request<void>("POST", "/api/auth/me/totp/disable", { password, code }),
  totpNewCodes: (password: string, code: string) =>
    request<{ recovery_codes: string[] }>("POST", "/api/auth/me/totp/recovery-codes", { password, code }),
  resetTotp: (userId: number) => request<User>("DELETE", `/api/users/${userId}/totp`),

  attackCoverage: () => request<AttackCoverage>("GET", "/api/attack/coverage"),
  remapPreview: () => request<RemapResult>("GET", "/api/attack/remap"),
  remapApply: () => request<RemapResult>("POST", "/api/attack/remap"),
  outputMetrics: (code: string, months = 12) =>
    request<OutputMetric[]>("GET", `/api/l3/${enc(code)}/output-metrics?months=${months}`),
  setOutputMetric: (code: string, period: string, body: OutputMetricInput) =>
    request<OutputMetric>("PUT", `/api/l3/${enc(code)}/output-metrics/${period}`, body),
  deleteOutputMetric: (code: string, period: string) =>
    request<void>("DELETE", `/api/l3/${enc(code)}/output-metrics/${period}`),
  outputSummary: (months = 12) => request<OutputSummary>("GET", `/api/output-metrics/summary?months=${months}`),
  importOutputCsv: async (file: File, dryRun: boolean): Promise<CsvReport> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dry_run", String(dryRun));
    const res = await fetch("/api/import/output-metrics", { method: "POST", body: fd, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, detailMessage(data) ?? `${res.status} ${res.statusText}`);
    return data as CsvReport;
  },

  demoData: (seed: number) => request<Record<string, number>>("POST", "/api/admin/demo-data", { seed }),
};

const enc = encodeURIComponent;
export type Level = "l2" | "l3";
const cfgUrl = (level: Level, code: string) => `/api/${level}/${enc(code)}/config`;
