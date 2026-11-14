import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type ConfigCommit, type L1, type L2, type L3, type Scores } from "../api";
import { useAuth } from "../auth";
import ConfigPanel from "../components/ConfigPanel";
import LifecyclePanel from "../components/LifecyclePanel";
import { Chips, ErrorNote, GapBadge, Modal, MultiSelect, StatusPill, useLoad } from "../components/ui";
import { fmtDate, num, pct, STATUS_LABEL } from "../lib/format";
import { t } from "../i18n";

interface Catalogue {
  l1s: L1[];
  l2s: L2[];
  scores: Scores;
}

export default function UseCases() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | "editL2" | "newL2" | "newL3" | "verifyL2">(null);

  const cat = useLoad<Catalogue>(async () => {
    const [l1s, l2s, scores] = await Promise.all([api.l1s(), api.l2s(), api.scores()]);
    return { l1s, l2s, scores };
  });

  const l2Score = useMemo(() => new Map(cat.data?.scores.l2.map((s) => [s.code, s]) ?? []), [cat.data]);

  const selectedCode = useMemo(() => {
    const d = cat.data;
    if (!d) return null;
    const p = params.get("l2");
    if (p && d.l2s.some((x) => x.code === p)) return p;
    const l1 = params.get("l1");
    return d.l2s.find((x) => !l1 || x.l1_code === l1)?.code ?? null;
  }, [cat.data, params]);
  const selected = cat.data?.l2s.find((x) => x.code === selectedCode) ?? null;
  const rules = useLoad<L3[]>(
    () => (selectedCode ? api.l3s({ l2: selectedCode }) : Promise.resolve([])),
    [selectedCode],
  );
  const heads = useLoad(
    () => (selectedCode ? api.configHeads("l3", selectedCode + "-") : Promise.resolve({})),
    [selectedCode],
  );

  const q = query.trim().toLowerCase();
  const matches = (l2: L2) => !q || l2.code.toLowerCase().includes(q) || l2.name.toLowerCase().includes(q);

  const refresh = () => {
    void cat.reload();
    void rules.reload();
  };

  const total = cat.data
    ? `${cat.data.l1s.length} L1 · ${cat.data.l2s.length} L2 · ${cat.data.l1s.reduce((a, x) => a + x.l3_count, 0)} ${t("L3 rules")}`
    : "…";

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Use cases")}</h1>
          <div className="subtitle">{total}</div>
        </div>
        {editor && (
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => setDialog("newL2")}>
              {t("+ L2 use case")}
            </button>
            <button type="button" className="btn btn-primary" disabled={!selected} onClick={() => setDialog("newL3")}>
              {t("+ L3 rule")}
            </button>
          </div>
        )}
      </header>

      <ErrorNote error={cat.error} />

      <div className="split">
        <section className="card tree" aria-label={t("Use case tree")}>
          <label className="sr-only" htmlFor="uc-search">
            {t("Search use cases")}
          </label>
          <input
            id="uc-search"
            className="input input-sm"
            placeholder={t("Search ID or name")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {cat.data?.l1s.map((l1) => {
            const children = cat.data!.l2s.filter((x) => x.l1_code === l1.code && matches(x));
            if (q && !children.length) return null;
            const open = q || !collapsed.has(l1.code);
            return (
              <div key={l1.code} className="tree-group">
                <button
                  type="button"
                  className="tree-l1"
                  aria-expanded={!!open}
                  onClick={() =>
                    setCollapsed((c) => {
                      const n = new Set(c);
                      if (n.has(l1.code)) n.delete(l1.code);
                      else n.add(l1.code);
                      return n;
                    })
                  }
                >
                  <span className="caret" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="code-tag">{l1.code}</span>
                  <span className="grow">{l1.name}</span>
                  <span className="small muted">{l1.applicable ? l1.l2_count : "n/a"}</span>
                </button>
                {open &&
                  children.map((l2) => {
                    const sc = l2Score.get(l2.code);
                    const gap = !sc || sc.scored_rules === 0;
                    return (
                      <button
                        type="button"
                        key={l2.code}
                        className={"tree-l2" + (l2.code === selectedCode ? " active" : "")}
                        aria-current={l2.code === selectedCode ? "true" : undefined}
                        onClick={() => setParams({ l2: l2.code })}
                      >
                        <span className="mono small muted tree-code">{l2.code}</span>
                        <span className="grow">{l2.name}</span>
                        <span className={gap ? "count-gap" : "count"} title={gap ? t("Detection gap") : t("Rules")}>
                          {l2.l3_count}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </section>

        <section className="split-wide stack-lg" aria-labelledby="l2title">
          {selected && (
            <L2Header
              l2={selected}
              score={l2Score.get(selected.code)}
              editor={editor}
              onEdit={() => setDialog("editL2")}
              onVerify={() => setDialog("verifyL2")}
            />
          )}
          <ErrorNote error={rules.error} />
          {selected && rules.data && rules.data.length > 0 && <RuleTable rules={rules.data} heads={heads.data ?? {}} />}
          {selected && rules.data && rules.data.length === 0 && (
            <div className="empty">
              <GapBadge />
              <h3>{t("No L3 rules yet")}</h3>
              <p>
                {t(
                  "This L2 use case is not scored and counts against framework completeness until at least one operational rule with all three metrics exists.",
                )}
              </p>
              {editor && (
                <button type="button" className="btn btn-primary" onClick={() => setDialog("newL3")}>
                  {t("+ Add first rule")}
                </button>
              )}
            </div>
          )}
          {selected && (
            <div className="two-col">
              <LifecyclePanel key={selected.code} level="l2" code={selected.code} onChanged={refresh} />
              <ConfigPanel key={"cfg" + selected.code} level="l2" code={selected.code} editor={editor} />
            </div>
          )}
        </section>
      </div>

      {selected && dialog === "editL2" && (
        <EditL2Dialog l2={selected} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
      {selected && dialog === "verifyL2" && (
        <VerifyDialog level="l2" code={selected.code} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
      {dialog === "newL2" && cat.data && (
        <NewL2Dialog
          l1s={cat.data.l1s}
          defaultL1={selected?.l1_code}
          onClose={() => setDialog(null)}
          onCreated={(code) => {
            setDialog(null);
            void cat.reload();
            setParams({ l2: code });
          }}
        />
      )}
      {dialog === "newL3" && selected && (
        <NewL3Dialog
          l2={selected}
          onClose={() => setDialog(null)}
          onCreated={(code) => navigate(`/usecases/l3/${code}`)}
        />
      )}
    </>
  );
}

function L2Header({
  l2,
  score,
  editor,
  onEdit,
  onVerify,
}: {
  l2: L2;
  score?: Scores["l2"][number];
  editor: boolean;
  onEdit: () => void;
  onVerify: () => void;
}) {
  const stats = [
    { label: t("Status"), value: STATUS_LABEL[l2.lifecycle_status] },
    { label: t("Rules (scored)"), value: `${score?.rules ?? l2.l3_count} (${score?.scored_rules ?? 0})` },
    { label: t("Weight"), value: num(score?.weight ?? null) },
    { label: t("Potential"), value: num(score?.potential ?? null) },
    { label: t("Onboarded"), value: fmtDate(l2.onboarded_at) },
    { label: t("Last verified"), value: fmtDate(l2.last_verified_at) },
  ];
  return (
    <div className="card l2-head">
      <div className="l2-head-main">
        <span className="mono small muted">
          {l2.code} · L1 {l2.l1_code}
        </span>
        <h2 id="l2title" className="h-lg">
          {l2.name}
        </h2>
        {l2.description && <p className="lead">{l2.description}</p>}
        <div className="chips">
          {l2.actors.map((a) => (
            <span key={a} className="chip chip-neutral">
              {a}
            </span>
          ))}
          {l2.business_drivers.map((b) => (
            <span key={b} className="chip chip-neutral">
              {b}
            </span>
          ))}
          {l2.risk_level && (
            <span className="chip chip-neutral">
              {t("Risk")} {l2.risk_level}/5
            </span>
          )}
          {l2.target_implementation !== null && (
            <span className="chip chip-neutral">
              {t("Target impl.")} {pct(l2.target_implementation)}
            </span>
          )}
        </div>
        {editor && (
          <div className="row-actions start">
            <button type="button" className="btn btn-sm" onClick={onEdit}>
              {t("Edit use case")}
            </button>
            <button type="button" className="btn btn-sm" onClick={onVerify}>
              {t("Verify now")}
            </button>
          </div>
        )}
      </div>
      <dl className="mini-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RuleTable({ rules, heads }: { rules: L3[]; heads: Record<string, ConfigCommit> }) {
  return (
    <div className="card table-card">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Rule")}</th>
            <th>{t("Status")}</th>
            <th className="num">{t("Eff")}</th>
            <th className="num">{t("Impl")}</th>
            <th className="num">{t("Cov")}</th>
            <th className="num">{t("Weight")}</th>
            <th>{t("Data sources")}</th>
            <th>{t("Last verified")}</th>
            <th>{t("Config")}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.code}>
              <td>
                <Link to={`/usecases/l3/${r.code}`} className="rule-link">
                  <span className="mono small muted">
                    {r.code}
                    {r.attack_techniques.length > 0 && ` · ${r.attack_techniques.join(", ")}`}
                  </span>
                  <span className="strong-500">{r.name}</span>
                </Link>
              </td>
              <td>
                <StatusPill status={r.lifecycle_status} />
              </td>
              <td className="num">{pct(r.effectiveness)}</td>
              <td className="num">{pct(r.implementation)}</td>
              <td className="num">{pct(r.coverage)}</td>
              <td className="num strong">
                {r.assessed ? num(r.weight) : <span className="muted">{t("not assessed")}</span>}
              </td>
              <td>
                <Chips items={r.log_sources} />
              </td>
              <td>
                <VerifiedCell rule={r} />
              </td>
              <td className="mono small">
                {heads[r.code] ? (
                  <span title={heads[r.code].message}>
                    r{heads[r.code].rev}
                    {heads[r.code].tags.length > 0 && (
                      <span className="muted"> · {heads[r.code].tags[heads[r.code].tags.length - 1].name}</span>
                    )}
                  </span>
                ) : (
                  <span className="muted">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VerifiedCell({ rule }: { rule: L3 }) {
  const scoredState = rule.lifecycle_status === "operational" || rule.lifecycle_status === "maintenance";
  if (!rule.last_verified_at)
    return scoredState ? <span className="badge-gap">{t("Never")}</span> : <span className="muted">–</span>;
  return (
    <span
      className={rule.verification_overdue ? "badge-gap" : ""}
      title={t("Due {date}", { date: fmtDate(rule.verification_due) })}
    >
      {fmtDate(rule.last_verified_at)}
      {rule.verification_overdue && t(" · overdue")}
    </span>
  );
}

// ------------------------------------------------------------------ dialogs

function EditL2Dialog({ l2, onClose, onSaved }: { l2: L2; onClose: () => void; onSaved: () => void }) {
  const lists = useLoad(async () => {
    const [actors, drivers, compliance] = await Promise.all([
      api.refs("threat_actor"),
      api.drivers(),
      api.compliance(),
    ]);
    return { actors, drivers, compliance };
  });
  const [form, setForm] = useState({
    name: l2.name,
    description: l2.description,
    risk_level: l2.risk_level?.toString() ?? "",
    target_implementation: l2.target_implementation === null ? "" : Math.round(l2.target_implementation * 100) + "",
    onboarded_at: l2.onboarded_at ?? "",
    actors: l2.actors,
    business_drivers: l2.business_drivers,
    compliance_driver_ids: l2.compliance_driver_ids.map(String),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateL2(l2.code, {
        name: form.name,
        description: form.description,
        risk_level: form.risk_level ? Number(form.risk_level) : null,
        target_implementation: form.target_implementation === "" ? null : Number(form.target_implementation) / 100,
        onboarded_at: form.onboarded_at || null,
        actors: form.actors,
        business_drivers: form.business_drivers,
        compliance_driver_ids: form.compliance_driver_ids.map(Number),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const d = lists.data;
  return (
    <Modal title={t("Edit {code}", { code: l2.code })} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error ?? lists.error} />
        <label className="field">
          {t("Name")}
          <input className="input" required value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          {t("Description")}
          <textarea
            className="input textarea"
            rows={3}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            {t("Risk level (1–5)")}
            <select className="input" value={form.risk_level} onChange={(e) => set({ risk_level: e.target.value })}>
              <option value="">{t("Not set")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("Target implementation (%)")}
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={form.target_implementation}
              onChange={(e) => set({ target_implementation: e.target.value })}
            />
          </label>
          <label className="field">
            {t("Onboarded on")}
            <input
              className="input"
              type="date"
              value={form.onboarded_at}
              onChange={(e) => set({ onboarded_at: e.target.value })}
            />
          </label>
        </div>
        {d && (
          <div className="form-grid">
            <MultiSelect
              label={t("Threat actors")}
              options={d.actors.map((a) => ({ value: a.name, label: a.name }))}
              value={form.actors}
              onChange={(v) => set({ actors: v })}
            />
            <MultiSelect
              label={t("Business drivers")}
              options={d.drivers.map((b) => ({ value: b.code, label: `${b.code} ${b.name}` }))}
              value={form.business_drivers}
              onChange={(v) => set({ business_drivers: v })}
            />
            <MultiSelect
              label={t("Compliance drivers")}
              options={d.compliance.flatMap((s) =>
                s.drivers.map((c) => ({ value: String(c.id), label: `${c.ref} ${c.name}` })),
              )}
              value={form.compliance_driver_ids}
              onChange={(v) => set({ compliance_driver_ids: v })}
            />
          </div>
        )}
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("Save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function VerifyDialog({
  level,
  code,
  onClose,
  onSaved,
}: {
  level: "l2" | "l3";
  code: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [result, setResult] = useState<"ok" | "issues">("ok");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.verify(level, code, { result, note, ...(when ? { verified_at: when } : {}) });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Verify {code}", { code })} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small" style={{ margin: 0 }}>
          {t("Record that the detection was tested, for example with a purple team exercise or replayed logs.")}
        </p>
        <ErrorNote error={error} />
        <fieldset className="radio-row">
          <legend>{t("Result")}</legend>
          <label>
            <input type="radio" checked={result === "ok"} onChange={() => setResult("ok")} /> {t("Works as expected")}
          </label>
          <label>
            <input type="radio" checked={result === "issues"} onChange={() => setResult("issues")} />{" "}
            {t("Issues found")}
          </label>
        </fieldset>
        <label className="field">
          {t("Note")}
          <textarea className="input textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field">
          {t("Date (leave empty for today)")}
          <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("Save verification")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewL2Dialog({
  l1s,
  defaultL1,
  onClose,
  onCreated,
}: {
  l1s: L1[];
  defaultL1?: string;
  onClose: () => void;
  onCreated: (code: string) => void;
}) {
  const [l1, setL1] = useState(defaultL1 ?? l1s[0]?.code ?? "");
  const [suffix, setSuffix] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const code = `${l1}-${suffix.toUpperCase()}`;
      await api.createL2({ code, name });
      onCreated(code);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={t("New L2 use case")} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="form-grid">
          <label className="field">
            {t("L1 use case")}
            <select className="input" value={l1} onChange={(e) => setL1(e.target.value)}>
              {l1s.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("ID suffix (3 letters or digits)")}
            <input
              className="input mono"
              required
              pattern="[A-Za-z0-9]{3}"
              maxLength={3}
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder={t("e.g. LAT")}
            />
          </label>
        </div>
        <label className="field">
          {t("Name")}
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary">
            {t("Create")} {l1}-{suffix.toUpperCase() || "___"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewL3Dialog({ l2, onClose, onCreated }: { l2: L2; onClose: () => void; onCreated: (code: string) => void }) {
  const next = useLoad(() => api.nextL3Code(l2.code), [l2.code]);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const value = code ?? next.data?.code ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createL3({ code: value, name, lifecycle_status: "onboarding" });
      onCreated(value);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={t("New rule in {code}", { code: l2.code })} open onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error ?? next.error} />
        <label className="field">
          {t("Rule ID")}
          <input className="input mono" required value={value} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="field">
          {t("Name")}
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("e.g. Detect credential dumping attempt")}
          />
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          {t("The rule starts in onboarding. Set metrics, data sources and status on the next page.")}
        </p>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value}>
            {t("Create rule")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
