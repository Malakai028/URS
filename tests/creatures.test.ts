import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  creatureGround,
  details,
  freshScene,
} from "../apps/server/adventure.ts";
import { newCharacter, characterView } from "../apps/server/game.ts";
import { combatProfile } from "../apps/server/creature-profiles.ts";
import {
  creatureJournal,
  discover,
  projectCreature,
} from "../apps/server/creature-knowledge.ts";
import {
  creatureAppearance,
  damageCreature,
  inspectCreature,
  recordGuardianHit,
  simulateCreatures,
} from "../apps/server/creatures.ts";
import type { Area, Point } from "../packages/shared/creatures.ts";

const world = "fixture";
const walkable = creatureGround("fixture", "Лес");
const field = new Set<Area>(["field"]);
const vault = new Set<Area>(["vault"]);
const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

test("field creatures keep separate identity, alternate idle/wander and stay on walkable territory", () => {
  const sc = freshScene();
  const wolf = () => inspectCreature(sc, "trail-wolf", world, true)!;
  assert.equal(wolf().creature.behavior, "idle");
  assert.equal(simulateCreatures(sc, new Set<Area>(), [], walkable, 0), false);
  assert.equal(
    simulateCreatures(sc, field, [], walkable, 1, () => 0),
    true,
  );
  assert.equal(wolf().creature.behavior, "wander");
  const position = wolf().creature.position;
  simulateCreatures(sc, field, [], walkable, 2, () => 0);
  assert.equal(wolf().creature.behavior, "idle");
  assert.deepEqual(wolf().creature.position, position);
  for (let i = 3; i < 100; i++) {
    const group = ["trail-wolf", "trail-scout", "trail-deer"];
    const before = group.map((id) => inspectCreature(sc, id, world, true)!);
    simulateCreatures(sc, field, [], walkable, i, (n) => i % n);
    const after = group.map((id) => inspectCreature(sc, id, world, true)!);
    assert.deepEqual(
      after.map((m) => m.creature.speciesId),
      ["B-001", "B-065", "B-011"],
    );
    assert.equal(new Set(after.map((m) => m.creature.appearance)).size, 3);
    assert.equal(
      new Set(after.map((m) => JSON.stringify(m.creature.position))).size,
      3,
    );
    after.forEach(({ creature: c, simulation }, index) => {
      assert.ok(distance(c.position, before[index].creature.position) <= 1);
      assert.ok(distance(c.position, simulation!.home) <= simulation!.radius);
      assert.equal(walkable(c.area, c.position.x, c.position.y), true);
      assert.deepEqual(
        [c.level, c.tier, c.rank, c.q],
        [null, null, null, null],
      );
    });
  }
  assert.equal(creatureAppearance("Нежить"), "undead");
  assert.equal(creatureAppearance("Звери и хищники"), "beast");
  assert.equal(creatureAppearance("Магические аномалии"), "other");
});

test("hostile detection advances toward a target and passive behavior flees", () => {
  const sc = freshScene();
  const actor = { id: "party", area: "field" as const, x: 14, y: 13 };
  const wolf = () => inspectCreature(sc, "trail-wolf", world, true)!;
  simulateCreatures(sc, field, [actor], walkable, 1, () => 0);
  assert.equal(wolf().creature.behavior, "alert");
  assert.equal(wolf().simulation?.target, actor.id);
  simulateCreatures(sc, field, [actor], walkable, 2, () => 0);
  assert.equal(wolf().creature.behavior, "pursue");
  assert.equal(distance(wolf().creature.position, actor), 1);
  simulateCreatures(sc, field, [], walkable, 3, () => 0);
  assert.equal(wolf().creature.behavior, "investigate");
  simulateCreatures(sc, field, [], walkable, 4000, () => 0);
  assert.equal(wolf().creature.behavior, "return_home");
  assert.deepEqual(wolf().creature.position, wolf().simulation!.home);
  assert.equal(
    inspectCreature(sc, "trail-wolf", world, false)?.simulation,
    undefined,
  );
  const second = freshScene();
  const deerActor = { ...actor, x: 12, y: 11 };
  simulateCreatures(second, field, [deerActor], walkable, 5, () => 0);
  const deer = inspectCreature(second, "trail-deer", world, false)!.creature;
  assert.equal(deer.relationship, "neutral");
  assert.equal(deer.behavior, "flee");
  assert.ok(distance(deer.position, deerActor) > 1);
});

test("patrol routes around obstacles, stops at unreachable cells and never moves the corpse", () => {
  const sc = freshScene();
  const guard = () => inspectCreature(sc, "sentinel", world, true)!;
  for (let i = 0; i < 8; i++) {
    const previous = guard().creature.position;
    simulateCreatures(sc, vault, [], walkable, i * 2000, () => 0);
    assert.equal(guard().creature.behavior, "patrol");
    assert.equal(distance(guard().creature.position, previous), 1);
  }
  const blocked = freshScene();
  simulateCreatures(
    blocked,
    vault,
    [],
    (_area, x, y) => !(x === 5 && y === 5),
    10,
  );
  assert.deepEqual(blocked.creatures?.sentinel.position, { x: 5, y: 4 });
  const detour = freshScene();
  recordGuardianHit(detour, { id: "foe", area: "vault", x: 5, y: 7 }, 10);
  simulateCreatures(
    detour,
    vault,
    [],
    (area, x, y) => walkable(area, x, y) && !(x === 5 && y === 5),
    11,
  );
  assert.deepEqual(detour.creatures?.sentinel.position, { x: 6, y: 4 });
  let samples = 0;
  simulateCreatures(
    blocked,
    vault,
    [],
    () => {
      samples++;
      return false;
    },
    11,
  );
  assert.ok(samples <= 4);
  sc.guardian = 7;
  recordGuardianHit(sc, { id: "foe", area: "vault", x: 5, y: 3 }, 12);
  assert.equal(guard().creature.hp, 7);
  sc.guardian = -1;
  const dead = guard().creature.position;
  assert.equal(simulateCreatures(sc, vault, [], walkable, 13), false);
  assert.equal(guard().creature.hp, 0);
  assert.equal(guard().creature.behavior, "dead");
  assert.deepEqual(guard().creature.position, dead);
});

const hero = (id: string) =>
  newCharacter(id, {
    name: "Идущий",
    race: "R-001",
    profession: "C-001",
    mode: "manual",
    flaw: "Утомляемость",
  });
test("combat profiles have distinct pace, range, damage and bounded cooldowns", () => {
  const ids = ["B-001", "B-065", "B-036"];
  const profiles = ids.map((id) => combatProfile(id)!);
  assert.deepEqual(
    profiles.map((p) => p.stepMs),
    [2000, 4000, 6000],
  );
  assert.deepEqual(
    profiles.map((p) => p.mitigation),
    [0, 1, 2],
  );
  assert.equal(combatProfile("B-011"), undefined);
  const sc = freshScene();
  const target = { id: "hero", area: "field" as const, x: 15, y: 12 };
  damageCreature(sc, "trail-scout", target, 1, 10000);
  damageCreature(sc, "trail-wolf", target, 1, 10000);
  const strikes: string[] = [];
  const step = (time: number) =>
    simulateCreatures(
      sc,
      field,
      [target],
      walkable,
      time,
      () => 0,
      (creature) => {
        strikes.push(creature.id);
        return true;
      },
    );
  step(10001);
  assert.deepEqual(strikes, ["trail-scout"]);
  step(12001);
  assert.deepEqual(strikes, ["trail-scout", "trail-wolf"]);
  damageCreature(sc, "trail-scout", target, 100, 13000);
  step(20001);
  assert.equal(strikes.filter((id) => id === "trail-scout").length, 1);
  assert.equal(
    inspectCreature(sc, "trail-scout", world, true)!.creature.alive,
    false,
  );

  for (const [targetId, x, y, area, expected] of [
    ["trail-wolf", 14, 12, "field", 4],
    ["trail-scout", 15, 11, "field", 3],
    ["cave-skeleton", 8, 7, "cave", 2],
  ] as const) {
    const c = hero("fighter");
    Object.assign(c, { x, y, capacity: 32768 });
    details(c).area = area;
    const scene = freshScene();
    const hit = advance(
      c,
      { type: "ability", skill: "attack", target: targetId },
      scene,
      { id: world, seed: world, land: "Лес", draft: { npc: "Лада" } },
      10000,
      "fighter",
    );
    assert.equal(hit.audit.damage, expected);
    assert.equal(hit.audit.resistance, undefined);
  }
});

test("knowledge is hero-local, bounded, and exposes statistics only after evidence", () => {
  const a = hero("owner");
  const b = hero("owner");
  const e = details(a);
  const wolf = inspectCreature(
    freshScene(),
    "trail-wolf",
    world,
    false,
  )!.creature;
  assert.equal(projectCreature(wolf, e).speciesId, null);
  assert.equal(discover(e, wolf, "seen", 1), true);
  assert.equal(discover(e, wolf, "seen", 2), false);
  assert.equal(creatureJournal(e)[0].stage, 1);
  assert.equal(discover(e, wolf, "identified", 3), true);
  assert.equal(projectCreature(wolf, e).speciesId, "B-001");
  assert.equal(projectCreature(wolf, e).hp, null);
  assert.equal(discover(e, wolf, "identified", 4), false);
  assert.equal(discover(e, wolf, "hit", 5), true);
  assert.equal(projectCreature(wolf, e).hp, 11);
  assert.equal(discover(e, wolf, "victory", 6), true);
  assert.equal(discover(e, wolf, "victory", 7), false);
  assert.equal(discover(e, { ...wolf, worldId: "second" }, "victory", 8), true);
  assert.equal(creatureJournal(e)[0].stage, 4);
  assert.deepEqual(creatureJournal(details(b)), []);
  assert.equal(characterView(a).extra?.creatureKnowledge, undefined);
});
