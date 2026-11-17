// Writes public/logos/<id>.svg for every declarative REST connector: the Simple Icons mark (CC0) in its brand colour
// when the spec names an iconSlug that exists, otherwise a neutral lettered tile. Simple Icons is not a project
// dependency; install it anywhere and point at it, then commit the generated SVGs:
//   npm install --prefix /tmp/si simple-icons
//   SIMPLE_ICONS=/tmp/si/node_modules/simple-icons node --import tsx scripts/generate-connector-logos.mts
import { writeFileSync } from "node:fs";
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
let branded = 0;
const lettered: string[] = [];
for (const spec of REST_CONNECTOR_SPECS) {
  const icon = spec.iconSlug ? bySlug.get(spec.iconSlug) : undefined;
  let svg: string;
  if (icon) {
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
  `logos: ${branded} brand marks, ${lettered.length} lettered tiles${lettered.length ? ` (${lettered.join(", ")})` : ""}`,
);
