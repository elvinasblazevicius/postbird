import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { BILLING_LIVE } from "@/lib/billing/live";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${siteConfig.name} collects, why, who processes it and your rights.`,
  alternates: { canonical: "/privacy" },
};

const H2 = ({ id, children }: { id?: string; children: React.ReactNode }) => (
  <h2 id={id} className="scroll-mt-24 pt-2 text-xl font-semibold">{children}</h2>
);

// Keep this page in step with the code: analytics (src/lib/analytics.ts), sign-ups
// (src/lib/subscribers.ts), consent and ads (src/components/ads.tsx).
export default function PrivacyPage() {
  const op = siteConfig.operator;
  const mail = siteConfig.contactEmail;
  const mailLink = mail ? <a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a> : <>us</>;
  return (
    <>
      <PageHeader title="Privacy" crumbs={[{ href: "/", label: "Home" }, { href: "/privacy", label: "Privacy" }]} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-[1.02rem] leading-relaxed text-ink sm:px-6">
        <p className="text-sm text-slate">Last updated 9 November 2026</p>
        <p>
          This page explains what {siteConfig.name} collects, why, who helps us process it and what you can ask us to do with it.
        </p>

        <H2>Who we are</H2>
        <p>
          {siteConfig.name} is run by {op.name}, {op.address}. {op.name} is the data controller. Contact: {mailLink}.
        </p>

        <H2>Browsing the site</H2>
        <p>
          We count page views, searches and clicks on application links to learn which listings are useful. We don&apos;t set cookies for this and we never
          store your IP address. Each visit is counted with a pseudonymous code made from your IP address and browser type, combined with a secret that changes every
          day, so visits on different days can&apos;t be linked together. Search terms, the page address (without personal links) and the campaign tags of the link
          you arrived from are recorded with the count. If you start a free trial, that day&apos;s code is kept with your sign-up for up to 30 days, only to measure
          which pages lead to sign-ups. For abuse protection (for example limiting repeated sign-ups) we keep a one-way hash of IP addresses for up to 24 hours.
        </p>

        <H2 id="cookies">Advertising measurement and cookies</H2>
        <p>
          We advertise on Microsoft Advertising (Bing). To learn whether ads lead to sign-ups we may:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>record the campaign tags of the ad link you clicked (&quot;utm&quot; tags) with page counts and with any sign-up;</li>
          <li>record Microsoft&apos;s click id (&quot;msclkid&quot;), which identifies one ad click, and remember it on your device for up to 90 days. Without your consent we only note that a click id was present, not its value;</li>
          <li>load Microsoft&apos;s Universal Event Tracking (UET) tag, which sets the cookies <code>_uetsid</code>, <code>_uetvid</code> and <code>MUID</code> and sends Microsoft the pages you view here, whether you click Apply on a vacancy, and whether you start a trial or sign up. Microsoft processes this under its own <a className="text-accent underline" href="https://privacy.microsoft.com/privacystatement" rel="noopener">privacy statement</a>.</li>
        </ul>
        <p>
          In the European Economic Area, the United Kingdom and Switzerland (and when we can&apos;t tell where you are), nothing is stored on your device and Microsoft&apos;s
          tag isn&apos;t loaded unless you click &quot;Allow&quot;. Elsewhere it runs unless you opt out; we treat a Global Privacy Control signal from your browser as an opt-out. You can change your choice at any time with &quot;Cookie settings&quot; at
          the bottom of every page. You can also opt out of personalised Microsoft ads at{" "}
          <a className="text-accent underline" href="https://account.microsoft.com/privacy/ad-settings" rel="noopener">account.microsoft.com/privacy/ad-settings</a> and of
          interest-based ads generally at <a className="text-accent underline" href="https://optout.aboutads.info" rel="noopener">optout.aboutads.info</a>.
        </p>

        <H2>Email alerts and early access</H2>
        <p>
          If you sign up, we store your email address, what you signed up for, the search or vacancy you were looking at, any note you type in the optional
          &quot;Anything else&quot; box, the campaign tags of the ad or link that brought you here (the click id only if allowed, see above), and when you confirmed. We use this only to send the emails you asked
          for and to measure interest in email alerts. Every email has a one-click unsubscribe link. We never sell or share your address.
        </p>
        {BILLING_LIVE ? (
          <p>
            <strong>Payments.</strong> Subscriptions are sold by Paddle.com, our merchant of record, which collects your payment details, billing address and tax
            information under its own <a className="text-accent underline" href="https://www.paddle.com/legal/privacy" rel="noopener">privacy notice</a>. We never see or
            store your card details. Paddle tells us your email address, country, plan, subscription status and dates, and its customer and subscription IDs, which
            we use to send your alerts and let you manage your subscription. Paddle&apos;s checkout script is loaded from Paddle&apos;s servers when you start to fill
            in the trial form, so that the secure checkout opens without a wait.
          </p>
        ) : null}

        <H2>Who processes data for us</H2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Netlify (United States): hosts the website.</li>
          <li>Supabase (servers in Australia): stores the database.</li>
          <li>Resend (United States): sends our emails.</li>
          <li>GitHub (United States): runs our scheduled jobs, including sending alert emails.</li>
          <li>Microsoft (United States): advertising measurement, only as described above.</li>
          {BILLING_LIVE ? <li>Paddle (United Kingdom): sells subscriptions as merchant of record and processes payments.</li> : null}
        </ul>
        <p>
          Some of these providers are outside your country. Where the law requires it, transfers rely on the providers&apos; standard contractual clauses or equivalent safeguards.
        </p>

        <H2>Legal bases</H2>
        <p>
          Email sign-ups and advertising cookies: your consent, which you can withdraw at any time. Anonymous visit counting and abuse protection: our legitimate interest in
          running a useful and secure site. Paid alerts: performing our contract with you, and keeping records the law requires.
        </p>

        <H2>How long we keep it</H2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Anonymous visit counts: 13 months.</li>
          <li>Sign-ups that are never confirmed: deleted after 30 days.</li>
          <li>Unsubscribed addresses: deleted after 30 days, unless you still have a paid plan.</li>
          {BILLING_LIVE ? <li>Cancelled subscriptions: your address, searches and settings are deleted 30 days after the plan ends.</li> : null}
          <li>
            {BILLING_LIVE
              ? "Early-access list: we email you once to say alerts are open, and delete your address 30 days later unless you start a trial."
              : "Early-access list: until paid alerts launch; if we decide not to launch, we tell you and delete the list within 30 days."}
          </li>
          {BILLING_LIVE ? <li>Subscription records: while you subscribe, then as long as tax and accounting law requires (Paddle keeps payment records as merchant of record).</li> : null}
        </ul>

        <H2>Applications</H2>
        <p>We don&apos;t receive job applications. When you apply, you do so on the employer&apos;s website under its own privacy policy.</p>

        <H2>Your rights</H2>
        <p>
          You can ask to see, correct, export or delete your data, object to its use, or withdraw consent, by emailing {mailLink}. We reply within 30 days. If you are in the
          EEA, the UK or Switzerland you can also complain to your data protection authority.
        </p>

        <H2>Age</H2>
        <p>{siteConfig.name} is meant for adults looking for work. Email alerts are not for anyone under 16.</p>
      </div>
    </>
  );
}
