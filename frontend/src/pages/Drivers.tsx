import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type BusinessDriver,
  type ComplianceDriver,
  type ComplianceSource,
  type DriverCoverage,
  type LinkedUseCase,
} from "../api";
import { useAuth } from "../auth";
import { ConfirmDeleteDialog, CoverageCell } from "../components/Drivers";
import { ErrorNote, Modal, useLoad } from "../components/ui";
import { pct } from "../lib/format";
import { t } from "../i18n";

type Deleting = { title: string; load: () => Promise<LinkedUseCase[]>; run: () => Promise<unknown> };

/** Linked L2 / L3 counts with a link to the filtered use case list. */
function LinkedCells({ d, filter }: { d?: DriverCoverage; filter: string }) {
  if (!d) return <td colSpan={3} />;
  return (
    <>
      <td className="num">
        {d.l2_count ? (
          <Link to={`/usecases?${filter}`} title={d.l2_codes.join(", ")}>
            {d.l2_count}
          </Link>
        ) : (
          <span className="muted">0</span>
        )}
      </td>
      <td className="num">{d.l3_count}</td>
      <td>
        <CoverageCell d={d} />
      </td>
    </>
  );
}

type DriverForm = { code: string; name: string; description: string };
type CdForm = { ref: string; name: string; description: string };

export default function Drivers() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const data = useLoad(async () => {
    const [drivers, compliance, coverage] = await Promise.all([
      api.drivers(),
      api.compliance(),
      api.driverCoverage(),
    ]);
    return {
      drivers,
      compliance,
      coverage,
      bdCov: new Map(coverage.business.map((d) => [d.id, d])),
      cdCov: new Map(coverage.compliance.map((d) => [d.id, d])),
      srcCov: new Map(coverage.sources.map((x) => [x.id, x])),
    };
  });
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bd, setBd] = useState<{ id?: number; form: DriverForm } | null>(null);
  const [cd, setCd] = useState<{ id?: number; sourceId: number; form: CdForm } | null>(null);
  const [source, setSource] = useState<{ id?: number; name: string } | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await data.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  async function saveBd(e: FormEvent) {
    e.preventDefault();
    if (!bd) return;
    const ok = await run(() => (bd.id ? api.updateDriver(bd.id, bd.form) : api.createDriver(bd.form)));
    if (ok) setBd(null);
  }
  async function saveCd(e: FormEvent) {
    e.preventDefault();
    if (!cd) return;
    const ok = await run(() =>
      cd.id ? api.updateComplianceDriver(cd.id, cd.form) : api.createComplianceDriver(cd.sourceId, cd.form),
    );
    if (ok) setCd(null);
  }

  async function saveSource(e: FormEvent) {
    e.preventDefault();
    if (!source) return;
    const ok = await run(() =>
      source.id ? api.renameSource(source.id, source.name) : api.createSource(source.name),
    );
    if (ok) setSource(null);
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{t("Business drivers")}</h1>
          <div className="subtitle">
            {t("Why the SOC monitors a threat: business and compliance drivers linked to L2 use cases.")}{" "}
            {data.data &&
              t("Coverage = average weight of the linked L2 use cases; L2 without scored rules count as 0. Below {p} is low.", {
                p: pct(data.data.coverage.low_threshold),
              })}
          </div>
        </div>
        {editor && (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setBd({ form: { code: "", name: "", description: "" } })}
            >
              {t("+ Business driver")}
            </button>
            <button type="button" className="btn" onClick={() => setSource({ name: "" })}>
              {t("+ Compliance source")}
            </button>
          </div>
        )}
      </header>
      <ErrorNote error={error ?? data.error} />

      <section className="card table-card" aria-labelledby="bdh">
        <h2 id="bdh" className="table-title">
          {t("Business drivers")}
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>ID</th>
              <th style={{ width: "22%" }}>{t("Name")}</th>
              <th>{t("Description")}</th>
              <th className="num">L2</th>
              <th className="num">L3</th>
              <th style={{ width: 200 }}>{t("Coverage")}</th>
              {editor && <th className="num">{t("Actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.data?.drivers.map((d: BusinessDriver) => (
              <tr key={d.id}>
                <td className="mono">{d.code}</td>
                <td className="strong-500">{d.name}</td>
                <td className="ink-2">{d.description || <span className="muted">–</span>}</td>
                <LinkedCells d={data.data?.bdCov.get(d.id)} filter={`bd=${encodeURIComponent(d.code)}&view=table`} />
                {editor && (
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setBd({ id: d.id, form: { code: d.code, name: d.name, description: d.description } })
                        }
                      >
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() =>
                          setDeleting({
                            title: t("Delete {code}?", { code: d.code }),
                            load: () => api.driverUseCases(d.id),
                            run: () => api.deleteDriver(d.id),
                          })
                        }
                      >
                        {t("Delete")}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="section-head">
        <h2>{t("Compliance drivers")}</h2>
      </div>
      {data.data && !data.data.compliance.length && (
        <p className="muted" style={{ margin: 0 }}>
          {t("No compliance source yet.")}
        </p>
      )}

      {data.data?.compliance.map((src: ComplianceSource) => (
        <section key={src.id} className="card table-card" aria-label={src.name}>
          <div className="table-title section-head">
            <h3>
              {src.name}
              {data.data?.srcCov.get(src.id) && (
                <span className="small muted" style={{ fontWeight: 400, marginLeft: 10 }}>
                  {t("{a} of {b} linked · {n} L2 · coverage {p}", {
                    a: data.data.srcCov.get(src.id)!.linked_drivers,
                    b: data.data.srcCov.get(src.id)!.drivers,
                    n: data.data.srcCov.get(src.id)!.l2_count,
                    p: pct(data.data.srcCov.get(src.id)!.coverage),
                  })}
                </span>
              )}
            </h3>
            {editor && (
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCd({ sourceId: src.id, form: { ref: "", name: "", description: "" } })}
                >
                  {t("+ Requirement")}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSource({ id: src.id, name: src.name })}
                >
                  {t("Rename")}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() =>
                    setDeleting({
                      title: t("Delete {name} and all its requirements?", { name: src.name }),
                      load: () => api.sourceUseCases(src.id),
                      run: () => api.deleteSource(src.id),
                    })
                  }
                >
                  {t("Delete source")}
                </button>
              </div>
            )}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t("Reference")}</th>
                <th style={{ width: "22%" }}>{t("Name")}</th>
                <th>{t("Description")}</th>
                <th className="num">L2</th>
                <th className="num">L3</th>
                <th style={{ width: 200 }}>{t("Coverage")}</th>
                {editor && <th className="num">{t("Actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {src.drivers.map((c: ComplianceDriver) => (
                <tr key={c.id}>
                  <td className="mono">{c.ref}</td>
                  <td className="strong-500">{c.name}</td>
                  <td className="ink-2">{c.description || <span className="muted">–</span>}</td>
                  <LinkedCells d={data.data?.cdCov.get(c.id)} filter={`cd=${c.id}&view=table`} />
                  {editor && (
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            setCd({
                              id: c.id,
                              sourceId: src.id,
                              form: { ref: c.ref, name: c.name, description: c.description },
                            })
                          }
                        >
                          {t("Edit")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() =>
                            setDeleting({
                              title: t("Delete {name}?", { name: `${src.name} ${c.ref}` }),
                              load: () => api.complianceDriverUseCases(c.id),
                              run: () => api.deleteComplianceDriver(c.id),
                            })
                          }
                        >
                          {t("Delete")}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!src.drivers.length && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t("No requirements yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ))}

      {deleting && (
        <ConfirmDeleteDialog
          title={deleting.title}
          load={deleting.load}
          onConfirm={async () => {
            await deleting.run();
            await data.reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}

      {bd && (
        <Modal
          title={bd.id ? t("Edit {code}", { code: bd.form.code }) : t("New business driver")}
          open
          onClose={() => setBd(null)}
        >
          <form className="stack" onSubmit={saveBd}>
            <ErrorNote error={error} />
            <div className="form-grid">
              <label className="field">
                {t("ID")}
                <input
                  className="input mono"
                  required
                  value={bd.form.code}
                  placeholder="BD-07"
                  onChange={(e) => setBd({ ...bd, form: { ...bd.form, code: e.target.value } })}
                />
              </label>
              <label className="field">
                {t("Name")}
                <input
                  className="input"
                  required
                  value={bd.form.name}
                  onChange={(e) => setBd({ ...bd, form: { ...bd.form, name: e.target.value } })}
                />
              </label>
            </div>
            <label className="field">
              {t("Description")}
              <textarea
                className="input textarea"
                rows={3}
                value={bd.form.description}
                onChange={(e) => setBd({ ...bd, form: { ...bd.form, description: e.target.value } })}
              />
            </label>
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setBd(null)}>
                {t("Cancel")}
              </button>
              <button type="submit" className="btn btn-primary">
                {t("Save")}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {source && (
        <Modal
          title={source.id ? t("Rename compliance source") : t("New compliance source")}
          open
          onClose={() => setSource(null)}
        >
          <form className="stack" onSubmit={saveSource}>
            <ErrorNote error={error} />
            <label className="field">
              {t("Name")}
              <input
                className="input"
                required
                autoFocus
                value={source.name}
                placeholder={t("e.g. ISO 27001")}
                onChange={(e) => setSource({ ...source, name: e.target.value })}
              />
            </label>
            {source.id && (
              <p className="small muted" style={{ margin: 0 }}>
                {t("Requirements and their links to use cases stay as they are.")}
              </p>
            )}
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setSource(null)}>
                {t("Cancel")}
              </button>
              <button type="submit" className="btn btn-primary">
                {t("Save")}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {cd && (
        <Modal
          title={cd.id ? t("Edit {code}", { code: cd.form.ref }) : t("New compliance requirement")}
          open
          onClose={() => setCd(null)}
        >
          <form className="stack" onSubmit={saveCd}>
            <ErrorNote error={error} />
            <div className="form-grid">
              <label className="field">
                {t("Reference")}
                <input
                  className="input mono"
                  required
                  value={cd.form.ref}
                  placeholder="DORA-10"
                  onChange={(e) => setCd({ ...cd, form: { ...cd.form, ref: e.target.value } })}
                />
              </label>
              <label className="field">
                {t("Name")}
                <input
                  className="input"
                  value={cd.form.name}
                  onChange={(e) => setCd({ ...cd, form: { ...cd.form, name: e.target.value } })}
                />
              </label>
            </div>
            <label className="field">
              {t("Description")}
              <textarea
                className="input textarea"
                rows={3}
                value={cd.form.description}
                onChange={(e) => setCd({ ...cd, form: { ...cd.form, description: e.target.value } })}
              />
            </label>
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setCd(null)}>
                {t("Cancel")}
              </button>
              <button type="submit" className="btn btn-primary">
                {t("Save")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
