# Postbird

Independent job search for UN, EU and international organization vacancies, each linked to the employer's own website. It covers UN agencies, development banks, EU institutions, other international organizations and NGOs. It imports vacancies automatically from your Inoreader output feeds, builds search-friendly pages, collects paid-alert trial sign-ups, and tracks Microsoft Ads conversions.

Stack: Next.js 16 (TypeScript, Tailwind 4), PostgreSQL on Supabase, hosting on Netlify (or Vercel), scheduling with GitHub Actions, email with Resend.

---

## 1. What you need (accounts and costs)

For a low-cost test, the whole thing runs on free plans; the only purchase is a domain.

| Service | What for | Cost |
|---|---|---|
| **Netlify** (recommended for the test) | Hosting, with a free `*.netlify.app` address | Free. Commercial use is allowed. 300 credits a month: each deploy costs 15, and traffic uses the rest (about 10–15 GB of pages). If credits run out, the site pauses until next month; you are never billed automatically. Functions are limited to 10 seconds, which is why imports run in GitHub Actions. |
| **GitHub** | Stores the code; runs the import every 2 hours and the daily emails | Free. Keep the repository **private**: GitHub switches off schedules in *public* repos after 60 days without commits. About 600 of the 2,000 free Actions minutes per month. |
| **Supabase** | Database | Free plan: 500 MB, which holds tens of thousands of jobs. Free projects pause after a week of inactivity; the 2-hourly import keeps it busy. |
| **Domain** | Your address; needed for email | A .com is about $11/year at Cloudflare Registrar, which sells at cost and renews at the same price (Porkbun: about $11.81). Avoid $1–2 first-year endings like .xyz: they renew at $15+ and hurt email delivery and trust. |
| **Resend** | Confirmation and weekly emails | Free: 3,000 emails/month, **100 per day**. Emails only reach subscribers once your domain is verified. |
| **Inoreader** | Your job feeds | Output feeds need an Inoreader Pro plan (you already use them). |
| **Microsoft Advertising** | Paid traffic (optional) | Your ad budget |

**Total for the test: about $11/year, plus ad spend.**

Vercel also works, but its free plan is for non-commercial use only. Its terms count a pricing page or ads as commercial, which means Vercel Pro at $20/month.

---

## 2. Deploy on Netlify (about 30 minutes, no coding)

### Step 1 — Database (Supabase)
1. Create a project at supabase.com. Choose a region near your visitors (e.g. Frankfurt) and save the database password.
2. Open **SQL Editor → New query**. Paste the whole of `db/migrations/001_init.sql`, then click **Run**. Do the same with `002_employer_links_and_logos.sql`, `003_security.sql`, `004_billing.sql`, `005_reminders_retention.sql`, `006_events_created_at.sql`, `007_accent_insensitive_search.sql`, `008_free_weekly_email.sql`, `009_email_claim_leases.sql`, `010_billing_integrity.sql`, `011_typo_tolerant_search.sql`, `012_ops_and_canonical_email.sql`, `013_desirable_languages.sql`, `014_alert_closing_sent.sql`, `015_billing_safety.sql`, `016_trust_fixes.sql`, `017_paid_start.sql` and `018_checkout_link_claims.sql`, in that order. All are safe to run again. After this first setup you don't need to run them by hand: new ones are applied automatically (see *Database migrations* in section 8).
3. Click **Connect** at the top and copy the **Transaction pooler** connection string (port **6543**). Replace `[YOUR-PASSWORD]` with your password. This is your `DATABASE_URL`.

### Step 2 — Code (GitHub)
Create a **private** repository and upload this folder, without `node_modules` or `.next`. If you'd rather not do this yourself, create an empty repository and ask Claude to push the code to it.

### Step 3 — Hosting (Netlify)
1. In Netlify, click **Add new project → Import an existing project → GitHub** and pick the repository. The build settings are read from `netlify.toml`.
2. Before deploying, open **Environment variables**, choose **Add a variable → scope: All**, and add:
   - `DATABASE_URL`: from Step 1. Its scopes must include **Builds** (scope *All* does): production builds apply new database migrations before the site goes live (section 8, *Database migrations*). If you add it with specific scopes, tick **Builds** as well as **Functions** and **Runtime**.
   - `CRON_SECRET`: a long random string. Generate one with `openssl rand -hex 32`, or use any 40+ random letters and digits. It protects the `/api/cron` addresses and, unless you set `ADMIN_SESSION_SECRET`, is part of the admin sign-in key.
   - `ADMIN_PASSWORD`: your admin password, at least 10 characters. Changing it signs out every admin session.
   - `ANALYTICS_SALT`: another long random string (`openssl rand -hex 32`). It keys the one-way codes for visitor counts, rate limits and trial markers (one free trial per person). Add the same value as a GitHub secret in Step 4, and don't change it later: existing trial markers would stop matching.
   - `ADMIN_SESSION_SECRET` (recommended): another long random string (`openssl rand -hex 32`), used only for admin sign-ins, so the cron secret and admin sessions are independent. Setting or changing it signs you out once.
   - `INOREADER_FEED_URLS`: your Inoreader output feed addresses, one per line. You can also add them later in the admin.
   - `NEXT_PUBLIC_SITE_URL`: the site's public address, e.g. `https://postbird.nuevanova.com` (no trailing slash). When set, it wins over `url` in `site.config.ts` for canonical links, the sitemap and email links, so keep it on the real domain (or leave it empty to use `site.config.ts`).
3. Click **Deploy**. Your site is live at `https://<your-site>.netlify.app`.

### Step 4 — Scheduled import and emails (GitHub Actions)
In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:
- `DATABASE_URL`: the same value as on Netlify. It is also used by the *Deploy migrations* workflow, the backup that applies new database migrations after every push to `main` once CI has passed (or when you run it by hand).
- `CRON_SECRET` and `ANALYTICS_SALT` (both required): use exactly the same values on Netlify and in GitHub. The scheduled clean-up uses them (`ANALYTICS_SALT`, or `CRON_SECRET` if that isn't set) to write the one-way trial markers (one free trial per person, section 6) that the site checks. With different values the markers don't match, and **Admin → Overview** shows a warning. If neither is set, no marker is written: the run logs an error and keeps the addresses that would need one until it is set.
- `SITE_URL`: your site address (no trailing slash). It's used for links in emails.
- `INOREADER_FEED_URLS`: optional, the same as on Netlify.
- `RESEND_API_KEY` and `EMAIL_FROM`: once email is set up (Step 6).
- `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_PRICE_MONTHLY` and `NEXT_PUBLIC_PADDLE_PRICE_QUARTERLY`: once billing is live (section 6), the same values as on Netlify. The weekly email reads them to offer the free trial; without them it offers early access instead.
- `PADDLE_API_KEY` and `NEXT_PUBLIC_PADDLE_ENV`: required once billing is live, the same values as on Netlify. The daily run uses them to cancel a free trial whose email address was never confirmed (2 days before the trial ends, so nothing is charged), to retry any cancel in Paddle that failed when the webhook asked for it, and to check Paddle customers that couldn't be checked at the time. Without them the run logs an error and these checks don't happen.

Then go to **Actions → Scheduled jobs → Run workflow**, choose `sync` and click Run to check it works. After that it imports every 2 hours and sends the emails once a day (06:23 UTC) by itself: paid alerts to each subscriber at their chosen frequency, the billing checks above, the plan emails (a reminder about 3 days before a free trial ends, the confirmation email again on days 3 and 10 of a trial whose address isn't confirmed yet, and any welcome or confirmation email that failed to send earlier), and, on Mondays, the free weekly email when `freeWeeklyEmail` is on (the first run of the week on a Monday starts it; if no run started it on Monday, the Tuesday or Wednesday run does, so one missed run doesn't lose the week; from Thursday a run only retries a week that started and failed, and each subscriber still gets at most one weekly email per week). It runs directly against the database, so there's no time limit. The daily run goes in this order: billing checks, plan emails, the free weekly email, paid alerts. Each part runs even when an earlier one failed (the failure is listed under **Admin → Overview → Errors to look at**, and the run then shows as failed in GitHub Actions); a subscriber whose search can't be run that day gets nothing and is tried again the next day, while everyone else's email goes out.

### Step 5 — First check
Open `https://<your-site>.netlify.app/admin`, sign in, and look at **Import history**. You can also click **Sync now**. On Netlify a sync started from the website reads feeds for about 5 seconds and finishes within about 7.5 seconds (it keeps time back to close the run and release its lock), so it stays within the 10-second limit; organization icons and old-data clean-up are left to the scheduled run, which also imports the rest. If the host ever cuts a run off, its lock expires after a minute and the run is marked as failed after 30 minutes.

### Step 6 — Domain and email
1. Buy the domain (e.g. at Cloudflare Registrar). In Netlify, open **Domain management → Add a domain** and follow the DNS instructions. Then set `NEXT_PUBLIC_SITE_URL` (Netlify) and `SITE_URL` (GitHub) to `https://yourdomain.com` and redeploy.
2. In Resend, add and verify the domain, then create an API key.
3. Add `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Postbird <alerts@yourdomain.com>`) on Netlify and as GitHub secrets, then redeploy.
4. In **Admin → Subscribers**, click **Send confirmation emails to unconfirmed sign-ups**. This reaches people who signed up before email was set up.

Resend's free plan allows 100 emails a day, so above about 100 subscribers you'll need a paid Resend plan.

**On Vercel instead:** import the repository in Vercel, add the same environment variables, and deploy. The GitHub Actions setup in Step 4 is the same: it runs the import and the emails, so nothing needs scheduling on the host.

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

When an organization's website is known (built-in list, or a link in the posting whose domain matches the organization's name or acronym), the sync fetches its site icon once from Google's public favicon service, on the server, stores it in the database and serves it from `/api/org-logo/<slug>`. Visitors' browsers never contact Google. Icons smaller than 32 px are ignored and the organization's initials are shown instead. Up to 15 icons are fetched per sync; missing ones are retried after 30 days. Organizations of type *UN system* or *EU institution* never get an icon: the UN and EU emblems are protected, so their icons are never fetched, stored or served (`/api/org-logo/…` answers 404), and every scheduled import deletes any that were stored earlier (migration 005 does it once too). If any other organization objects, remove its icon for good in the database (`update organizations set logo = null, logo_type = null, logo_blocked = true where slug = '…';`). Blocked organizations are never fetched again and are kept even while they have no listings, so the block stays.

## 3b. Search filters

- **Main filters:** What (keywords), Where (a world region or a country), Organization, Category, Grade, and Remote only.
- **Under "More filters":** contract type, years of experience required, language in requirements, type of organization, deadline, and date posted.

**Grade** offers groups (entry level, Professional, Director, National Officer, General Service, Field Service, service contracts) and exact grades such as P-3 or NO-B. **Language**, **experience** and **grade** are read from each vacancy's text and title only when they're stated, so a job without them simply doesn't appear under those filters.

Regions follow the usual UN regional split; move countries between regions in `src/config/regions.ts`. Region pages (e.g. `/locations/africa`) are built automatically.

Every results page has a **Get new matches for this search in a free weekly email** link (with "daily alerts (paid plan)" next to it), and every job with a deadline has **Add to calendar** (a free .ics download with a reminder two days before). The weekly-email link opens `/alerts` with the search filled in; the daily-alerts link leads to the free-trial sign-up and saves the search with the sign-up, so you can see which features people want. A results page with no matches offers "Get an email when new … vacancies are posted", which opens `/alerts` with that search.

---

## 4. Microsoft Ads (Bing) quick start

**Concept test rule (decided before any ad spend, 9 Nov 2026):** at least 300 visitors arriving from ads; **passed** if 3% or more of them click "Start free trial" and leave their email, **failed** below 1%, **unclear** in between (try another ad message or price). Admin → Overview shows the verdict automatically. The thresholds are in `site.config.ts` (`conceptTest`).


1. **Tag.** In Microsoft Advertising, open **Tools → UET tag → Create** and copy the Tag ID. On Netlify, add `NEXT_PUBLIC_MS_UET_TAG_ID=<id>` and redeploy. Visitors everywhere except the United States see a small cookie choice first, and so do visitors whose country can't be determined; US visitors don't (they can opt out under "Cookie settings / Your privacy choices" in the footer).
2. **Conversion goals.** Create goals of type **Event**, each with *Action equals*:
   - `begin_trial`: a free trial started (sent when the Paddle checkout completes). **Primary.**
   - `purchase`: a plan paid straight away, by an address that has had its trial before (sent when the Paddle checkout completes). **Primary.**
   - `subscribe`: free weekly email sign-up (only used while `freeWeeklyEmail` is switched on). Primary or secondary, as you prefer.
   - `trial_cta_click`: clicked a "Start free trial" or daily-alerts button (interest only). Secondary, not counted in conversions.
   - `apply_click`: clicked Apply on a vacancy. Secondary, not counted in conversions.
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

- **Overview:** active vacancies, subscribers, waitlist, import status, warnings for missing setup, and usefulness metrics (visitors, job views, apply clicks, searches, top categories, organizations and searches, referring sites, campaigns). With billing on: the billing self-check (which Paddle API permissions work) and billing flags (blocked second trials, second subscriptions for one address, trials canceled because the address was never confirmed, Paddle customers whose email doesn't match), each with "Mark dealt with". **Errors to look at** lists unexpected errors from the Paddle webhook and the scheduled import and emails (no personal data; a repeat counts up), also with "Mark dealt with"; resolved ones are deleted after 90 days. A warning appears when the scheduled jobs use a different `ANALYTICS_SALT`/`CRON_SECRET` from the site, and when the daily job (emails and billing safety checks) hasn't finished successfully for 26 hours; the billing self-check card shows what the last daily run's billing checks did. `/api/health` reports `dailyJobFresh` (true or false only) for an uptime monitor, and answers **HTTP 503** (with the same JSON) when the daily job hasn't succeeded for 26 hours or the database can't be reached, so a plain status-code monitor (e.g. UptimeRobot's free HTTP monitor on `https://<your-site>/api/health`, alerting on any non-2xx answer) catches a stopped daily job as well as a site that is down. Right after setup it answers 503 until the first daily run: start one by hand (**Actions → Scheduled jobs → Run workflow → digest**) before turning the monitor on.
- **Feeds:** add, edit, switch off or remove feeds; run a sync now.
- **Import history:** every run, with new, updated, duplicate, failed and skipped items and feed errors.
- **Listings:** search, remove or restore listings, and fix a category.
- **Subscribers:** counts, latest sign-ups with their alert preferences, send confirmations, send this week's free weekly email now (any day; still at most one per subscriber per week), CSV export.

Analytics are first-party and cookieless. No IP addresses are stored; visitors are counted with a hash that changes daily. Bots are filtered out. Admin, alert-link and account pages (`/admin`, `/alerts/confirm`, `/alerts/unsubscribe`, `/account`) are never recorded, and stored page addresses keep only `utm_*` and `msclkid` parameters.

---

## 6. Paid email alerts (Paddle Billing)

Browsing, search and filters are free. **Email alerts are the paid product**, sold through [Paddle Billing](https://www.paddle.com/billing) (merchant of record: Paddle sells to the customer and handles VAT/sales tax, so no company in a Stripe country is needed). Plans, prices and trial length shown on the site come from `site.config.ts` (`premium`); the amounts actually charged come from the prices you create in Paddle, so keep the two the same.

### Two modes, one switch

- **Billing off** (any of the three `NEXT_PUBLIC_PADDLE_*` values below empty, e.g. today on the live site): the early-access "fake door". Every "Start free trial" button records the person's email and alert preferences and tells them plainly that alerts aren't open and nothing is charged.
- **Billing on** (all three set): the same buttons show the plan choice (3 months preselected), the email field and **"Start 14-day free trial"**, then open Paddle's checkout. The card is taken at sign-up, nothing is charged for 14 days, then the plan renews automatically unless cancelled.

After checkout Paddle notifies the site (`/api/paddle/webhook`). Each event is recorded and applied in one database transaction, so an event cut off half-way is applied again when Paddle retries it. Paying through the public trial form never confirms an address, because anyone can type anyone's address there: an address that isn't confirmed yet (a new one, or one on the list that was never confirmed; a confirmed address gets its trial through a link emailed to it, see below) gets a confirmation email ("Confirm your email for Postbird alerts") once the trial starts, and the page says "Your trial has started. Check your inbox and confirm your address to start your alerts." The welcome email and alerts start only after the owner confirms; the daily job resends a confirmation email that failed to send. Until then the plan doesn't count against the address's free trial and leaves no trial marker, so if it is canceled before confirmation (by the daily job, or in Paddle) the address can start a trial again, also if its owner confirms later. That also holds when the daily job cancels a trial because the address wasn't confirmed in time and the owner confirms later: confirming then says "Your trial was cancelled because the address wasn't confirmed in time. You can start it again." with a link to the trial page. A checkout opened from a link emailed to the address (below) does confirm it, because opening that link proves the mailbox. Once confirmed, the subscriber gets a welcome email with the link to **their account page** (`/account?t=…`, private, never indexed or tracked): plan and status, trial end or renewal date, up to 5 saved searches, daily or weekly emails, "Cancel plan" (opens Paddle's cancel page for the subscription), "Manage billing" (opens Paddle's customer portal: card, invoices), and unsubscribe. Lost the link? `/account/login` emails a new one (it has a separate "Cancel my plan" form that sends the same link in an email worded for cancelling); links in older emails stop working once the new email has been sent (if sending fails, the old links keep working).

**Nothing the browser sends is trusted on its own.** Each checkout records whether it may start a free trial (`trial_allowed`). If a trialing subscription arrives for a checkout that didn't allow one, or for an address that had another subscription while confirmed (or another form of the same address did, or its deleted record left a trial marker), the webhook doesn't apply it, cancels it in Paddle at once and shows it under **Admin → Overview → Billing flags**; alerts stay off and no welcome is sent. Before a Paddle customer id is stored, the webhook fetches the customer and requires its email to be the subscriber's address; on a mismatch nothing is linked, alerts stay off and it is flagged. If the customer can't be checked (no API key, Paddle unreachable), the plan is applied without linking the customer, flagged, and checked again with the next event, by the daily run or when billing is opened. A second running subscription for an address that already has one (two checkouts finished at once) is canceled in Paddle at once and never applied, and the public form won't prepare a second free-trial checkout for an address while one started in the last 5 minutes is still open (the same visitor asking again gets that checkout back; anyone else is told to try again in 5 minutes); the continue page likewise won't prepare a second checkout while one from the last 5 minutes is open. When a second subscription is canceled, the customer gets a short email saying a duplicate plan was cancelled and that replying gets the charge refunded: refund that transaction in Paddle (the billing flag says so). A cancel that fails is tried again by the daily run.

**Unconfirmed addresses.** A trial started from the public form doesn't confirm the address (anyone can type anyone's address). Only an address that was never confirmed can be in this state: a confirmed owner who later unsubscribed stays proven, even if someone else types the address into a sign-up form. The address gets a confirmation email when the trial starts and again on days 3 and 10; no trial-ending reminder goes to it. If it still isn't confirmed 2 days before the trial ends, the daily run cancels the trial in Paddle at once, so nothing is charged, and flags it (no email is sent about it). A customer portal session is only ever opened for a checked customer.

**What the trial form reveals about an address.** A new address, or one that was never confirmed and never had a plan, goes straight to Paddle with the trial. Any other address (a confirmed one, such as a free weekly email subscriber, or one that has or had a plan, or another form of it did) gets "Check your inbox: we've emailed this address a link to continue." instead. So whoever types an address can tell whether it is new or unconfirmed here, which suggests a confirmed subscriber or a plan; they can't tell which (all get the same reply, also when the daily email cap is reached), and the account link and checkout terms only go to the address. Routing confirmed addresses through their inbox means nobody else can start, and so use up, the free trial of an address whose owner we know. Hiding even the remaining bit would mean emailing every address a link before checkout, an extra step for every genuine new customer, so it was left this way. The next step goes to the address: with a running plan, its account link ("You already have daily alerts"); otherwise a single-use link valid for 24 hours to `/account/continue`, which shows the terms for that address (the free trial if it never had a plan, otherwise no trial) and then opens Paddle (at most 3 such emails an hour and 5 a day per address). The account page offers "Start your 14-day free trial" to an address that never had a plan, otherwise "Restart daily alerts"; both open the continue page straight away (the account link proves the address). The free weekly email's upgrade link is a single-use continue link too, valid 7 days (needs `ANALYTICS_SALT` or `CRON_SECRET` in the scheduled job; without one it links to the trial page).

Unsubscribing (the email link, the one-click button in Gmail/Outlook, or the account page) stops alert emails only. When the plan is still running, the unsubscribe page says so, shows the next payment date and amount, and offers **Cancel my plan** (it emails the account link, worded for cancelling: the unsubscribe link never changes, so it doesn't open billing itself) next to **Just stop emails**; the one-click button sends one email saying the plan is still active, with the cancel link. About 3 days before a free trial ends, every trialing subscriber who hasn't canceled gets one reminder with the plan, the amount, the date of the first payment and the cancel link. Emails are sent through Resend with idempotency keys and `Reply-To: info@nuevanova.com` (`contactEmail` in `site.config.ts`).

**Early-access list:** when billing goes live, **Admin → Subscribers → Email the early-access list** sends each confirmed early-access member who isn't on a plan the one promised email (alerts are open, the free trial, an unsubscribe link). Their address is deleted 30 days later unless they start a trial. Canceled plans are deleted 30 days after the cancellation (Paddle keeps the payment records), and checkout references, which link a daily visitor code to a subscriber, after 30 days. When an address that had a plan while confirmed is deleted, a one-way code of it (an HMAC with `ANALYTICS_SALT`, or `CRON_SECRET` if that isn't set; not the address) is kept for 24 months in `trial_markers`, so the address can't start a second free trial; changing that secret makes the existing codes stop matching. The scheduled jobs and the site must use the same values (Step 4); Admin → Overview warns when they don't.

**One free trial per person, not per spelling.** For the trial rule only, addresses are compared in a canonical form: lowercase, without a `+suffix` in the local part, and for Gmail without dots (`googlemail.com` counts as `gmail.com`). So `jane.doe+jobs@gmail.com` can't start a second trial after `janedoe@gmail.com` had one. Emails still go to the address exactly as typed. The canonical form is kept in `subscribers.canonical_email` (migration 012) and used for trial markers.

Alerts go out with the daily scheduled run (see Step 4): for each subscriber in trial or paying, every saved search is run for open vacancies first seen since that search's last email, and the matches are sent as one email. Each alert also ends with **Closing in the next 3 days**: up to 10 open vacancies that match any of the subscriber's searches (posted at any time) and whose closing date is between today and 3 days ahead (UTC), soonest first. Vacancies without a closing date never appear there, nor do those already among the email's new matches, and each vacancy is listed there at most once per subscriber (`alert_closing_sent`, migration 014; rows are deleted after 60 days by the import's clean-up). The section counts towards the 50 vacancies an email lists. A subscriber with no new matches but with vacancies closing soon still gets an email ("3 vacancies you follow close soon"). The free weekly email never has this section. A new plan starts on daily alerts (subscribers can switch to weekly on their account page), and its first alert goes with the next daily run, covering vacancies first seen since the plan started (or the last 24 hours), so nothing the free weekly email already sent is repeated. Daily subscribers get at most one email a day, weekly ones one a week, and nobody gets an empty email. Subscribers with a plan (trial, active, payment overdue or paused) never get the free weekly email.

**Admin → Overview** shows trials, paying subscribers, cancellations and an MRR estimate. Once billing is on, the concept-test verdict counts ad visitors who **started a trial** instead of joining early access. (Ad visitors from before the switch still count in the denominator.)

### Paddle setup (sandbox first)

Do everything in a **sandbox** account first ([sandbox-login.paddle.com](https://sandbox-login.paddle.com/signup)); nothing real is charged there and the test card is `4242 4242 4242 4242` (any future expiry, any CVC). Then repeat in the live account.

1. **Product:** Paddle → Catalog → Products → New product. Name `Postbird email alerts`, tax category *Standard digital goods* (or *SaaS*).
2. **Two prices** on that product (Catalog → product → New price), both in USD:
   - **$9.99**, billing period **every 1 month**, **trial period 14 days**, trial requires a payment method (card) — no trial price, so the trial is free.
   - **$19.99**, billing period **every 3 months**, **trial period 14 days**, trial requires a payment method — no trial price.

   Copy both price IDs (`pri_…`). If you later change a price in `site.config.ts`, create a new Paddle price with the same amount and update the env var: Paddle charges what its price says, not what the site shows.

   **Tax mode:** check Paddle → Settings → **Sales tax** (the tax mode: whether prices include tax or tax is added at checkout; each price can also set its own). The site says "Depending on where you live, VAT or sales tax is included or added; Paddle shows the exact total before you pay" (`TAX_LINE` and `EMAIL_TAX_NOTE` in `src/lib/early-access-copy.ts`), which is true either way; if you change the setting, re-read that copy and keep it in step.
3. **Default payment link:** Paddle → Checkout → Checkout configuration → Default payment link: `https://postbird.nuevanova.com/account/pay`. Paddle uses it for card updates and unpaid renewals; checkout fails with "Something went wrong" until it is set.
4. **Client-side token:** Paddle → My account → Settings → Authentication → Client-side tokens → New client-side token (`test_…` in sandbox, `live_…` in live). It is public; it goes in `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`.
5. **API key:** Paddle → My account → Settings → Authentication → API keys → New API key, with only these permissions: **Price: read**, **Transaction: write**, **Subscription: read** and **write**, **Customer: read** and **Customer portal session: write**. It goes in `PADDLE_API_KEY` (secret; never in a `NEXT_PUBLIC_` variable). What each is for: price read and transaction write create a returning customer's checkout without a trial; subscription read fetches a subscription the webhook hasn't seen; subscription write cancels a free trial an address may not have (one per email address), a second running subscription for one address, and a trial whose address was never confirmed; customer read checks that a Paddle customer's email is the subscriber's address before it is linked; customer portal session write opens "Manage billing" and "Cancel plan". After deploying, **Admin → Overview → Run billing self-check** reads the monthly price and one customer and says which permission is missing, if any (the write permissions can't be tested without changing anything).
6. **Webhook:** Paddle → Events → Notifications → New destination. Type *Webhook*, URL `https://postbird.nuevanova.com/api/paddle/webhook`, usage *Platform* (add *Simulation* too if you want to try the webhook simulator), events: `subscription.created`, `subscription.updated`, `subscription.activated`, `subscription.trialing`, `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `subscription.canceled`, `transaction.completed`. Copy the destination's secret key (`pdl_ntfset_…`) into `PADDLE_WEBHOOK_SECRET`.
7. **Environment variables** on Netlify (Site configuration → Environment variables), then redeploy (the `NEXT_PUBLIC_` values are built into the pages):
   ```
   NEXT_PUBLIC_PADDLE_ENV=sandbox            # "production" for the live account
   NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_…
   NEXT_PUBLIC_PADDLE_PRICE_MONTHLY=pri_…    # the $9.99 / month price
   NEXT_PUBLIC_PADDLE_PRICE_QUARTERLY=pri_…  # the $19.99 / 3 months price
   PADDLE_API_KEY=pdl_sdbx_apikey_…
   PADDLE_WEBHOOK_SECRET=pdl_ntfset_…
   ```
   The billing tables come with the database migrations, which the production deploy applies (section 8, *Database migrations*).
8. **Test:** start a trial with the test card, check that the account link appears (or arrives by email), that **Admin → Overview** shows one trial, that "Manage billing" opens Paddle's portal and "Cancel plan" its cancel page, and that cancelling there shows on the account page. Paddle's delivery log is under Events → Notifications.
9. **Going live:** in the live account, add `postbird.nuevanova.com` under **Paddle → My account → Settings → Website approval** (live checkouts only open on approved domains; Paddle reviews it), finish the account verification, then repeat steps 1–7 with live values and `NEXT_PUBLIC_PADDLE_ENV=production`.

To switch billing off again, empty `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` and redeploy: the forms go back to early access. Existing subscriptions keep running in Paddle and their webhooks are still processed.

`freeWeeklyEmail` in `site.config.ts` switches the model. With `true` (the current setting), anyone can sign up on `/alerts` for a free Monday email (double opt-in, no card, no account): the past week's new vacancies for the one search they choose (keywords, organization, location), or the week's newest if they choose none, at most 10 listed with "See all", and nothing in a week without new matches. The paid plan is the upgrade: daily (or weekly) alerts for up to 5 searches. Free subscribers keep one saved search (the database enforces 1 without a plan and 5 with one); they can change it from the account link in each email or by signing up again. If a paid plan ends, the address gets the free weekly email only if it had signed up for it. With `false`, all alerts are paid.

---

## 7. Branding

Edit **`site.config.ts`** to change the name, wording, colours, contact email, disclaimer, prices and trial length. The logo is `src/components/brand-mark.tsx`. Categories are in `src/config/categories.ts`, known organizations (used to merge spellings) in `src/config/organizations.ts`, and duty stations in `src/config/cities.ts`.

Country flags (next to locations and in the homepage "Duty stations" row) come from the [flag-icons](https://github.com/lipis/flag-icons) package (MIT licence). They are copied into `public/flags` automatically before `npm run dev` and `npm run build`, so they are not stored in the repository. The "Duty stations" row shows only countries with open vacancies; the UN and EU emblems are deliberately not used, because both organizations restrict use of their flags and emblems.

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

### Database migrations

New files in `db/migrations` are applied in order, once each (`npm run db:migrate`; already-applied ones are skipped):

1. **Netlify production build**, before `next build` (`scripts/build-netlify.sh`, set in `netlify.toml`). A failed migration fails the build, so the new code never goes live without its database changes; the previous deploy keeps running. This needs `DATABASE_URL` with the **Builds** scope (Step 3); without it the build prints a notice and continues. Like the two workflows below, the build migrates only when **CI passed for its commit**: it asks GitHub's API (no token needed for a public repository; for a private one it uses `GITHUB_TOKEN` if you add one to Netlify's build environment, with read access to Actions) for the CI run of `COMMIT_REF`, waiting up to 8 minutes while CI is still running. If CI failed, the build fails, so the commit's code never goes live (the previous deploy keeps running). If CI's result can't be found out (private repository without a token, GitHub's API limit, CI still running after 8 minutes, a canceled run), the build continues without migrating and prints a notice; the *Deploy migrations* workflow then applies them once CI passes. Netlify itself has no setting that holds a deploy until GitHub's checks pass (the alternatives are **Deploys → Stop auto publishing**, then publishing each deploy by hand once CI is green, or unlinking the repository and starting production builds from a build hook that a GitHub workflow calls after CI passes; note that **Build status → Stopped builds** also blocks build hooks), so this wait in the build script is what gates production deploys on CI. Deploy previews and branch deploys never migrate: they share the production database.
2. **Deploy migrations** workflow, after CI passed on `main` (backup).
3. **Scheduled jobs** workflow, before each task, only when the latest CI run for that commit succeeded.

Because the database changes before the new code is live (and previews run new code against it), every migration must be **additive** (expand only): add tables, columns with defaults or nullable, indexes, or replace functions in a way the current code still works with. Never drop or rename a column or table, or tighten a constraint, in the same release that stops using it: first ship code that no longer needs it, then remove it in a later migration. Migrations must also be safe to run again (`if not exists`, `create or replace`, `on conflict do nothing`).

### Security notes

- **Admin sign-in:** sessions last 24 hours. Signing out ends every admin session on every device; so does changing `ADMIN_PASSWORD`. The cron secret alone can't create a session. Wrong passwords are limited per visitor IP (8 wrong passwords and 30 attempts per 15 minutes); there is no limit across all visitors, so nobody can lock you out by guessing from many addresses. If your own connection ever gets locked, wait 15 minutes or run `delete from admin_login_failures;` in the Supabase SQL editor.
- **Rate limits:** analytics events (120 per 10 minutes per IP) and admin sign-in use a small database table. The visitor IP comes from the host (`x-nf-client-connection-ip` on Netlify), never from a header the browser can set. IP addresses are never stored: the table keeps a salted one-way hash for at most 24 hours.
- **Database time limits:** the app connects with a 5-second connection timeout, and its transactions (the Paddle webhook, and the public job search and filter-count queries: `searchJobs`, `facetSnapshot` and `filteredFacets` in `src/lib/jobs.ts`, which each run in their own short transaction for this reason) set an 8-second statement timeout with `SET LOCAL`, which works through Supabase's transaction pooler. The pooler doesn't accept session settings, so a limit for every other query has to be set on the database role in the Supabase SQL editor, e.g. `alter role postgres set statement_timeout = '8s';` (check the role name in your connection string; it also applies to the scheduled jobs, so pick a value their largest clean-up queries stay under). Migrations are exempt from the role's limit: each migration transaction turns `statement_timeout` off for itself first (`SET LOCAL`), so a long index build isn't cut off. Every query also has a 12-second limit on the app's side (`query_timeout` in `src/lib/db.ts`; migrations have none), the backstop for a pooler or network that stops answering, and queries are never pipelined on one connection (`max_pipeline: 1`), which Supabase's pooler before Supavisor 2.10 can't handle.
- **CDN caching:** public pages (home, job lists and job pages, organizations, locations, categories, remote jobs, pricing, about, the sitemap and robots.txt) are cached by Netlify's CDN for 5 minutes, then served stale for up to 10 minutes while a fresh copy is made (`next.config.ts`). Account, alert, admin and API pages are never cached. New listings therefore appear on the site within about 5 to 15 minutes of an import.
- **Headers:** every page sends a Content-Security-Policy (only the site itself and Microsoft's UET tag at `bat.bing.com`/`bat.bing.net`; no framing by other sites), HSTS including subdomains, and the usual nosniff/referrer/permissions headers. Inline scripts are allowed because Next.js needs them on static pages (nonces only work on pages rendered for every request). If you turn on Microsoft Clarity in the UET tag settings, add `https://*.clarity.ms` to the policy in `next.config.ts`.

Demo listings use made-up organizations, are labelled "Demo data" everywhere, are kept out of search engines and the sitemap, and the seed script refuses to run against a non-local database.

---

## 9. What was tested, and what wasn't

**Tested locally:** typecheck, lint and production build pass, and the unit tests and database integration tests pass (feed parsing, field extraction, dates, categories, grades, languages, experience, URLs, billing and emails, plus regression cases from independent code reviews). An end-to-end import ran against a real PostgreSQL 16 with RSS, Atom and JSON Feed sample feeds, plus a broken XML feed, an HTML page and a 404. Results:
- Broken feeds are logged and the other feeds still import.
- A second run creates no duplicates.
- Cross-feed and cross-site duplicates merge.
- Deadline changes update listings, and past deadlines close them.
- Removed listings stay removed.
- Two syncs at once: the second is skipped.
- A sync started from the website stops cleanly at its time limit and leaves the rest for the scheduled run.
- Signing up again with an address that already exists changes nothing until the owner confirms by email, and the reply is the same as for a new address. Admin sign-in locks a connection for 15 minutes after 8 wrong passwords from its IP; there is no lock across all connections.
- All filters, alone and combined (region, country, grade, language, experience, deadline and more), return results, and the calendar download works.
- Cron endpoints reject requests without the secret.

**Tested with real feeds (8 November 2026):** ReliefWeb's public jobs feed (all jobs, and international organizations only) and an Inoreader folder feed whose Pro plan had lapsed. Of 40 items, 27 were imported, each linking to the employer's own application page (WHO, UNESCO and IOM careers sites, Workday, iCIMS, Teamtailor, Google Forms and so on). The other 13 were skipped and logged: tenders and supplier calls, and postings that only accept applications by email. A second run changed nothing. The lapsed Inoreader feed was reported as a feed error ("Inoreader has suspended this feed…"), with nothing imported or removed. No page on the site mentions or links to a job board. Fixes from this test are covered by regression tests.

**Licensing note on ReliefWeb:** ReliefWeb's Terms & Conditions allow "personal, non-commercial use, without any right to resell or redistribute them or to compile or create derivative works therefrom". Do not use ReliefWeb feeds on the live, paid site without written permission from ReliefWeb (OCHA). The same check applies to every source in your Inoreader folder.

Also tested: every page returns the right status (404s for unknown pages, 308 to the canonical job address), JobPosting data appears only on open jobs with a description, `noindex` is set on closed, thin and filtered pages, and the sitemap and robots.txt are correct. In a real browser: sign-up → confirm (opening the link alone doesn't confirm) → unsubscribe, the free-trial sign-up form, filters updating the URL, analytics events, campaign attribution saved with sign-ups, and admin login, including a wrong password.

**Not tested (needs your accounts):**
- A working (Pro) Inoreader output feed with your sources. Only the suspended version was available; how many items each export returns is unconfirmed.
- Sending through Resend: confirmation, digest and one-click unsubscribe headers.
- Deployment on Netlify or Vercel, and Supabase's pooler.
- The GitHub Actions workflow on GitHub's servers. The commands it runs (`npm ci`, `npm run sync`, `npm run digest`) were run locally.
- The Microsoft UET tag firing in Microsoft Advertising.
