import { t } from "../i18n";
import type { Classification, InterviewStatus, Stride, SystemRow, ThreatCategory, ThreatState } from "../api";

export const STRIDE: Stride[] = [
  "spoofing",
  "tampering",
  "repudiation",
  "information_disclosure",
  "denial_of_service",
  "elevation_of_privilege",
];

export const STRIDE_LABEL: Record<Stride, string> = {
  spoofing: t("Spoofing"),
  tampering: t("Tampering"),
  repudiation: t("Repudiation"),
  information_disclosure: t("Information disclosure"),
  denial_of_service: t("Denial of service"),
  elevation_of_privilege: t("Elevation of privilege"),
};

export const isCustomThreat = (c: string): boolean => c.startsWith("custom:");

// #60: titles of custom ATT&CK threats by category (custom:<key>); keys are random and unique, so
// one map serves every interview and system shown
const customTitles = new Map<string, string>();

export function registerCustomThreats(list: { category: string; title?: string | null }[]): void {
  for (const x of list) if (x.title && isCustomThreat(x.category)) customTitles.set(x.category, x.title);
}

/** Label of a STRIDE category or of a custom ATT&CK threat. */
export function threatLabel(c: ThreatCategory | string): string {
  return (STRIDE_LABEL as Record<string, string>)[c] ?? customTitles.get(c) ?? t("Custom threat");
}

/** Short explanation shown next to each category in the interview. */
export const STRIDE_HINT: Record<Stride, string> = {
  spoofing: t("Someone pretends to be another user or system (stolen credentials, fake sessions)."),
  tampering: t("Data, code or configuration is changed without permission."),
  repudiation: t("Someone denies an action and there is no trustworthy record of it."),
  information_disclosure: t("Confidential data is exposed to people who should not see it."),
  denial_of_service: t("The component becomes slow or unavailable for its users."),
  elevation_of_privilege: t("Someone gains more rights than intended, e.g. admin access."),
};

export const STATE_LABEL: Record<ThreatState, string> = {
  applies: t("Applies"),
  does_not_apply: t("Does not apply"),
  not_discussed: t("Not discussed"),
};

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  public: t("Public"),
  internal: t("Internal"),
  confidential: t("Confidential"),
  restricted: t("Restricted"),
};

export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  draft: t("Draft"),
  completed: t("Completed"),
  confirmed: t("Confirmed"),
};

export const SYSTEM_STATE_LABEL: Record<SystemRow["state"], string> = {
  none: t("No interview"),
  due: t("Interview due"),
  ok: t("Up to date"),
};

/** Risk score (1..25) -> risk level 1..5, as the server does. */
export function riskLevel(score: number | null | undefined): number | null {
  if (!score || score < 1) return null;
  return Math.min(5, Math.floor((score - 1) / 5) + 1);
}
