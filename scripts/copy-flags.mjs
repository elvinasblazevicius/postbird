/**
 * Copies the country flag SVGs (flag-icons, MIT licence) from node_modules
 * into public/flags so they are served as static files. Runs automatically
 * before `npm run dev` and `npm run build`; public/flags is not committed.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");
const dest = join(process.cwd(), "public", "flags");
if (!existsSync(src)) {
  console.warn("flag-icons not installed; skipping flag copy");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("Copied country flags to public/flags");
