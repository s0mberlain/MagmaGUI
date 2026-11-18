import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Campaign, type CampaignIn, type RedTeamAccount, type TestOutcome } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Modal, useLoad } from "../components/ui";
import { fmtDate } from "../lib/format";
import { CAMPAIGN_STATUS_LABEL, campaignClass, fmtTtd, OUTCOME_LABEL, OUTCOMES } from "../lib/purple";
import { t } from "../i18n";

/** Stacked bar of the outcomes of a campaign's tests. */
export function OutcomeBar({ counts, total }: { counts: Record<TestOutcome, number>; total: number }) {
  if (!total) return <span className="muted">–</span>;
  const label = OUTCOMES.filter((o) => counts[o])
    .map((o) => `${OUTCOME_LABEL[o]}: ${counts[o]}`)
    .join(", ");
  return (
    <div className="stack-xs" title={label}>
      <div className="outcome-bar" role="img" aria-label={label || t("No outcomes yet")}>
        {OUTCOMES.map((o) =>
          counts[o] ? <span key={o} className={`o-${o}`} style={{ width: `${(counts[o] / total) * 100}%` }} /> : null,
        )}
      </div>
      <span className="small muted">
        {OUTCOMES.map((o) => counts[o]).join(" / ")} · {t("Blocked / Alerted / Logged / Not detected")}
      </span>
    </div>
  );
}

export default function Campaigns() {
  const { can, user } = useAuth();
  const editor = can("admin", "analyst");
  const red = user?.role === "red_team";
  const list = useLoad(() => api.campaigns());
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Campaigns")}</h1>
          <div className="subtitle">
            {red
              ? t("Purple team campaigns you are assigned to. Record when and how you ran each test.")
              : t(
                  "Purple team campaigns: test cases per ATT&CK technique, linked to the rules that should detect them. Each outcome is recorded as a verification of the linked rules.",
                )}
          </div>
        </div>
        {editor && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {t("New campaign")}
          </button>
        )}
      </header>

      <ErrorNote error={list.error} />
      {list.data && !list.data.length && (
        <div className="empty">
          <h3>{t("No campaigns yet")}</h3>
          <p>
            {red
              ? t("You are not assigned to a campaign.")
              : t("Create a campaign, pick use cases and Magma proposes one test per ATT&CK technique of their rules.")}
          </p>
        </div>
      )}
      {!!list.data?.length && (
        <section className="card table-card" aria-label={t("Campaigns")}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("Campaign")}</th>
                <th>{t("Status")}</th>
                <th>{t("Planned")}</th>
                <th className="num">{t("Tests")}</th>
                <th>{t("Executed")}</th>
                {!red && <th>{t("Outcomes")}</th>}
                {!red && <th className="num">{t("Median TTD")}</th>}
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/campaigns/${c.id}`} className="strong-500">
                      {c.name}
                    </Link>
                    {c.white_box && <span className="chip chip-info" style={{ marginLeft: 8 }}>{t("White box")}</span>}
                    {c.red_team.length > 0 && (
                      <div className="small muted">
                        {t("Red team")}: {c.red_team.map((u) => u.display_name || u.username).join(", ")}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={campaignClass(c.status)}>{CAMPAIGN_STATUS_LABEL[c.status]}</span>
                  </td>
                  <td>
                    {fmtDate(c.planned_start)} – {fmtDate(c.planned_end)}
                  </td>
                  <td className="num">{c.test_count}</td>
                  <td>
                    {c.test_count ? `${c.exec_counts.executed + c.exec_counts.not_executed} / ${c.test_count}` : "–"}
                  </td>
                  {!red && (
                    <td>{c.outcome_counts ? <OutcomeBar counts={c.outcome_counts} total={c.test_count} /> : "–"}</td>
                  )}
                  {!red && <td className="num">{fmtTtd(c.median_ttd_seconds)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {creating && (
        <CampaignDialog
          onClose={() => setCreating(false)}
          onSaved={(c) => navigate(`/campaigns/${c.id}`, { state: { warnings: c.warnings } })}
        />
      )}
    </>
  );
}

/** Create or edit a campaign: name, dates, white box and the assigned red team accounts. */
export function CampaignDialog({
  campaign,
  onClose,
  onSaved,
}: {
  campaign?: Campaign;
  onClose: () => void;
  onSaved: (c: Campaign) => void;
}) {
  const accounts = useLoad<RedTeamAccount[]>(() => api.redTeamAccounts());
  const [form, setForm] = useState<CampaignIn>({
    name: campaign?.name ?? "",
    description: campaign?.description ?? "",
    planned_start: campaign?.planned_start ?? "",
    planned_end: campaign?.planned_end ?? "",
    white_box: campaign?.white_box ?? false,
    red_team_ids: campaign?.red_team.map((u) => u.id) ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CampaignIn>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.planned_end < form.planned_start) {
      setError(t("The planned end cannot be before the planned start"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = campaign ? await api.updateCampaign(campaign.id, form) : await api.createCampaign(form);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) =>
    set({
      red_team_ids: form.red_team_ids.includes(id)
        ? form.red_team_ids.filter((x) => x !== id)
        : [...form.red_team_ids, id],
    });

  return (
    <Modal title={campaign ? t("Edit campaign") : t("New campaign")} open onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorNote error={error} />
        <label className="field">
          {t("Name")}
          <input
            className="input"
            required
            maxLength={255}
            autoFocus
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="field">
          {t("Description")}
          <textarea
            className="input textarea"
            rows={3}
            maxLength={10000}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        <div className="form-grid two">
          <label className="field">
            {t("Planned start")}
            <input
              className="input"
              type="date"
              required
              value={form.planned_start}
              onChange={(e) => set({ planned_start: e.target.value })}
            />
          </label>
          <label className="field">
            {t("Planned end")}
            <input
              className="input"
              type="date"
              required
              min={form.planned_start || undefined}
              value={form.planned_end}
              onChange={(e) => set({ planned_end: e.target.value })}
            />
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={form.white_box} onChange={(e) => set({ white_box: e.target.checked })} />
          <span>
            <strong>{t("White box")}</strong>
            <br />
            <span className="muted">
              {t(
                "The red team may read the full definition and current configuration of the linked rules. Outcomes stay hidden from it until the campaign is closed.",
              )}
            </span>
          </span>
        </label>
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field" style={{ marginBottom: 6 }}>
            {t("Red team accounts")}
          </legend>
          <ErrorNote error={accounts.error} />
          {accounts.data && !accounts.data.length && (
            <p className="small muted" style={{ margin: 0 }}>
              {t("No red team accounts yet. An admin creates them under Users with the role Red team.")}
            </p>
          )}
          {accounts.data?.map((a) => (
            <label key={a.id} className="check-row">
              <input type="checkbox" checked={form.red_team_ids.includes(a.id)} onChange={() => toggle(a.id)} />
              <span>
                {a.display_name || a.username} <span className="muted mono small">{a.username}</span>
                {!a.active && <span className="pill pill-warn" style={{ marginLeft: 6 }}>{t("Disabled")}</span>}
              </span>
            </label>
          ))}
          <p className="small muted" style={{ margin: 0 }}>
            {t("Assigned accounts can sign in until the latest planned end of their campaigns + 7 days, unless an admin set another date.")}
          </p>
        </fieldset>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("Saving…") : campaign ? t("Save") : t("Create campaign")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
