/**
 * Read-only check: is every vacancy in the feeds on the site? Reads each active feed exactly as the
 * import does (same item count, same employer links found behind job boards, without new
 * look-ups) and reports, item by item, whether it is open on the site, closed, removed, merged
 * with another listing, deliberately skipped (and why), or missing. Writes nothing.
 * Usage: npm run feed-coverage   (or the "feed-coverage" option of the GitHub workflow)
 */
import { getSql } from "../src/lib/db";
import { IMPORT_SETTINGS } from "../src/config/import";
import { fetchFeedText } from "../src/lib/feeds/sync";
import { parseFeed, type RawItem } from "../src/lib/feeds/parse";
import { ItemSkipped, normalizeItem } from "../src/lib/feeds/extract";
import { boardListingOf } from "../src/lib/feeds/board-links";
import { cleanTitle } from "../src/lib/feeds/title";
import { hostOf } from "../src/lib/feeds/url";

/** Words of a title for comparing: lower case, accents and punctuation gone, filler words dropped. */
const FILLER = new Set(["the", "a", "an", "of", "and", "for", "in", "to", "at", "on", "with", "de", "la", "le", "et", "des", "du", "en", "y"]);
function words(t: string): Set<string> {
  return new Set(cleanTitle(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !FILLER.has(w)));
}
function similarity(a: Set<string>, b: Set<string>): number {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / Math.max(1, Math.min(a.size, b.size));
}

async function main() {
  const sql = getSql();
  const feeds = await sql<{ id: number; name: string; url: string; default_organization: string | null; content_policy: "none" | "excerpt" | "full" }[]>`
    select id, name, url, default_organization, content_policy from feeds where is_active order by id`;
  for (const feed of feeds) {
    const parsed = parseFeed(await fetchFeedText(feed.url));
    let items: RawItem[] = parsed.items.slice(0, IMPORT_SETTINGS.maxItemsPerFeed);
    // Employer links already found behind job boards (no new look-ups here).
    const listings = items.map((it) => boardListingOf(it)?.listing).filter((x): x is string => !!x);
    const behind = new Map((await sql<{ source_url: string; target_url: string | null }[]>`
      select source_url, target_url from board_links where source_url = any(${listings})`).map((r) => [r.source_url, r.target_url]));
    items = items.map((it) => {
      const b = boardListingOf(it);
      const t = b ? behind.get(b.listing) : null;
      return t ? { ...it, links: [t, ...it.links] } : it;
    });

    const ctx = { id: Number(feed.id), name: feed.name, defaultOrganization: feed.default_organization, contentPolicy: feed.content_policy };
    const skippedBoardItems: { title: string; host: string }[] = [];
    const outcome = new Map<string, number>();
    const skipReasons = new Map<string, number>();
    const missing: string[] = [];
    const add = (k: string) => outcome.set(k, (outcome.get(k) ?? 0) + 1);
    const normalized: { title: string; urlHash: string; fingerprint: string | null }[] = [];
    for (const it of items) {
      try {
        const j = normalizeItem(it, ctx);
        normalized.push({ title: j.title, urlHash: j.urlHash, fingerprint: j.fingerprint });
      } catch (e) {
        if (e instanceof ItemSkipped) {
          add("skipped on purpose");
          const reason = boardListingOf(it) && !behind.has(boardListingOf(it)!.listing) ? "Job-board listing whose employer link hasn't been looked up yet (next import)" : (e as Error).message;
          skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
          if (/job-board/i.test(reason)) skippedBoardItems.push({ title: it.title, host: hostOf(it.links[0] ?? "") });
        } else add("could not be read");
      }
    }
    const rows = await sql<{ url_hash: string; fingerprint: string | null; status: string }[]>`
      select url_hash, fingerprint, status from jobs
       where url_hash = any(${normalized.map((n) => n.urlHash)})
          or (fingerprint is not null and fingerprint = any(${normalized.map((n) => n.fingerprint).filter((x): x is string => !!x)}))`;
    const byHash = new Map(rows.map((r) => [r.url_hash, r.status]));
    const byFp = new Map(rows.filter((r) => r.fingerprint).map((r) => [r.fingerprint!, r.status]));
    const seen = new Set<string>();
    for (const n of normalized) {
      if (seen.has(n.urlHash)) { add("same vacancy twice in the feed"); continue; }
      seen.add(n.urlHash);
      const status = byHash.get(n.urlHash);
      if (status) { add(status === "active" ? "on the site (open)" : `on the site but ${status}`); continue; }
      const merged = n.fingerprint ? byFp.get(n.fingerprint) : undefined;
      if (merged) { add("merged with the same vacancy from another source"); continue; }
      add("MISSING");
      missing.push(n.title);
    }

    console.log(`\nFeed "${feed.name}": ${items.length} items read`);
    for (const [k, v] of [...outcome].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
    if (skipReasons.size) {
      console.log("  Skipped, by reason:");
      for (const [k, v] of [...skipReasons].sort((a, b) => b[1] - a[1])) console.log(`    ${v} × ${k}`);
    }
    // Skipped board listings: is the same vacancy on the site from another source (the employer's own feed)?
    if (skippedBoardItems.length) {
      const open = (await sql<{ title: string }[]>`select title from jobs where status = 'active'`).map((j) => words(j.title)).filter((w) => w.size >= 2);
      const perHost = new Map<string, { total: number; covered: number; examples: string[] }>();
      for (const b of skippedBoardItems) {
        const w = words(b.title);
        const covered = w.size >= 2 && open.some((o) => similarity(w, o) >= 0.85);
        const h = perHost.get(b.host) ?? { total: 0, covered: 0, examples: [] };
        h.total++;
        if (covered) h.covered++;
        else if (h.examples.length < 12) h.examples.push(b.title.slice(0, 90));
        perHost.set(b.host, h);
      }
      console.log("  Skipped job-board listings already on the site from another source (same title):");
      for (const [host, h] of [...perHost].sort((a, b) => b[1].total - a[1].total)) {
        console.log(`    ${host}: ${h.covered} of ${h.total} (${Math.round((100 * h.covered) / h.total)}%)`);
        for (const e of h.examples) console.log(`      not on the site: ${e}`);
      }
    }
    if (missing.length) {
      console.log(`  Missing (${missing.length}), first 40:`);
      for (const t of missing.slice(0, 40)) console.log(`    - ${t}`);
    }
  }
}

main()
  .then(() => getSql().end({ timeout: 2 }))
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await getSql().end({ timeout: 2 });
    process.exit(1);
  });
