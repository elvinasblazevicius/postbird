# Global Careers Hub

A job board for UN agencies, international organizations, humanitarian groups and NGOs. It imports vacancies automatically from your Inoreader output feeds, builds search-friendly pages, collects email subscribers and Premium interest, and tracks Microsoft Ads conversions.

Stack: Next.js 16 (TypeScript, Tailwind 4), PostgreSQL on Supabase, hosting on Vercel, scheduling with GitHub Actions, email with Resend.

---

## 1. What you need (accounts and costs)

| Service | What for | Cost |
|---|---|---|
| **GitHub** | Stores the code and runs the import every 2 hours | Free. Keep the repository **private**: GitHub switches off schedules in *public* repos after 60 days without commits. This uses about 370 of the 2,000 free Actions minutes per month. |
| **Supabase** | Database | Free plan: 500 MB, which holds tens of thousands of jobs. Free projects pause after a week of inactivity; the 2-hourly import keeps it busy. |
| **Vercel** | Hosting, with a free `*.vercel.app` address | Free (Hobby) **for non-commercial use only**. Vercel's terms count taking payments and *advertising a paid service* as commercial. The Premium page and paid ads therefore mean **Vercel Pro, $20/month**, or another host whose free plan allows commercial use (not tested with this project). |
| **Inoreader** | Your job feeds | Output feeds need an Inoreader Pro plan (you already use them). |
| **Resend** | Confirmation and weekly emails | Free: 3,000 emails/month, **100 per day**. Emails only reach subscribers once you **verify a domain you own**. |
| **Domain** | Needed for email; optional for the site | About $10–15/year |
| **Microsoft Advertising** | Paid traffic (optional) | Your ad budget |

**Minimum to launch: $0.** When you start charging or running ads: about $20/month (Vercel Pro) plus a domain.

---

## 2. Deploy (about 30 minutes, no coding)

### Step 1 — Database (Supabase)
1. Create a project at supabase.com. Choose a region near your visitors (e.g. Frankfurt) and save the database password.
2. Open **SQL Editor → New query**. Paste the whole of `db/migrations/001_init.sql`, then click **Run**. It is safe to run again.
3. Click **Connect** at the top and copy the **Transaction pooler** connection string (port **6543**). Replace `[YOUR-PASSWORD]` with your password. This is your `DATABASE_URL`.

### Step 2 — Code (GitHub)
Create a **private** repository and upload this folder, without `node_modules` or `.next`. If you'd rather not do this yourself, create an empty repository and ask Claude to push the code to it.

### Step 3 — Hosting (Vercel)
1. In Vercel, click **Add New → Project** and import the repository. Leave the framework settings as they are.
2. Before you click Deploy, open **Environment Variables** and add:
   - `DATABASE_URL`: from Step 1.
   - `CRON_SECRET`: a long random string. Generate one with `openssl rand -hex 32`, or use any 40+ random letters and digits.
   - `ADMIN_PASSWORD`: your admin password, at least 10 characters.
   - `INOREADER_FEED_URLS`: your Inoreader output feed addresses, one per line. You can also add them later in the admin.
3. Click **Deploy**. Your site is live at `https://<project>.vercel.app`.

### Step 4 — Scheduled import (GitHub Actions)
In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:
- `SITE_URL` = `https://<project>.vercel.app` (no trailing slash)
- `CRON_SECRET` = the same value as in Vercel

Then go to **Actions → Scheduled jobs → Run workflow**, choose `sync` and click Run to check it works. After that it runs every 2 hours by itself. `vercel.json` also adds a once-a-day import on Vercel as a backup, which is the maximum Vercel's free plan allows.

### Step 5 — First check
Open `https://<project>.vercel.app/admin`, sign in, and click **Sync now**. The import report shows what was created, merged and skipped. Then open the homepage.

### Step 6 — Email (when you have a domain)
1. In Resend, add and verify your domain, then create an API key.
2. In Vercel, add `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Global Careers Hub <alerts@yourdomain.com>`), then redeploy.
3. In **Admin → Subscribers**, click **Send confirmation emails to unconfirmed sign-ups**. This reaches people who signed up before email was set up.

The weekly digest goes out on Mondays. Resend's free plan allows 100 emails a day, so above about 100 subscribers you'll need a paid Resend plan.

### Step 7 — Your domain (later)
In Vercel, open **Settings → Domains** and add your domain, then set `NEXT_PUBLIC_SITE_URL=https://yourdomain.com` (or `url` in `site.config.ts`). Update the GitHub `SITE_URL` secret to match.

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
- **Check the item count.** The feed card shows how many items each read returned. If it's always the same small number, the feed may only return its newest items, and busy feeds could lose some between imports. Split the feed into several folders, or run the import more often (change `17 */2 * * *` to `17 * * * *` in `.github/workflows/scheduled.yml`).

### How importing works
- Each item is turned into a listing using only what the item says: labelled lines such as "Duty Station:", "Closing date:" and "Organization:", the title, feed tags, and the employer's own domain. Anything not clearly stated is shown as **"Not specified"**.
- Deadlines are taken only from labelled dates that are unambiguous. A date like `05/06/2026` is ignored rather than guessed.
- **Duplicates** are merged when the vacancy link is the same (tracking parameters ignored), or when the same organization's vacancy appears on another website with the same reference number, or with the same title, place and deadline. The employer's own website is preferred as the Apply link.
- Listings close automatically after their deadline. Listings with no deadline are hidden 45 days after the feed last showed them. Closed listings are deleted after 90 days. Every setting is in `src/config/import.ts`.
- Removing a listing in **Admin → Listings** is permanent; later imports won't bring it back.

---

## 4. Microsoft Ads (Bing) quick start

1. **Tag.** In Microsoft Advertising, open **Tools → UET tag → Create** and copy the Tag ID. In Vercel, add `NEXT_PUBLIC_MS_UET_TAG_ID=<id>` and redeploy. Visitors from the EEA, UK and Switzerland see a small cookie choice, which Microsoft requires there; nobody else does.
2. **Conversion goals.** Create goals of type **Event**, each with *Action equals*:
   - `subscribe`: weekly alert sign-up (primary).
   - `trial_signup`: Premium interest form completed (primary).
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
- **Subscribers:** counts, latest sign-ups with Premium interests, send confirmations, send the digest now, CSV export.

Analytics are first-party and cookieless. No IP addresses are stored; visitors are counted with a hash that changes daily. Bots are filtered out.

---

## 6. Premium (fake-door test)

The `/pricing` page shows the price and a **Start free trial** button. Clicking it records interest, says plainly that Premium isn't open yet, and collects the email and alert preferences. Nobody is charged. Compare *trial clicks* with *waitlist sign-ups* in the admin to test demand and price. Change the price and features in `site.config.ts`.

When demand is proven, the database already has `billing_customers`, `billing_subscriptions` and `saved_searches` for Stripe. Note that Stripe doesn't accept businesses based in Vietnam, so you'd need a company in a Stripe-supported country, or a merchant of record such as Lemon Squeezy or Paddle.

---

## 7. Branding

Edit **`site.config.ts`** to change the name, wording, colours, contact email, disclaimer and Premium price. The logo is `src/components/brand-mark.tsx`. Categories are in `src/config/categories.ts`, known organizations (used to merge spellings) in `src/config/organizations.ts`, and duty stations in `src/config/cities.ts`.

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
```

Demo listings use made-up organizations, are labelled "Demo data" everywhere, are kept out of search engines and the sitemap, and the seed script refuses to run against a non-local database.

---

## 9. What was tested, and what wasn't

**Tested locally:** typecheck, lint and production build pass, and 17 unit tests pass (feed parsing, field extraction, dates, categories, URLs). An end-to-end import ran against a real PostgreSQL 16 with RSS, Atom and JSON Feed sample feeds, plus a broken XML feed, an HTML page and a 404. Results:
- Broken feeds are logged and the other feeds still import.
- A second run creates no duplicates.
- Cross-feed and cross-site duplicates merge.
- Deadline changes update listings, and past deadlines close them.
- Removed listings stay removed.
- Two syncs at once: the second is skipped.
- Cron endpoints reject requests without the secret.

Also tested: every page returns the right status (404s for unknown pages, 308 to the canonical job address), JobPosting data appears only on open jobs with a description, `noindex` is set on closed, thin and filtered pages, and the sitemap and robots.txt are correct. In a real browser: sign-up → confirm (opening the link alone doesn't confirm) → unsubscribe, the Premium interest form, filters updating the URL, analytics events, campaign attribution saved with sign-ups, and admin login, including a wrong password.

**Not tested (needs your accounts):**
- Real Inoreader output feeds. Their exact item fields and how many items each returns are unconfirmed; the parser handles standard RSS, Atom and JSON Feed, and Inoreader-specific link fields.
- Sending through Resend: confirmation, digest and one-click unsubscribe headers.
- Deployment on Vercel and Supabase's pooler.
- The GitHub Actions schedule.
- The Microsoft UET tag firing in Microsoft Advertising.
