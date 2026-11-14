/**
 * Tidying vacancy titles as published: leading requisition numbers, PDF file names, post codes,
 * ALL-CAPS titles and capitalised runs, bilingual "English || Arabic" titles, gender tags such as
 * "(m/w/d)" and hyphens used as separators.
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "de", "du", "des", "la", "le", "et", "y", "en"]);

function titleCaseWord(w: string, first: boolean): string {
  const lower = w.toLowerCase();
  if (!first && SMALL.has(lower)) return lower;
  // Short words in an all-caps title are usually acronyms (HQ, ICT, M&E, WASH stays as typed below).
  if (/^[A-Z&]{2,3}$/.test(w)) return w;
  return lower.replace(/(^|[-/(])([a-zà-ÿ])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/**
 * Gender tags some employers add to every title (German "m/w/d", French "H/F", "f/m/x" …): two or
 * three of the letters f, m, h, w, d, x between slashes, in brackets. Said once on the employer's
 * page; in a list of titles they are noise.
 */
const GENDER_TAG = /\s*[([]\s*[fmhwdx]\s*[/|]\s*[fmhwdx](?:\s*[/|]\s*[fmhwdx])?\s*[)\]]/gi;

/** Words kept in capitals when a run of capitalised words is tidied (organizations and common acronyms). */
const KEEP_CAPS = new Set(["NATO", "OSCE", "OECD", "UNDP", "UNICEF", "UNHCR", "UNFPA", "UNOPS", "UNESCO", "UNIDO", "UNEP", "UNRWA", "UNAIDS", "UNFCCC", "UNCTAD", "UNITAR", "UNMISS", "MONUSCO", "MINUSCA", "IFAD", "IAEA", "INTERPOL", "WASH", "LOGFAS", "ECSAT", "ESCB", "EEAS", "EPSO", "IFRC", "ICRC", "OCHA", "OHCHR", "UNHCHR", "MEAL", "GBV", "PSEA", "AVRR", "HIV", "AIDS", "ICTM", "MPOX", "COVID"]);

/**
 * Runs of two or more capitalised words inside a mixed title ("RESEARCH COORDINATOR AND DATA ANALYST –
 * Political Integrity", "… is looking for: ACCOUNTS CLERK LOCAL AGENT"): title case, keeping short
 * words (likely acronyms) and known acronyms as typed.
 */
function tidyCapsRuns(t: string): string {
  return t.replace(/\b\p{Lu}[\p{Lu}&'’.-]*(?:\s+\p{Lu}[\p{Lu}&'’.-]*)+\b/gu, (run) => {
    const words = run.split(/\s+/);
    if (words.filter((w) => w.replace(/[^\p{Lu}]/gu, "").length >= 4 && !KEEP_CAPS.has(w)).length < 2) return run;
    return words.map((w, i) => (KEEP_CAPS.has(w) ? w : titleCaseWord(w, i === 0))).join(" ");
  });
}

export function cleanTitle(raw: string): string {
  // Zero-width characters some sites put in titles.
  let t = raw.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  // A PDF's file name used as the title: "[pdf] LQ011, Technical Officer.pdf".
  t = t.replace(/^\s*\[pdf\]\s*/i, "").replace(/\.pdf\s*$/i, "");
  // Post or vacancy codes at either end: "LQ011, Technical Officer", "Security Officer (MMF), AX034",
  // "Officer, Partnerships (261645)", "MEP Installations Lead – 261736", "– Job No. 529046",
  // "(Entity: EIF – Job ID: 111820)", "Ref: 160475", "(RFP301469)".
  t = t
    .replace(/^[A-Z]{1,3}\s?\d{3},\s*/, "")
    .replace(/,\s*[A-Z]{1,3}\s?\d{3}\s*$/, "")
    .replace(/\s*\((?:[^()]*?\bJob\s*(?:ID|No\.?)\s*:?\s*\d+[^()]*|\d{5,}|RFP\s*\d*\s*)\)/gi, "")
    .replace(/\s*[–—-]?\s*\bJob\s*(?:ID|No\.?)\s*:?\s*\d+\s*$/i, "")
    .replace(/\s*\bRef(?:erence)?\.?\s*:?\s*\d{4,}\b/gi, "")
    .replace(/\s*[–—-]\s*\d{5,}\s*$/, "");
  // "INT 2026 003 | Medical Assistant Intern", "CON 2026 053 | Specialist": a vacancy code before a bar.
  t = t.replace(/^[A-Z]{2,5}\s?(?:19|20)\d\d\s?[-/]?\s?\d{2,4}\s*[|:–—-]\s*/, "");
  // "The European Union Delegation to Kazakhstan is looking for: Accounts Clerk": the role only.
  t = t.replace(/^.{3,140}?\bis\s+(?:looking\s+for|recruiting|hiring)\s*(?:an?\s+)?:\s*/i, "");
  // "Prosper Global is looking for Country Director." (no colon): the role only, without the full stop.
  t = t.replace(/^\p{Lu}[\p{L}&.' -]{1,60}?\s+is\s+(?:looking\s+for|recruiting|hiring|seeking)\s+(?:an?\s+)?(?=\p{Lu})/u, "").replace(/(?<=\p{L}|\))\.$/u, "");
  // Internal vacancy codes written into the title: "VA26P197V01 Project Manager", "SVN2026041_Senior Project
  // Associate", "VN-EC017-2026-M&E Monitoring…", "K26373 Field Research Coordinator", "IRS26375 Seed Systems Specialist".
  t = t
    .replace(/^(\S+\s+)?(?:[A-Z]{1,4}\d{2}[A-Z]\d{3}[A-Z]\d{2}\s|[A-Z]{2,4}\d{6,8}_|VN-[A-Z]{2}\d{3}-+(?:\d{4}-+)?(?:[A-Z&]+\s)?|[A-Z]{1,3}\d{5}\s)(?=\S)/, (m, org: string | undefined) => org ?? "")
    .replace(/\s*\(\s*RFP\d+\s*\)/gi, "");
  // UNICEF's and others' segments that hold codes, or only their empty shells once a feed dropped the
  // digits: ", (NO-1)" / ", (NO-)", ", TA (364 days)" / ", TA ( days)", ", #00138514" / ", #", "Thailand#13919",
  // a closing region code (", LACR"), "– GL D – Defined Duration until December", "(EN-EL-MO---GRAE)", "(TJO)".
  t = t
    .replace(/,?\s*\(\s*[A-Z]{1,4}-\s*\)/g, "")
    .replace(/,?\s*\bTA\s*\(\s*\d*\s*days?\s*\)/gi, "")
    .replace(/,?\s*#\s*\d*(?=\s*(?:,|$))/g, "")
    .replace(/#\d{3,}\b/g, "")
    .replace(/,\s*(?:LACR|ESAR|WCAR|MENAR|EAPR|ECAR|ROSA|SARO)\s*$/, "")
    .replace(/\s*[–—-]\s*GL [A-H]\b(?=\s*(?:[–—-]|$))/g, "")
    .replace(/\s*[–—-]\s*Defined Duration until \w+(?: \d{4})?/gi, "")
    .replace(/\s*\((?:[A-Z0-9]+-+){2,}[A-Z0-9-]*\)/g, "")
    .replace(/\s*\(TJO\)/gi, "")
    .replace(/,\s*(?:NO|GS|P|G|D)-(?=\s*(?:,|$))/g, "")
    .replace(/,\s*\.?\s*(?:days|months)\b(?=\s*(?:[,(]|$))/gi, "")
    .replace(/(^|[\s,])#(?=[\s,]|$)/g, "$1")
    // A duration whose number a feed dropped ("Perú-Lima, 11 meses" arriving as "…Lima, meses").
    .replace(/(^|[^\d\s])\s+(?:años|meses|mois|jours|días|dias|semanas)\b/giu, "$1")
    // A name written twice ("PAHO PAHO Consultant").
    .replace(/^(\p{L}{2,12})\s+\1\b/iu, "$1")
    .replace(/\s*,(?:\s*,)+/g, ",")
    .replace(/[\s,]+$/, "");
  // "Field Documentation Officer || موثق/ـة ميداني/ـة": keep the Latin-script part.
  if (t.includes("||")) {
    const parts = t.split("||").map((p) => p.trim()).filter(Boolean);
    t = parts.find((p) => /[a-z]/i.test(p)) ?? parts[0] ?? t;
  }
  // "23559 Monitoring and Evaluation Officer", "REQ-12345 - Analyst", "#1234: Officer"
  t = t.replace(/^(?:#|req(?:uisition)?[-\s#]*|vacancy\s+(?:no\.?\s*)?)?(?!(?:19|20)\d\d\b)\d{4,8}\s*[-–—:]?\s+(?=\p{L})/iu, "");
  // ALL CAPS → Title Case (only when the title is mostly capitals).
  const letters = t.replace(/[^\p{L}]/gu, "");
  const upper = t.replace(/[^\p{Lu}]/gu, "");
  if (letters.length >= 8 && upper.length / letters.length > 0.85) {
    t = t.split(/(\s+)/).map((w, i) => (/\s/.test(w) ? w : KEEP_CAPS.has(w) ? w : titleCaseWord(w, i === 0))).join("");
  } else {
    t = tidyCapsRuns(t);
  }
  // "Data Analyst (m/w/d)", "Chargé de projet (H/F) - Paris": the tag goes, and a separator it leaves at the end too.
  t = t.replace(GENDER_TAG, "").replace(/\s*[-–—:|,]\s*$/u, "");
  // A hyphen with a space on one or both sides separates parts of the title: "Officer- TVET",
  // "Officer -TVET" and "Officer - TVET" all become "Officer – TVET" (en dash). Hyphens inside
  // words ("Non-Food") and suspended hyphens before "and/or/to" ("pre- and post-") are left alone.
  t = t.replace(/(?<=\S)(?:\s+-\s*|-\s+)(?!(?:and|or|to)\s)(?=\S)/gi, " – ");
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * The title as used for the job's URL slug: without a source's reference number at the start, which
 * cleanTitle keeps when it isn't a plain requisition number ("VA-2026-045: Finance Officer",
 * "(JO 12345) Finance Officer", "No. 123 – Finance Officer"), and without the vacancy's own
 * reference when the title starts with it. Only the slug changes; the title shown is cleanTitle's.
 */
export function titleForSlug(title: string, reference?: string | null): string {
  let t = title.trim();
  if (reference) {
    const ref = reference.trim();
    if (ref && t.toLowerCase().startsWith(ref.toLowerCase())) t = t.slice(ref.length);
  }
  // A bracketed reference: "(12345)", "[VA 2026/45]".
  t = t.replace(/^\s*[([][^)\]]*\d[^)\]]*[)\]]\s*[-–—:|]?\s*/u, "");
  // A reference-like first token (letters, digits and -/._#) with at least one digit, followed by a separator:
  // "VA-2026-045:", "JO 12345 –", "No. 123 -", "#456 |": at least 3 digits, so "COVID-19 – …" stays.
  // Not a year on its own ("2026 Graduate Programme").
  t = t.replace(/^\s*(?:(?:ref(?:erence)?|no|nr|vacancy|va|jo|job(?:\s+opening)?|req(?:uisition)?)\.?\s*(?:no\.?|number|id)?\s*[:#]?\s*)?(?!(?:19|20)\d\d\s)(?=[a-z]{0,6}[-/._#]?(?:[\w\-/.#]*?\d){3})[a-z]{0,6}[-/._#]?\d[\w\-/.#]*\s*[-–—:|]\s*(?=\p{L})/iu, "");
  return t.trim() || title.trim();
}

/**
 * The title without the organization's name when the source added it ("Administrative Assistant |
 * IOM – International Organization for Migration", "IOM – Administrative Assistant", "UNDP Chief, HR
 * Services", "Data Analyst at Transparency International"): the card shows the organization anyway.
 * Names: the organization's display name, short name and other spellings. Never empties a title.
 */
export function stripOrgFromTitle(title: string, names: (string | null | undefined)[]): string {
  const list = [...new Set(names.filter((n): n is string => !!n && n.trim().length >= 2).map((n) => n.trim()))]
    .sort((a, b) => b.length - a.length);
  if (!list.length) return title;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const any = list.map(esc).join("|");
  let t = title;
  // Suffix: " | IOM – International Organization for Migration", " – ESIP – European …", " at Transparency International (Secretariat)".
  t = t.replace(new RegExp(`\\s*(?:[|–—-]|\\bat)\\s+(?:(?:${any})\\s*[–—-]\\s*)?(?:${any})(?:\\s*\\([^()]*\\))?\\s*$`, "i"), "");
  // A last part that starts with the name and says which office: " – OSCE Programme Office in Bishkek, Bishkek", " – OSCE Secretariat".
  t = t.replace(new RegExp(`\\s+[|–—]\\s+(?:${any})\\s[^|–—]{2,70}$`), (m) => (t.length - m.length >= 8 ? "" : m));
  // Prefix: "IOM – ", "IOM: ", or a capitalised short name followed by the role ("UNDP Chief", "WHO Chargé").
  t = t.replace(new RegExp(`^(?:${any})\\s*(?:[–—:|-]\\s*|\\((?:[^()]*)\\)\\s*[–—-]?\\s*)`, "i"), "");
  // The name exactly as written, then a capitalised role: "UNDP Chief", "Jhpiego State Team Lead", "FHI 360 Administrative Associate".
  const lead = list.find((n) => t.startsWith(`${n} `) && /^\p{Lu}/u.test(t.slice(n.length + 1)));
  if (lead) t = t.slice(lead.length + 1);
  t = t.replace(/\s{2,}/g, " ").trim();
  // A part of the organization's name that names a separate entity ("IDB Invest", "UNDP-IC") is not a prefix to drop.
  if (/^(invest\b|ic\b|-)/i.test(t)) return title;
  return t.length >= 3 ? t : title;
}
