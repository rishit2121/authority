// Writes public/logos/<id>.svg for every declarative REST connector, from the first source that has one:
//   1. scripts/connector-logos/<id>.svg|png|jpg -- a brand mark fetched once and checked in (see the README there);
//      an SVG must contain no script, event handler, foreignObject, embedded image or external reference;
//   2. the Simple Icons mark (CC0) for the spec's iconSlug, in its brand colour;
//   3. a neutral lettered tile.
// Simple Icons is not a project dependency; install it anywhere and point at it, then commit the generated SVGs:
//   npm install --prefix /tmp/si simple-icons
//   SIMPLE_ICONS=/tmp/si/node_modules/simple-icons node --import tsx scripts/generate-connector-logos.mts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.env.SIMPLE_ICONS;
if (!dir) throw new Error("Set SIMPLE_ICONS to an installed simple-icons package directory.");
const simpleIcons = (await import(pathToFileURL(path.join(dir, "index.mjs")).href)) as Record<
  string,
  unknown
>;

import { REST_CONNECTOR_SPECS } from "../src/lib/connectors/rest/providers/index.ts";

type SimpleIcon = { slug: string; hex: string; path: string; title: string };
const bySlug = new Map<string, SimpleIcon>();
for (const value of Object.values(simpleIcons) as unknown[]) {
  const icon = value as Partial<SimpleIcon>;
  if (icon && typeof icon.slug === "string" && typeof icon.path === "string")
    bySlug.set(icon.slug, icon as SimpleIcon);
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const UNSAFE_SVG =
  /<script|javascript:|\son[a-z]+\s*=|<foreignObject|<image|(?:xlink:)?href\s*=\s*["'](?!#)|@import|url\((?!#)/i;
const SOURCES = path.join("scripts", "connector-logos");

/** A checked-in brand mark, as a self-contained SVG, or null. */
function checkedIn(id: string, name: string): string | null {
  const svgPath = path.join(SOURCES, `${id}.svg`);
  if (existsSync(svgPath)) {
    const svg = readFileSync(svgPath, "utf8");
    if (UNSAFE_SVG.test(svg) || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg)) {
      throw new Error(`${svgPath} contains active or external content; refusing to publish it.`);
    }
    return svg.trim() + "\n";
  }
  for (const [ext, type] of [
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
  ] as const) {
    const rasterPath = path.join(SOURCES, `${id}.${ext}`);
    if (!existsSync(rasterPath)) continue;
    const data = readFileSync(rasterPath).toString("base64");
    return `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${escape(name)}</title><image width="24" height="24" href="data:${type};base64,${data}"/></svg>\n`;
  }
  return null;
}

let branded = 0;
let fetched = 0;
const lettered: string[] = [];
for (const spec of REST_CONNECTOR_SPECS) {
  const icon = spec.iconSlug ? bySlug.get(spec.iconSlug) : undefined;
  const own = checkedIn(spec.id, spec.name);
  let svg: string;
  if (own) {
    svg = own;
    fetched++;
  } else if (icon) {
    svg = `<svg fill="#${icon.hex}" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${escape(spec.name)}</title><path d="${icon.path}"/></svg>\n`;
    branded++;
  } else {
    const letter = escape(
      spec.name
        .replace(/[^A-Za-z0-9]/g, "")
        .charAt(0)
        .toUpperCase() || "?",
    );
    svg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${escape(spec.name)}</title><rect width="24" height="24" rx="5" fill="#5B6472"/><text x="12" y="16.5" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600" fill="#FFFFFF">${letter}</text></svg>\n`;
    lettered.push(spec.id);
  }
  writeFileSync(path.join("public", "logos", `${spec.id}.svg`), svg);
}
console.log(
  `logos: ${fetched} checked-in marks, ${branded} Simple Icons marks, ${lettered.length} lettered tiles${lettered.length ? ` (${lettered.join(", ")})` : ""}`,
);
