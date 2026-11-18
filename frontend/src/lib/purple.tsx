import type { PtAssessmentStatus, PtBlueStatus, PtOutcome, PtRedStatus, PtTrend } from "../api";
import { t } from "../i18n";

/** VECTR order of priority, best first (backend app/purple.py). */
export const OUTCOMES: PtOutcome[] = [
  "blocked",
  "alerted",
  "logged_central",
  "logged_local",
  "none",
  "not_applicable",
  "tbd",
];

export const OUTCOME_LABEL: Record<PtOutcome, string> = {
  blocked: t("Blocked"),
  alerted: t("Alerted"),
  logged_central: t("Logged (central)"),
  logged_local: t("Logged (local only)"),
  none: t("Not detected"),
  not_applicable: t("N/A"),
  tbd: t("TBD"),
};

export const OUTCOME_HINT: Record<PtOutcome, string> = {
  blocked: t("The attack was prevented."),
  alerted: t("An alert fired that an analyst would see."),
  logged_central: t("Events reached the SIEM, but no alert fired."),
  logged_local: t("Telemetry exists only on the host or tool, not in the SIEM."),
  none: t("Nothing was seen."),
  not_applicable: t("This defense does not apply to the test."),
  tbd: t("Not assessed yet."),
};

export const RED_STATUS_LABEL: Record<PtRedStatus, string> = {
  planned: t("Planned"),
  in_progress: t("Running"),
  executed: t("Executed"),
  not_executed: t("Not executed"),
};

export const BLUE_STATUS_LABEL: Record<PtBlueStatus, string> = {
  waiting: t("Waiting for red"),
  in_review: t("In review"),
  done: t("Done"),
};

export const ASSESSMENT_STATUS_LABEL: Record<PtAssessmentStatus, string> = {
  planned: t("Planned"),
  in_progress: t("In progress"),
  completed: t("Completed"),
};

export const TREND_LABEL: Record<PtTrend, string> = {
  improved: t("Improved"),
  regressed: t("Regressed"),
  unchanged: t("Unchanged"),
  new: t("First run"),
  untested: t("Not run"),
};

export const SEVERITIES = ["", "info", "low", "medium", "high", "critical"] as const;
export const SEVERITY_LABEL: Record<(typeof SEVERITIES)[number], string> = {
  "": "–",
  info: t("Info"),
  low: t("Low"),
  medium: t("Medium"),
  high: t("High"),
  critical: t("Critical"),
};

export function OutcomePill({ outcome, overridden }: { outcome: PtOutcome; overridden?: boolean }) {
  return (
    <span className={`pill pt-${outcome}`} title={OUTCOME_HINT[outcome] + (overridden ? " " + t("(set by hand)") : "")}>
      {OUTCOME_LABEL[outcome]}
      {overridden ? " *" : ""}
    </span>
  );
}

export function RedPill({ status }: { status: PtRedStatus }) {
  return <span className={`pill pt-red-${status}`}>{RED_STATUS_LABEL[status]}</span>;
}

export function BluePill({ status }: { status: PtBlueStatus }) {
  return <span className={`pill pt-blue-${status}`}>{BLUE_STATUS_LABEL[status]}</span>;
}

export function TrendPill({ trend }: { trend: PtTrend }) {
  return <span className={`pill pt-trend-${trend}`}>{TREND_LABEL[trend]}</span>;
}

/** "12 min", "45 s", "2 h 5 min" */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "–";
  const s = Math.round(seconds);
  if (s < 120) return t("{n} s", { n: s });
  if (s < 7200) return t("{n} min", { n: Math.round(s / 60) });
  return t("{h} h {m} min", { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
}

/** ISO timestamp -> value for <input type="datetime-local"> (local time) and back. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

/** Comma or line separated text <-> list. */
export const splitList = (v: string): string[] =>
  v
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
export const joinList = (v: string[]): string => v.join(", ");
