import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type L2, type Stride, type StrideMapping } from "../api";
import { useAuth } from "../auth";
import { confirmDialog, ErrorNote, useLoad } from "../components/ui";
import { STRIDE_HINT, STRIDE_LABEL } from "../lib/stride";
import { t } from "../i18n";

export default function StrideMappingPage() {
  const { can } = useAuth();
  const admin = can("admin");
  const data = useLoad<StrideMapping>(() => api.strideMapping());
  const l2s = useLoad<L2[]>(() => (admin ? api.l2s() : Promise.resolve([])), [admin]);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<string | null>(null);
  const [pick, setPick] = useState<Partial<Record<Stride, string>>>({});
  const m = data.data;

  async function run(fn: () => Promise<StrideMapping>) {
    setError(null);
    try {
      data.setData(await fn());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  const ids = (cat: Stride) => m?.categories.find((c) => c.category === cat)?.l2s.map((x) => x.l2_id) ?? [];
  const thresholdValue = threshold ?? String(m?.threshold ?? "");
  const thresholdBad = !/^\d+$/.test(thresholdValue) || Number(thresholdValue) < 1 || Number(thresholdValue) > 25;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("STRIDE mapping")}</h1>
          <div className="subtitle">
            {t(
              "Which L2 use cases an interview proposes for each STRIDE category. Changes apply to draft interviews; completed interviews and system links stay as they are.",
            )}
          </div>
        </div>
        {admin && (
          <div className="row-actions">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (await confirmDialog(t("Replace the mapping with the default mapping?"), { danger: true }))
                  await run(() => api.resetStrideMapping());
              }}
            >
              {t("Restore default mapping")}
            </button>
          </div>
        )}
      </header>
      <ErrorNote error={error ?? data.error ?? l2s.error} />
      {!admin && <p className="form-notice">{t("Only admins can change the mapping.")}</p>}

      <section className="card stack-sm" aria-labelledby="thh">
        <h2 id="thh" className="h-sm">
          {t("Proposal threshold")}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {t("A threat is proposed when its risk score (likelihood × impact, 1–25) is at least this value.")}
        </p>
        {admin ? (
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (thresholdBad) return;
              if (await run(() => api.setProposalThreshold(Number(thresholdValue)))) setThreshold(null);
            }}
          >
            <label className="field" style={{ flex: "0 0 140px" }}>
              {t("Threshold (1–25)")}
              <input
                className={"input" + (thresholdBad ? " is-invalid" : "")}
                type="number"
                min={1}
                max={25}
                value={thresholdValue}
                aria-invalid={thresholdBad}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </label>
            <button type="submit" className="btn" disabled={thresholdBad || threshold === null}>
              {t("Save")}
            </button>
            {thresholdBad && <span className="field-error">{t("Enter a whole number from 1 to 25.")}</span>}
          </form>
        ) : (
          <p style={{ margin: 0 }} className="strong">
            {m?.threshold ?? "–"}
          </p>
        )}
      </section>

      <div className="stride-grid">
        {m?.categories.map((c) => (
          <section key={c.category} className="card stack-sm" aria-labelledby={`st-${c.category}`}>
            <h2 id={`st-${c.category}`} className="h-sm">
              {STRIDE_LABEL[c.category]} <span className="count">{c.l2s.length}</span>
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              {STRIDE_HINT[c.category]}
            </p>
            {c.l2s.length ? (
              <ul className="plain-list">
                {c.l2s.map((x) => (
                  <li key={x.l2_id} className="stride-row">
                    <Link to={`/usecases?l2=${encodeURIComponent(x.code)}`}>
                      <span className="mono small">{x.code}</span> {x.name}
                    </Link>
                    {!x.l1_applicable && <span className="chip chip-neutral">{t("L1 not applicable")}</span>}
                    {admin && (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={t("Remove {code} from {category}", { code: x.code, category: STRIDE_LABEL[c.category] })}
                        onClick={() =>
                          void run(() => api.setStrideMapping(c.category, ids(c.category).filter((i) => i !== x.l2_id)))
                        }
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                {t("No use case mapped.")}
              </p>
            )}
            {admin && (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const v = pick[c.category];
                  if (!v) return;
                  if (await run(() => api.setStrideMapping(c.category, [...ids(c.category), Number(v)])))
                    setPick((p) => ({ ...p, [c.category]: "" }));
                }}
              >
                <label className="sr-only" htmlFor={`add-${c.category}`}>
                  {t("Add use case to {category}", { category: STRIDE_LABEL[c.category] })}
                </label>
                <select
                  id={`add-${c.category}`}
                  className="input input-sm grow"
                  value={pick[c.category] ?? ""}
                  onChange={(e) => setPick((p) => ({ ...p, [c.category]: e.target.value }))}
                >
                  <option value="">{t("Add L2 use case…")}</option>
                  {l2s.data
                    ?.filter((x) => !ids(c.category).includes(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · {x.name}
                      </option>
                    ))}
                </select>
                <button type="submit" className="btn btn-sm" disabled={!pick[c.category]}>
                  {t("Add")}
                </button>
              </form>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
