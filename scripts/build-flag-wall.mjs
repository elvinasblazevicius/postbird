/**
 * Builds public/flag-wall.svg: a grid of national flags (flag-icons, MIT)
 * used as a faint decoration in the homepage hero. One file, one request.
 * Run with `npm run build:flags` after changing the country list.
 * National flags only: UN and EU emblems are restricted and not used.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dir = join(dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");

// Countries that host many international duty stations, from every region.
const CODES = [
  "ch", "ke", "fr", "at", "be", "it", "us", "jp", "de", "nl", "se", "no", "dk", "fi",
  "sn", "ng", "gh", "th", "vn", "id", "ca", "gb", "ie", "ci", "ml", "td", "cm", "et",
  "ug", "tz", "rw", "ma", "jo", "lb", "tr", "ua", "pl", "ro", "gr", "bd", "co", "pe",
  "cl", "pa", "bo", "ht", "lk", "np", "qa", "ae", "kr", "ph", "in", "za", "eg", "bj",
  "bf", "gn", "ga", "ne", "mg", "ss", "so", "sd", "ye", "iq", "pk", "mx", "ar", "br",
];
const MAX_BYTES = 4000; // skip detailed coats of arms; they turn to noise at this size

const COLS = 10, ROWS = 7, W = 64, H = 48, GAP = 14;
const flags = [];
for (const c of CODES) {
  const raw = readFileSync(join(dir, `${c}.svg`), "utf8");
  if (raw.length > MAX_BYTES) continue;
  const viewBox = raw.match(/viewBox="([^"]+)"/)[1];
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/id="([^"]+)"/g, `id="${c}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${c}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${c}-$1"`)
    .replace(/\s*\n\s*/g, "");
  flags.push({ c, viewBox, inner });
}

// Deterministic shuffle so neighbouring tiles differ.
let seed = 7;
const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const order = [...flags].sort(() => rand() - 0.5);

const tiles = [];
const defs = [`<clipPath id="tile"><rect width="${W}" height="${H}" rx="6"/></clipPath>`];
const used = new Set();
for (let r = 0; r < ROWS; r++) {
  for (let col = 0; col < COLS; col++) {
    const f = order[(r * COLS + col) % order.length];
    const x = col * (W + GAP) + (r % 2 ? (W + GAP) / 2 : 0);
    const y = r * (H + GAP);
    if (!used.has(f.c)) {
      used.add(f.c);
      defs.push(`<symbol id="f-${f.c}" viewBox="${f.viewBox}" preserveAspectRatio="none">${f.inner}</symbol>`);
    }
    tiles.push(`<g transform="translate(${x} ${y})" clip-path="url(#tile)"><use href="#f-${f.c}" width="${W}" height="${H}"/></g>`);
  }
}
const width = COLS * (W + GAP) + (W + GAP) / 2;
const height = ROWS * (H + GAP) - GAP;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs>${defs.join("")}</defs>${tiles.join("")}</svg>\n`;
writeFileSync("public/flag-wall.svg", svg);
console.log(`public/flag-wall.svg: ${used.size} flags, ${(svg.length / 1024).toFixed(1)} KB`);
