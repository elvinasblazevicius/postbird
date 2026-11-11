/**
 * Import and listing settings. Safe to change; no code knowledge needed.
 */
export const IMPORT_SETTINGS = {
  /**
   * What a NEW feed may republish until you change it in the admin:
   *  - "none":    title, organization, location, dates and a link only (safest)
   *  - "excerpt": the above plus a short summary (about 300 characters)
   *  - "full":    the full job description
   * Only choose "excerpt" or "full" for a feed after checking the source's
   * terms allow it.
   */
  defaultContentPolicy: "none" as "none" | "excerpt" | "full",

  /** Length of the summary shown when a feed uses "excerpt". */
  excerptLength: 300,

  /**
   * Jobs with no known closing date are hidden this many days after
   * they were last seen in a feed (the source has most likely removed them).
   */
  hideUndatedAfterDays: 45,

  /** Expired and hidden jobs are deleted for good after this many days. */
  deleteClosedAfterDays: 90,

  /** How long one feed may take to download before it is skipped (ms). */
  fetchTimeoutMs: 20_000,

  /** Maximum items read from one feed per sync (protects the free database). */
  maxItemsPerFeed: 500,

  /**
   * Items asked for from an Inoreader output feed per sync (its "n" parameter). Inoreader sends
   * only the latest 20 without it, fewer than a busy folder gets between two syncs. 100 is the
   * most its API returns at once. An "n" already in the feed address is kept.
   */
  inoreaderItems: 100,

  /**
   * Items whose TITLE matches one of these are not imported: tenders,
   * requests for proposals and supplier calls are not jobs. They are logged
   * as "skipped" in Admin → Imports, so you can see what was left out.
   */
  skipTitlePatterns: [
    /^\s*(?:rfp|rfq|rfi|itb|ifb)\b/i,
    /\brequest for (?:proposals?|quotations?|quotes?|offers?|bids?|information)\b/i,
    /\b(?:invitation|call) (?:to|for) (?:bids?|tenders?|proposals?|offers?|quotations?)\b/i,
    /^\s*tender\b|\btender (?:notice|no\.?|ref\.?|for)\b/i,
    /\b(?:preferred )?supplier (?:list|roster|database)\b/i,
  ] as RegExp[],

  /** Detailed per-item import logs are kept this many days. */
  keepImportLogsDays: 30,

  /** Analytics events are kept this many days. */
  keepAnalyticsDays: 395,
} as const;

export const LISTING_SETTINGS = {
  /** Jobs per page on /jobs and landing pages. */
  pageSize: 20,
  /**
   * Organization, category and country pages are only offered to search
   * engines when they have at least this many open jobs (avoids thin pages).
   */
  minJobsForIndexedLandingPage: 3,
  /**
   * Job pages with no description at all (feeds set to "none") have little
   * text, which search engines treat as thin content. Keep false to ask
   * search engines not to index them; listing and landing pages are indexed
   * either way.
   */
  indexJobsWithoutDescription: false,
  /** "Closing soon" means a deadline within this many days. */
  closingSoonDays: 7,
} as const;
