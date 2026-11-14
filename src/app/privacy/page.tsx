import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { BILLING_LIVE } from "@/lib/billing/live";
import { META_PIXEL_ID } from "@/lib/meta-pixel";
import { siteConfig } from "@/lib/site";

/**
 * Built at deploy without the database, so the header and footer list only the employer types that
 * always have vacancies; rendered again at most hourly after that, with the real counts (employerNav
 * in src/components/site-header.tsx).
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${siteConfig.name} collects, why, who processes it and your rights.`,
  alternates: { canonical: "/privacy" },
};

const H2 = ({ id, children }: { id?: string; children: React.ReactNode }) => (
  <h2 id={id} className="scroll-mt-24 pt-2 text-xl font-semibold">{children}</h2>
);

// Keep this page in step with the code: analytics (src/lib/analytics.ts), sign-ups
// (src/lib/subscribers.ts), consent and ads (src/components/ads.tsx, src/lib/meta-pixel.ts).

/** Meta's pixel is described only while it is switched on (NEXT_PUBLIC_META_PIXEL_ID). */
const META = Boolean(META_PIXEL_ID);

/** Where we ask before anything optional is stored (consentRequiredFor in src/app/api/geo/route.ts). */
const ASK_FIRST = "Everywhere except the United States";
/** When the location isn't known, we ask too. */
const ASK_FIRST_UNKNOWN = "and when we can\u2019t tell where you are";

export default function PrivacyPage() {
  const op = siteConfig.operator;
  const mail = siteConfig.contactEmail;
  const mailLink = mail ? <a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a> : <>us</>;
  return (
    <>
      <PageHeader width="max-w-3xl" title="Privacy" crumbs={[{ href: "/", label: "Home" }, { href: "/privacy", label: "Privacy" }]} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-[1.02rem] leading-relaxed text-ink sm:px-6">
        <p className="text-sm text-slate">Last updated 12 November 2026</p>
        <p>
          This page explains what {siteConfig.name} collects, why, who helps us process it and what you can ask us to do with it.
        </p>

        <H2>Who we are</H2>
        <p>
          {siteConfig.name} is run by {op.name}, {op.legalForm}, {op.address}. {op.name} is the data controller. Contact: {mailLink}.
        </p>

        <H2>Browsing the site</H2>
        <p>
          To learn which listings and pages are useful, we count page views, vacancy views, searches, clicks on Apply links, clicks on the email-alert {BILLING_LIVE ? "(free trial)" : "(free trial or early access)"}{" "}
          buttons and clicks on the book link described below, as well as sign-ups{BILLING_LIVE ? "" : <> and the answer to the optional &quot;which plan would you choose?&quot; question</>}. We don&apos;t set cookies for this. Our own visit counts never store your IP address (our host, Netlify, processes it to serve the site and keeps it briefly in its logs). Each visit is counted with a pseudonymous code made from your IP address and
          browser type, combined with the date and a secret key, so visits on different days can&apos;t be linked together. Search terms, the page address (without
          personal links), the campaign tags of the link you arrived from and the name of the website that linked to us (only its domain, never the full address)
          are recorded with the count. If you sign up, that day&apos;s pseudonymous code is kept with the sign-up count for up to 13
          months, and linked to your subscription for up to 30 days, only to measure which pages lead to sign-ups. For abuse protection (for example limiting repeated sign-ups) we keep a one-way
          hash of IP addresses for up to 24 hours.
        </p>
        <p>
          <strong>Where you are.</strong> We use the country your connection appears to come from (from our host, Netlify; not stored) to decide whether
          to ask for cookie consent first.
        </p>
        <p>
          <strong>What is stored on your device.</strong> {ASK_FIRST} ({ASK_FIRST_UNKNOWN}), before you make a choice we store only <code>gch_geo</code> (a session flag in session storage that notes whether we need to ask for consent,
          deleted when you close the tab) and your cookie choice (<code>gch_ads_consent</code>, in local storage) once you make it. In the United States, unless you opt out or
          your browser sends Global Privacy Control, we also store <code>gch_attr</code> in local storage: the campaign tags and Microsoft click id of the ad you came
          from, used for up to 90 days and then deleted. {META ? "Microsoft's and Meta's tags then also set" : "Microsoft's tag then also sets"} the cookies listed below. If you use &quot;Save&quot; on a vacancy,
          the list of saved vacancies is kept in your browser&apos;s local storage on this device only; to show which saved vacancies are still open, the{" "}
          <a className="text-accent underline" href="/saved">Saved jobs</a> page sends us their vacancy numbers, and nothing else.
        </p>

        <H2 id="cookies">Advertising measurement and cookies</H2>
        <p>
          {META
            ? "We advertise on Microsoft Advertising and on Meta (Facebook and Instagram), and may advertise on other platforms; only Microsoft's and Meta's tags are used on this site."
            : "We advertise on Microsoft Advertising and may advertise on other platforms; only Microsoft's tag is used on this site."}{" "}
          To learn whether ads lead to sign-ups we may:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>record the campaign tags of the ad link you clicked (&quot;utm&quot; tags) with page counts and with any sign-up;</li>
          <li>record Microsoft&apos;s click id (&quot;msclkid&quot;), which identifies one ad click, and remember it on your device for up to 90 days. With your consent the Microsoft click id is kept with our visit counts for up to 90 days, then reduced to &quot;present&quot;. Without your consent we only note that a click id was present, not its value;</li>
          <li>
            load Microsoft&apos;s Universal Event Tracking (UET) tag, which sets the cookies <code>_uetsid</code>, <code>_uetvid</code>, <code>_uetmsclkid</code> and <code>MUID</code>, with matching entries in
            local storage, and sends
            Microsoft these events: the pages you view here (<code>page_view</code>), clicks on Apply (<code>apply_click</code>), clicks on an email-alert button
            (<code>trial_cta_click</code>), {BILLING_LIVE ? "joining the email list" : "joining early access or the email list"} (<code>trial_signup</code>, <code>subscribe</code>) and a completed checkout
            (<code>begin_trial</code> for a free trial, <code>purchase</code> for a plan that starts straight away). Microsoft processes this under its own{" "}
            <a className="text-accent underline" href="https://privacy.microsoft.com/privacystatement" rel="noopener">privacy statement</a>.
          </li>
          {META ? (
            <li>
              load the Meta Pixel from Meta Platforms, which measures visits from our Facebook and Instagram ads and the sign-ups they lead to. It sets the
              cookies <code>_fbp</code> and, when you arrive from a Meta ad link, <code>_fbc</code>, and sends Meta these events: the pages you view here
              (<code>PageView</code>, with the page address as shown in your address bar, which on search results includes the search filters), signing up
              for the free weekly email (<code>Lead</code>) and a completed checkout (<code>StartTrial</code> for a free trial, <code>Purchase</code> with the
              plan&apos;s price for a plan that starts straight away). So that these sign-ups are counted even when a browser blocks Meta&apos;s script, our
              server also reports the same three sign-up events to Meta (its Conversions API), only after you clicked &quot;Allow&quot;: the event, the page
              address, your IP address and browser type (which Meta uses to match the visit), Meta&apos;s cookie values above, and your email address only as a
              one-way scrambled code (a SHA-256 hash), never in readable form. We never send Meta your name or what you enter in our sign-up forms
              (including the search you choose for alerts); search filters reach Meta only as part of a results page&apos;s address. We have switched off the
              pixel&apos;s automatic detection of buttons and forms. Meta processes this under its own{" "}
              <a className="text-accent underline" href="https://www.facebook.com/privacy/policy/" rel="noopener">privacy policy</a>.
            </li>
          ) : null}
        </ul>
        <p>
          {ASK_FIRST} ({ASK_FIRST_UNKNOWN}), nothing except the <code>gch_geo</code> session flag (and your choice, once you make it) is stored on your device, and
          {META ? " neither Microsoft's nor Meta's tag is loaded," : " Microsoft's tag isn't loaded,"} unless you click &quot;Allow&quot;. If you click &quot;No thanks&quot; later, we delete the {META ? "Microsoft and Meta" : "Microsoft"} cookies and storage entries
          listed above that were set on this site, and the remembered campaign tags{META ? ", and tell Meta's pixel to stop sending anything" : ""}. In the United States it runs unless you opt out; we treat a Global Privacy Control signal from your browser as an opt-out. You can change your choice at any time with &quot;Cookie settings / Your privacy choices&quot; at
          the bottom of every page. You can also opt out of personalized Microsoft ads at{" "}
          <a className="text-accent underline" href="https://account.microsoft.com/privacy/ad-settings" rel="noopener">account.microsoft.com/privacy/ad-settings</a> and of
          interest-based ads generally at <a className="text-accent underline" href="https://optout.aboutads.info" rel="noopener">optout.aboutads.info</a>
          {META ? (
            <>
              , and choose how Meta uses your activity for ads in your{" "}
              <a className="text-accent underline" href="https://accountscenter.facebook.com/ad_preferences" rel="noopener">Meta ad preferences</a>
            </>
          ) : null}
          .
        </p>

        <H2 id="us-privacy-choices">Your US privacy choices</H2>
        <p>
          We don&apos;t sell your data. {META ? "Microsoft's and Meta's advertising tags" : "Microsoft's advertising tag"} may count as &quot;sharing&quot; for targeted advertising under some US state
          laws; opt out with &quot;Your privacy choices&quot; at the bottom of every page or with Global Privacy Control.
        </p>

        <H2>{siteConfig.freeWeeklyEmail ? `Weekly email${BILLING_LIVE ? " and daily alerts" : ", daily alerts and early access"}` : BILLING_LIVE ? "Email alerts" : "Email alerts and early access"}</H2>
        <p>
          If you sign up, we store your email address, what you signed up for, the search or vacancy you were looking at,{BILLING_LIVE ? "" : <> any note you type in the optional &quot;Anything else&quot; box,</>} the campaign tags of the ad or link that brought you here (the click id only if allowed, see above), and when you confirmed. We use this only to send the emails you asked
          for and to measure interest in daily alerts. Every email has a one-click unsubscribe link. We never sell your address, and share it only with the providers listed below to run the service.
          {mail ? <> If you reply to one of our emails, your reply goes to {mailLink}.</> : null}
        </p>
        {siteConfig.freeWeeklyEmail ? (
          <p>
            <strong>Free weekly email.</strong> For the free weekly email we also store the one search you chose (keywords, organization, location and any other
            filters, or none), a private link to change it, when you confirmed and when we last emailed you. Nothing is sent until you confirm your address with
            the link we email you. We email you only on Mondays (or, if a Monday send fails, later that week), and only when there are new vacancies for your search.
          </p>
        ) : null}

        <H2>Feature suggestions</H2>
        <p>
          When you send a message from the &ldquo;Suggest a feature&rdquo; page, we keep the message, the email address you give (if any) and the page you came
          from, and forward them to our own inbox, so we can read it and, if you asked, reply. We delete them when you ask us to.
        </p>

        <H2>Our book link</H2>
        <p>
          Pages about EU institution vacancies show a test-preparation book published by {op.name}, which runs {siteConfig.name}. Its link goes to the book&apos;s
          page on Amazon. To open the Amazon store for your country, we look at the country your connection comes from at the moment you click; we don&apos;t store it.
          Amazon has its own privacy policy. We only count the click, as described above.
        </p>
        {BILLING_LIVE ? <H2 id="payments">Payments</H2> : null}
        {BILLING_LIVE ? (
          <p>
            Subscriptions are sold by Paddle.com, our merchant of record, which collects your payment details, billing address and tax
            information under its own <a className="text-accent underline" href="https://www.paddle.com/legal/privacy" rel="noopener">privacy notice</a>. We never see or
            store your card details. Paddle tells us your email address, country, plan, subscription status and dates, and its customer and subscription IDs, which
            we use to send your alerts and let you manage your subscription. Paddle&apos;s checkout script (Paddle.js) is loaded from Paddle&apos;s servers only
            once you use a checkout form, so that the secure checkout opens without a wait: where we ask first about cookies (see above), when you click into
            the email field or start the checkout; in the United States also when you point at the form. Once loaded, Paddle.js sets Cloudflare&apos;s <code>__cf_bm</code>{" "}
            cookie on paddle.com (bot protection). On live checkouts Paddle.js may also load Paddle
            Retain (formerly ProfitWell, part of Paddle), which Paddle uses for payment recovery and subscription analytics under Paddle&apos;s privacy notice.
          </p>
        ) : null}

        <H2>Who processes data for us</H2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Netlify (United States): hosts the website.</li>
          <li>Supabase (servers in the United States): stores the database.</li>
          <li>Resend (United States): sends our emails.</li>
          {mail ? <li>Our email hosting provider: receives and stores the messages you send to {mailLink}.</li> : null}
          <li>GitHub (United States): runs our scheduled jobs, including sending alert emails.</li>
          <li>Microsoft (United States): advertising measurement, only as described above.</li>
          {META ? <li>Meta Platforms (Ireland and United States): advertising measurement for our Facebook and Instagram ads, only as described above.</li> : null}
          {BILLING_LIVE ? <li>Paddle (United Kingdom): sells subscriptions as merchant of record and processes payments.</li> : null}
          {BILLING_LIVE ? <li>Paddle Retain (part of Paddle): payment recovery and subscription analytics, on live checkouts only.</li> : null}
        </ul>
        <p>
          Some of these providers are outside your country. Where the law requires it, transfers rely on the providers&apos; standard contractual clauses or equivalent safeguards.
        </p>

        <H2>Legal bases</H2>
        <p>
          Email sign-ups and advertising cookies: your consent, which you can withdraw at any time. Pseudonymous visit counting and abuse protection: our legitimate interest in
          running a useful and secure site. Paid alerts: performing our contract with you, and keeping records the law requires. One-trial records and
          unfinished-checkout data: our legitimate interest in preventing abuse of the free trial.
        </p>

        <H2>How long we keep it</H2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Pseudonymous visit counts: 13 months.</li>
          <li>Sign-ups that are never confirmed: deleted 30 days after the last confirmation email, with the search you chose.</li>
          <li>Unsubscribed addresses: deleted 30 days after you unsubscribe, with your searches, unless you still have a paid plan.</li>
          {siteConfig.freeWeeklyEmail ? <li>Free weekly email: kept while you are subscribed; unsubscribing starts the 30 days above.</li> : null}
          {BILLING_LIVE ? (
            <li>
              Canceled subscriptions: your address, searches and settings are deleted 30 days after the plan ends
              {siteConfig.freeWeeklyEmail ? ", unless you have also signed up for the free weekly email and are still subscribed to it (then we keep your address and searches for that email)" : ""}.
            </li>
          ) : null}
          {BILLING_LIVE ? (
            <li>Which vacancies your alerts listed as closing soon (so each is listed once): 60 days, or until your address is deleted.</li>
          ) : null}
          <li>
            {BILLING_LIVE
              ? "Early-access list (only people who joined before daily alerts opened): we email you once to say alerts are open, and delete your address 30 days later unless you start a trial."
              : "Early-access list: until paid alerts launch; if we decide not to launch, we tell you and delete the list within 30 days."}
          </li>
          {BILLING_LIVE ? (
            <li>
              Subscription records: we keep none beyond the 30 days above; Paddle keeps payment and tax records as merchant of record. (We keep the ids of
              Paddle&apos;s notifications, with no personal data, for a year, only to ignore repeats.)
            </li>
          ) : null}
          {BILLING_LIVE ? (
            <li>Record that you agreed to automatic renewal: kept with your subscription records for as long as we keep them.</li>
          ) : null}
          {BILLING_LIVE ? (
            <li>
              If you start a checkout and don&apos;t finish it, we keep the address and search you entered for 30 days, then delete them. We don&apos;t email you about it.
            </li>
          ) : null}
          {BILLING_LIVE ? <li>Addresses that started a free trial: a one-way code (not the address), kept 24 months, only to apply the one-trial rule.</li> : null}
        </ul>

        <H2>Applications</H2>
        <p>We don&apos;t receive job applications. When you apply, you do so on the employer&apos;s website under its own privacy policy.</p>

        <H2>Your rights</H2>
        <p>
          You can ask to see, correct, export or delete your data, object to its use, or withdraw consent, by emailing {mailLink}. We reply within 30 days. If you are in the
          EEA, the UK or Switzerland you can also complain to your data protection authority.
        </p>

        <H2>Age</H2>
        <p>
          {siteConfig.name} is meant for adults looking for work. You must be at least 16 to sign up for our emails, and at least 18 to buy a subscription
          (see the <a className="text-accent underline" href="/terms#age">terms</a>). We don&apos;t knowingly collect data from anyone younger.
        </p>
      </div>
    </>
  );
}
