import { readFile } from "node:fs/promises";
import { parseCSV, createTerm, importRows } from "../public/lib/domain.js";
import { readSheet } from "../server/sheets.js";
const filename = process.argv[2];
if (!filename)
  throw new Error(
    "Pass a local response CSV path. Only aggregate results are printed.",
  );
const rows = filename.startsWith("https:")
  ? await readSheet(filename)
  : parseCSV(await readFile(filename, "utf8"));
const term = createTerm("MT26", "", rows);
const counts = Object.fromEntries(
  ["absolute beginner", "beginner", "bedroom", "gigging"].map((level) => [
    level,
    term.profiles.filter((p) => p.experience === level).length,
  ]),
);
console.log(
  JSON.stringify(
    {
      responses: term.profiles.length,
      dates: term.nights.map((n) => n.date),
      experienceLabels: counts,
      needsReview: term.profiles.filter((p) => p.needsReview).length,
      repeatImportAdded: importRows(term, rows).added,
    },
    null,
    2,
  ),
);
