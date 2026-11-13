import type { Lifecycle } from "../api";

/** 0..1 → "62 %"; null → "–". */
export function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)} %`;
}

/** 0..1 → "0.62"; null → "–". */
export function num(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? "–" : v.toFixed(digits);
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso + "T00:00:00").getTime();
  return Math.floor(ms / 86400000);
}

export const STATUS_LABEL: Record<Lifecycle, string> = {
  onboarding: "Onboarding",
  operational: "Operational",
  maintenance: "Maintenance",
  offloading: "Offloading",
  retired: "Retired",
};

export const REF_KINDS = [
  { kind: "threat_actor", label: "Threat actors", hint: "Who the L2 use cases defend against." },
  { kind: "detection_technology", label: "Detection technologies", hint: "Tools that raise the alerts of an L3 rule." },
  { kind: "log_source", label: "Log sources", hint: "Data sources a rule reads. A rule can use several." },
  { kind: "scope", label: "Scopes", hint: "Parts of the estate a rule covers." },
] as const;
