import { useState, type FormEvent } from "react";
import { api, type BusinessDriver, type ComplianceDriver, type ComplianceSource } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Modal, useLoad } from "../components/ui";

type DriverForm = { code: string; name: string; description: string };
type CdForm = { ref: string; name: string; description: string };

export default function Drivers() {
  const { can } = useAuth();
  const editor = can("admin", "analyst");
  const data = useLoad(async () => {
    const [drivers, compliance] = await Promise.all([api.drivers(), api.compliance()]);
    return { drivers, compliance };
  });
  const [error, setError] = useState<string | null>(null);
  const [bd, setBd] = useState<{ id?: number; form: DriverForm } | null>(null);
  const [cd, setCd] = useState<{ id?: number; sourceId: number; form: CdForm } | null>(null);
  const [newSource, setNewSource] = useState("");

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

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Business drivers</h1>
          <div className="subtitle">Why the SOC monitors a threat: business and compliance drivers linked to L2 use cases.</div>
        </div>
        {editor && (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setBd({ form: { code: "", name: "", description: "" } })}
            >
              + Business driver
            </button>
          </div>
        )}
      </header>
      <ErrorNote error={error ?? data.error} />

      <section className="card table-card" aria-labelledby="bdh">
        <h2 id="bdh" className="table-title">
          Business drivers
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>ID</th>
              <th style={{ width: "28%" }}>Name</th>
              <th>Description</th>
              {editor && <th className="num">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.data?.drivers.map((d: BusinessDriver) => (
              <tr key={d.id}>
                <td className="mono">{d.code}</td>
                <td className="strong-500">{d.name}</td>
                <td className="ink-2">{d.description || <span className="muted">–</span>}</td>
                {editor && (
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setBd({ id: d.id, form: { code: d.code, name: d.name, description: d.description } })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          if (window.confirm(`Delete ${d.code}? It is unlinked from every use case.`))
                            void run(() => api.deleteDriver(d.id));
                        }}
                      >
                        Delete
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
        <h2>Compliance drivers</h2>
        {editor && (
          <form
            className="inline-form-plain"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.createSource(newSource))) setNewSource("");
            }}
          >
            <label className="sr-only" htmlFor="new-source">
              New compliance source
            </label>
            <input
              id="new-source"
              className="input input-sm"
              placeholder="New source, e.g. ISO 27001"
              required
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
            />
            <button type="submit" className="btn btn-sm">
              Add source
            </button>
          </form>
        )}
      </div>

      {data.data?.compliance.map((src: ComplianceSource) => (
        <section key={src.id} className="card table-card" aria-label={src.name}>
          <div className="table-title section-head">
            <h3>{src.name}</h3>
            {editor && (
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCd({ sourceId: src.id, form: { ref: "", name: "", description: "" } })}
                >
                  + Requirement
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    if (window.confirm(`Delete ${src.name} and all its requirements?`))
                      void run(() => api.deleteSource(src.id));
                  }}
                >
                  Delete source
                </button>
              </div>
            )}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Reference</th>
                <th style={{ width: "28%" }}>Name</th>
                <th>Description</th>
                {editor && <th className="num">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {src.drivers.map((c: ComplianceDriver) => (
                <tr key={c.id}>
                  <td className="mono">{c.ref}</td>
                  <td className="strong-500">{c.name}</td>
                  <td className="ink-2">{c.description || <span className="muted">–</span>}</td>
                  {editor && (
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            setCd({ id: c.id, sourceId: src.id, form: { ref: c.ref, name: c.name, description: c.description } })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete ${c.ref}?`)) void run(() => api.deleteComplianceDriver(c.id));
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!src.drivers.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No requirements yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ))}

      {bd && (
        <Modal title={bd.id ? `Edit ${bd.form.code}` : "New business driver"} open onClose={() => setBd(null)}>
          <form className="stack" onSubmit={saveBd}>
            <ErrorNote error={error} />
            <div className="form-grid">
              <label className="field">
                ID
                <input
                  className="input mono"
                  required
                  value={bd.form.code}
                  placeholder="BD-07"
                  onChange={(e) => setBd({ ...bd, form: { ...bd.form, code: e.target.value } })}
                />
              </label>
              <label className="field">
                Name
                <input
                  className="input"
                  required
                  value={bd.form.name}
                  onChange={(e) => setBd({ ...bd, form: { ...bd.form, name: e.target.value } })}
                />
              </label>
            </div>
            <label className="field">
              Description
              <textarea
                className="input textarea"
                rows={3}
                value={bd.form.description}
                onChange={(e) => setBd({ ...bd, form: { ...bd.form, description: e.target.value } })}
              />
            </label>
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setBd(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {cd && (
        <Modal title={cd.id ? `Edit ${cd.form.ref}` : "New compliance requirement"} open onClose={() => setCd(null)}>
          <form className="stack" onSubmit={saveCd}>
            <ErrorNote error={error} />
            <div className="form-grid">
              <label className="field">
                Reference
                <input
                  className="input mono"
                  required
                  value={cd.form.ref}
                  placeholder="DORA-10"
                  onChange={(e) => setCd({ ...cd, form: { ...cd.form, ref: e.target.value } })}
                />
              </label>
              <label className="field">
                Name
                <input
                  className="input"
                  value={cd.form.name}
                  onChange={(e) => setCd({ ...cd, form: { ...cd.form, name: e.target.value } })}
                />
              </label>
            </div>
            <label className="field">
              Description
              <textarea
                className="input textarea"
                rows={3}
                value={cd.form.description}
                onChange={(e) => setCd({ ...cd, form: { ...cd.form, description: e.target.value } })}
              />
            </label>
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setCd(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
