import { api } from "../api";
import { getLang, LANGUAGES, setLang, t, type Lang } from "../i18n";

/** Language picker. Signed in, the choice is saved on the account and follows the user. */
export default function LanguageSelect({ save = false, className = "" }: { save?: boolean; className?: string }) {
  const change = async (lang: Lang) => {
    if (save) await api.setLocale(lang).catch(() => undefined);
    setLang(lang);
  };
  return (
    <select
      className={`input lang-select ${className}`}
      aria-label={t("Language")}
      value={getLang()}
      onChange={(e) => void change(e.target.value as Lang)}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
