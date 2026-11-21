import { useEffect, useState } from "react";
import { purple, type PtRedStatus } from "../api";
import { RED_STATUS_LABEL } from "../lib/purple";
import { t } from "../i18n";

/** Execution state of a purple team test the way VECTR shows it: a status with a run clock,
 * plus a picker for who works on the test. */

type Person = { username: string; display_name: string; role: string };

// one request per page, shared by every picker (campaign tables have one picker per row)
let peopleCache: Promise<Person[]> | null = null;
function loadPeople(): Promise<Person[]> {
  peopleCache ??= purple.people().catch((e) => {
    peopleCache = null;
    throw e;
  });
  return peopleCache;
}

export function usePeople(): Person[] {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let live = true;
    loadPeople()
      .then((p) => live && setPeople(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return people;
}

/** "0:04:12" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** Seconds the attack ran: live while it runs, start to stop once it stopped. */
export function useElapsed(status: PtRedStatus, start: string | null, stop: string | null): number | null {
  const now = useNow(status === "in_progress" && !!start);
  if (!start) return null;
  const from = new Date(start).getTime();
  const to = stop && status !== "in_progress" ? new Date(stop).getTime() : now;
  return (to - from) / 1000;
}

/** Status pill with a dot (pulsing while in progress) and the run clock. */
export function RunState({
  status,
  start,
  stop,
  size = "md",
}: {
  status: PtRedStatus;
  start: string | null;
  stop: string | null;
  size?: "sm" | "md";
}) {
  const elapsed = useElapsed(status, start, stop);
  const showClock = elapsed !== null && (status === "in_progress" || status === "paused" || status === "executed");
  return (
    <span className={`pt-state pt-state-${status} pt-state-${size}`}>
      <span className="pt-state-dot" aria-hidden="true" />
      <span className="pt-state-label">{RED_STATUS_LABEL[status]}</span>
      {showClock && (
        <span className="pt-state-clock mono" title={status === "paused" ? t("Time since the attack started") : t("Attack duration")}>
          {clock(elapsed)}
        </span>
      )}
    </span>
  );
}

/** Pick who works on a test: the app's analysts and admins, or a name typed by hand
 * ("Someone else…", e.g. an external red team operator). */
export function AssigneePicker({
  value,
  onChange,
  disabled,
  label,
  me,
  compact,
  quiet,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
  me?: string;
  compact?: boolean;
  /** in table rows: reads as text (no field border) until hovered or focused */
  quiet?: boolean;
}) {
  const people = usePeople();
  const known = people.some((p) => p.username === value);
  const [typing, setTyping] = useState<string | null>(null);
  if (typing !== null) {
    const commit = () => {
      onChange(typing.trim());
      setTyping(null);
    };
    return (
      <span className={"pt-assignee" + (compact ? " pt-assignee-sm" : "")}>
        <input
          className={"input" + (compact ? " input-sm" : "")}
          autoFocus
          aria-label={label}
          value={typing}
          placeholder={t("Name, e.g. an external red team operator")}
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") setTyping(null);
          }}
          onBlur={commit}
        />
      </span>
    );
  }
  return (
    <span className={"pt-assignee" + (compact ? " pt-assignee-sm" : "") + (quiet ? " pt-assignee-quiet" : "")}>
      <select
        className={"input" + (compact ? " input-sm" : "")}
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "\u0000other") {
            setTyping(known ? "" : value);
            return;
          }
          onChange(v);
        }}
      >
        <option value="">{t("– unassigned –")}</option>
        {people.map((p) => (
          <option key={p.username} value={p.username}>
            {p.display_name && p.display_name !== p.username ? `${p.display_name} (${p.username})` : p.username}
          </option>
        ))}
        {value && !known && <option value={value}>{value}</option>}
        <option value={"\u0000other"}>{t("Someone else…")}</option>
      </select>
      {me && !disabled && value !== me && (
        <button
          type="button"
          className={quiet ? "link-btn link-quiet small" : "btn " + (compact ? "btn-xs" : "btn-sm")}
          title={t("Assign to me")}
          onClick={() => onChange(me)}
        >
          {t("Me")}
        </button>
      )}
    </span>
  );
}
