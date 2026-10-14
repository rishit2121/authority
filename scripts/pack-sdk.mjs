// Builds packages/authority-sdk and packs it to public/sdk/authority-sdk.tgz,
// so every deployment serves the exact SDK version it was built with:
//   npm install https://<deployment>/sdk/authority-sdk.tgz
// Runs as `prebuild`; the output is generated, never committed.
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "public", "sdk");
const run = (args) =>
  execFileSync("npm", args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] }).toString();

run(["run", "build", "-w", "@authority/sdk"]);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const packed = JSON.parse(run(["pack", "-w", "@authority/sdk", "--json", "--pack-destination", outDir]));
const filename = packed[0]?.filename;
if (!filename) throw new Error("npm pack produced no tarball");
renameSync(path.join(outDir, path.basename(filename)), path.join(outDir, "authority-sdk.tgz"));
console.log(`sdk: packed ${packed[0].name}@${packed[0].version} -> public/sdk/authority-sdk.tgz`);
