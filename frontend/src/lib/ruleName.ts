/** SIEM name of a rule from the format in the settings (issue #29), e.g.
 * `$companyName:$ucID:$ucName` -> `MYCORP:IA-CMT-LOG-02:Failed Login Monitoring`. */

export interface RuleNameVariable {
  name: string;
  value: string;
}

/** Variables every rule brings along; admins cannot redefine them. */
export const RULE_NAME_BUILTINS = ["ucID", "ucName", "l2ID", "l1ID"] as const;

export function ruleNameValues(
  rule: { code: string; name: string; l2_code: string; l1_code: string },
  variables: RuleNameVariable[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of variables) out[v.name] = v.value;
  // the rule's own values win
  return { ...out, ucID: rule.code, ucName: rule.name, l2ID: rule.l2_code, l1ID: rule.l1_code };
}

/** Replaces `$name` by its value. The whole name counts ($ucIDx is not $ucID + "x"); unknown
 * names stay as they are so a typo shows. */
export function renderRuleName(format: string, values: Record<string, string>): string {
  return format.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : m,
  );
}

/** `$names` in the format that have no value. */
export function unknownNames(format: string, values: Record<string, string>): string[] {
  const names = [...format.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
  return [...new Set(names.filter((n) => !Object.prototype.hasOwnProperty.call(values, n)))];
}
