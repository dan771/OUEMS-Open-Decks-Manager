import { readFile, writeFile } from "node:fs/promises";
const config = JSON.parse(
  (await readFile("wrangler.jsonc", "utf8")).replace(/,\s*([}\]])/g, "$1"),
);
config.name = "ouems-open-decks-local-test";
config.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000001";
config.vars = { LOCAL_DEV: "true" };
await writeFile("wrangler.local.json", JSON.stringify(config, null, 2));
console.log(
  "Prepared an ignored local-only Worker config. Production config remains protected.",
);
