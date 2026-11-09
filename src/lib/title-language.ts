/**
 * The language of a vacancy title, when it is clearly not English ("Oficial de Proyectos" →
 * Spanish). Used for a small "Posting in Spanish" tag and the lang attribute on the title.
 * Deliberately cautious: it returns null unless several words point to one language and
 * no English words do, so a title that mixes languages or is unclear gets no tag.
 */
export type TitleLanguage = { code: "es" | "fr" | "pt" | "ar" | "ru"; name: string };

const NAMES: Record<TitleLanguage["code"], string> = { es: "Spanish", fr: "French", pt: "Portuguese", ar: "Arabic", ru: "Russian" };

/** Words used in one language's job titles and not in English (or in the other two). */
const MARKERS: Record<"es" | "fr" | "pt", Set<string>> = {
  es: new Set([
    "del", "y", "para", "con", "los", "las", "el", "oficial", "asistente", "especialista", "coordinador", "coordinadora", "consultor", "consultora",
    "proyecto", "proyectos", "programa", "programas", "gestion", "tecnico", "tecnica", "analista", "jefe", "jefa", "apoyo", "nacional",
    "desarrollo", "servicios", "auxiliar", "encargado", "encargada", "oficina", "salud", "educacion", "proteccion", "seguimiento", "evaluacion", "administrativo", "administrativa", "logistica", "comunicacion",
  ]),
  fr: new Set([
    "du", "des", "et", "pour", "au", "aux", "le", "les", "charge", "chargee", "specialiste", "coordinateur", "coordinatrice", "projet", "projets",
    "suivi", "developpement", "adjoint", "adjointe", "conseiller", "conseillere", "chef", "appui", "responsable", "gestionnaire", "agent",
    "assistante", "sante", "education", "protection", "superviseur", "superviseure", "chauffeur", "comptable", "juriste", "logisticien",
    "programme", "administratif", "logistique",
  ]),
  pt: new Set([
    "do", "da", "dos", "das", "e", "para", "oficial", "assistente", "especialista", "coordenador", "coordenadora", "consultor", "consultora",
    "projeto", "projetos", "programa", "gestao", "tecnico", "tecnica", "analista", "apoio", "nacional", "desenvolvimento", "servicos",
    "saude", "educacao", "protecao", "monitoria", "avaliacao",
  ]),
};

/** Common English title words: any of them means the title isn't clearly in another language. */
const ENGLISH = new Set([
  "and", "of", "the", "for", "with", "to", "officer", "manager", "specialist", "head", "lead", "intern", "internship",
  "advisor", "adviser", "analyst", "associate", "director", "program", "project", "coordinator",
  "health", "development", "field", "staff", "deputy", "chief", "team", "leader",
]);

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function titleLanguage(title: string | null | undefined): TitleLanguage | null {
  if (!title) return null;
  const letters = title.replace(/[^\p{L}]/gu, "");
  if (!letters) return null;
  // Non-Latin scripts: most of the letters in that script.
  const arabic = (title.match(/[؀-ۿ]/g) ?? []).length;
  const cyrillic = (title.match(/[Ѐ-ӿ]/g) ?? []).length;
  if (arabic / letters.length > 0.5) return { code: "ar", name: NAMES.ar };
  if (cyrillic / letters.length > 0.5) return { code: "ru", name: NAMES.ru };

  const words = fold(title).split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => ENGLISH.has(w))) return null;
  const score = (lang: "es" | "fr" | "pt") => new Set(words.filter((w) => MARKERS[lang].has(w))).size;
  const ranked = (["es", "fr", "pt"] as const).map((code) => ({ code, n: score(code) })).sort((a, b) => b.n - a.n);
  const [best, next] = ranked;
  // Two different marker words, and clearly more than the runner-up (Spanish and Portuguese share many).
  if (best.n < 2 || best.n === next.n) return null;
  return { code: best.code, name: NAMES[best.code] };
}
