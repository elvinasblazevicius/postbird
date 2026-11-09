/**
 * World regions used by the "Where" filter. Grouping follows the regional
 * splits most UN agencies use. Edit the country codes (ISO 3166-1 alpha-2)
 * to move a country between regions.
 */
export type Region = { slug: string; name: string; codes: string[] };

export const REGIONS: Region[] = [
  {
    slug: "africa",
    name: "Africa",
    codes: "AO BF BI BJ BW CD CF CG CI CM CV DJ ER ET GA GH GM GN GQ GW KE KM LR LS MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TZ UG YT ZA ZM ZW".split(" "),
  },
  {
    slug: "middle-east-north-africa",
    name: "Middle East and North Africa",
    codes: "AE BH DZ EG EH IL IQ IR JO KW LB LY MA OM PS QA SA SY TN YE".split(" "),
  },
  {
    slug: "asia-pacific",
    name: "Asia and the Pacific",
    codes: "AF AS AU BD BN BT CK CN FJ FM GU HK ID IN JP KH KI KP KR LA LK MH MM MN MO MP MV MY NC NP NR NU NZ PF PG PH PK PW SB SG TH TL TO TV TW VN VU WS".split(" "),
  },
  {
    slug: "europe-central-asia",
    name: "Europe and Central Asia",
    codes: "AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GE GG GI GR HR HU IE IM IS IT JE KG KZ LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TJ TM TR UA UZ VA XK".split(" "),
  },
  {
    slug: "latin-america-caribbean",
    name: "Latin America and the Caribbean",
    codes: "AG AI AR AW BB BO BR BS BZ CL CO CR CU CW DM DO EC FK GD GF GP GT GY HN HT JM KN KY LC MQ MS MX NI PA PE PR PY SR SV SX TC TT UY VC VE VG VI".split(" "),
  },
  {
    slug: "north-america",
    name: "North America",
    codes: "BM CA GL PM US".split(" "),
  },
];

export function regionBySlug(slug: string | null | undefined): Region | undefined {
  return slug ? REGIONS.find((r) => r.slug === slug) : undefined;
}

export function regionOf(code: string | null | undefined): Region | undefined {
  return code ? REGIONS.find((r) => r.codes.includes(code.toUpperCase())) : undefined;
}

/** Grade groups for the "Grade" filter. `match` is checked against the stored grade (e.g. "P-3"). */
export const GRADE_GROUPS: { value: string; name: string; grades: string[] }[] = [
  { value: "entry", name: "Entry level (P-1, P-2, NO-A)", grades: ["P-1", "P-2", "NO-A"] },
  { value: "P", name: "Professional (P-1 to P-5)", grades: ["P-1", "P-2", "P-3", "P-4", "P-5"] },
  { value: "D", name: "Director and above (D-1, D-2, ASG, USG)", grades: ["D-1", "D-2", "ASG", "USG"] },
  { value: "NO", name: "National Officer (NO-A to NO-E)", grades: ["NO-A", "NO-B", "NO-C", "NO-D", "NO-E"] },
  { value: "G", name: "General Service (G-1 to G-7)", grades: ["G-1", "G-2", "G-3", "G-4", "G-5", "G-6", "G-7", "GS-1", "GS-2", "GS-3", "GS-4", "GS-5", "GS-6", "GS-7"] },
  { value: "FS", name: "Field Service (FS)", grades: ["FS-1", "FS-2", "FS-3", "FS-4", "FS-5", "FS-6", "FS-7"] },
  { value: "SC", name: "Service contracts (SB, NPSA, IPSA, LICA, ICS)", grades: [] },
  // EU staff categories (stored "AD-6", "AST-3", "AST/SC-2", "FG-IV"; shown "AD 6", see displayGrade in src/lib/grades.ts).
  { value: "AD", name: "EU AD (AD 5 to AD 16)", grades: Array.from({ length: 12 }, (_, i) => `AD-${i + 5}`) },
  { value: "AST", name: "EU AST (AST 1 to AST 11)", grades: Array.from({ length: 11 }, (_, i) => `AST-${i + 1}`) },
  { value: "AST-SC", name: "EU AST/SC (AST/SC 1 to AST/SC 6)", grades: Array.from({ length: 6 }, (_, i) => `AST/SC-${i + 1}`) },
  { value: "FG", name: "EU contract agent (FG I to FG IV)", grades: ["FG-I", "FG-II", "FG-III", "FG-IV"] },
  // World Bank Group and IFC grades GA (entry) to GK.
  { value: "WBG", name: "World Bank Group (GA to GK)", grades: ["GA", "GB", "GC", "GD", "GE", "GF", "GG", "GH", "GI", "GJ", "GK"] },
];

/** Organization types (from the known-organizations list). */
export const ORG_TYPES: { value: string; name: string; type: string }[] = [
  { value: "un", name: "UN system", type: "UN system" },
  { value: "ifi", name: "Development banks and IFIs", type: "International financial institution" },
  { value: "eu", name: "EU institutions", type: "EU institution" },
  { value: "io", name: "Other international organizations", type: "International organization" },
  { value: "ngo", name: "NGOs", type: "NGO" },
];

/**
 * Languages detected in a vacancy's language requirements (besides English): the UN's official
 * languages, the other official languages of the EU, then other languages field posts often ask for.
 */
export const LANGUAGES = [
  "French", "Spanish", "Arabic", "Portuguese", "Russian", "Chinese",
  "German", "Italian", "Dutch", "Polish", "Bulgarian", "Croatian", "Czech", "Danish", "Estonian", "Finnish", "Greek", "Hungarian",
  "Irish", "Latvian", "Lithuanian", "Maltese", "Romanian", "Slovak", "Slovenian", "Swedish",
  "Ukrainian", "Turkish", "Swahili", "Dari", "Pashto", "Persian", "Somali", "Amharic", "Hausa", "Bengali", "Urdu", "Burmese",
  "Indonesian", "Japanese",
] as const;

/** Other names a posting may use for a language in LANGUAGES ("Farsi" is stored as Persian). */
export const LANGUAGE_ALIASES: Record<string, (typeof LANGUAGES)[number]> = {
  Farsi: "Persian",
  Kiswahili: "Swahili",
  Bangla: "Bengali",
  Pushto: "Pashto",
  Pashtu: "Pashto",
  "Bahasa Indonesia": "Indonesian",
};

/**
 * The languages a single search word turns into the language filter ("german" → German). Names that
 * often stand for an organization or a nationality in a search ("danish refugee council", "irish aid")
 * stay search words.
 */
export const SEARCH_LANGUAGES: readonly string[] = ["French", "Spanish", "Arabic", "Portuguese", "Russian", "Chinese", "German", "Italian", "Dutch", "Polish"];
