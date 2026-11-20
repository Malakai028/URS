import { randomInt, randomUUID } from "node:crypto";
import { attributes } from "../../packages/engine/attributes.ts";
import { terrain, size, resolveAction } from "../../packages/engine/index.ts";
import {
  skills,
  gearDefs,
  standardLook,
  type Extra,
  type Gear,
} from "../../packages/shared/phase2.ts";
import type { Action, Character } from "../../packages/shared/index.ts";
import { skillTarget } from "../../packages/shared/targeting.ts";
import { ensure, guideSpeech, sight } from "./game.ts";
import type { Area } from "../../packages/shared/creatures.ts";
import {
  creatureCanSee,
  creatureCombat,
  damageCreature,
  inspectCreature,
  isCreature,
  visibleCreatures,
  type CreatureScene,
} from "./creatures.ts";
import { discover, projectCreature } from "./creature-knowledge.ts";
export type { Area } from "../../packages/shared/creatures.ts";
type Drop = Gear & { x: number; y: number; area: Area };
export type Scene = CreatureScene & {
  opened: boolean;
  beacon: boolean;
  loot: Drop[];
  claimed: string[];
};
export const freshScene = (): Scene => ({
  opened: false,
  beacon: false,
  guardian: 16,
  loot: [],
  claimed: [],
});
export function details(c: Character): Extra {
  return (c.extra ??= {
    hp: 18,
    stamina: 12,
    regenAt: 0,
    guard: "",
    guardUntil: 0,
    area: "field",
    facing: [1, 0],
    gear: [],
    uses: {},
    cooldown: {},
    look: { ...standardLook },
  });
}
export function ground(
  seed: string,
  land: string,
  area: Area,
  x: number,
  y: number,
) {
  if (area !== "field") {
    if (area === "cave" && x === 6 && y >= 4 && y <= 9) return "hazard";
    return x === 0 || y === 0 || x === 15 || y === 15 ? "rock" : "trail";
  }
  if ((y === 13 && x >= 12 && x <= 35) || (x === 35 && y >= 13 && y <= 26))
    return "trail";
  if (x >= 12 && x <= 19 && y >= 10 && y <= 16) return "trail";
  return terrain(seed, land, x, y);
}
export function creatureGround(seed: string, land: string) {
  return (area: Area, x: number, y: number) =>
    !["rock", "water", "hazard"].includes(ground(seed, land, area, x, y));
}
export function positions(s: Scene, area: Area, npc: string) {
  return [
    ...(area === "field"
      ? [
          {
            id: "lodge",
            kind: "ruin",
            name: "Посёлок перевозчиков",
            x: 22,
            y: 13,
          },
          { id: "cave", kind: "ruin", name: "Пещера у перевала", x: 35, y: 26 },
          { id: "guide", kind: "npc", name: npc, x: 13, y: 12 },
          {
            id: "cache",
            kind: "chest",
            name: s.opened ? "Открытый тайник" : "Тайник дозора",
            x: 12,
            y: 13,
          },
          { id: "gate", kind: "ruin", name: "Вход в башню", x: 15, y: 14 },
        ]
      : area === "lodge"
        ? [
            { id: "gate", kind: "ruin", name: "Дверь на тракт", x: 2, y: 2 },
            { id: "well", kind: "npc", name: "Колодец артели", x: 4, y: 3 },
          ]
        : area === "cave"
          ? [
              { id: "gate", kind: "ruin", name: "Выход из пещеры", x: 2, y: 2 },
              {
                id: "inscription",
                kind: "beacon",
                name: "Рунная плита",
                x: 7,
                y: 6,
              },
            ]
          : [
              { id: "gate", kind: "ruin", name: "Выход на тракт", x: 2, y: 2 },
              {
                id: "beacon",
                kind: "beacon",
                name: s.beacon ? "Горящий маяк" : "Погасший маяк",
                x: 6,
                y: 4,
              },
            ]),
    ...visibleCreatures(s, area, "").map((c) => ({
      id: c.id,
      name: c.name,
      kind: "monster",
      ...c.position,
    })),
    ...s.loot
      .filter((l) => l.area === area)
      .map((l) => ({
        id: l.id,
        kind: "loot",
        name: gearDefs[l.kind].name,
        x: l.x,
        y: l.y,
      })),
  ];
}
export function advance(
  c: Character,
  action: Extract<Action, { type: "ability" | "gear" }>,
  scene: Scene,
  w: { id?: string; seed: string; land: string; draft: { npc: string } },
  now: number,
  actorId: string,
  recipient?: Character,
) {
  const e = details(c),
    audit: Record<string, unknown> = {
      actor: c.name,
      method: "deterministic",
      ruleset: "0.6-p02.1",
      xpAward: 0,
    };
  const elapsed = Math.max(0, Math.floor((now - (e.regenAt || now)) / 4000));
  e.stamina = Math.min(12, e.stamina + elapsed);
  if (!e.regenAt || elapsed) e.regenAt = now;
  const adjacent = (x: number, y: number) =>
    Math.abs(c.x - x) + Math.abs(c.y - y) <= 1;
  const walkable = creatureGround(w.seed, w.land);
  const objects = positions(scene, e.area, w.draft.npc).filter(
    (p) => !isCreature(p.id) || creatureCanSee(walkable, e.area, c, p),
  );
  let text = "";
  if (action.type === "gear") {
    const mass = (ch: Character) =>
      details(ch).gear.reduce((total, g) => total + gearDefs[g.kind].mass, 0);
    if (action.op === "take") {
      const i = scene.loot.findIndex(
        (l) => l.id === action.item && l.area === e.area && adjacent(l.x, l.y),
      );
      ensure(i >= 0, "Подойдите к предмету");
      ensure(
        mass(c) + gearDefs[scene.loot[i].kind].mass <=
          attributes(c).carry.current,
        "Превышена грузоподъёмность",
      );
      const l = scene.loot.splice(i, 1)[0];
      e.gear.push({ id: l.id, kind: l.kind, equipped: false });
      text = "Подобран предмет: " + gearDefs[l.kind].name;
    } else {
      const i = e.gear.findIndex((g) => g.id === action.item);
      ensure(i >= 0, "Предмет отсутствует");
      const g = e.gear[i],
        def = gearDefs[g.kind];
      if (action.op === "equip") {
        for (const other of e.gear)
          if (gearDefs[other.kind].slot === def.slot) other.equipped = false;
        g.equipped = true;
        text = "Экипировано: " + def.name;
      }
      if (action.op === "unequip") {
        ensure(g.equipped, "Предмет уже снят");
        g.equipped = false;
        text = "Снято: " + def.name;
      }
      if (action.op === "drop") {
        scene.loot.push({
          ...g,
          equipped: false,
          x: c.x,
          y: c.y,
          area: e.area,
        });
        e.gear.splice(i, 1);
        text = "Оставлено: " + def.name;
      }
      if (action.op === "give") {
        ensure(
          recipient &&
            recipient.userId !== c.userId &&
            details(recipient).area === e.area &&
            adjacent(recipient.x, recipient.y),
          "Получатель должен быть рядом",
        );
        ensure(
          mass(recipient) + def.mass <= attributes(recipient).carry.current,
          "Получатель перегружен",
        );
        details(recipient).gear.push({ ...g, equipped: false });
        e.gear.splice(i, 1);
        text = "Передано " + recipient.name + ": " + def.name;
      }
    }
    return { text, audit };
  }
  const k = action.skill,
    [label, cost, delay, level] = skills[k];
  ensure(c.level >= level, "Требуется уровень " + level);
  ensure(now >= (e.cooldown[k] || 0), "Способность восстанавливается");
  ensure(e.stamina >= cost, "Недостаточно выносливости");
  ensure(
    e.hp > 0 || k === "rest",
    "Персонаж обессилен. Используйте передышку.",
  );
  const to = objects.find((o) => o.id === action.target);
  const selected =
    to && inspectCreature(scene, to.id, w.id ?? "", false)?.creature;
  const visibleName = (id: string, name: string) => {
    const m = inspectCreature(scene, id, w.id ?? "", false)?.creature;
    return m ? projectCreature(m, e).name : name;
  };
  audit.targetMode = skillTarget[k];
  if (action.target && ["entity", "nearest"].includes(skillTarget[k]))
    ensure(to || recipient, "Недопустимая цель");
  if (skillTarget[k] === "entity") ensure(action.target, "Выберите цель");
  if (to && ["entity", "nearest"].includes(skillTarget[k])) {
    audit.target = to.id;
    audit.targetName = visibleName(to.id, to.name);
  }
  if (["walk", "run", "jump", "sprint", "climb", "swim"].includes(k)) {
    const [dx, dy] = [action.dx ?? e.facing[0], action.dy ?? e.facing[1]];
    ensure(Math.abs(dx) + Math.abs(dy) === 1, "Укажите одно направление");
    const distance = k === "sprint" ? 3 : k === "run" || k === "jump" ? 2 : 1;
    ensure(
      now - c.lastMove >= Math.max(220, delay),
      "Движение слишком быстро",
      429,
    );
    const bound = e.area === "field" ? size : 16;
    for (let i = 1; i <= distance; i++) {
      const x = c.x + dx * i,
        y = c.y + dy * i;
      ensure(x >= 0 && x < bound && y >= 0 && y < bound, "Граница карты");
      const tile = ground(w.seed, w.land, e.area, x, y);
      ensure(
        tile !== "rock" || (k === "climb" && e.area === "field"),
        "Скала преграждает путь",
      );
      ensure(
        tile !== "water" || k === "swim" || (k === "jump" && i < distance),
        "Требуется плавание",
      );
    }
    Object.assign(audit, { from: [c.x, c.y], distance });
    c.x += dx * distance;
    c.y += dy * distance;
    e.facing = [dx, dy];
    c.lastMove = now;
    if (ground(w.seed, w.land, e.area, c.x, c.y) === "hazard") {
      e.hp = Math.max(0, e.hp - 2);
      audit.hazard = "Острые кристаллы: −2 здоровья";
    }
    c.explored = [
      ...new Set([
        ...c.explored,
        ...sight(c.x, c.y).map((v) =>
          e.area === "field" ? v : e.area + ":" + v,
        ),
      ]),
    ];
    text = label + " → " + c.x + ", " + c.y;
  } else if (k === "rest") {
    e.hp = Math.min(18, e.hp + 5);
    e.stamina = Math.min(12, e.stamina + 5);
    text = "Передышка у укрытия. Здоровье " + e.hp + "/18.";
  } else if (k === "observe") {
    if (to)
      ensure(
        isCreature(to.id)
          ? Math.max(Math.abs(c.x - to.x), Math.abs(c.y - to.y)) <= 3
          : Math.abs(c.x - to.x) + Math.abs(c.y - to.y) <= 4,
        "Цель вне дистанции осмотра",
      );
    if (selected && discover(e, selected, "identified", now))
      audit.discovery = "Вид определён";
    text =
      (to ? [to] : objects)
        .filter(
          (o) =>
            Math.abs(c.x - o.x) + Math.abs(c.y - o.y) <= 4 ||
            (o === to && isCreature(o.id)),
        )
        .map((o) => visibleName(o.id, o.name) + " (" + o.x + ", " + o.y + ")")
        .join(" · ") || "Вблизи нет ориентиров.";
  } else if (k === "block" || k === "dodge" || k === "stealth") {
    e.guard = k;
    e.guardUntil = now + 15000;
    text = label + " действует 15 секунд.";
  } else if (k === "search" || k === "interact") {
    const obj =
      to ??
      objects
        .filter((o) => !isCreature(o.id) && adjacent(o.x, o.y))
        .sort(
          (a, b) =>
            Math.abs(c.x - a.x) +
            Math.abs(c.y - a.y) -
            Math.abs(c.x - b.x) -
            Math.abs(c.y - b.y),
        )[0];
    ensure(obj && adjacent(obj.x, obj.y), "Подойдите к выбранной цели");
    audit.target = obj.id;
    audit.targetName = obj.name;
    if (obj.id === "cache") {
      ensure(!scene.opened, "Тайник уже открыт. Подберите предметы.");
      scene.opened = true;
      for (const kind of ["blade", "vest"] as const)
        scene.loot.push({
          id: randomUUID(),
          kind,
          equipped: false,
          x: obj.x,
          y: obj.y,
          area: e.area,
        });
      text = "В тайнике лежат клинок и жилет.";
    } else if (["gate", "lodge", "cave"].includes(obj.id)) {
      const previous = e.area;
      e.area =
        e.area === "field"
          ? obj.id === "gate"
            ? "vault"
            : (obj.id as Area)
          : "field";
      [c.x, c.y] =
        e.area !== "field"
          ? [2, 2]
          : previous === "vault"
            ? [15, 14]
            : previous === "lodge"
              ? [22, 13]
              : [35, 26];
      text =
        e.area === "vault"
          ? scene.beacon
            ? "Свет маяка освещает башню."
            : scene.guardian > 0
              ? "Внутри башни слышен звон стража."
              : "В башне тихо. Маяк ещё погашен."
          : e.area === "lodge"
            ? "На площади артели есть колодец."
            : e.area === "cave"
              ? "Среди острых кристаллов виднеется надпись."
              : "Вы вернулись на тракт.";
    } else if (obj.id === "well") {
      e.hp = 18;
      e.stamina = 12;
      text = "Вода из колодца восстановила силы.";
    } else if (obj.id === "inscription") {
      const claim = "inscription:" + actorId;
      ensure(!scene.claimed.includes(claim), "Надпись уже изучена");
      scene.claimed.push(claim);
      audit.xpAward = 25;
      text =
        "Руна рассказывает об основании артели. Находка записана в историю.";
    } else if (obj.id === "guide") {
      text = guideSpeech(
        w.draft.npc,
        scene,
        " указывает на тайник к югу и башню на востоке.",
      );
      if (!c.talked) {
        c.talked = true;
        audit.xpAward = 40;
      }
    } else if (obj.id === "beacon") {
      ensure(scene.guardian === 0, "Маяк охраняет страж");
      ensure(!scene.beacon, "Маяк уже зажжён");
      scene.beacon = true;
      audit.xpAward = 60;
      text = "Маяк зажжён. Свет над трактом виден всей партии.";
    } else ensure(false, "Выберите действие для этой цели");
  } else if (k === "attack") {
    if (recipient) {
      const target = details(recipient);
      ensure(
        recipient.userId !== c.userId &&
          e.duel &&
          target.duel &&
          target.hp > 0 &&
          target.area === e.area &&
          adjacent(recipient.x, recipient.y),
        "Для поединка нужны согласие обоих и соседняя клетка",
      );
      const hit = resolveAction("probabilistic", true, [
        {
          capacity: c.capacity + c.level,
          difficulty: recipient.capacity + recipient.level,
          modifier: 0,
          roll: randomInt(1, 101),
        },
      ]);
      const armor = attributes(recipient).resistance.current;
      const damage = hit.success
        ? Math.max(
            0,
            Math.floor(attributes(c).strength.current / 3) +
              e.gear
                .filter((g) => g.equipped)
                .reduce((n, g) => n + gearDefs[g.kind].power, 0) -
              armor -
              (target.guardUntil > now ? 2 : 0),
          )
        : 0;
      target.hp = Math.max(0, target.hp - damage);
      Object.assign(audit, hit, { armor, damage });
      text = "Поединок с " + recipient.name + ". Урон " + damage + ".";
    } else {
      const profile = to && creatureCombat(to.id);
      ensure(
        to && profile && selected?.alive && adjacent(to.x, to.y),
        "Выберите живое существо на соседней клетке",
      );
      const check = resolveAction("probabilistic", true, [
        {
          capacity: c.capacity + c.level,
          difficulty: profile.aptitude,
          modifier: 0,
          roll: randomInt(1, 101),
        },
      ]);
      const equipped = e.gear.filter((g) => g.equipped);
      const attack =
        Math.floor(attributes(c).strength.current / 3) +
        equipped.reduce((n, g) => n + gearDefs[g.kind].power, 0);
      const damage = check.success
        ? Math.max(1, attack - profile.mitigation)
        : 0;
      const armor = equipped.reduce((n, g) => n + gearDefs[g.kind].armor, 0);
      damageCreature(
        scene,
        to.id,
        { id: c.userId, area: e.area, x: c.x, y: c.y },
        damage,
        now,
      );
      const defense =
        e.guardUntil > now
          ? e.guard === "block"
            ? 3
            : e.guard === "dodge"
              ? 2
              : 1
          : 0;
      const retaliation =
        to.id === "sentinel" && scene.guardian
          ? Math.max(0, profile.damage - armor - defense)
          : 0;
      e.hp = Math.max(0, e.hp - retaliation);
      Object.assign(audit, check, {
        damage,
        armor,
        ...(to.id === "sentinel" ? { resistance: profile.mitigation } : {}),
        retaliation,
      });
      if (to.id !== "sentinel")
        audit.attempts = check.attempts.map(({ roll, success }) => ({
          roll,
          success,
        }));
      text =
        to.id === "sentinel"
          ? "Урон стражу " + damage + ". Ответный урон " + retaliation + "."
          : "Урон существу " + damage + ".";
      if (damage > 0) discover(e, selected, "hit", now);
      if (damage >= (selected.hp ?? Infinity)) {
        discover(e, { ...selected, behavior: "dead" }, "victory", now);
        if (to.id !== "sentinel") text += " Существо повержено.";
      }
      if (
        to.id === "sentinel" &&
        !scene.guardian &&
        !scene.claimed.includes(actorId)
      ) {
        scene.claimed.push(actorId);
        audit.xpAward = 55;
        scene.loot.push({
          id: randomUUID(),
          kind: "shard",
          equipped: false,
          x: to.x,
          y: to.y,
          area: "vault",
        });
        text += " Страж повержен.";
      }
    }
  }
  e.stamina -= cost;
  e.cooldown[k] = now + delay;
  e.uses[k] = (e.uses[k] || 0) + 1;
  c.xp = (BigInt(c.xp) + BigInt(Number(audit.xpAward))).toString();
  Object.assign(audit, {
    skill: k,
    stamina: e.stamina,
    staminaSpent: cost,
    hp: e.hp,
  });
  return { text, audit };
}
