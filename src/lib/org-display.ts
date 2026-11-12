import { KNOWN_ORGS } from "@/config/organizations";

const BY_NAME = new Map(KNOWN_ORGS.map((o) => [o.name.toLowerCase(), o]));

/** "UNICEF", "IOM", "DNDi": one word with at least two capitals. */
const isAcronym = (s: string) => /^[A-Z0-9][A-Za-z0-9&-]*$/.test(s) && (s.match(/[A-Z]/g)?.length ?? 0) >= 2;

/**
 * An organization's name as cards show it: in full, with the abbreviation people scan for in
 * brackets ("United Nations Children's Fund (UNICEF)", "International Organization for Migration
 * (IOM)"). The stored name is kept as it is in filters, addresses and search.
 */
export function orgDisplayName(name: string, short?: string | null): string {
  const known = BY_NAME.get(name.toLowerCase());
  if (isAcronym(name)) {
    // Stored under its abbreviation: the first other spelling of several words is the full name.
    const full = known?.aliases?.find((a) => /\s/.test(a) && a.length > name.length + 4 && !a.includes(name));
    return full ? `${full} (${name})` : name;
  }
  const s = short ?? known?.short ?? null;
  return s && isAcronym(s) && !name.includes(s) ? `${name} (${s})` : name;
}
