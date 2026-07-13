import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (dirname(dist) !== root) {
  throw new Error(`Refusing unsafe build output path: ${dist}`);
}
const files = [
  "manifest.json",
  "background.js",
  "shared.js",
  "popup.html",
  "popup.css",
  "popup.js",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  await cp(join(root, file), join(dist, file));
}

await cp(join(root, "icons"), join(dist, "icons"), { recursive: true });

console.log(`Built extension package contents in ${dist}`);
