// Moteur i18n Casanéo — français (source) → anglais.
// La langue est appliquée au démarrage (comme le thème) ; changer de langue recharge l'app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import dayjs from "dayjs";
import "dayjs/locale/fr";

export type LangPref = "auto" | "fr" | "en";
export const LANG_PREF_KEY = "app_lang_pref";

let lang: "fr" | "en" = "fr";
let pref: LangPref = "auto";

// Dictionnaire FR → EN (clés normalisées : NFC + espaces internes réduits)
const RAW: Record<string, string> = require("./en.json");
const norm = (s: string) => {
  const c = s.replace(/\s+/g, " ").trim();
  return typeof (c as any).normalize === "function" ? c.normalize("NFC") : c;
};
const DICT: Record<string, string> = {};
for (const k in RAW) DICT[norm(k)] = RAW[k];

function deviceLang(): "fr" | "en" {
  try {
    const code = Localization.getLocales?.()[0]?.languageCode || "fr";
    return code === "fr" ? "fr" : "en";
  } catch {
    return "fr";
  }
}

export async function initI18n() {
  try {
    const stored = await AsyncStorage.getItem(LANG_PREF_KEY);
    if (stored === "fr" || stored === "en" || stored === "auto") pref = stored;
  } catch {}
  lang = pref === "auto" ? deviceLang() : pref;
  dayjs.locale(lang === "en" ? "en" : "fr");
}

export function getLang(): "fr" | "en" {
  return lang;
}
export function getLangPref(): LangPref {
  return pref;
}
export async function setLangPref(p: LangPref) {
  pref = p;
  try {
    await AsyncStorage.setItem(LANG_PREF_KEY, p);
  } catch {}
}

// Règles pour les chaînes construites dynamiquement
const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/^(\d+) nuits?$/, (_a, n) => `${n} night${Number(n) > 1 ? "s" : ""}`],
  [/^(\d+) voyageurs?$/, (_a, n) => `${n} guest${Number(n) > 1 ? "s" : ""}`],
  [/^(\d+) jours?$/, (_a, n) => `${n} day${Number(n) > 1 ? "s" : ""}`],
  [/^(\d+) logements?$/, (_a, n) => `${n} propert${Number(n) > 1 ? "ies" : "y"}`],
  [/^(\d+) réservations?$/, (_a, n) => `${n} booking${Number(n) > 1 ? "s" : ""}`],
  [/^(\d+) photos?$/, (_a, n) => `${n} photo${Number(n) > 1 ? "s" : ""}`],
  [/^(\d+) hébergements? disponibles?$/, (_a, n) => `${n} accommodation${Number(n) > 1 ? "s" : ""} available`],
  [/^J-(\d+)$/, "D-$1"],
  [/^Du (.+) au (.+)$/, "From $1 to $2"],
];

function lookup(s: string): string | null {
  const key = norm(s);
  if (!key) return null;
  const hit = DICT[key];
  if (hit) return hit;
  for (const [re, rep] of RULES) {
    const m = key.match(re);
    if (m) return typeof rep === "string" ? key.replace(re, rep) : (rep as any)(...m);
  }
  return null;
}

/** Traduit une chaîne française. Repli : la chaîne d'origine (jamais de texte cassé). */
export function t(s: string): string {
  if (lang !== "en" || !s) return s;
  const direct = lookup(s);
  if (direct) return direct;
  // Segments : "A · B", "A — B", "Label : valeur"
  for (const sep of [" · ", " — ", " : "]) {
    if (s.includes(sep)) {
      const parts = s.split(sep).map((p) => lookup(p) ?? p);
      if (parts.some((p, i) => p !== s.split(sep)[i])) return parts.join(sep === " : " ? ": " : sep);
    }
  }
  return s;
}
