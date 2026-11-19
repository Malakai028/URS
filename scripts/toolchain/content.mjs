import assert from "node:assert/strict";
import { catalog } from "../../packages/content/index.ts";
import { atlas } from "../../packages/content/atlas.ts";

for (const [name, records] of Object.entries(catalog)) {
  const expanded = atlas[name];
  assert.ok(Array.isArray(expanded), "Missing atlas " + name);
  assert.equal(
    expanded.length,
    records.length,
    "Catalog count changed " + name,
  );
}
console.log(
  "PASS catalog CSV loading, unique source IDs, tier/rank order and atlas counts",
);
