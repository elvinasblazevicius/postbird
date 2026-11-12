/**
 * Some job boards publish, on each listing, an "Apply on the employer's website" link that
 * redirects straight to the employer's own vacancy, and allow robots to follow it. For those
 * boards the scheduled import looks behind that link once per listing, so an item without an
 * employer link in the feed can still be imported with the employer's address (the board itself
 * is never linked or named). Boards that close their pages to robots (UNjobs) are not listed here.
 * Results are kept in board_links, so each listing is looked up only once (a miss is retried after
 * a week). Scheduled import only: never in the website's few-second "Sync now".
 */
import { sql } from "@/lib/db";
import type { RawItem } from "./parse";
import { hostOf, isAggregatorUrl, isListingSite } from "./url";
import { allowed } from "./enrich";
import type { RobotsRules } from "./robots";
import { IMPORT_SETTINGS } from "@/config/import";

type Resolver = { host: RegExp; applyUrl: (listing: string) => string | null };

export const BOARD_RESOLVERS: Resolver[] = [
  // UNjobnet: /jobs/detail/irc-employment-specialist-90553666 → /apply/90553666 (302 to the employer).
  // Its robots.txt closes only /jd/, /salaryscale/ and /go/ (checked again on every run).
  {
    host: /(^|\.)unjobnet\.org$/i,
    applyUrl: (u) => {
      const id = u.match(/\/jobs\/detail\/[^?#]*?-(\d{5,})(?:[/?#]|$)/)?.[1];
      return id ? `https://www.unjobnet.org/apply/${id}` : null;
    },
  },
];

const MAX_PER_RUN = 200;
const DELAY_MS = 1_200;
const RETRY_MISS_DAYS = 7;

/** The board listing an item points to when it has no employer link of its own, and how to look behind it. */
export function boardListingOf(item: RawItem): { listing: string; apply: string } | null {
  if (item.links.some((l) => !isAggregatorUrl(l) && !isListingSite(hostOf(l)))) return null;
  for (const l of item.links) {
    const r = BOARD_RESOLVERS.find((x) => x.host.test(hostOf(l)));
    const apply = r?.applyUrl(l);
    if (apply) return { listing: l, apply };
  }
  return null;
}

/** Where a board's apply link redirects: the employer's page, or null (no redirect, or to another board). */
async function lookBehind(apply: string, robots: Map<string, RobotsRules>): Promise<string | null> {
  if (!(await allowed(apply, robots))) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(apply, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": IMPORT_SETTINGS.vacancyPages.userAgent } });
    await res.body?.cancel().catch(() => {});
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) return null;
    const target = new URL(loc, apply).toString();
    const host = hostOf(target);
    return /^https?:/i.test(target) && !isListingSite(host) && !isAggregatorUrl(target) ? target : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Items whose only link is a supported board's listing get the employer's link put first (where
 * the import looks for it). Returns the items (changed copies where a link was found) and counts.
 */
export async function addEmployerLinksFromBoards(items: RawItem[], deadline: number): Promise<{ items: RawItem[]; found: number; looked: number }> {
  const wanted = items.map((it) => ({ it, b: boardListingOf(it) }));
  const listings = [...new Set(wanted.filter((w) => w.b).map((w) => w.b!.listing))];
  if (!listings.length || process.env.VITEST) return { items, found: 0, looked: 0 };

  const known = new Map<string, string | null>();
  for (const r of await sql<{ source_url: string; target_url: string | null; fresh: boolean }[]>`
    select source_url, target_url, (target_url is not null or checked_at > now() - make_interval(days => ${RETRY_MISS_DAYS})) as fresh
      from board_links where source_url = any(${listings})`) {
    if (r.fresh) known.set(r.source_url, r.target_url);
  }

  const robots = new Map<string, RobotsRules>();
  let looked = 0;
  for (const w of wanted) {
    if (!w.b || known.has(w.b.listing)) continue;
    if (looked >= MAX_PER_RUN || Date.now() > deadline) break;
    looked++;
    const target = await lookBehind(w.b.apply, robots);
    known.set(w.b.listing, target);
    await sql`insert into board_links (source_url, target_url, checked_at) values (${w.b.listing}, ${target}, now())
      on conflict (source_url) do update set target_url = excluded.target_url, checked_at = now()`;
    await new Promise((res) => setTimeout(res, DELAY_MS));
  }

  let found = 0;
  const out = wanted.map(({ it, b }) => {
    const target = b ? known.get(b.listing) : null;
    if (!target) return it;
    found++;
    return { ...it, links: [target, ...it.links] };
  });
  return { items: out, found, looked };
}
