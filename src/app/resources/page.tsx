import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { PageHeader } from "@/components/page-header";
import { EpsoBook } from "@/components/epso-book";
import { INDEPENDENCE_NOTE } from "@/lib/site";

const PATH = "/resources";
const TITLE = "Resources for international job seekers";
const DESCRIPTION =
  "Guides to reading UN and international vacancies and their grades, and preparation for the EU's EPSO selection tests.";

/** Rendered again at most hourly, like the guides (the header and footer list employer types with live counts). */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

/** The site's guides, each with what it answers. New guides are added here and in the sitemap. */
const GUIDES: { href: string; title: string; text: string }[] = [
  {
    href: "/guides/how-to-read-a-un-vacancy",
    title: "How to read a UN vacancy",
    text: "What each part of a vacancy usually means: grade, contract type, duty station, closing date and time zone, who can apply, qualifications, languages and how to apply.",
  },
  {
    href: "/grades",
    title: "Grades and contract types explained",
    text: "P, D, G and NO grades, service contracts, consultancies, internships, UN Volunteers and EU staff categories, with links to the official pay scales.",
  },
  {
    href: "/grades#professional",
    title: "UN salaries",
    text: "Net base salaries for Professional and Director grades from the official ICSC scale, how post adjustment changes take-home pay by duty station, and where to find pay for local, EU and other contracts.",
  },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        width="max-w-3xl"
        title="Resources"
        crumbs={[{ href: "/", label: "Home" }, { href: PATH, label: "Resources" }]}
        intro="Guides to understanding international vacancies, and help preparing for selection tests."
        note={INDEPENDENCE_NOTE}
      />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <section aria-labelledby="guides-heading">
          <h2 id="guides-heading" className="text-[1.4rem] font-semibold leading-tight text-ink">Guides</h2>
          <ul className="mt-4 grid gap-3">
            {GUIDES.map((g) => (
              <li key={g.href}>
                <Link href={g.href} className="group block rounded-xl border border-rule bg-paper p-4 no-underline hover:border-sky-rule sm:p-5">
                  <span className="text-[1.1rem] font-bold text-ink group-hover:text-accent group-hover:underline">{g.title}</span>
                  <span className="mt-1 block text-[0.95rem] leading-relaxed text-tint-ink">{g.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="tests-heading" className="mt-10">
          <h2 id="tests-heading" className="text-[1.4rem] font-semibold leading-tight text-ink">Selection test preparation</h2>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-tint-ink">
            EU institutions recruit permanent officials, and many contract staff, through EPSO selection procedures, which usually include
            verbal, numerical and abstract reasoning tests.
          </p>
          <EpsoBook className="mt-4" source="resources" />
        </section>
      </div>
    </>
  );
}
