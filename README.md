# Postbird

The UN and international organization job aggregator: one place for vacancies at UN agencies, development banks, EU institutions and other international organizations. It imports vacancies automatically from your Inoreader output feeds, builds search-friendly pages, collects paid-alert trial sign-ups, and tracks Microsoft Ads conversions.

Stack: Next.js 16 (TypeScript, Tailwind 4), PostgreSQL on Supabase, hosting on Netlify (or Vercel), scheduling with GitHub Actions, email with Resend.

---

## 1. What you need (accounts and costs)

For a low-cost test, the whole thing runs on free plans; the only purchase is a domain.

| Service | What for | Cost |
|---|---|---|
| **Netlify** (recommended for the test) | Hosting, with a free `*.netlify.app` address | Free. Commercial use is allowed. 300 credits a month: each deploy costs 15, and traffic uses the rest (about 10–15 GB of pages). If credits run out, the site pauses until next month; you are never billed automatically. Functions are limited to 10 seconds, which is why imports run in GitHub Actions. |
| **GitHub** | Stores the code; runs the import every 2 hours and the weekly email | Free. Keep the repository **private**: GitHub switches off schedules in *public* repos after 60 days without commits. About 600 of the 2,000 free Actions minutes per month. |
| **Supabase** | Database | Free plan: 500 MB, which holds tens of thousands of jobs. Free projects pause after a week of inactivity; the 2-hourly import keeps it busy. |
| **Domain** | Your address; needed for email | A .com is about $11/year at Cloudflare Registrar, which sells at cost and renews at the same price (Porkbun: about $11.81). Avoid $1–2 first-year endings like .xyz: they renew at $15+ and hurt email delivery and trust. |
| **Resend** | Confirmation and weekly emails | Free: 3,000 emails/month, **100 per day**. Emails only reach subscribers once your domain is verified. |
| **Inoreader** | Your job feeds | Output feeds need an Inoreader Pro plan (you already use them). |
| **Microsoft Advertising** | Paid traffic (optional) | Your ad budget |

**Total for the test: about $11/year, plus ad spend.**

Vercel also works (`vercel.json` is included), but its free plan is for non-commercial use only. Its terms count a pricing page or ads as commercial, which means Vercel Pro at $20/month.

---

## 2. Deploy on Netlify (about 30 minutes, no coding)

### Step 1 — Database (Supabase)
1. Create a project at supabase.com. Choose a region near your visitors (e.g. Frankfurt) and save the database password.
2. Open **SQL Editor → New query**. Paste the whole of `db/migrations/001_init.sql`, then click **Run**. Do the same with `002_employer_links_and_logos.sql` and `003_security.sql`, in that order. All are safe to run again, and the scheduled job in Step 4 also applies any missing ones before every run.
3. Click **Connect** at the top and copy the **Transaction pooler** connection string (port **6543**). Replace `[YOUR-PASSWORD]` with your password. This is your `DATABASE_URL`.

### Step 2 — Code (GitHub)
Create a **private** repository and upload this folder, without `node_modules` or `.next`. If you'd rather not do this yourself, create an empty repository and ask Claude to push the code to it.

### Step 3 — Hosting (Netlify)
1. In Netlify, click **Add new project → Import an existing project → GitHub** and pick the repository. The build settings are read from `netlify.toml`.
2. Before deploying, open **Environment variables**, choose **Add a variable → scope: All**, and add:
   - `DATABASE_URL`: from Step 1.
   - `CRON_SECRET`: a long random string. Generate one with `openssl rand -hex 32`, or use any 40+ random letters and digits. It protects the `/api/cron` addresses and, unless you set `ADMIN_SESSION_SECRET`, is part of the admin sign-in key.
   - `ADMIN_PASSWORD`: your admin password, at least 10 characters. Changing it signs out every admin session.
   - `ADMIN_SESSION_SECRET` (recommended): another long random string (`openssl rand -hex 32`), used only for admin sign-ins, so the cron secret and admin sessions are independent. Setting or changing it signs you out once.
   - `INOREADER_FEED_URLS`: your Inoreader output feed addresses, one per line. You can also add them later in the admin.
   - `NEXT_PUBLIC_SITE_URL`: `https://<your-site>.netlify.app` for now; change it when you add your domain.
3. Click **Deploy**. Your site is live at `https://<your-site>.netlify.app`.

### Step 4 — Scheduled import and weekly email (GitHub Actions)
In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:
- `DATABASE_URL`: the same value as on Netlify.
- `SITE_URL`: your site address (no trailing slash). It's used for links in emails.
- `INOREADER_FEED_URLS`: optional, the same as on Netlify.
- `RESEND_API_KEY` and `EMAIL_FROM`: once email is set up (Step 6).

Then go to **Actions → Scheduled jobs → Run workflow**, choose `sync` and click Run to check it works. After that it imports every 2 hours and sends the digest on Mondays by itself. It runs directly against the database, so there's no time limit.

### Step 5 — First check
Open `https://<your-site>.netlify.app/admin`, sign in, and look at **Import history**. You can also click **Sync now**. On Netlify a sync started from the website reads feeds for about 5 seconds and finishes within about 7.5 seconds (it keeps time back to close the run and release its lock), so it stays within the 10-second limit; organization icons and old-data clean-up are left to the scheduled run, which also imports the rest. If the host ever cuts a run off, its lock expires after a minute and the run is marked as failed after 30 minutes.

### Step 6 — Domain and email
1. Buy the domain (e.g. at Cloudflare Registrar). In Netlify, open **Domain management → Add a domain** and follow the DNS instructions. Then set `NEXT_PUBLIC_SITE_URL` (Netlify) and `SITE_URL` (GitHub) to `https://yourdomain.com` and redeploy.
2. In Resend, add and verify the domain, then create an API key.
3. Add `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Postbird <alerts@yourdomain.com>`) on Netlify and as GitHub secrets, then redeploy.
4. In **Admin → Subscribers**, click **Send confirmation emails to unconfirmed sign-ups**. This reaches people who signed up before email was set up.

Resend's free plan allows 100 emails a day, so above about 100 subscribers you'll need a paid Resend plan.

**On Vercel instead:** import the repository in Vercel, add the same environment variables, and deploy. `vercel.json` adds a daily backup import, which is the most its free plan allows. The GitHub Actions setup in Step 4 is the same.

---

## 3. Inoreader feeds

- In Inoreader, right-click a folder or tag, then **Properties → Automations → Output feeds → On**. Copy the RSS or JSON address. Both formats work, as do RSS, Atom and JSON Feed from anywhere else.
- Add a feed in **Admin → Feeds**; it is checked before it's saved. Feeds listed in `INOREADER_FEED_URLS` are added automatically.
- **What may be republished** is set per feed:
  - `none` (default): title, organization, location, dates and link only.
  - `excerpt`: adds a ~300-character summary.
  - `full`: adds the full description.

  Only choose `excerpt` or `full` once you've checked that source's terms. Job pages without any description are kept out of search engines, because thin pages hurt SEO, so `excerpt` noticeably improves organic traffic where it's allowed.
- **Organization for every item**: fill this in only for a feed that covers a single employer.
- **Check the item count.** The feed card shows how many items each read returned. If it's always the same small number, the feed may only return its newest items, and busy feeds could lose some between imports. Split the feed into several folders, or run the import more often (change `17 */2 * * *` to `17 * * * *` in `.github/workflows/scheduled.yml`; hourly uses about 1,100 of the 2,000 free minutes).

### How importing works
- Each item is turned into a listing using only what the item says: labelled lines such as "Duty Station:", "Closing date:" and "Organization:", the title, feed tags, and the employer's own domain. Anything not clearly stated is shown as **"Not specified"**.
- Deadlines are taken only from labelled dates that are unambiguous. A date like `05/06/2026` is ignored rather than guessed.
- **Duplicates** are merged when the vacancy link is the same (tracking parameters ignored), or when the same organization's vacancy appears on another website with the same reference number, or with the same title, place and deadline. The employer's own website is preferred as the Apply link.
- Listings close automatically after their deadline. Listings with no deadline are hidden 45 days after the feed last showed them. Closed listings are deleted after 90 days. Every setting is in `src/config/import.ts`.
- Removing a listing in **Admin → Listings** is permanent; later imports won't bring it back.

---

### Job boards inside your feeds

If a feed item comes from a job board that re-posts vacancies (ReliefWeb, UNjobs, Impactpool, Devex and similar, listed in `src/lib/feeds/url.ts`), Postbird never links to or names the board. It reads the employer's own application link from the posting's "How to apply" section (Outlook Safe Links are unwrapped and board tracking parameters removed) and uses that for the **Apply on Official Website** button. Postings with no employer link (for example "send your CV by email") and links to the UN procurement portal (tenders) are skipped and logged in Admin → Imports.

### Organization logos

When an organization's website is known (built-in list, or a link in the posting whose domain matches the organization's name or acronym), the sync fetches its site icon once from Google's public favicon service, on the server, stores it in the database and serves it from `/api/org-logo/<slug>`. Visitors' browsers never contact Google. Icons smaller than 32 px are ignored and the organization's initials are shown instead. Up to 15 icons are fetched per sync; missing ones are retried after 30 days. Note that many UN agency logos contain the UN emblem, whose use is restricted; showing an agency's own icon next to its own vacancies is how job sites commonly identify employers, and the site's disclaimer says it is independent, but if an organization objects, remove its icon for good in the database (`update organizations set logo = null, logo_type = null, logo_blocked = true where slug = '…';`). Blocked organizations are never fetched again and are kept even while they have no listings, so the block stays.

## 3b. Search filters

- **Main filters:** What (keywords), Where (a world region or a country), Organization, Category, Grade, and Remote only.
- **Under "More filters":** contract type, years of experience required, language in requirements, type of organization, deadline, and date posted.

**Grade** offers groups (entry level, Professional, Director, National Officer, General Service, Field Service, service contracts) and exact grades such as P-3 or NO-B. **Language**, **experience** and **grade** are read from each vacancy's text and title only when they're stated, so a job without them simply doesn't appear under those filters.

Regions follow the usual UN regional split; move countries between regions in `src/config/regions.ts`. Region pages (e.g. `/locations/africa`) are built automatically.

Every results page has an **Email me jobs like these** button, and every job with a deadline has **Add to calendar** (a free .ics download with a reminder two days before) and **Remind me**. "Email me jobs like these" and "Remind me" lead to the free-trial sign-up and save the search or job with the sign-up, so you can see which features people want.

---

## 4. Microsoft Ads (Bing) quick start

**Concept test rule (decided before any ad spend, 9 Nov 2026):** at least 300 visitors arriving from ads; **passed** if 3% or more of them click "Start free trial" and leave their email, **failed** below 1%, **unclear** in between (try another ad message or price). Admin → Overview shows the verdict automatically. The thresholds are in `site.config.ts` (`conceptTest`).


1. **Tag.** In Microsoft Advertising, open **Tools → UET tag → Create** and copy the Tag ID. On Netlify, add `NEXT_PUBLIC_MS_UET_TAG_ID=<id>` and redeploy. Visitors from the EEA, UK and Switzerland see a small cookie choice, which Microsoft requires there; nobody else does.
2. **Conversion goals.** Create goals of type **Event**, each with *Action equals*:
   - `trial_signup`: free-trial sign-up for email alerts (primary). This is the conversion that matters while alerts are paid.
   - `subscribe`: free weekly email sign-up (primary; only used if `freeWeeklyEmail` is switched on).
   - `begin_trial`: clicked "Start free trial" (secondary).
   - `apply_click`: clicked "Apply on Official Website" (secondary; set it as not counted in conversions).
3. **Tracking.** Turn on **auto-tagging**, then set the account-level **Final URL suffix** to:
   `utm_source=bing&utm_medium=cpc&utm_campaign={Campaign}&utm_content={AdGroup}&utm_term={keyword}`
   **Admin → Overview → Campaigns** then shows visitors, sign-ups and trial clicks per campaign and ad group. Divide spend by sign-ups to get the cost per subscriber.
4. **Send each ad group to a matching page:**
   - Remote NGO jobs → `/remote-jobs`
   - UN data jobs → `/categories/data-analytics`
   - Jobs in a country → `/locations/<country>`
   - An organization's jobs → `/organizations/<slug>`

   Only send ads to pages that currently list several jobs. Every results page has a sign-up box after the sixth listing.
5. **Starting point.** Use phrase-match keywords such as "un jobs", "ngo jobs remote", "un data analyst jobs" and "international organization vacancies". Add negatives: salary, login, sign in, application status. Start at $5–10/day for two weeks and judge on cost per confirmed subscriber.
6. **Wording.** Don't imply you are the UN or any organization. Organization names in ad text can be restricted by trademark rules, so keep ad text generic ("UN & NGO vacancies in one place").

---

## 5. Admin (`/admin`)

- **Overview:** active vacancies, subscribers, waitlist, import status, warnings for missing setup, and usefulness metrics (visitors, job views, apply clicks, searches, top categories, organizations and searches, referring sites, campaigns).
- **Feeds:** add, edit, switch off or remove feeds; run a sync now.
- **Import history:** every run, with new, updated, duplicate, failed and skipped items and feed errors.
- **Listings:** search, remove or restore listings, and fix a category.
- **Subscribers:** counts, latest sign-ups with their alert preferences, send confirmations, send the digest now, CSV export.

Analytics are first-party and cookieless. No IP addresses are stored; visitors are counted with a hash that changes daily. Bots are filtered out. Admin and alert-link pages (`/admin`, `/alerts/confirm`, `/alerts/unsubscribe`) are never recorded, and stored page addresses keep only `utm_*` and `msclkid` parameters.

---

## 6. Paid email alerts (fake-door test)

Browsing, search and filters are free. **Email alerts are the paid product: $5/month or $12 for 3 months, after a 14-day free trial with no card.** Billing isn't switched on yet. Every "Start free trial" button records the person's email and alert preferences, then tells them plainly that trials start soon and nothing is charged today. Nobody is billed.

To read the test, compare **trial clicks** and **waitlist sign-ups** per visitor in **Admin → Overview**, including per ad campaign. Change prices, trial length and features in `site.config.ts` (`premium`).

`freeWeeklyEmail` in `site.config.ts` switches the model. With `false` (the current setting), all alerts are paid. With `true`, everyone gets a free Monday email and the paid plan is the upgrade. The weekly digest only goes to free subscribers, or to paying ones (`plan = 'premium'`), to match.

When demand is proven, the database already has `billing_customers`, `billing_subscriptions` and `saved_searches` ready for Stripe. Stripe doesn't accept businesses based in Vietnam, though, so you'd need a company in a Stripe-supported country, or a merchant of record such as Lemon Squeezy or Paddle.

---

## 7. Branding

Edit **`site.config.ts`** to change the name, wording, colours, contact email, disclaimer, prices and trial length. The logo is `src/components/brand-mark.tsx`. Categories are in `src/config/categories.ts`, known organizations (used to merge spellings) in `src/config/organizations.ts`, and duty stations in `src/config/cities.ts`.

Country flags (next to locations and in the homepage "Duty stations" row) come from the [flag-icons](https://github.com/lipis/flag-icons) package (MIT licence). They are copied into `public/flags` automatically before `npm run dev` and `npm run build`, so they are not stored in the repository. The faint flag wall on the right of the homepage hero is one generated file, `public/flag-wall.svg` (about 43 KB); change its country list in `scripts/build-flag-wall.mjs` and run `npm run build:flags`. The "Duty stations" row shows only countries with open vacancies; the UN and EU emblems are deliberately not used, because both organizations restrict use of their flags and emblems.

---

## 8. Local development

```bash
cp .env.example .env.local        # fill in DATABASE_URL (a local Postgres works)
npm install
npm run db:migrate                # create tables
npm run demo:seed                 # optional: 16 FICTIONAL listings, local databases only
npm run dev                       # http://localhost:3000
npm run sync                      # import feeds once
npm run demo:clear                # remove demo listings
npm test && npm run typecheck && npm run lint && npm run build
# Database integration tests (sync, expiry, locks, rate limits, admin sessions, cron auth).
# Use a THROWAWAY database: its tables are emptied. Without the variable they are skipped.
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/pb_test npm test
```

`.github/workflows/ci.yml` runs the type check, lint, unit tests and the integration tests (against a temporary PostgreSQL container) on every push and pull request. Actions are pinned to full commit SHAs.

### Security notes

- **Admin sign-in:** sessions last 24 hours. Signing out ends every admin session on every device; so does changing `ADMIN_PASSWORD`. The cron secret alone can't create a session. Wrong passwords are limited per visitor IP (8 per 15 minutes); more than 50 wrong passwords in 15 minutes from anywhere pauses all sign-ins for 15 minutes. If that ever locks you out, run `delete from admin_login_failures;` in the Supabase SQL editor.
- **Rate limits:** analytics events (120 per 10 minutes per IP) and admin sign-in use a small database table. The visitor IP comes from the host (`x-nf-client-connection-ip` on Netlify), never from a header the browser can set. IP addresses are never stored: the table keeps a salted one-way hash for at most 24 hours.
- **Headers:** every page sends a Content-Security-Policy (only the site itself and Microsoft's UET tag at `bat.bing.com`/`bat.bing.net`; no framing by other sites), HSTS including subdomains, and the usual nosniff/referrer/permissions headers. Inline scripts are allowed because Next.js needs them on static pages (nonces only work on pages rendered for every request). If you turn on Microsoft Clarity in the UET tag settings, add `https://*.clarity.ms` to the policy in `next.config.ts`.

Demo listings use made-up organizations, are labelled "Demo data" everywhere, are kept out of search engines and the sitemap, and the seed script refuses to run against a non-local database.

---

## 9. What was tested, and what wasn't

**Tested locally:** typecheck, lint and production build pass, and 36 unit tests pass (feed parsing, field extraction, dates, categories, grades, languages, experience, URLs, plus regression cases from an independent code review). An end-to-end import ran against a real PostgreSQL 16 with RSS, Atom and JSON Feed sample feeds, plus a broken XML feed, an HTML page and a 404. Results:
- Broken feeds are logged and the other feeds still import.
- A second run creates no duplicates.
- Cross-feed and cross-site duplicates merge.
- Deadline changes update listings, and past deadlines close them.
- Removed listings stay removed.
- Two syncs at once: the second is skipped.
- A sync started from the website stops cleanly at its time limit and leaves the rest for the scheduled run.
- Signing up again with an address that already exists changes nothing until the owner confirms by email, and the reply is the same as for a new address. Admin sign-in locks for 15 minutes after 8 wrong passwords from one IP, and for everyone after more than 50 in 15 minutes.
- All filters, alone and combined (region, country, grade, language, experience, deadline and more), return results, and the calendar download works.
- Cron endpoints reject requests without the secret.

**Tested with real feeds (8 November 2026):** ReliefWeb's public jobs feed (all jobs, and international organizations only) and an Inoreader folder feed whose Pro plan had lapsed. Of 40 items, 27 were imported, each linking to the employer's own application page (WHO, UNESCO and IOM careers sites, Workday, iCIMS, Teamtailor, Google Forms and so on). The other 13 were skipped and logged: tenders and supplier calls, and postings that only accept applications by email. A second run changed nothing. The lapsed Inoreader feed was reported as a feed error ("Inoreader has suspended this feed…"), with nothing imported or removed. No page on the site mentions or links to a job board. Fixes from this test are covered by regression tests (36 in total).

**Licensing note on ReliefWeb:** ReliefWeb's Terms & Conditions allow "personal, non-commercial use, without any right to resell or redistribute them or to compile or create derivative works therefrom". Do not use ReliefWeb feeds on the live, paid site without written permission from ReliefWeb (OCHA). The same check applies to every source in your Inoreader folder.

Also tested: every page returns the right status (404s for unknown pages, 308 to the canonical job address), JobPosting data appears only on open jobs with a description, `noindex` is set on closed, thin and filtered pages, and the sitemap and robots.txt are correct. In a real browser: sign-up → confirm (opening the link alone doesn't confirm) → unsubscribe, the free-trial sign-up form, filters updating the URL, analytics events, campaign attribution saved with sign-ups, and admin login, including a wrong password.

**Not tested (needs your accounts):**
- A working (Pro) Inoreader output feed with your sources. Only the suspended version was available; how many items each export returns is unconfirmed.
- Sending through Resend: confirmation, digest and one-click unsubscribe headers.
- Deployment on Netlify or Vercel, and Supabase's pooler.
- The GitHub Actions workflow on GitHub's servers. The commands it runs (`npm ci`, `npm run sync`, `npm run digest`) were run locally.
- The Microsoft UET tag firing in Microsoft Advertising.
