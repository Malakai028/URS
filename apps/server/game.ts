import {
  attributes,
  energyAfterLevel,
} from "../../packages/engine/attributes.ts";
import { randomInt } from "node:crypto";
import {
  calculateQ,
  getLevelUpCost,
  indexToRank,
  indexToTier,
  levelUp,
  npcPos,
  resolveAction,
  ruin,
  size,
  spawn,
  terrain,
  awardExperience,
} from "../../packages/engine/index.ts";
import type { Action, Character, Draft } from "../../packages/shared/index.ts";
export class GameError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
export function ensure(
  condition: unknown,
  message: string,
  code = 400,
): asserts condition {
  if (!condition) throw new GameError(message, code);
}
export function sight(x: number, y: number) {
  const cells = [];
  for (let py = Math.max(0, y - 3); py <= Math.min(size - 1, y + 3); py++)
    for (let px = Math.max(0, x - 3); px <= Math.min(size - 1, x + 3); px++)
      cells.push(px + "," + py);
  return cells;
}
export function newCharacter(
  userId: string,
  input: {
    name: string;
    race: string;
    profession: string;
    mode: string;
    flaw: string;
  },
): Character {
  const maxEnergy = input.flaw === "Утомляемость" ? 6 : 8;
  return {
    ...input,
    userId,
    level: 0,
    xp: "0",
    tier: 0,
    rank: 0,
    q: calculateQ(0, 0),
    threat: null,
    administration: null,
    ...spawn,
    energy: maxEnergy,
    maxEnergy,
    capacity: input.profession === "C-022" ? 14 : 12,
    inventory: 2,
    currency: "0",
    talked: false,
    surveyed: false,
    lastMove: 0,
    explored: sight(spawn.x, spawn.y),
    rewards: [],
  };
}
export function characterView(c: Character) {
  const extra = c.extra && { ...c.extra };
  if (extra) delete extra.creatureKnowledge;
  return {
    ...c,
    extra,
    attributes: attributes(c),
    tierName: indexToTier(c.tier),
    rankName: indexToRank(c.rank),
    nextCost: getLevelUpCost(c.level).toString(),
  };
}
type BeaconProgress = { beacon: boolean; opened: boolean };
export function guideSpeech(
  name: string,
  scene: BeaconProgress | undefined,
  directions: string,
) {
  if (scene?.beacon)
    return (
      name +
      " смотрит на свет башни: «Маяк горит. Теперь с переправы снова видно дорогу»."
    );
  if (scene?.opened)
    return (
      name +
      " указывает на башню (15, 14): «Тайник уже открыт. У входа проверь снаряжение»."
    );
  return name + directions;
}
export function apply(
  c: Character,
  a: Action,
  world: { seed: string; land: string; draft: Draft },
  role: string,
  now: number,
  scene?: BeaconProgress,
) {
  const audit: Record<string, unknown> = {
    method: "deterministic",
    actor: c.name,
    ruleset: "0.6-p01.1",
  };
  let text = "",
    reward = 0;
  if (a.type === "intent") {
    const commands: Record<string, Action> = {
      "осмотреть руины": { type: "survey" },
      поговорить: { type: "talk" },
      проверка: { type: "roll" },
    };
    const action = commands[a.text.toLowerCase()];
    if (action) return apply(c, action, world, role, now, scene);
    text = "Заявка мастеру: " + a.text;
  }
  if (a.type === "chat" || a.type === "gm") {
    ensure(
      a.type !== "gm" || ["owner", "gm"].includes(role),
      "Нужны права мастера",
      403,
    );
    text = a.text;
  }
  if (a.type === "move") {
    const x = c.x + a.dx,
      y = c.y + a.dy;
    ensure(
      Math.abs(a.dx) + Math.abs(a.dy) === 1,
      "За ход доступен один соседний квадрат",
    );
    ensure(now - c.lastMove >= 220, "Слишком быстрый шаг", 429);
    ensure(x >= 0 && x < size && y >= 0 && y < size, "Граница карты");
    const tile = terrain(world.seed, world.land, x, y);
    ensure(!["water", "rock"].includes(tile), "Непроходимая местность");
    Object.assign(audit, {
      from: [c.x, c.y],
      to: [x, y],
      tile,
      method: "deterministic",
    });
    Object.assign(c, {
      x,
      y,
      lastMove: now,
      explored: [...new Set([...c.explored, ...sight(x, y)])],
    });
    text = "Переход на (" + x + ", " + y + ")";
  }
  if (a.type === "talk") {
    ensure(
      Math.abs(c.x - npcPos.x) + Math.abs(c.y - npcPos.y) <= 1,
      "Подойдите к проводнику",
    );
    text = guideSpeech(
      world.draft.npc,
      scene,
      " показывает дорогу к руинам (15, 14). " + world.draft.hook,
    );
    if (!c.talked) {
      reward = 40;
      c.talked = true;
    }
    audit.firstConversation = reward > 0;
  }
  if (a.type === "use") {
    ensure(
      c.inventory > 0 && c.energy < c.maxEnergy,
      "Паёк нужен при потере сил и наличии запаса",
    );
    audit.energyBefore = c.energy;
    c.inventory--;
    c.energy = Math.min(c.maxEnergy, c.energy + 3);
    audit.energyAfter = c.energy;
    text = "Походный паёк восстановил силы.";
  }
  if (a.type === "roll" || a.type === "survey") {
    const survey = a.type === "survey";
    if (survey) {
      ensure(c.talked, "Сначала поговорите с проводником");
      ensure(
        Math.abs(c.x - ruin.x) + Math.abs(c.y - ruin.y) <= 1,
        "Подойдите к руинам (15, 14)",
      );
      ensure(!c.surveyed, "Руины уже исследованы");
    }
    const fresh = c.energy > 0;
    const check = (difficulty: number) => ({
      capacity: c.capacity + c.level,
      difficulty,
      modifier: (fresh ? 5 : 0) - (c.flaw === "Рассеянность" ? 3 : 0),
      roll: randomInt(1, 101),
    });
    const result = resolveAction(
      survey ? "complex" : "probabilistic",
      true,
      survey ? [check(8), check(10)] : [check(14)],
    );
    Object.assign(audit, result, { energyBefore: c.energy });
    c.energy = Math.max(0, c.energy - 1);
    text = survey
      ? result.success
        ? "В руинах найдена карта старого тракта."
        : "Надпись ускользнула. Можно повторить исследование."
      : result.success
        ? "Проверка наблюдательности пройдена."
        : "Проверка наблюдательности не пройдена.";
    if (survey && result.success) {
      reward = 65;
      c.surveyed = true;
    } else if (!survey && result.success) reward = 12;
  }
  if (a.type === "level") {
    const next = levelUp(c.level, BigInt(c.xp));
    Object.assign(audit, {
      spent: (BigInt(c.xp) - next.xp).toString(),
      rewards: next.rewards,
    });
    Object.assign(c, {
      level: next.level,
      xp: next.xp.toString(),
      rewards: [...c.rewards, ...next.rewards],
      ...energyAfterLevel(c.maxEnergy),
    });
    text =
      "Достигнут уровень " + c.level + ". Потрачено " + audit.spent + " XP.";
  }
  if (reward) c.xp = awardExperience(BigInt(c.xp), BigInt(reward)).toString();
  audit.xpAward = reward;
  return { text, audit };
}
