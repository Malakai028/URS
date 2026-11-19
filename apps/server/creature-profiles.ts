export type CombatProfile = {
  anatomy: string;
  maxHp: number;
  stepMs: number;
  detection: number;
  reach: number;
  aptitude: number;
  damage: number;
  mitigation: number;
  cooldownMs: number;
  ability: string;
};

// Expedition playtest settings. Canonical classification is intentionally separate.
const profiles = new Map<string, CombatProfile>([
  [
    "B-001",
    {
      anatomy: "Четвероногое",
      maxHp: 11,
      stepMs: 2000,
      detection: 3,
      reach: 1,
      aptitude: 9,
      damage: 3,
      mitigation: 0,
      cooldownMs: 4000,
      ability: "Укус",
    },
  ],
  [
    "B-065",
    {
      anatomy: "Гуманоид",
      maxHp: 13,
      stepMs: 4000,
      detection: 3,
      reach: 2,
      aptitude: 8,
      damage: 2,
      mitigation: 1,
      cooldownMs: 6000,
      ability: "Бросок камня",
    },
  ],
  [
    "B-036",
    {
      anatomy: "Скелетная нежить",
      maxHp: 16,
      stepMs: 6000,
      detection: 4,
      reach: 1,
      aptitude: 7,
      damage: 4,
      mitigation: 2,
      cooldownMs: 8000,
      ability: "Удар костяной рукой",
    },
  ],
]);
export const combatProfile = (id: string | null) =>
  id ? profiles.get(id) : undefined;
export const guardianProfile: CombatProfile = {
  anatomy: "Страж встречи",
  maxHp: 16,
  stepMs: 2000,
  detection: 3,
  reach: 1,
  aptitude: 8,
  damage: 4,
  mitigation: 1,
  cooldownMs: 0,
  ability: "Контратака",
};
