/**
 * Without a database: the daily job's heartbeat rule, protected emblems (UN, EU, Red Cross and
 * Red Crescent), the duplicate-plan email, the confirm-first note before the trial checkbox, the
 * EU-free site defaults and the share-preview helper.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import siteConfig from "@site-config";
import { KNOWN_ORGS } from "@/config/organizations";
import { TRIAL_CONFIRM_NOTE } from "@/lib/early-access-copy";
import { duplicatePlanEmail } from "@/lib/email-templates";
import { defaultSiteCopy, homeCopy } from "@/lib/eu-claim";
import { EMBLEM_DOMAIN_RE, EMBLEM_NAME_RE, isLogoProtected } from "@/lib/feeds/logos";
import { DAILY_JOB_STALE_HOURS, dailyJobFresh } from "@/lib/heartbeat";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";

describe("daily job heartbeat", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  it("is fresh for 26 hours after a successful run, and stale without one", () => {
    expect(DAILY_JOB_STALE_HOURS).toBe(26);
    expect(dailyJobFresh(new Date(now - 25 * 3600_000), now)).toBe(true);
    expect(dailyJobFresh(new Date(now - 26 * 3600_000).toISOString(), now)).toBe(true);
    expect(dailyJobFresh(new Date(now - 27 * 3600_000), now)).toBe(false);
    expect(dailyJobFresh(null, now)).toBe(false);
    expect(dailyJobFresh("not a date", now)).toBe(false);
  });
});

describe("protected emblems", () => {
  it("covers the ICRC, the IFRC and national societies, by name or website", () => {
    for (const name of [
      "International Committee of the Red Cross", "ICRC", "IFRC", "International Federation of Red Cross and Red Crescent Societies",
      "British Red Cross", "American Red Cross", "Croix-Rouge française", "Cruz Roja Española", "Deutsches Rotes Kreuz", "Norges Røde Kors",
      "Swedish Red Cross", "Netherlands Red Cross", "Rode Kruis", "Croce Rossa Italiana", "Palestine Red Crescent Society", "Türk Kızılay", "Magen David Adom",
    ]) expect([name, isLogoProtected({ name })]).toEqual([name, true]);
    for (const website of ["icrc.org", "www.ifrc.org", "redcross.org.uk", "croix-rouge.fr", "cruzroja.es", "drk.de", "rodekors.no", "redcrescent.org.qa"]) {
      expect([website, isLogoProtected({ name: "Some employer", website })]).toEqual([website, true]);
    }
  });

  it("covers UN and EU bodies by type, and leaves other organizations alone", () => {
    expect(isLogoProtected({ name: "UNICEF", org_type: "UN system" })).toBe(true);
    expect(isLogoProtected({ name: "European Commission", org_type: "EU institution" })).toBe(true);
    for (const name of ["Médecins Sans Frontières", "International Rescue Committee", "Save the Children", "World Bank Group", "Crossroads International"]) {
      expect([name, isLogoProtected({ name, website: "example.org" })]).toEqual([name, false]);
    }
  });

  it("the configured Red Cross organizations are protected", () => {
    const rc = KNOWN_ORGS.filter((o) => ["ICRC", "IFRC"].includes(o.short ?? ""));
    expect(rc).toHaveLength(2);
    for (const o of rc) expect(isLogoProtected({ name: o.name, short_name: o.short, org_type: o.type, domains: o.domains })).toBe(true);
  });

  it("migration 016 clears stored icons with the same patterns", () => {
    const sqlText = readFileSync(path.join(__dirname, "..", "db", "migrations", "016_trust_fixes.sql"), "utf8");
    expect(sqlText).toContain(`~* '${EMBLEM_NAME_RE}'`);
    expect(sqlText).toContain(`~* '${EMBLEM_DOMAIN_RE}'`);
  });
});

describe("customer-facing copy", () => {
  it("the duplicate-plan email says what happened and how to get the charge back", () => {
    const m = duplicatePlanEmail();
    expect(m.subject).toBe("We canceled a duplicate plan");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("We canceled a duplicate plan for this address");
      expect(body).toContain(siteConfig.operator.name);
    }
    expect(m.text).toContain("reply to this email and we'll refund the charge");
    expect(m.html).toContain("reply to this email and we&#39;ll refund the charge");
  });

  it("the public trial form says the address must be confirmed, and that there is one trial per address", () => {
    expect(TRIAL_CONFIRM_NOTE).toBe("Your 14 days start today. We'll email you a link to confirm your address; your alerts start once you confirm. One free trial per email address.");
  });
});

describe("site defaults and share previews", () => {
  it("the defaults never name the EU", () => {
    const d = defaultSiteCopy();
    expect(d.description).toBe("Independent job search for UN and international organization vacancies, each linked to the employer's own website.");
    for (const v of Object.values(d)) expect(v).not.toMatch(/\bEU\b/);
    expect(homeCopy(true).description).toBe(siteConfig.description);
  });

  it("sets the page's own title and description for Open Graph and X", () => {
    const m = shareMetadata(sharedTitle("Pricing"), "Plans and prices.");
    expect(m.openGraph).toMatchObject({ title: `Pricing | ${siteConfig.name}`, description: "Plans and prices.", siteName: siteConfig.name });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: `Pricing | ${siteConfig.name}`, description: "Plans and prices." });
  });
});
