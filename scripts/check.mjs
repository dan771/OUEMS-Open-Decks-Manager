import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + entry.name;
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(mjs|js)$/.test(p)) out.push(p);
  }
  return out;
}
const files = [
  ...(await walk("public")),
  ...(await walk("server")),
  ...(await walk("tests")),
  ...(await walk("scripts")),
  "worker.js",
  "playwright.config.js",
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status) {
    console.error(result.stderr);
    process.exit(result.status);
  }
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
