import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../packages/content/index.ts";
import * as e from "../packages/engine/index.ts";
test("every catalog tier and rank round trips in order", () => {
  for (const [i, r] of catalog.tiers.entries()) {
    assert.equal(e.tierToIndex(r.designation), i);
    assert.equal(e.indexToTier(i), r.designation);
  }
  for (const [i, r] of catalog.ranks.entries()) {
    assert.equal(e.rankToIndex(r.designation), i);
    assert.equal(e.indexToRank(i), r.designation);
  }
  for (const bad of ["H+-", "HG", "VVVVVVVVVVV", "", "H-----------"])
    assert.throws(() => e.tierToIndex(bad));
  assert.throws(() => e.indexToTier(2520));
  assert.throws(() => e.indexToRank(-1));
  assert.throws(() => e.rankToIndex("Небесный VI"));
  assert.deepEqual(
    Object.values(catalog).map((c) => c.length),
    [2520, 55, 14, 131, 123, 145],
  );
});
test("exact costs, balances, and each overlapping level reward", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => e.getLevelUpCost(i)),
    [100n, 880n, 4356n, 17037n, 58564n],
  );
  assert.ok(e.getLevelUpCost(1000) > 10n ** 300n);
  for (const [l, n] of [
    [5, 2],
    [10, 3],
    [25, 3],
    [50, 5],
    [100, 6],
  ])
    assert.equal(e.getMilestoneRewards(l).length, n);
  assert.deepEqual(e.levelUp(0, 112n), {
    level: 1,
    xp: 12n,
    rewards: ["base"],
  });
  assert.throws(() => e.levelUp(1, 0n));
  assert.throws(() => e.spendExperience(1n, -2n));
  assert.equal(e.awardExperience(30n, 30n, true), 30n);
});
test("rules for checks, ratings and money", () => {
  const d = { capacity: 10, difficulty: 10, modifier: 0, roll: 51 };
  assert.equal(e.resolveAction("probabilistic", true, [d]).success, false);
  assert.equal(e.resolveAction("complex", true, [d, d]).attempts.length, 1);
  assert.equal(e.resolveAction("deterministic", false).success, false);
  assert.throws(() =>
    e.resolveAction("probabilistic", true, [{ ...d, roll: 0 }]),
  );
  assert.equal(e.calculateQ(0, 0), 200);
  assert.equal(e.canAssignThreat({}), "notConfigured");
  assert.deepEqual(e.convertCurrency(12n, 1n, 10n), {
    units: 1n,
    remainderWood: 2n,
  });
  assert.throws(() => e.convertCurrency(1n, null, 1n));
});
