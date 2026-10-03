import { readFile, writeFile, mkdir } from "node:fs/promises";
import { demoState } from "../server/demo.js";
await mkdir(".local", { recursive: true });
try {
  const existing = await readFile(".local/state.json");
  const backup = `.local/state-backup-${Date.now()}.json`;
  await writeFile(backup, existing);
  console.log(`Previous local workspace backed up to ${backup}.`);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await writeFile(".local/state.json", JSON.stringify(demoState(), null, 2));
console.log("Fresh fictional MT26 demo saved. Restart the local server.");
