// Fails when a t("...") text has no German or Dutch entry, or a {placeholder} differs.
// Run: npm run i18n:check   (texts are keyed by the English text, see src/i18n.ts)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && f !== "i18n.ts") files.push(p);
  }
})("src");

const keys = new Set();
for (const f of files) {
  // t("...") texts, and st("...") server messages translated at runtime (src/serverTexts.ts)
  for (const m of readFileSync(f, "utf8").matchAll(/\bs?t\(\s*("(?:[^"\\]|\\.)*")/g)) keys.add(JSON.parse(m[1]));
}

const ph = (s) => [...s.matchAll(/\{\w+\}/g)].map((x) => x[0]).sort().join();
let bad = 0;
for (const lang of ["de", "nl"]) {
  const dict = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
  for (const k of keys) {
    if (!(k in dict)) {
      console.error(`${lang}: missing ${JSON.stringify(k)}`);
      bad++;
    } else if (ph(k) !== ph(dict[k])) {
      console.error(`${lang}: placeholders differ in ${JSON.stringify(k)}`);
      bad++;
    }
  }
  for (const k of Object.keys(dict)) if (!keys.has(k)) console.warn(`${lang}: unused ${JSON.stringify(k)}`);
}
console.log(`${keys.size} texts checked in de and nl`);
process.exit(bad ? 1 : 0);
