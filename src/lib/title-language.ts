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
    "enumerador", "enumeradora", "encuestador", "encuestadora", "encuesta", "encuestas", "asesor", "asesora", "ingeniero", "ingeniera", "pasante", "monitoreo", "saneamiento", "hogares", "trabajo", "campana",
  ]),
  fr: new Set([
    "du", "des", "et", "pour", "au", "aux", "le", "les", "charge", "chargee", "charges", "chargees", "specialiste", "coordinateur", "coordinatrice", "projet", "projets",
    "suivi", "developpement", "adjoint", "adjointe", "conseiller", "conseillere", "chef", "appui", "responsable", "gestionnaire", "agent",
    "assistante", "sante", "education", "protection", "superviseur", "superviseure", "chauffeur", "comptable", "juriste", "logisticien",
    "programme", "administratif", "logistique", "enquete", "enquetes", "enqueteur", "enqueteuse", "enqueteurs", "ingenieur", "medecin", "infirmier",
    "infirmiere", "formateur", "formatrice", "animateur", "animatrice", "stagiaire", "volontaire", "secretaire", "directeur", "directrice", "humanitaire",
    "eau", "assainissement", "securite",
  ]),
  pt: new Set([
    "do", "da", "dos", "das", "e", "para", "oficial", "assistente", "especialista", "coordenador", "coordenadora", "consultor", "consultora",
    "projeto", "projetos", "programa", "gestao", "tecnico", "tecnica", "analista", "apoio", "nacional", "desenvolvimento", "servicos",
    "saude", "educacao", "protecao", "monitoria", "avaliacao",
  ]),
};

/**
 * Accented letters each language uses (before folding). A title with one marker word and such a
 * letter counts as two pieces of evidence: "Técnico de Protección" is Spanish even though
 * "técnico" alone is also Portuguese. English titles have none of these letters.
 */
const ACCENTS: Record<"es" | "fr" | "pt", RegExp> = {
  es: /[áéíóúñü¿¡]/i,
  fr: /[àâçéèêëîïôùûüÿœ]/i,
  pt: /[áâãàçéêíóôõú]/i,
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
  // Each different marker word counts once; the language's accented letters add one more, but
  // only alongside a marker word (accents alone could be a name).
  const score = (lang: "es" | "fr" | "pt") => {
    const n = new Set(words.filter((w) => MARKERS[lang].has(w))).size;
    return n > 0 && ACCENTS[lang].test(title) ? n + 1 : n;
  };
  const ranked = (["es", "fr", "pt"] as const).map((code) => ({ code, n: score(code) })).sort((a, b) => b.n - a.n);
  const [best, next] = ranked;
  // Two pieces of evidence, and clearly more than the runner-up (Spanish and Portuguese share many).
  if (best.n < 2 || best.n === next.n) return null;
  return { code: best.code, name: NAMES[best.code] };
}
