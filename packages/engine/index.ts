export const letters = [..."HGFEDCBASLMV"];
export const families =
  "Деревянный Бронзовый Серебряный Золотой Изумрудный Алмазный Платиновый Обсидиановый Мифический Легендарный Небесный".split(
    " ",
  );
const roman = ["V", "IV", "III", "II", "I"];
function index(value: number, count: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= count)
    throw Error("Индекс вне диапазона");
  return value;
}
export function indexToTier(i: number) {
  index(i, 2520);
  const m = (i % 21) - 10;
  return (
    letters[Math.floor(i / 210)].repeat(1 + Math.floor((i % 210) / 21)) +
    (m < 0 ? "-" : "+").repeat(Math.abs(m))
  );
}
export function tierToIndex(t: string) {
  const parts = /^([HGFEDCBASLMV])\1{0,9}(-{0,10}|\+{1,10})$/.exec(t);
  if (!parts) throw Error("Недопустимый тир");
  const suffix = parts[2];
  return (
    letters.indexOf(parts[1]) * 210 +
    21 * (t.length - suffix.length - 1) +
    10 +
    suffix.length * (suffix.startsWith("-") ? -1 : 1)
  );
}
export function indexToRank(i: number) {
  index(i, 55);
  return families[Math.floor(i / 5)] + " " + roman[i % 5];
}
export function rankToIndex(rank: string) {
  const [f, r, ...rest] = rank.split(" ");
  return index(
    families.length && !rest.length && roman.includes(r)
      ? families.indexOf(f) * 5 + roman.indexOf(r)
      : -1,
    55,
  );
}
export const rules = {
  version: "0.6-p01.1",
  base: 100n,
  growthNum: 11n,
  growthDen: 5n,
  tierGrowth: 1.012,
  rankGrowth: 1.18,
  nodes: [5, 10, 25, 50, 100],
};
export function getLevelUpCost(l: number, r = rules) {
  if (
    !Number.isSafeInteger(l) ||
    l < 0 ||
    r.growthDen <= 0n ||
    r.growthNum <= 0n ||
    r.base <= 0n
  )
    throw Error("Некорректная стоимость");
  const n = BigInt(l),
    den = r.growthDen ** n;
  return (r.base * (n + 1n) ** 2n * r.growthNum ** n + den - 1n) / den;
}
export function getMilestoneRewards(l: number, r = rules) {
  return l > 0
    ? ["base", ...r.nodes.filter((k) => l % k === 0).map(String)]
    : [];
}
export function calculateQ(t: number, r: number, c = rules) {
  return (
    100 * c.tierGrowth ** index(t, 2520) + 100 * c.rankGrowth ** index(r, 55)
  );
}
export function canAssignThreat(
  actual: Record<string, number>,
  thresholds?: Record<string, number>,
) {
  const keys = ["level", "tier", "rank", "q", "stat", "trial", "achievement"];
  if (!thresholds || keys.some((k) => !Number.isFinite(thresholds[k])))
    return "notConfigured";
  return keys.every((k) => actual[k] >= thresholds[k])
    ? "eligible"
    : "ineligible";
}
export function awardExperience(
  xp: bigint,
  amount: bigint,
  alreadyAwarded = false,
) {
  if (xp < 0n || amount < 0n) throw Error("Некорректный опыт");
  return xp + (alreadyAwarded ? 0n : amount);
}
export function spendExperience(xp: bigint, amount: bigint) {
  if (amount < 0n || xp < amount) throw Error("Недостаточно опыта");
  return xp - amount;
}
export function levelUp(l: number, xp: bigint, r = rules) {
  return {
    level: l + 1,
    xp: spendExperience(xp, getLevelUpCost(l, r)),
    rewards: getMilestoneRewards(l + 1, r),
  };
}
export function convertCurrency(
  amount: bigint,
  from: bigint | null,
  to: bigint | null,
) {
  if (amount < 0n || !from || !to || from < 0n || to < 0n)
    throw Error("Курс недоступен");
  return { units: (amount * from) / to, remainderWood: (amount * from) % to };
}
type Check = {
  capacity: number;
  difficulty: number;
  modifier: number;
  roll: number;
};
export function resolveAction(
  mode: "deterministic" | "probabilistic" | "complex",
  possible: boolean,
  checks: Check[] = [],
) {
  if (
    (mode === "probabilistic" && checks.length !== 1) ||
    (mode === "complex" && checks.length < 2) ||
    (mode === "deterministic" && checks.length)
  )
    throw Error("Неверное число этапов");
  const attempts = [];
  if (possible)
    for (const c of checks) {
      if (
        ![c.capacity, c.difficulty, c.modifier, c.roll].every(
          Number.isFinite,
        ) ||
        c.capacity <= 0 ||
        c.difficulty <= 0 ||
        !Number.isInteger(c.roll) ||
        c.roll < 1 ||
        c.roll > 100
      )
        throw Error("Недопустимая проверка");
      const target = Math.max(
        0,
        Math.min(
          100,
          Math.floor(
            50 + 25 * Math.log2(c.capacity / c.difficulty) + c.modifier,
          ),
        ),
      );
      attempts.push({ ...c, target, success: c.roll <= target });
      if (c.roll > target) break;
    }
  return {
    method: mode,
    possible,
    attempts,
    success: possible && attempts.every((a) => a.success),
  };
}
export const size = 96,
  spawn = { x: 12, y: 12 },
  npcPos = { x: 13, y: 12 },
  ruin = { x: 15, y: 14 };
export function terrain(seed: string, land: string, x: number, y: number) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  if (x >= 10 && x <= 16 && y >= 10 && y <= 15) return "trail";
  const river = 3 + Math.round(2 * Math.sin((y + (h % 13)) / 4));
  if (x === river || x === river + 1) return "water";
  const n = Math.imul(x + 137, 73856093) ^ Math.imul(y + 139, 19349663) ^ h;
  if (Math.abs(n % 17) < 2) return "rock";
  return Math.abs(n % 10) < (land === "Лес" ? 7 : land === "Нагорье" ? 2 : 4)
    ? "forest"
    : "grass";
}
