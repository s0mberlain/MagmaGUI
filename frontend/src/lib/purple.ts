import type { CampaignStatus, ExecStatus, TestOutcome } from "../api";
import { t } from "../i18n";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  planned: t("Planned"),
  running: t("Running"),
  closed: t("Closed"),
};

export const EXEC_LABEL: Record<ExecStatus, string> = {
  not_run: t("Not run"),
  executed: t("Executed"),
  not_executed: t("Could not execute"),
};

export const OUTCOME_LABEL: Record<TestOutcome, string> = {
  blocked: t("Blocked"),
  alerted: t("Alerted"),
  logged: t("Logged"),
  not_detected: t("Not detected"),
};

export const OUTCOMES: TestOutcome[] = ["blocked", "alerted", "logged", "not_detected"];
export const EXEC_STATES: ExecStatus[] = ["not_run", "executed", "not_executed"];

/** Pill class: detected (Blocked / Alerted) is good, Logged is a warning, Not detected is bad. */
export function outcomeClass(o: TestOutcome | null | undefined): string {
  if (o === "blocked" || o === "alerted") return "pill pill-ok";
  if (o === "logged") return "pill pill-warn";
  if (o === "not_detected") return "pill pill-bad";
  return "pill";
}

export function campaignClass(s: CampaignStatus): string {
  return s === "running" ? "pill pill-info" : s === "closed" ? "pill" : "pill pill-warn";
}

/** Time to detect: "12 min", "3 h 5 min", or days for 24 h and more ("2 d 4 h"). */
export function fmtTtd(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "–";
  const min = Math.round(seconds / 60);
  if (min < 60) return t("{n} min", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? t("{h} h {m} min", { h, m: min % 60 }) : t("{h} h", { h });
  const d = Math.floor(h / 24);
  return h % 24 ? t("{d} d {h} h", { d, h: h % 24 }) : t("{d} d", { d });
}

/** ISO time (UTC) -> value of an <input type="datetime-local"> in the browser time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Value of an <input type="datetime-local"> (browser time zone) -> ISO time in UTC. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Now" for a datetime-local input. */
export function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString());
}
