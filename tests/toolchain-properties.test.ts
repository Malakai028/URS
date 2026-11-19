import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  awardExperience,
  spendExperience,
  getLevelUpCost,
} from "../packages/engine/index.ts";

test("TOOL-00 reproducible generated XP accounting and monotone level costs", () => {
  const seed = Number(process.env.FC_SEED || 20261119);
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 10n ** 80n }),
      fc.bigInt({ min: 0n, max: 10n ** 40n }),
      (balance, earned) => {
        const after = awardExperience(balance, earned);
        assert.equal(spendExperience(after, earned), balance);
      },
    ),
    { seed, numRuns: 500 },
  );
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 500 }), (level) => {
      assert.ok(getLevelUpCost(level + 1) > getLevelUpCost(level));
    }),
    { seed, numRuns: 300 },
  );
});
