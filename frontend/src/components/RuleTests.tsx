import { Link } from "react-router-dom";
import { api, type RuleTest } from "../api";
import { fmtTime } from "../lib/format";
import { CAMPAIGN_STATUS_LABEL, fmtTtd, OUTCOME_LABEL, outcomeClass } from "../lib/purple";
import { ErrorNote, useLoad } from "./ui";
import { t } from "../i18n";

/** Purple team tests of a rule, newest first (PROJ-3, spec 25). */
export default function RuleTests({ code }: { code: string }) {
  const tests = useLoad<RuleTest[]>(() => api.ruleTests(code), [code]);
  return (
    <section className="card stack" aria-labelledby="rt-h">
      <div className="section-head">
        <h2 id="rt-h">{t("Tests")}</h2>
        <Link to="/campaigns" className="small">
          {t("Campaigns")}
        </Link>
      </div>
      <ErrorNote error={tests.error} />
      {tests.data && !tests.data.length && (
        <p className="muted small" style={{ margin: 0 }}>
          {t("No purple team test is linked to this rule yet.")}
        </p>
      )}
      {!!tests.data?.length && (
        <ul className="history">
          {tests.data.map((x) => (
            <li key={x.id}>
              {x.outcome ? (
                <span className={outcomeClass(x.outcome)}>{OUTCOME_LABEL[x.outcome]}</span>
              ) : (
                <span className="pill">{t("No outcome")}</span>
              )}
              <span className="stack-xs">
                <Link to={`/campaigns/${x.campaign_id}?test=${x.id}`} className="strong-500">
                  {x.title}
                </Link>
                <span className="small ink-2">
                  {x.campaign_name} ({CAMPAIGN_STATUS_LABEL[x.campaign_status]}) · <span className="mono">{x.technique}</span>
                </span>
                <span className="small muted">
                  {t("Executed")}: {x.executed_at ? fmtTime(x.executed_at) : "–"} · {t("TTD")}: {fmtTtd(x.ttd_seconds)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
