import { randomInt } from "node:crypto";
import { atlas } from "../../packages/content/atlas.ts";
import { size } from "../../packages/engine/index.ts";
import { creatureStepMs } from "../../packages/shared/creatures.ts";
import { combatProfile, guardianProfile } from "./creature-profiles.ts";
import type {
  Area,
  CreatureAppearance,
  CreatureBehavior,
  CreatureInspection,
  CreatureMotion,
  CreatureView,
  Point,
} from "../../packages/shared/creatures.ts";

type Spec = {
  id: string;
  speciesId: string | null;
  area: Area;
  home: Point;
  radius: number;
  route: Point[];
  profile: "territorial" | "patrol" | "passive";
  appearance?: CreatureAppearance;
  dimensions: CreatureView["dimensions"];
};
export type CreatureScene = {
  guardian: number;
  creatures?: Record<string, CreatureMotion>;
};
type Actor = Point & { id: string; area: Area };
type Walkable = (area: Area, x: number, y: number) => boolean;
const point = (x: number, y: number) => ({ x, y });
const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const key = (p: Point) => p.x + "," + p.y;
const directions = [point(1, 0), point(0, 1), point(-1, 0), point(0, -1)];
const specs: Spec[] = [
  {
    id: "sentinel",
    speciesId: null,
    area: "vault",
    home: point(5, 4),
    radius: 4,
    route: [point(5, 4), point(5, 5), point(6, 5), point(6, 4)],
    profile: "patrol",
    appearance: "guardian",
    dimensions: { width: 0.9, height: 1.15 },
  },
  {
    id: "trail-wolf",
    speciesId: "B-001",
    area: "field",
    home: point(14, 11),
    radius: 4,
    route: [],
    profile: "territorial",
    appearance: "wolf",
    dimensions: { width: 1.08, height: 0.7 },
  },
  {
    id: "trail-deer",
    speciesId: "B-011",
    area: "field",
    home: point(12, 10),
    radius: 4,
    route: [],
    profile: "passive",
    appearance: "deer",
    dimensions: { width: 1.16, height: 1.0 },
  },
  {
    id: "trail-scout",
    speciesId: "B-065",
    area: "field",
    home: point(15, 10),
    radius: 4,
    route: [],
    profile: "territorial",
    appearance: "goblin",
    dimensions: { width: 0.72, height: 0.84 },
  },
  {
    id: "cave-skeleton",
    speciesId: "B-036",
    area: "cave",
    home: point(7, 7),
    radius: 4,
    route: [point(7, 7), point(7, 8), point(8, 8), point(8, 7)],
    profile: "patrol",
    appearance: "skeleton",
    dimensions: { width: 0.67, height: 1.04 },
  },
];
const species = new Map(atlas.bestiary.map((entry) => [entry.id, entry]));
const specById = new Map(specs.map((spec) => [spec.id, spec]));
export const isCreature = (id: string) => specById.has(id);
function motion(s: CreatureScene, spec: Spec): CreatureMotion {
  return (
    s.creatures?.[spec.id] ?? {
      position: spec.home,
      facing: point(1, 0),
      behavior: "idle",
      moved: false,
      routeIndex: 0,
      target: null,
      lastSeen: null,
      lastAction: "rest",
      updatedAt: 0,
    }
  );
}
function health(s: CreatureScene, spec: Spec) {
  const profile = creatureCombat(spec.id);
  if (!profile) return null;
  const hp =
    spec.id === "sentinel" ? s.guardian : (motion(s, spec).hp ?? profile.maxHp);
  return Math.max(0, Math.min(profile.maxHp, hp));
}
export function creatureCombat(id: string) {
  return id === "sentinel"
    ? guardianProfile
    : combatProfile(specById.get(id)?.speciesId ?? null);
}
const alive = (scene: CreatureScene, spec: Spec) => health(scene, spec) !== 0;
export function creatureAppearance(category: string): CreatureAppearance {
  if (category === "Звери и хищники") return "beast";
  if (category === "Нежить") return "undead";
  return "other";
}
export function creatureCanSee(
  ground: Walkable,
  area: Area,
  from: Point,
  to: Point,
) {
  // Grid ray through intermediate tiles. The endpoints are checked by the caller.
  const dx = Math.abs(to.x - from.x),
    dy = Math.abs(to.y - from.y);
  const sx = Math.sign(to.x - from.x),
    sy = Math.sign(to.y - from.y);
  let { x, y } = from;
  let error = dx - dy;
  while (x !== to.x || y !== to.y) {
    const twice = 2 * error;
    if (twice > -dy) {
      error -= dy;
      x += sx;
    }
    if (twice < dx) {
      error += dx;
      y += sy;
    }
    if ((x !== to.x || y !== to.y) && !ground(area, x, y)) return false;
  }
  return true;
}
function view(scene: CreatureScene, spec: Spec, worldId: string): CreatureView {
  const m = motion(scene, spec);
  const row = spec.speciesId ? species.get(spec.speciesId) : null;
  const hp = health(scene, spec);
  const profile = creatureCombat(spec.id);
  return {
    id: spec.id,
    worldId,
    area: spec.area,
    encounterId: worldId + ":" + spec.area,
    speciesId: spec.speciesId,
    name: row?.name ?? "Осколочный страж",
    species: row?.name ?? "Страж башни",
    individualName: spec.id === "sentinel" ? "Осколочный страж" : null,
    category: row?.category ?? "Страж встречи",
    description: row?.description ?? "Страж охраняет маяк в сигнальной башне.",
    level: null,
    tier: null,
    rank: null,
    q: null,
    threat: null,
    rarity: null,
    hp,
    maxHp: profile?.maxHp ?? null,
    alive: hp !== 0,
    position: m.position,
    relationship: spec.profile === "passive" ? "neutral" : "hostile",
    behavior: hp !== 0 ? m.behavior : "dead",
    moved: hp !== 0 && m.moved,
    facing: m.facing,
    stepMs: hp === 0 ? null : (profile?.stepMs ?? creatureStepMs),
    attackable: Boolean(profile && hp !== 0),
    condition:
      hp === null || !profile
        ? undefined
        : hp <= profile.maxHp / 3
          ? "critical"
          : hp < profile.maxHp
            ? "wounded"
            : "healthy",
    cue: m.lastAction === "strike" ? "Атаковало" : undefined,
    appearance: spec.appearance ?? creatureAppearance(row?.category ?? ""),
    dimensions: spec.dimensions,
  };
}
export function visibleCreatures(
  scene: CreatureScene,
  area: Area,
  worldId: string,
) {
  return specs
    .filter((spec) => spec.area === area)
    .map((spec) => view(scene, spec, worldId));
}
export function inspectCreature(
  scene: CreatureScene,
  id: string,
  worldId: string,
  gm: boolean,
): CreatureInspection | undefined {
  const spec = specById.get(id);
  if (!spec) return;
  const creature = view(scene, spec, worldId);
  if (!gm) return { creature, knowledge: "observation" };
  const state = motion(scene, spec);
  const profile = creatureCombat(id);
  return {
    creature,
    knowledge: "gm",
    source: spec.speciesId ? species.get(spec.speciesId) : undefined,
    learned: profile
      ? {
          anatomy: profile.anatomy,
          ability: profile.ability,
          mitigation: profile.mitigation,
          reach: profile.reach,
        }
      : undefined,
    simulation: {
      home: spec.home,
      radius: spec.radius,
      route: spec.route,
      profile: spec.profile,
      target: state.target,
      lastSeen: state.lastSeen,
      lastAction: state.lastAction,
      updatedAt: state.updatedAt,
      resistance: profile?.mitigation ?? null,
      combat: profile && {
        aptitude: profile.aptitude,
        detection: profile.detection,
        damage: profile.damage,
        cooldownMs: profile.cooldownMs,
      },
    },
  };
}
export function damageCreature(
  scene: CreatureScene,
  id: string,
  attacker: Actor,
  damage: number,
  now: number,
) {
  const spec = specById.get(id);
  if (!spec) return false;
  const hp = health(scene, spec);
  if (hp === null || hp === 0) return false;
  const remaining = Math.max(0, hp - damage);
  if (id === "sentinel") {
    scene.guardian = remaining;
    recordGuardianHit(scene, attacker, now);
  } else {
    const old = motion(scene, spec);
    (scene.creatures ??= {})[id] = {
      ...old,
      hp: remaining,
      behavior: remaining ? "alert" : "dead",
      target: remaining ? attacker.id : null,
      provokedBy: remaining ? attacker.id : undefined,
      lastSeen: remaining ? point(attacker.x, attacker.y) : null,
      lastAction: remaining ? (damage > 0 ? "hit" : "notice") : "death",
      updatedAt: now,
      moved: false,
    };
  }
  return true;
}
export function recordGuardianHit(
  scene: CreatureScene,
  enemy: Actor,
  now: number,
) {
  const old = motion(scene, specs[0]);
  scene.creatures ??= {};
  scene.creatures.sentinel = {
    ...old,
    target: scene.guardian ? enemy.id : null,
    lastSeen: scene.guardian ? point(enemy.x, enemy.y) : null,
    moved: false,
    updatedAt: now,
    behavior: scene.guardian ? "alert" : "dead",
    lastAction: scene.guardian ? "hit" : "death",
  };
}

function neighbors(p: Point) {
  return directions.map((d) => point(p.x + d.x, p.y + d.y));
}
// Breadth-first search over the finite home territory, returning only a single cardinal step.
function firstStep(
  from: Point,
  valid: (p: Point) => boolean,
  goal: (p: Point) => boolean,
) {
  if (goal(from)) return from;
  const visited = new Set([key(from)]);
  const queue: { position: Point; first: Point }[] = [];
  function push(p: Point, first: Point) {
    if (!valid(p) || visited.has(key(p))) return;
    visited.add(key(p));
    queue.push({ position: p, first });
  }
  for (const next of neighbors(from)) push(next, next);
  for (let i = 0; i < queue.length && i < 81; i++) {
    const entry = queue[i];
    if (goal(entry.position)) return entry.first;
    for (const next of neighbors(entry.position)) push(next, entry.first);
  }
  return from;
}

export function simulateCreatures(
  scene: CreatureScene,
  areas: ReadonlySet<Area>,
  actors: Actor[],
  ground: Walkable,
  now: number,
  choose: (length: number) => number = randomInt,
  strike?: (
    creature: CreatureView,
    target: Actor,
    profile: NonNullable<ReturnType<typeof creatureCombat>>,
  ) => boolean,
) {
  let changed = false;
  const present = new Map(
    specs
      .filter((s) => alive(scene, s))
      .map((s) => [s.id, motion(scene, s).position]),
  );
  for (const spec of specs) {
    if (!areas.has(spec.area) || !alive(scene, spec)) continue;
    const old = motion(scene, spec);
    const profile = creatureCombat(spec.id);
    const at = old.position;
    const inArea = actors.filter((a) => a.area === spec.area);
    const extent = spec.area === "field" ? size : 16;
    const valid = (p: Point) =>
      p.x >= 0 &&
      p.y >= 0 &&
      p.x < extent &&
      p.y < extent &&
      distance(spec.home, p) <= spec.radius &&
      ground(spec.area, p.x, p.y) &&
      !inArea.some((a) => distance(a, p) === 0) &&
      !specs.some(
        (s) =>
          s.id !== spec.id &&
          s.area === spec.area &&
          present.has(s.id) &&
          distance(present.get(s.id)!, p) === 0,
      );
    const detected = inArea
      .filter(
        (a) =>
          distance(a, at) <= (profile?.detection ?? 3) &&
          distance(spec.home, a) <= spec.radius + 1 &&
          creatureCanSee(ground, spec.area, at, a),
      )
      .sort(
        (a, b) => distance(a, at) - distance(b, at) || a.id.localeCompare(b.id),
      );
    const target =
      detected.find((a) => a.id === old.provokedBy) ??
      detected.find((a) => a.id === old.target) ??
      detected[0];
    let behavior: CreatureBehavior = "idle";
    let next = at,
      routeIndex = old.routeIndex,
      lastSeen = old.lastSeen;
    if (target && spec.profile === "passive") {
      behavior = "flee";
      const options = neighbors(at)
        .filter((p) => valid(p) && distance(p, target) > distance(at, target))
        .sort((a, b) => distance(b, target) - distance(a, target));
      next = options[0] ?? at;
    } else if (
      target &&
      (spec.profile !== "patrol" || old.target || spec.area === "cave")
    ) {
      lastSeen = point(target.x, target.y);
      behavior = old.target ? "pursue" : "alert";
      if (behavior === "pursue")
        next = firstStep(
          at,
          valid,
          (p) => distance(p, target) <= (profile?.reach ?? 1),
        );
    } else if (
      lastSeen &&
      ["alert", "pursue", "investigate"].includes(old.behavior)
    ) {
      behavior = "investigate";
      next = firstStep(at, valid, (p) => distance(p, lastSeen!) <= 1);
      if (next === at || distance(next, lastSeen) <= 1) lastSeen = null;
    } else if (
      (old.behavior === "return_home" ||
        old.behavior === "flee" ||
        old.behavior === "investigate") &&
      distance(at, spec.home) > 0
    ) {
      behavior = "return_home";
      next = firstStep(at, valid, (p) => distance(p, spec.home) === 0);
      if (next === at) behavior = "idle";
    } else if (spec.route.length) {
      behavior = "patrol";
      if (distance(at, spec.route[routeIndex]) === 0)
        routeIndex = (routeIndex + 1) % spec.route.length;
      next = firstStep(
        at,
        valid,
        (p) => distance(p, spec.route[routeIndex]) === 0,
      );
    } else if (old.behavior !== "wander" || choose(3) !== 0) {
      const options = neighbors(at).filter(valid);
      if (options.length) {
        behavior = "wander";
        next = options[choose(options.length)];
      }
    }
    if (
      old.stepAt !== undefined &&
      now - old.stepAt < (profile?.stepMs ?? creatureStepMs)
    )
      next = at;
    const attacking = Boolean(
      strike &&
      profile &&
      spec.id !== "sentinel" &&
      target &&
      target.id === old.provokedBy &&
      distance(at, target) <= profile.reach &&
      now >= (old.lastAttackAt ?? 0) + profile.cooldownMs &&
      strike(view(scene, spec, ""), target, profile),
    );
    const moved = at !== next;
    const facing = moved ? point(next.x - at.x, next.y - at.y) : old.facing;
    const activeTarget = ["alert", "pursue", "flee"].includes(behavior)
      ? (target?.id ?? null)
      : null;
    if (
      !attacking &&
      old.lastAction !== "strike" &&
      !moved &&
      !old.moved &&
      old.behavior === behavior &&
      old.routeIndex === routeIndex &&
      old.target === activeTarget &&
      old.lastSeen?.x === lastSeen?.x &&
      old.lastSeen?.y === lastSeen?.y
    )
      continue;
    scene.creatures ??= {};
    scene.creatures[spec.id] = {
      ...old,
      position: next,
      facing,
      moved,
      behavior,
      routeIndex,
      target: activeTarget,
      lastSeen,
      updatedAt: now,
      stepAt: moved ? now : old.stepAt,
      lastAttackAt: attacking ? now : old.lastAttackAt,
      lastAction: attacking
        ? "strike"
        : moved
          ? "step"
          : behavior === "alert"
            ? "notice"
            : "rest",
    };
    present.set(spec.id, next);
    changed = true;
  }
  return changed;
}
