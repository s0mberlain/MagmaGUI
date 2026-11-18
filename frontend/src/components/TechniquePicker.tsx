import { useId, useState } from "react";
import { t } from "../i18n";

/** Pick MITRE ATT&CK techniques by id or name (custom threats #60, purple team test cases). */
export default function TechniquePicker({
  value,
  names,
  techniques,
  disabled,
  invalid,
  onChange,
  label = t("MITRE ATT&CK techniques"),
  required = true,
}: {
  value: string[];
  names: Map<string, string>;
  techniques: { id: string; name: string }[];
  disabled?: boolean;
  invalid?: boolean;
  onChange: (v: string[]) => void;
  label?: string;
  required?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listId = "attack-techniques-" + useId().replace(/:/g, "");
  function addDraft(raw = draft) {
    // accepts "T1110.003" or the datalist text "T1110.003 Password Spraying"
    const id = raw.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
    if (!id) return;
    if (names.size && !names.has(id)) {
      setError(t("Unknown ATT&CK technique {id}", { id }));
      return;
    }
    setError(null);
    if (!value.includes(id)) onChange([...value, id]);
    setDraft("");
  }
  return (
    <div className="field grow-2">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {value.length > 0 && (
        <span className="chips">
          {value.map((id) => (
            <span key={id} className="chip chip-info" title={names.get(id) ?? id}>
              <span className="mono">{id}</span> {names.get(id) ?? ""}
              {!disabled && (
                <button
                  type="button"
                  className="chip-x"
                  aria-label={t("Remove {code}", { code: id })}
                  onClick={() => onChange(value.filter((x) => x !== id))}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </span>
      )}
      {!disabled && (
        <div className="ttp-add">
          <input
            className={"input" + (invalid || error ? " is-invalid" : "")}
            list={listId}
            value={draft}
            placeholder={t("Search, e.g. T1110 or Brute Force")}
            onChange={(e) => {
              const v = e.target.value;
              // picking an entry of the list adds it right away
              const id = v.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
              if (v.includes(" ") && names.has(id) && v.trim() === `${id} ${names.get(id)}`) addDraft(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft();
              }
            }}
          />
          <button type="button" className="btn btn-sm" disabled={!draft.trim()} onClick={() => addDraft()}>
            {t("Add")}
          </button>
          <datalist id={listId}>
            {techniques.map((x) => (
              <option key={x.id} value={`${x.id} ${x.name}`} />
            ))}
          </datalist>
        </div>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
