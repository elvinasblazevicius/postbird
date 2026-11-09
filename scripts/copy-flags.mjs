/**
 * Copies the country flag SVGs (flag-icons, MIT licence) from node_modules
 * into public/flags so they are served as static files. Runs automatically
 * before `npm run dev` and `npm run build`; public/flags is not committed.
 * The UN and EU flags (un.svg, eu.svg) are left out: their emblems are
 * protected and this site never shows them. Copies made before this rule
 * are removed.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";

const EXCLUDED = new Set(["un.svg", "eu.svg"]);

const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");
const dest = join(process.cwd(), "public", "flags");
if (!existsSync(src)) {
  console.warn("flag-icons not installed; skipping flag copy");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true, filter: (from) => !EXCLUDED.has(basename(from)) });
for (const name of EXCLUDED) rmSync(join(dest, name), { force: true });
console.log("Copied country flags to public/flags (without the UN and EU flags)");
