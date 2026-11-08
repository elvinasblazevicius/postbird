/**
 * Builds public/world-dots.svg: a dot-matrix world map used as the hero and
 * email-band background. Run once (npm run build:map); the SVG is committed.
 * Map data: Natural Earth via the world-atlas package (public domain).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { geoContains, geoEqualEarth } from "d3-geo";
import { feature } from "topojson-client";

const topology = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/land-50m.json", import.meta.url)));
const land = feature(topology, topology.objects.land);

const width = 1200;
const height = 560;
const step = 9; // distance between dots in px
const projection = geoEqualEarth().fitExtent([[10, 10], [width - 10, height - 10]], { type: "Sphere" });

let path = "";
let count = 0;
for (let y = step / 2; y < height; y += step) {
  for (let x = step / 2; x < width; x += step) {
    const lonLat = projection.invert([x, y]);
    if (!lonLat || Number.isNaN(lonLat[0])) continue;
    if (lonLat[1] < -58) continue; // leave out Antarctica
    if (geoContains(land, lonLat)) {
      path += `M${x} ${y}h0`;
      count++;
    }
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none"><path d="${path}" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round"/></svg>\n`;
writeFileSync(new URL("../public/world-dots.svg", import.meta.url), svg);
console.log(`world-dots.svg: ${count} dots, ${(svg.length / 1024).toFixed(0)} KB`);
