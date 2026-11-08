import { XMLParser, XMLValidator } from "fast-xml-parser";

/** One feed entry, as close to the source as possible. */
export type RawItem = {
  guid: string | null;
  title: string;
  /** Candidate links in order of preference (the first non-aggregator link wins later). */
  links: string[];
  summaryHtml: string | null;
  contentHtml: string | null;
  published: string | null;
  updated: string | null;
  author: string | null;
  categories: string[];
  /** Name of the original publication, when an aggregator (e.g. Inoreader) provides it. */
  sourceTitle: string | null;
  sourceUrl: string | null;
};

export type ParsedFeed = {
  format: "rss" | "atom" | "rdf" | "jsonfeed";
  title: string | null;
  items: RawItem[];
};

export class FeedParseError extends Error {}

type Node = unknown;

function txt(v: Node): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return txt(o["#text"]);
    if ("__cdata" in o) return txt(o["__cdata"]);
    if ("name" in o) return txt(o["name"]); // atom author
  }
  return null;
}

function arr<T = Node>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function attr(v: Node, name: string): string | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const a = (v as Record<string, unknown>)[`@_${name}`];
    return typeof a === "string" ? a.trim() || null : null;
  }
  return null;
}

function uniq(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const l of list) {
    const s = l?.trim();
    if (s && /^https?:\/\//i.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  removeNSPrefix: false,
});

function parseRssItem(it: Record<string, Node>): RawItem {
  const guidNode = it["guid"];
  const guid = txt(guidNode);
  const guidIsLink = attr(guidNode, "isPermaLink") !== "false" && guid && /^https?:/i.test(guid);
  const source = it["source"];
  return {
    guid,
    title: txt(it["title"]) ?? "",
    links: uniq([
      txt(it["feedburner:origLink"]),
      txt(it["link"]),
      ...arr(it["atom:link"]).map((l) => attr(l, "href")),
      guidIsLink ? guid : null,
    ]),
    summaryHtml: txt(it["description"]),
    contentHtml: txt(it["content:encoded"]),
    published: txt(it["pubDate"]) ?? txt(it["dc:date"]),
    updated: txt(it["atom:updated"]),
    author: txt(it["dc:creator"]) ?? txt(it["author"]),
    categories: arr(it["category"]).map(txt).filter((c): c is string => !!c),
    sourceTitle: txt(source),
    sourceUrl: attr(source, "url"),
  };
}

function parseAtomEntry(e: Record<string, Node>): RawItem {
  const links = arr(e["link"]);
  const alternate = links.filter((l) => !attr(l, "rel") || attr(l, "rel") === "alternate").map((l) => attr(l, "href"));
  const via = links.filter((l) => attr(l, "rel") === "via" || attr(l, "rel") === "related").map((l) => attr(l, "href"));
  const source = e["source"] as Record<string, Node> | undefined;
  return {
    guid: txt(e["id"]),
    title: txt(e["title"]) ?? "",
    links: uniq([...alternate, ...via]),
    summaryHtml: txt(e["summary"]),
    contentHtml: txt(e["content"]),
    published: txt(e["published"]) ?? txt(e["updated"]),
    updated: txt(e["updated"]),
    author: arr(e["author"]).map(txt).find(Boolean) ?? null,
    categories: arr(e["category"]).map((c) => attr(c, "label") ?? attr(c, "term") ?? txt(c)).filter((c): c is string => !!c),
    sourceTitle: source ? txt(source["title"]) : null,
    sourceUrl: source ? arr(source["link"]).map((l) => attr(l, "href")).find(Boolean) ?? null : null,
  };
}

function parseJsonFeed(body: string): ParsedFeed {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body);
  } catch {
    throw new FeedParseError("The feed is not valid JSON.");
  }
  const items = (data.items ?? (data as { entries?: unknown[] }).entries) as unknown[] | undefined;
  if (!Array.isArray(items)) throw new FeedParseError("JSON feed has no 'items' list.");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    format: "jsonfeed",
    title: str(data.title),
    items: items.map((raw) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const authors = [it.author, ...(Array.isArray(it.authors) ? it.authors : [])]
        .map((a) => (typeof a === "string" ? a : str((a as { name?: unknown } | undefined)?.name)))
        .filter(Boolean) as string[];
      const origin = (it.origin ?? it._origin ?? it.source) as Record<string, unknown> | undefined;
      const canonical = Array.isArray(it.canonical) ? (it.canonical[0] as { href?: string })?.href : undefined;
      const alternate = Array.isArray(it.alternate) ? (it.alternate[0] as { href?: string })?.href : undefined;
      const tags = Array.isArray(it.tags) ? it.tags : Array.isArray(it.categories) ? it.categories : [];
      return {
        guid: str(it.id) ?? str(it.guid),
        title: str(it.title) ?? "",
        links: uniq([str(it.external_url), canonical, alternate, str(it.url), str(it.link), str(it.id)]),
        summaryHtml: str(it.summary) ?? str(it.description),
        contentHtml: str(it.content_html) ?? str(it.content) ?? str(it.content_text),
        published: str(it.date_published) ?? str(it.published) ?? str(it.pubDate) ?? str(it.date),
        updated: str(it.date_modified) ?? str(it.updated),
        author: authors[0] ?? null,
        categories: tags.map((t) => (typeof t === "string" ? t : str((t as { label?: unknown })?.label) ?? "")).filter(Boolean),
        sourceTitle: origin ? str(origin.title) : null,
        sourceUrl: origin ? str(origin.htmlUrl) ?? str(origin.url) ?? str(origin.home_page_url) : null,
      };
    }),
  };
}

/** Parse RSS 2.0, RSS 1.0 (RDF), Atom or JSON Feed text. */
export function parseFeed(body: string): ParsedFeed {
  const trimmed = body.replace(/^﻿/, "").trim();
  if (!trimmed) throw new FeedParseError("The feed is empty.");
  if (trimmed.startsWith("{")) return parseJsonFeed(trimmed);
  if (!trimmed.startsWith("<")) throw new FeedParseError("The response is not a feed (expected XML or JSON).");

  const valid = XMLValidator.validate(trimmed);
  if (valid !== true) {
    if (/<html[\s>]/i.test(trimmed.slice(0, 2000))) throw new FeedParseError("The address returned a web page, not a feed. Check the feed URL.");
    throw new FeedParseError(`The feed is not valid XML (line ${valid.err.line}: ${valid.err.msg}).`);
  }
  let doc: Record<string, Node>;
  try {
    doc = xml.parse(trimmed) as Record<string, Node>;
  } catch (e) {
    throw new FeedParseError(`The feed is not valid XML: ${(e as Error).message}`);
  }

  if (doc["rss"]) {
    const channel = (doc["rss"] as Record<string, Node>)["channel"] as Record<string, Node> | undefined;
    if (!channel) throw new FeedParseError("RSS feed has no <channel>.");
    return {
      format: "rss",
      title: txt(channel["title"]),
      items: arr(channel["item"] as Record<string, Node>[]).map(parseRssItem),
    };
  }
  if (doc["feed"]) {
    const feed = doc["feed"] as Record<string, Node>;
    return {
      format: "atom",
      title: txt(feed["title"]),
      items: arr(feed["entry"] as Record<string, Node>[]).map(parseAtomEntry),
    };
  }
  if (doc["rdf:RDF"]) {
    const rdf = doc["rdf:RDF"] as Record<string, Node>;
    const channel = rdf["channel"] as Record<string, Node> | undefined;
    return {
      format: "rdf",
      title: channel ? txt(channel["title"]) : null,
      items: arr(rdf["item"] as Record<string, Node>[]).map(parseRssItem),
    };
  }
  if (doc["html"] || doc["!doctype"]) throw new FeedParseError("The address returned a web page, not a feed. Check the feed URL.");
  throw new FeedParseError("Unrecognised feed format (expected RSS, Atom or JSON Feed).");
}
