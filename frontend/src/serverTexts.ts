/**
 * Texts that the API sends as labels (lifecycle definition of done and change drivers, CMMI
 * levels, maturity aspects, trend metrics). They are shown with `t(label)`; listing them here
 * puts them into the translation files and `npm run i18n:check`. Keep in sync with
 * backend/app/lifecycle.py, backend/app/api/growth.py and backend/app/snapshots.py.
 */
import { t } from "./i18n";

export const serverTexts = () => [
  t("Log sources deliver data"),
  t("Required log sources are connected and delivering."),
  t("Scope implemented"),
  t("All assets, users or networks in scope are covered."),
  t("Incident response documented"),
  t("There is a playbook for the alerts."),
  t("Roles documented"),
  t("Owner and responsibilities for the use case are written down."),
  t("Rules implemented, tested and documented"),
  t("Detection logic is live and tested."),
  t("Threat landscape"),
  t("Business change"),
  t("Regulation"),
  t("IT infrastructure"),
  t("Red / purple teaming"),
  t("Incident lessons learned"),
  t("Threat hunting"),
  t("Tuning / false positives"),
  t("Other"),
  t("Initial"),
  t("Detection is ad hoc and depends on individuals; use cases are not documented."),
  t("Managed"),
  t("Use cases are planned and documented per project; results can be repeated."),
  t("Defined"),
  t("A standard use case process exists for the whole SOC and is followed."),
  t("Quantitatively managed"),
  t("Use cases are steered with metrics: scores, trends, verification."),
  t("Optimizing"),
  t("Metrics, hunting and incidents continuously improve the use cases."),
  t("People"),
  t("Process"),
  t("Technology"),
  t("SOC detection score"),
  t("Growth potential"),
  t("Framework completeness"),
  t("Assessment coverage"),
  t("Verification health"),
  t("L2 use cases with rules"),
  t("L3 rules"),
  t("Operational rules"),
  t("Log sources in use"),
  t("Scopes in use"),
  t("Maturity level (CMMI)"),
  t("Now"),
];
