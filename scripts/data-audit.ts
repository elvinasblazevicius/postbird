/**
 * Read-only report on the quality of the open listings: links that don't lead to the employer,
 * text copied from other job boards, missing employers, likely duplicates, grade codes, odd
 * places and titles. Writes nothing. Prints only listing data (public on the site anyway).
 * Usage: npm run data-audit   (or the "data-audit" option of the GitHub workflow)
 */
import { getSql } from "../src/lib/db";

async function main() {
  const sql = getSql();
  const open = sql`j.status = 'active' and not j.is_demo`;
  const section = (t: string) => console.log(`\n=== ${t} ===`);

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from jobs j where ${open}`;
  console.log(`Open listings: ${n}`);

  section("Taken down as duplicates (removed copy → kept listing)");
  for (const r of await sql<{ id: number; kept: number; t1: string; t2: string; s1: string | null; s2: string | null; d1: string | null; d2: string | null; a1: string | null; a2: string | null }[]>`
    select d.id::int, k.id::int as kept, d.title as t1, k.title as t2, d.source_host as s1, k.source_host as s2, d.deadline::text as d1, k.deadline::text as d2, d.apply_host as a1, k.apply_host as a2
      from jobs d join jobs k on k.id = substring(d.removed_reason from '#([0-9]+)')::bigint
     where d.status = 'removed' and d.removed_reason like 'Same vacancy as #%' order by d.updated_at desc limit 200`) console.log(`#${r.id} (${r.s1}, ${r.a1}, ${r.d1 ?? "-"}) → #${r.kept} (${r.s2}, ${r.a2}, ${r.d2 ?? "-"}) | ${r.t1}${r.t1 === r.t2 ? "" : ` | kept: ${r.t2}`}`);

  section("Apply hosts (top 60)");
  for (const r of await sql<{ apply_host: string | null; n: number; ex: number }[]>`
    select apply_host, count(*)::int as n, min(id)::int as ex from jobs j where ${open} group by 1 order by 2 desc limit 60`) console.log(`${r.n}\t${r.apply_host}\t#${r.ex}`);

  section("Source hosts");
  for (const r of await sql<{ source_host: string | null; n: number }[]>`
    select source_host, count(*)::int as n from jobs j where ${open} group by 1 order by 2 desc limit 40`) console.log(`${r.n}\t${r.source_host}`);

  section("Text from other job boards or closed notices (page_text / description)");
  const patterns: [string, string][] = [
    ["no longer open", "%no longer open%"], ["position has been filled", "%position has been filled%"], ["no longer accepting", "%no longer accepting%"],
    ["[email protected]", "%[email protected]%"], ["email-protection", "%email-protection%"], ["unjobnet", "%unjobnet%"], ["untalent", "%untalent%"],
    ["report this job", "%report this job%"], ["unjobs.org", "%unjobs.org%"], ["impactpool", "%impactpool%"], ["devex", "%devex%"], ["reliefweb", "%reliefweb%"],
    ["jica.go.jp", "%jica.go.jp%"],
  ];
  for (const [label, like] of patterns) {
    const rows = await sql<{ id: number }[]>`select id::int from jobs j where ${open} and (coalesce(j.page_text,'') ilike ${like} or coalesce(j.description_html,'') ilike ${like} or coalesce(j.apply_url,'') ilike ${like}) order by id limit 400`;
    console.log(`${String(rows.length).padStart(4)}  ${label}: ${rows.slice(0, 12).map((r) => `#${r.id}`).join(" ")}`);
  }

  section("Snippets around those phrases (description as stored, 3 per phrase)");
  for (const [label, re] of [["no longer open", "no longer open"], ["report this job", "report this job"], ["email protected", "email.{0,10}protected"], ["untalent", "untalent"], ["impactpool", "impactpool"], ["jica", "jica"]] as const) {
    const rows = await sql<{ id: number; source_host: string | null; snip: string }[]>`
      select id::int, source_host, substring(description_html from greatest(1, position(lower(${label.split(" ")[0]}) in lower(description_html)) - 700) for 1100) as snip
        from jobs j where ${open} and description_html ~* ${re} order by id desc limit 3`;
    for (const r of rows) console.log(`--- ${label} #${r.id} (${r.source_host}) ---\n${r.snip.replace(/\s+/g, " ")}`);
  }
  // How each source's description ends (the last 500 characters), one example per aggregator source.
  for (const host of ["unjobnet.org", "untalent.org", "impactpool.org", "unjobs.org"]) {
    const rows = await sql<{ id: number; tail: string; head: string }[]>`
      select id::int, right(description_html, 700) as tail, left(description_html, 400) as head from jobs j where ${open} and source_host = ${host} order by id desc limit 2`;
    for (const r of rows) console.log(`--- ${host} #${r.id} head ---\n${r.head.replace(/\s+/g, " ")}\n--- tail ---\n${r.tail.replace(/\s+/g, " ")}`);
  }
  const [{ ln }] = await sql<{ ln: number }[]>`select count(*)::int as ln from jobs j where ${open} and description_html ~* 'no longer open'`;
  const [{ lp }] = await sql<{ lp: number }[]>`select count(*)::int as lp from jobs j where ${open} and coalesce(page_text,'') ~* 'no longer open'`;
  console.log(`"no longer open" in description: ${ln}, in page text: ${lp}`);

  section("No employer (count, then samples: id | apply host | title)");
  const noOrg = await sql<{ id: number; apply_host: string | null; source_host: string | null; title: string }[]>`
    select id::int, apply_host, source_host, title from jobs j where ${open} and organization_id is null order by id desc`;
  console.log(`${noOrg.length} without an employer`);
  for (const r of noOrg.slice(0, 80)) console.log(`#${r.id} | ${r.apply_host} | ${r.source_host} | ${r.title}`);

  section("Likely duplicates (same employer, title and country)");
  for (const r of await sql<{ ids: number[]; title: string; deadlines: string[] }[]>`
    select array_agg(id::int order by id) as ids, min(title) as title, array_agg(coalesce(deadline::text,'-') order by id) as deadlines
      from jobs j where ${open}
     group by coalesce(organization_id, -1), lower(regexp_replace(title, '[^a-zA-Z0-9]+', ' ', 'g')), coalesce(country_code,'')
    having count(*) > 1 order by count(*) desc limit 60`) console.log(`${r.ids.map((i) => `#${i}`).join(",")} | ${r.deadlines.join(",")} | ${r.title}`);

  section("Same title open more than once (id | org id/slug | country | closing | source → apply link)");
  for (const r of await sql<{ t: string; rows: string[] }[]>`
    select min(j.title) as t, array_agg(j.id || ' | ' || coalesce(j.organization_id::text, '-') || '/' || coalesce(o.slug, '-') || ' | ' || coalesce(j.country_code, '-') || ' | ' || coalesce(j.deadline::text, '-') || ' | ' || coalesce(j.source_host, '-') || ' → ' || left(coalesce(j.apply_url, '-'), 110) order by j.id) as rows
      from jobs j left join organizations o on o.id = j.organization_id where ${open}
     group by lower(regexp_replace(j.title, '[^a-zA-Z]+', ' ', 'g')) having count(*) > 1 order by 1 limit 50`) {
    console.log(`-- ${r.t}`);
    for (const x of r.rows) console.log(`   #${x}`);
  }

  section("Grades (value, count)");
  for (const r of await sql<{ grade: string; n: number }[]>`select grade, count(*)::int as n from jobs j where ${open} and grade is not null group by 1 order by 2 desc`) console.log(`${r.n}\t${r.grade}`);
  const [{ g }] = await sql<{ g: number }[]>`select count(*)::int as g from jobs j where ${open} and grade is null`;
  console.log(`(no grade: ${g})`);

  section("Odd places");
  for (const r of await sql<{ id: number; city: string | null; country_code: string | null; location_text: string | null }[]>`
    select id::int, city, country_code, location_text from jobs j where ${open}
       and (coalesce(city,'') ~* '(unavailable|n/a|tbd|tbc|various|multiple|^-$)' or coalesce(location_text,'') ~* '(unavailable|n/a|tbd|tbc|\\(also)')
     order by id limit 40`) console.log(`#${r.id} | ${r.city} | ${r.country_code} | ${r.location_text}`);
  const [{ nl }] = await sql<{ nl: number }[]>`select count(*)::int as nl from jobs j where ${open} and country_code is null and coalesce(is_remote, false) = false and coalesce(location_text, '') = ''`;
  console.log(`(no country and not remote: ${nl})`);
  for (const r of await sql<{ id: number; city: string | null; location_text: string | null; title: string }[]>`
    select id::int, city, location_text, title from jobs j where ${open} and country_code is null and coalesce(is_remote, false) = false and coalesce(location_text, '') = '' order by id desc limit 60`) console.log(`#${r.id} | ${r.city} | ${r.location_text} | ${r.title}`);

  section("Titles with codes or sentences");
  for (const r of await sql<{ id: number; title: string }[]>`
    select id::int, title from jobs j where ${open}
       and (title ~ '[A-Z]{2,}[0-9]{2,}[A-Z0-9]{2,}' or title ~ '^[A-Z]{2}-[A-Z]{2}[0-9]' or title ~* ' is (looking|hiring|seeking)' or title ~* '^(we are|join )')
     order by id limit 60`) console.log(`#${r.id} | ${r.title}`);

  section("Categories");
  for (const r of await sql<{ category: string | null; n: number }[]>`select category, count(*)::int as n from jobs j where ${open} group by 1 order by 2 desc`) console.log(`${r.n}\t${r.category}`);

  section("Languages of listings (title words)");
  const [{ es }] = await sql<{ es: number }[]>`select count(*)::int as es from jobs j where ${open} and title ~* '\\m(oficial|asistente|coordinador|especialista|consultor|técnico|tecnico)\\M'`;
  const [{ fr }] = await sql<{ fr: number }[]>`select count(*)::int as fr from jobs j where ${open} and title ~* '\\m(chargé|charge de|responsable|assistant\\(e\\)|coordonnateur|spécialiste|consultant\\(e\\))\\M'`;
  console.log(`Spanish-looking titles: ${es}, French-looking titles: ${fr}`);

  section("Cities (top 60)");
  for (const r of await sql<{ city: string; country_code: string | null; n: number }[]>`
    select city, country_code, count(*)::int as n from jobs j where ${open} and city is not null group by 1, 2 order by 3 desc limit 60`) console.log(`${r.n}\t${r.city}, ${r.country_code}`);
}

main()
  .then(() => getSql().end({ timeout: 2 }))
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await getSql().end({ timeout: 2 });
    process.exit(1);
  });
