/**
 * Small i18n layer for English, German and Dutch.
 *
 * The English text is the key: `t("Use cases")`. German and Dutch come from `locales/*.json`;
 * a text missing there falls back to English. Placeholders: `t("{n} rules", { n: 3 })`.
 * Changing the language reloads the page, so plain `t()` calls are enough everywhere (also in
 * module-level label maps) and no hook or context is needed.
 */
import de from "./locales/de.json";
import nl from "./locales/nl.json";

export type Lang = "en" | "de" | "nl";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "nl", label: "Nederlands" },
];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, de, nl };
// Check that every text is translated: npm run i18n:check
const STORAGE_KEY = "magma.lang";

function isLang(v: unknown): v is Lang {
  return v === "en" || v === "de" || v === "nl";
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  return isLang(nav) ? nav : "en";
}

const current: Lang = initialLang();

export function getLang(): Lang {
  return current;
}

/** BCP 47 tag for Intl formatters. */
export function locale(): string {
  return { en: "en-GB", de: "de-DE", nl: "nl-NL" }[current];
}

/** Switch the language; reloads the page when it changes. Returns true when it reloads. */
export function setLang(lang: string | null | undefined): boolean {
  if (!isLang(lang) || lang === current) return false;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    if (localStorage.getItem(STORAGE_KEY) !== lang) return false;
  } catch {
    return false; // storage blocked: a reload would not keep the choice (and could loop)
  }
  window.location.reload();
  return true;
}

export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
  let out = DICTS[current][text] ?? text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m));
  return out;
}

if (typeof document !== "undefined") document.documentElement.lang = current;
