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
  login: (username: string, password: string) =>
    request<User>("POST", "/api/auth/login", { username, password }),
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
};
