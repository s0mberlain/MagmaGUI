/**
 * Texts that the API sends as labels (lifecycle definition of done and change drivers, trend
 * metrics). They are shown with `t(label)`; listing them here
 * puts them into the translation files and `npm run i18n:check`. Keep in sync with
 * backend/app/lifecycle.py and backend/app/snapshots.py.
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
  t("SOC detection score"),
  t("Catalogue coverage"),
  t("Growth potential"),
  t("Framework completeness"),
  t("Assessment coverage"),
  t("Verification health"),
  t("L2 use cases with rules"),
  t("L3 rules"),
  t("Operational rules"),
  t("Log sources in use"),
  t("Scopes in use"),
  t("Now"),
];
