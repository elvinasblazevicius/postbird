/**
 * Feed synchronisation: download every active feed, turn items into jobs,
 * de-duplicate, update, expire, and log everything to sync_runs/sync_items.
 */
import { IMPORT_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import type { RawItem } from "./parse";
import { normalizeItem, ItemSkipped, type ContentPolicy, type NormalizedJob } from "./extract";
import { parseFeed, FeedParseError } from "./parse";
import { refreshOrgLogos } from "./logos";
import { cleanupRateLimits } from "@/lib/rate-limit";
import { purgeStaleSubscribers } from "@/lib/subscribers";
import { purgeOpsEvents } from "@/lib/ops-events";
import { reduceOldClickIds } from "@/lib/analytics";
import { canonicalizeUrl, isAggregatorUrl } from "./url";
import { knownOrgByHost } from "./extract";

export type SyncTrigger = "cron" | "manual" | "cli";

export type SyncResult = {
  runId: number;
  status: "success" | "partial" | "failed" | "skipped";
  feedsTotal: number;
  feedsFailed: number;
  itemsSeen: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  itemsFailed: number;
  expired: number;
  message: string | null;
  /** One entry per feed that was read (no feed addresses: they can contain access tokens). */
  feeds: FeedReport[];
};

export type FeedReport = { id: number; name: string; status: "ok" | "error" | "not_reached"; items: number; error: string | null };

type FeedRow = {
  id: number;
  name: string;
  url: string;
  default_organization: string | null;
  content_policy: ContentPolicy;
};

type ExistingJob = {
  id: number;
  url_hash: string;
  fingerprint: string | null;
  status: string;
  primary_feed_id: number | null;
  category_locked: boolean;
  apply_host: string;
  apply_url: string;
  source_host: string | null;
  organization_id: number | null;
  title: string; slug: string; country_code: string | null; city: string | null; location_text: string | null;
  is_remote: boolean | null; category: string; job_type: string | null; grade: string | null; reference: string | null;
  languages: string[] | null; desirable_languages: string[] | null; min_experience_years: number | null;
  summary: string | null; description_html: string | null; content_policy: string;
  published_at: Date | null; deadline: string | null;
};

type ItemLog = { feed_id: number | null; job_id: number | null; outcome: string; title: string | null; url: string | null; message: string | null };

const USER_AGENT = "Postbird-FeedSync/1.0 (job feed importer)";
/**
 * How long one sync may run. The scheduled import runs from GitHub Actions
 * (no limit). When triggered through the website ("Sync now" or the cron
 * URL) it must finish within the host's request limit: 10 s on Netlify's
 * free plan. Unfinished items are picked up next time.
 */
function timeBudgetMs(trigger: SyncTrigger): number {
  if (trigger === "cli") return Number.POSITIVE_INFINITY; // GitHub Actions / command line
  const fromEnv = Number(process.env.SYNC_TIME_BUDGET_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return process.env.VERCEL ? 240_000 : 7_500; // Netlify free plan: 10 s per request, minus start-up time
}

/**
 * Part of a website-triggered run's budget kept back for the work after the
 * feeds: expiring listings, saving the item log, closing the run and
 * releasing the lock. Feeds and items stop this long before the budget ends.
 */
export const CLEANUP_RESERVE_MS = 2_500;

/** Website-triggered runs hold the lock briefly, so a run the host kills mid-way blocks the next one for at most a minute. */
const LOCK_MINUTES = { cli: 20, website: 1 } as const;

/** Runs still "running" after this long were stopped by the host (time limit) and are marked as failed. */
const STALE_RUN_MINUTES = 30;

// ── Feeds from environment variables ─────────────────────────

/** Inoreader replaces an output feed with one "Feed suspended!" notice when the owner's Pro plan lapses. */
export function isSuspendedInoreaderFeed(items: RawItem[]): boolean {
  return items.length > 0 && items.length <= 2 && items.every((i) =>
    /inoreader\.com\/upgrade\//i.test(i.guid ?? "") ||
    (/^\s*feed suspended/i.test(i.title) && i.links.every((u) => isAggregatorUrl(u))));
}

/** Add feeds listed in INOREADER_FEED_URLS (one per line or comma-separated; optional "Name | URL"). */
export async function ensureEnvFeeds(): Promise<number> {
  const raw = process.env.INOREADER_FEED_URLS || process.env.FEED_URLS || "";
  const entries = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  let added = 0;
  for (const [i, entry] of entries.entries()) {
    const [maybeName, maybeUrl] = entry.includes("|") ? entry.split("|").map((s) => s.trim()) : [null, entry];
    const url = maybeUrl;
    if (!/^https?:\/\//i.test(url)) continue;
    const name = maybeName || `Inoreader feed ${i + 1}`;
    const rows = await sql`
      insert into feeds (name, url, from_env, content_policy)
      values (${name}, ${url}, true, ${IMPORT_SETTINGS.defaultContentPolicy})
      on conflict (url) do nothing
      returning id`;
    added += rows.length;
  }
  return added;
}

// ── Locking ──────────────────────────────────────────────────

/** Takes the named lock for `minutes` (fractions allowed) unless someone else holds it. */
export async function acquireLock(name: string, holder: string, minutes: number): Promise<boolean> {
  const seconds = Math.max(1, Math.round(minutes * 60));
  const rows = await sql`
    update locks set locked_until = now() + make_interval(secs => ${seconds}), holder = ${holder}
    where name = ${name} and (locked_until is null or locked_until < now())
    returning name`;
  return rows.length === 1;
}

export async function releaseLock(name: string, holder: string): Promise<void> {
  await sql`update locks set locked_until = null where name = ${name} and holder = ${holder}`;
}

// ── Fetching ─────────────────────────────────────────────────

export const MAX_FEED_BYTES = 15_000_000;

class FeedTooLarge extends Error {
  constructor() {
    super(`Feed is larger than ${Math.round(MAX_FEED_BYTES / 1_000_000)} MB and was skipped.`);
  }
}

/** Reads a response body as UTF-8, giving up as soon as it passes `maxBytes` (nothing beyond that is downloaded). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new FeedTooLarge();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FeedTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

export async function fetchFeedText(url: string, timeoutMs: number = IMPORT_SETTINGS.fetchTimeoutMs): Promise<string> {
  const ctrl = new AbortController();
  const limit = Math.max(1000, Math.min(timeoutMs, IMPORT_SETTINGS.fetchTimeoutMs));
  const timer = setTimeout(() => ctrl.abort(), limit);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const hint =
        res.status === 404 ? " The feed address may be wrong, or the output feed was switched off in Inoreader." :
        res.status === 401 || res.status === 403 ? " The feed is not public; check the output feed settings in Inoreader." :
        res.status === 429 ? " The feed is rate-limiting requests; it will be retried at the next sync." : "";
      throw new Error(`HTTP ${res.status} ${res.statusText}.${hint}`);
    }
    return await readCapped(res, MAX_FEED_BYTES);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Timed out after ${Math.round(limit / 1000)} s.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Creates missing organizations and returns slug → id. For a known
 * organization (from src/config/organizations.ts; only those have a type)
 * the stored name, short name and type follow the built-in list, so a
 * corrected entry reaches rows created earlier. Names read from feeds don't
 * overwrite a stored name.
 */
export async function upsertOrganizations(jobs: NormalizedJob[]): Promise<Map<string, number>> {
  const bySlug = new Map<string, NormalizedJob["organization"]>();
  for (const j of jobs) if (j.organization) bySlug.set(j.organization.slug, j.organization);
  const map = new Map<string, number>();
  if (bySlug.size === 0) return map;
  const rows = [...bySlug.values()].map((o) => ({ slug: o!.slug, name: o!.name, short_name: o!.short, org_type: o!.type, website: o!.website }));
  await sql`insert into organizations ${sql(rows, "slug", "name", "short_name", "org_type", "website")}
    on conflict (slug) do update set
      website = coalesce(organizations.website, excluded.website),
      name = case when excluded.org_type is not null then excluded.name else organizations.name end,
      short_name = case when excluded.org_type is not null then excluded.short_name else organizations.short_name end,
      org_type = coalesce(excluded.org_type, organizations.org_type)`;
  const found = await sql<{ id: number; slug: string }[]>`select id, slug from organizations where slug = any(${[...bySlug.keys()]})`;
  for (const r of found) map.set(r.slug, Number(r.id));
  return map;
}

function dateOnly(d: Date | string | null): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function sameTime(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function statusFor(deadline: string | null, today: string): "active" | "expired" {
  return deadline && deadline < today ? "expired" : "active";
}

// ── Main sync ────────────────────────────────────────────────

export async function runSync(trigger: SyncTrigger): Promise<SyncResult> {
  const started = Date.now();
  const isCli = trigger === "cli";
  const budget = timeBudgetMs(trigger);
  // Feeds and items stop early enough to leave time for the clean-up below.
  const workBudget = Number.isFinite(budget) ? Math.max(1_000, budget - CLEANUP_RESERVE_MS) : budget;
  const outOfTime = () => Date.now() - started > workBudget;
  let stoppedEarly = false;
  const holder = `${trigger}-${started}-${Math.random().toString(36).slice(2, 8)}`;

  // Runs the host stopped mid-way (time limit) never reached their final update.
  await sql`
    update sync_runs set status = 'failed', finished_at = coalesce(finished_at, now()),
      message = concat_ws(' ', message, 'The run did not finish (it was most likely stopped by the host''s time limit).')
    where status = 'running' and started_at < now() - make_interval(mins => ${STALE_RUN_MINUTES})`;

  const [run] = await sql<{ id: number }[]>`insert into sync_runs (trigger) values (${trigger}) returning id`;
  const runId = Number(run.id);

  const result: SyncResult = {
    runId, status: "success", feedsTotal: 0, feedsFailed: 0, itemsSeen: 0, created: 0, updated: 0,
    unchanged: 0, duplicates: 0, itemsFailed: 0, expired: 0, message: null, feeds: [],
  };

  if (!(await acquireLock("sync", holder, isCli ? LOCK_MINUTES.cli : LOCK_MINUTES.website))) {
    result.status = "skipped";
    result.message = "Another sync is already running; this one was skipped.";
    await sql`update sync_runs set status = 'skipped', finished_at = now(), message = ${result.message} where id = ${runId}`;
    return result;
  }

  const logs: ItemLog[] = [];
  const notes: string[] = [];
  try {
    await ensureEnvFeeds();
    const feeds = await sql<FeedRow[]>`
      select id, name, url, default_organization, content_policy from feeds where is_active order by id`;
    result.feedsTotal = feeds.length;
    if (feeds.length === 0) notes.push("No active feeds. Add one in Admin → Feeds or set INOREADER_FEED_URLS.");

    const today = new Date().toISOString().slice(0, 10);

    for (const feed of feeds) {
      const feedId = Number(feed.id);
      if (outOfTime()) {
        stoppedEarly = true;
        result.feeds.push({ id: feedId, name: feed.name, status: "not_reached", items: 0, error: null });
        continue;
      }
      try {
        const body = await fetchFeedText(feed.url, Number.isFinite(workBudget) ? workBudget - (Date.now() - started) : undefined);
        const parsed = parseFeed(body);
        if (isSuspendedInoreaderFeed(parsed.items)) {
          throw new Error("Inoreader has suspended this feed: exporting RSS needs an active Inoreader Pro plan. Nothing was imported or removed.");
        }
        const items = parsed.items.slice(0, IMPORT_SETTINGS.maxItemsPerFeed);
        result.itemsSeen += items.length;

        // Normalise
        const ctx = { id: feedId, name: feed.name, defaultOrganization: feed.default_organization, contentPolicy: feed.content_policy };
        const jobs: NormalizedJob[] = [];
        const seenInFeed = new Set<string>();
        for (const item of items) {
          try {
            const job = normalizeItem(item, ctx);
            if (seenInFeed.has(job.urlHash)) continue; // same vacancy twice in one feed
            seenInFeed.add(job.urlHash);
            jobs.push(job);
          } catch (e) {
            const skipped = e instanceof ItemSkipped;
            if (!skipped) result.itemsFailed++;
            logs.push({ feed_id: feedId, job_id: null, outcome: skipped ? "skipped" : "failed", title: item.title?.slice(0, 300) || null, url: item.links[0] ?? null, message: (e as Error).message.slice(0, 500) });
          }
        }

        const orgIds = await upsertOrganizations(jobs);
        const hashes = jobs.map((j) => j.urlHash);
        const fps = jobs.map((j) => j.fingerprint).filter((f): f is string => !!f);
        const existing = await sql<ExistingJob[]>`
          select id, url_hash, fingerprint, status, primary_feed_id, category_locked, apply_host, apply_url, source_host, organization_id,
                 title, slug, country_code, city, location_text, is_remote, category, job_type, grade, reference,
                 languages, desirable_languages, min_experience_years,
                 summary, description_html, content_policy, published_at, deadline::text as deadline
          from jobs where url_hash = any(${hashes}) or (fingerprint is not null and fingerprint = any(${fps}))`;
        const byHash = new Map(existing.map((e) => [e.url_hash, e]));
        const byFp = new Map(existing.filter((e) => e.fingerprint).map((e) => [e.fingerprint!, e]));
        const sourcesForFeed = new Set(
          (await sql<{ job_id: number }[]>`select job_id from job_sources where feed_id = ${feedId} and job_id = any(${existing.map((e) => e.id)})`)
            .map((r) => Number(r.job_id)),
        );

        const touched: { job_id: number; feed_id: number; item_guid: string | null; item_url: string; source_title: string | null }[] = [];

        for (const j of jobs) {
          if (outOfTime()) { stoppedEarly = true; break; }
          try {
            const orgId = j.organization ? orgIds.get(j.organization.slug) ?? null : null;
            let ex = byHash.get(j.urlHash);
            let matchedBy: "url" | "fingerprint" | null = ex ? "url" : null;
            if (!ex && j.fingerprint) {
              const cand = byFp.get(j.fingerprint);
              if (cand && (cand.source_host ?? cand.apply_host) !== j.sourceHost) { ex = cand; matchedBy = "fingerprint"; }
            }

            if (!ex) {
              const status = statusFor(j.deadline, today);
              const [row] = await sql<{ id: number }[]>`
                insert into jobs (slug, title, organization_id, primary_feed_id, country_code, city, location_text, is_remote,
                  category, job_type, grade, languages, desirable_languages, min_experience_years, reference, summary, description_html, content_policy, apply_url, apply_host,
                  source_host, url_hash, fingerprint, published_at, deadline, status)
                values (${j.slug}, ${j.title}, ${orgId}, ${feedId}, ${j.countryCode}, ${j.city}, ${j.locationText}, ${j.isRemote},
                  ${j.category}, ${j.jobType}, ${j.grade}, ${j.languages}, ${j.desirableLanguages}, ${j.minExperienceYears}, ${j.reference}, ${j.summary}, ${j.descriptionHtml}, ${j.contentPolicy},
                  ${j.applyUrl}, ${j.applyHost}, ${j.sourceHost}, ${j.urlHash}, ${j.fingerprint}, ${j.publishedAt}, ${j.deadline}, ${status})
                on conflict (url_hash) do nothing
                returning id`;
              if (!row) { result.unchanged++; continue; } // created concurrently; ignore
              const id = Number(row.id);
              byHash.set(j.urlHash, { id, url_hash: j.urlHash, fingerprint: j.fingerprint, status, primary_feed_id: feedId } as ExistingJob);
              if (j.fingerprint) byFp.set(j.fingerprint, { id, url_hash: j.urlHash, fingerprint: j.fingerprint, apply_host: j.applyHost, source_host: j.sourceHost } as ExistingJob);
              touched.push({ job_id: id, feed_id: feedId, item_guid: j.guid, item_url: j.applyUrl, source_title: j.sourceTitle });
              result.created++;
              logs.push({ feed_id: feedId, job_id: id, outcome: "created", title: j.title, url: j.applyUrl, message: status === "expired" ? "Imported as closed (deadline has passed)" : null });
              continue;
            }

            const id = Number(ex.id);
            touched.push({ job_id: id, feed_id: feedId, item_guid: j.guid, item_url: j.applyUrl, source_title: j.sourceTitle });

            const isPrimary = ex.primary_feed_id === null || Number(ex.primary_feed_id) === feedId;
            if (matchedBy === "fingerprint" && sourcesForFeed.has(id)) { result.unchanged++; continue; } // already merged earlier
            if (matchedBy === "fingerprint" || (!isPrimary && !sourcesForFeed.has(id))) {
              // The same vacancy reached us through another feed or another website.
              result.duplicates++;
              logs.push({ feed_id: feedId, job_id: id, outcome: "duplicate", title: j.title, url: j.applyUrl,
                message: matchedBy === "fingerprint" ? "Same title, organization and details as an existing listing on another website" : "Same vacancy link already imported from another feed" });
              // Prefer the employer's own website as the application link.
              if (matchedBy === "fingerprint" && orgId && knownOrgByHost(j.applyHost) && !knownOrgByHost(ex.apply_host)) {
                // Only the link changes; url_hash keeps identifying the listing so its own feed still updates it.
                await sql`update jobs set apply_url = ${j.applyUrl}, apply_host = ${j.applyHost}, updated_at = now() where id = ${id}`;
              }
              continue;
            }
            if (!isPrimary) { result.unchanged++; continue; }

            // Primary feed: refresh the listing if anything changed.
            const newStatus =
              ex.status === "removed" ? "removed" :
              ex.status === "active" ? statusFor(j.deadline, today) :
              (j.deadline === null || j.deadline >= today) ? "active" : ex.status;
            const category = ex.category_locked ? ex.category : j.category;
            // Keep an employer link merged in from another feed rather than switching back to a less direct one.
            const keepMerged = knownOrgByHost(ex.apply_host) && !knownOrgByHost(j.applyHost);
            const applyUrl = keepMerged ? ex.apply_url : j.applyUrl;
            const applyHost = keepMerged ? ex.apply_host : j.applyHost;
            const changed =
              ex.title !== j.title || ex.slug !== j.slug || (ex.organization_id === null ? null : Number(ex.organization_id)) !== orgId ||
              ex.country_code !== j.countryCode || ex.city !== j.city || ex.location_text !== j.locationText ||
              ex.is_remote !== j.isRemote || ex.category !== category || ex.job_type !== j.jobType || ex.grade !== j.grade ||
              ex.reference !== j.reference || (ex.languages ?? []).join() !== (j.languages ?? []).join() ||
              (ex.desirable_languages ?? []).join() !== (j.desirableLanguages ?? []).join() ||
              (ex.min_experience_years ?? null) !== j.minExperienceYears || ex.summary !== j.summary || ex.description_html !== j.descriptionHtml ||
              ex.content_policy !== j.contentPolicy || !sameTime(ex.published_at, j.publishedAt) ||
              dateOnly(ex.deadline) !== j.deadline || ex.status !== newStatus || ex.primary_feed_id === null ||
              ex.apply_url !== applyUrl || ex.source_host !== j.sourceHost;

            if (!changed) { result.unchanged++; continue; }
            await sql`
              update jobs set title = ${j.title}, slug = ${j.slug}, organization_id = ${orgId}, primary_feed_id = ${feedId},
                country_code = ${j.countryCode}, city = ${j.city}, location_text = ${j.locationText}, is_remote = ${j.isRemote},
                category = ${category}, job_type = ${j.jobType}, grade = ${j.grade}, reference = ${j.reference},
                languages = ${j.languages}, desirable_languages = ${j.desirableLanguages}, min_experience_years = ${j.minExperienceYears},
                summary = ${j.summary}, description_html = ${j.descriptionHtml}, content_policy = ${j.contentPolicy},
                published_at = ${j.publishedAt}, deadline = ${j.deadline}, fingerprint = ${j.fingerprint},
                apply_url = ${applyUrl}, apply_host = ${applyHost}, source_host = ${j.sourceHost},
                status = ${newStatus}, updated_at = now()
              where id = ${id}`;
            result.updated++;
            const what = ex.status !== newStatus ? `Status ${ex.status} → ${newStatus}` : dateOnly(ex.deadline) !== j.deadline ? `Deadline ${dateOnly(ex.deadline) ?? "none"} → ${j.deadline ?? "none"}` : null;
            logs.push({ feed_id: feedId, job_id: id, outcome: "updated", title: j.title, url: j.applyUrl, message: what });
          } catch (e) {
            result.itemsFailed++;
            logs.push({ feed_id: feedId, job_id: null, outcome: "failed", title: j.title, url: j.applyUrl, message: (e as Error).message.slice(0, 500) });
          }
        }

        // Mark everything seen in this feed (keeps listings alive and records attribution).
        if (touched.length) {
          const ids = [...new Set(touched.map((t) => t.job_id))];
          await sql`update jobs set last_seen_at = now() where id = any(${ids})`;
          const uniqueTouched = [...new Map(touched.map((t) => [t.job_id, t])).values()];
          await sql`
            insert into job_sources ${sql(uniqueTouched, "job_id", "feed_id", "item_guid", "item_url", "source_title")}
            on conflict (job_id, feed_id) do update
              set last_seen_at = now(), item_url = excluded.item_url, item_guid = excluded.item_guid, source_title = excluded.source_title`;
        }

        await sql`
          update feeds set last_synced_at = now(), last_status = 'ok', last_error = null, last_item_count = ${items.length}, updated_at = now()
          where id = ${feedId}`;
        result.feeds.push({ id: feedId, name: feed.name, status: "ok", items: items.length, error: null });
      } catch (e) {
        result.feedsFailed++;
        const msg = e instanceof FeedParseError ? e.message : `Could not read the feed: ${(e as Error).message}`;
        result.feeds.push({ id: feedId, name: feed.name, status: "error", items: 0, error: msg.slice(0, 500) });
        logs.push({ feed_id: feedId, job_id: null, outcome: "feed_error", title: feed.name, url: feed.url.replace(/([?&](?:token|key|apikey|access_token)=)[^&]+/gi, "$1…"), message: msg.slice(0, 500) });
        await sql`update feeds set last_synced_at = now(), last_status = 'error', last_error = ${msg.slice(0, 1000)}, updated_at = now() where id = ${feedId}`;
      }
    }

    // Organization icons (a few per run). Only in the scheduled import: website-
    // triggered runs keep their few seconds for feeds and the clean-up.
    if (isCli) {
      try {
        await refreshOrgLogos(() => Number.POSITIVE_INFINITY);
      } catch (e) {
        notes.push(`Organization icons were not updated: ${(e as Error).message}`);
      }
    }

    if (stoppedEarly) notes.push("Stopped early to stay within the website's time limit; the remaining items will be imported by the next scheduled run.");

    // Expire / archive / clean up
    const expired = await sql`
      update jobs set status = 'expired', updated_at = now()
      where status = 'active' and deadline is not null and deadline < (now() at time zone 'utc')::date
      returning id`;
    const archived = await sql`
      update jobs set status = 'archived', updated_at = now()
      where status = 'active' and deadline is null
        and last_seen_at < now() - make_interval(days => ${IMPORT_SETTINGS.hideUndatedAfterDays})
      returning id`;
    result.expired = expired.length + archived.length;
    // Retention clean-up only in the scheduled import (every 2 hours), never
    // inside the website's 10-second limit.
    if (isCli) await retentionCleanup();
  } catch (e) {
    result.status = "failed";
    notes.push(`Sync stopped: ${(e as Error).message}`);
  } finally {
    try {
      if (logs.length) {
        const rows = logs.map((l) => ({ run_id: runId, ...l }));
        for (let i = 0; i < rows.length; i += 500) {
          await sql`insert into sync_items ${sql(rows.slice(i, i + 500), "run_id", "feed_id", "job_id", "outcome", "title", "url", "message")}`;
        }
      }
    } catch (e) {
      notes.push(`Could not save item log: ${(e as Error).message}`);
    }
    if (result.status !== "failed") {
      if (result.feedsTotal > 0 && result.feedsFailed === result.feedsTotal) result.status = "failed";
      else if (result.feedsFailed > 0 || result.itemsFailed > 0 || stoppedEarly) result.status = "partial";
    }
    result.message = notes.join(" ") || null;
    await sql`
      update sync_runs set status = ${result.status}, finished_at = now(), feeds_total = ${result.feedsTotal},
        feeds_failed = ${result.feedsFailed}, items_seen = ${result.itemsSeen}, jobs_created = ${result.created},
        jobs_updated = ${result.updated}, jobs_unchanged = ${result.unchanged}, duplicates = ${result.duplicates},
        items_failed = ${result.itemsFailed}, jobs_expired = ${result.expired}, message = ${result.message}
      where id = ${runId}`;
    await releaseLock("sync", holder);
  }
  return result;
}

/** Deletes old listings, logs, analytics and unused organizations. */
async function retentionCleanup(): Promise<void> {
  await sql`
    delete from jobs
    where status in ('expired', 'archived')
      and greatest(coalesce(deadline::timestamptz, last_seen_at), updated_at) < now() - make_interval(days => ${IMPORT_SETTINGS.deleteClosedAfterDays})`;
  await sql`delete from sync_items where created_at < now() - make_interval(days => ${IMPORT_SETTINGS.keepImportLogsDays})`;
  await sql`delete from sync_runs where started_at < now() - make_interval(days => ${IMPORT_SETTINGS.keepImportLogsDays * 3})`;
  await sql`delete from events where created_at < now() - make_interval(days => ${IMPORT_SETTINGS.keepAnalyticsDays})`;
  // Privacy policy: a Microsoft click id kept with the visit counts becomes "present" after 90 days.
  await reduceOldClickIds();
  // Organizations whose icon was blocked are kept, so the block survives while they have no listings.
  await sql`delete from organizations o where not o.logo_blocked and not exists (select 1 from jobs j where j.organization_id = o.id)`;
  // Hashed abuse-protection keys are kept at most 24 hours.
  await cleanupRateLimits();
  // Privacy policy: unconfirmed sign-ups and unsubscribed addresses go after 30 days.
  await purgeStaleSubscribers();
  // Errors marked as dealt with on Admin → Overview.
  await purgeOpsEvents();
  // Which vacancies paid alerts already listed as closing soon: all of them have closed long before.
  await sql`delete from alert_closing_sent where sent_at < now() - interval '60 days'`;
}

/** Exposed for tests. */
export const _internal = { canonicalizeUrl };
