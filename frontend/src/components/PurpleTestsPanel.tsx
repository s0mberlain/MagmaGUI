import { Link } from "react-router-dom";
import { purple } from "../api";
import { fmtDate } from "../lib/format";
import { OutcomePill } from "../lib/purple";
import { ErrorNote, useLoad } from "./ui";
import { t } from "../i18n";

/** Purple team results of an L3 rule (evidence only: the embedded metrics stay manual). */
export default function PurpleTestsPanel({ code }: { code: string }) {
  const tests = useLoad(() => purple.ruleTests(code), [code]);
  const list = tests.data ?? [];
  return (
    <section className="card stack-sm" aria-labelledby="pth">
      <div className="section-head">
        <h2 id="pth">{t("Purple team tests")}</h2>
        <Link to="/purple" className="small">
          {t("Purple teaming")}
        </Link>
      </div>
      <ErrorNote error={tests.error} />
      {tests.data && !list.length && (
        <p className="muted small" style={{ margin: 0 }}>
          {t("This rule was not part of a purple team test yet.")}
        </p>
      )}
      {list.length > 0 && (
        <ul className="history">
          {list.slice(0, 8).map((x) => (
            <li key={x.test_case_id}>
              <OutcomePill outcome={x.outcome} />
              <span className="stack-xs">
                <Link to={`/purple/test-cases/${x.test_case_id}`} className="strong-500">
                  {x.test_case}
                </Link>
                <span className="small muted">
                  {x.assessment}
                  {x.attack_start ? ` · ${fmtDate(x.attack_start)}` : ` · ${t("not run yet")}`}
                  {x.alert_name ? ` · ${x.alert_name}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
