import type { Character } from "../shared/index.ts";
import { gearDefs } from "../shared/phase2.ts";
export type Metric = {
  label: string;
  unit: string;
  current: number;
  normal: number;
  maximum: number;
  potential: number;
};
export function energyAfterLevel(maximum: number) {
  return { energy: maximum + 1, maxEnergy: maximum + 1 };
}
export function attributes(c: Character): Record<string, Metric> {
  const strength = (c.profession === "C-001" ? 12 : 9) + c.level;
  const keen = c.race === "R-009" ? 2 : 0;
  const e = c.extra;
  function value(
    label: string,
    unit: string,
    normal: number,
    current = normal,
    maximum = normal,
    potential = normal + Math.max(1, Math.round(normal * 0.25)),
  ) {
    return { label, unit, current, normal, maximum, potential };
  }
  return {
    strength: value(
      "Сила",
      "ед.",
      strength,
      (e?.hp ?? 18) < 7 ? Math.max(1, strength - 3) : strength,
    ),
    carry: value("Переносимый груз", "кг", strength * 2),
    speed: value("Скорость ходьбы", "клеток/с", 4.55),
    acceleration: value("Разгон", "клеток/с²", 3),
    reaction: value("Реакция", "мс", 220),
    endurance: value("Выносливость", "ед.", 12, e?.stamina ?? 12),
    coordination: value("Координация", "ед.", 10 + keen),
    balance: value("Равновесие", "ед.", 9),
    dexterity: value("Ловкость", "ед.", 10 + keen),
    health: value("Здоровье", "ед.", 18, e?.hp ?? 18),
    perception: value("Наблюдательность", "ед.", c.capacity + c.level),
    memory: value("Память", "ед.", 10),
    knowledge: value("Знания", "ед.", c.profession === "C-022" ? 13 : 8),
    magic: value("Магическая энергия", "ед.", c.maxEnergy, c.energy),
    control: value("Контроль магии", "ед.", c.profession === "C-022" ? 12 : 4),
    regen: value("Восстановление", "ед./с", 0.25),
    resistance: value(
      "Защита экипировки",
      "ед.",
      e?.gear
        .filter((g) => g.equipped)
        .reduce((t, g) => t + gearDefs[g.kind].armor, 0) || 0,
    ),
    social: value("Общение", "ед.", 10),
  };
}
export const traits = [
  {
    id: "fatigue",
    name: "Утомляемость",
    category: "resource.capacity",
    exclusion: "starting-flaw",
  },
  {
    id: "distracted",
    name: "Рассеянность",
    category: "check.attention",
    exclusion: "starting-flaw",
  },
];
export function validateTraits(ids: string[]) {
  const chosen = ids.map((id) => traits.find((t) => t.id === id));
  return (
    chosen.every(Boolean) &&
    new Set(chosen.map((t) => t!.category)).size === ids.length &&
    new Set(chosen.map((t) => t!.exclusion)).size === ids.length
  );
}
