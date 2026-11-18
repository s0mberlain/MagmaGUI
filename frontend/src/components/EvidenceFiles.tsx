import { useState, type DragEvent, type ReactNode } from "react";
import { fmtSize, fmtTime } from "../lib/format";
import { confirmDialog, ErrorNote, Modal } from "./ui";
import { t } from "../i18n";

/** What the evidence card needs to know about a file. */
export interface EvidenceItem {
  id: number;
  filename: string;
  size: number;
  uploaded_by: string;
  uploaded_at: string;
  viewable: boolean;
  content_type: string;
}

const MAX = 20 * 1024 * 1024;

/**
 * Evidence files with upload (button or drag and drop), view (PDF, images), download and remove.
 * Used by business owner interviews (#34, #55) and purple team test cases.
 */
export default function EvidenceFiles<T extends EvidenceItem>({
  title,
  headingId,
  files,
  editable,
  accept,
  hint,
  upload,
  remove,
  url,
  onChange,
  label,
  removeQuestion,
  extra,
}: {
  title: string;
  headingId: string;
  files: T[];
  editable: boolean;
  accept: string;
  hint: string;
  upload: (file: File) => Promise<T>;
  remove: (file: T) => Promise<void>;
  url: (file: T, download?: boolean) => string;
  onChange: (list: T[]) => void;
  /** a chip after the file name, e.g. the kind of file */
  label?: (file: T) => ReactNode;
  removeQuestion: (file: T) => string;
  /** extra content under the heading */
  extra?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<T | null>(null);
  const [dragging, setDragging] = useState(false);

  // files can also be dropped on the card (#55)
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const dropProps = editable
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = busy ? "none" : "copy";
          setDragging(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(false);
          if (!busy) void doUpload(e.dataTransfer.files);
        },
      }
    : {};

  async function doUpload(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setBusy(true);
    let current = files;
    const failed: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX) {
        failed.push(t("{file}: the file is larger than 20 MB", { file: f.name }));
        continue;
      }
      try {
        current = [...current, await upload(f)];
        onChange(current);
      } catch (e) {
        failed.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (failed.length) setError(failed.join(" · "));
  }

  async function doRemove(a: T) {
    const ok = await confirmDialog(removeQuestion(a), { danger: true, confirmLabel: t("Remove") });
    if (!ok) return;
    try {
      await remove(a);
      onChange(files.filter((x) => x.id !== a.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const isImage = (a: T) => a.content_type.startsWith("image/");

  return (
    <section
      className={"card stack-sm" + (dragging ? " evidence-dragging" : "")}
      aria-labelledby={headingId}
      {...dropProps}
    >
      <div className="section-head">
        <h2 id={headingId} className="h-sm">
          {title} <span className="count">{files.length}</span>
        </h2>
        {editable && (
          <label className={"btn btn-sm" + (busy ? " disabled" : "")}>
            {busy ? t("Uploading…") : t("+ Add files")}
            <input
              type="file"
              multiple
              accept={accept}
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                void doUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {hint}
      </p>
      {extra}
      {editable && (
        <div className={"evidence-drop" + (dragging ? " is-over" : "")} aria-hidden="true">
          {busy ? t("Uploading…") : dragging ? t("Drop to upload") : t("Drag and drop files here, or use + Add files")}
        </div>
      )}
      <ErrorNote error={error} />
      {files.length > 0 ? (
        <ul className="plain-list evidence-list">
          {files.map((a) => (
            <li key={a.id}>
              {a.viewable ? (
                <button type="button" className="link-btn evidence-name" onClick={() => setViewing(a)}>
                  {a.filename}
                </button>
              ) : (
                <a className="evidence-name" href={url(a, true)} download>
                  {a.filename}
                </a>
              )}
              {label?.(a)}
              <span className="small muted">
                {fmtSize(a.size)} · {t("added {time} by {user}", { time: fmtTime(a.uploaded_at), user: a.uploaded_by })}
              </span>
              <span className="grow" />
              {a.viewable && (
                <button type="button" className="btn btn-sm" onClick={() => setViewing(a)}>
                  {t("View")}
                </button>
              )}
              <a className="btn btn-sm" href={url(a, true)} download>
                {t("Download")}
              </a>
              {editable && (
                <button type="button" className="btn btn-sm" onClick={() => void doRemove(a)}>
                  {t("Remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {t("No evidence files.")}
        </p>
      )}
      {viewing && (
        <Modal title={viewing.filename} open onClose={() => setViewing(null)} wide>
          <div className="stack-sm">
            {isImage(viewing) ? (
              <img className="evidence-image" src={url(viewing)} alt={viewing.filename} />
            ) : (
              <iframe className="evidence-frame" src={url(viewing)} title={viewing.filename} />
            )}
            <div className="row-actions">
              <a className="btn" href={url(viewing)} target="_blank" rel="noreferrer">
                {t("Open in new tab")}
              </a>
              <a className="btn" href={url(viewing, true)} download>
                {t("Download")}
              </a>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
