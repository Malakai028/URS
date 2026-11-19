import { readFileSync } from "node:fs";
import { indexToTier, indexToRank } from "../engine/index.ts";
function load(file: string, count: number) {
  const lines = readFileSync(
    new URL("../../docs/reference/URE_Library_v0_6/" + file, import.meta.url),
    "utf8",
  )
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const fields = lines.shift()!.split(",");
  const records = lines.map((line) => {
    const cols = line.split(",");
    if (cols.length !== fields.length) throw Error(file + " columns");
    return Object.fromEntries(fields.map((f, i) => [f, cols[i]])) as Record<
      string,
      string
    >;
  });
  if (
    records.length !== count ||
    new Set(records.map((r) => r[fields[0]])).size !== count
  )
    throw Error(file + " entries");
  return records;
}
export const catalog = {
  tiers: load("Tiers_2520.csv", 2520),
  ranks: load("Ranks_55.csv", 55),
  currencies: load("Currencies_14.csv", 14),
  races: load("Races_Catalog.csv", 131),
  classes: load("Classes_Catalog.csv", 123),
  bestiary: load("Bestiary_Catalog.csv", 145),
};
for (const [i, r] of catalog.tiers.entries())
  if (indexToTier(i) !== r.designation) throw Error("Tier mismatch");
for (const [i, r] of catalog.ranks.entries())
  if (indexToRank(i) !== r.designation) throw Error("Rank mismatch");
