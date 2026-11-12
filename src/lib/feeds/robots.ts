/**
 * A small robots.txt reader: the rules for our bot's name, or for "*" when none name it, and
 * whether a path is allowed (longest matching rule wins; Allow wins a tie; "*" and "$" supported).
 * A missing robots.txt (404) allows everything; one that can't be read (5xx, timeout) allows
 * nothing for this run, the cautious reading.
 */
export type RobotsRules = { allow: string[]; disallow: string[] } | "allow-all" | "deny-all";

export function parseRobots(text: string, botName: string): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const name = botName.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && name.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  if (!chosen.length) return "allow-all";
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

function ruleRegex(rule: string): RegExp {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  if (rules === "allow-all") return true;
  if (rules === "deny-all") return false;
  let best: { len: number; allow: boolean } | null = null;
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]] as const) {
    for (const r of list) {
      if (!ruleRegex(r).test(pathAndQuery)) continue;
      const len = r.length;
      if (!best || len > best.len || (len === best.len && allow)) best = { len, allow };
    }
  }
  return best ? best.allow : true;
}
