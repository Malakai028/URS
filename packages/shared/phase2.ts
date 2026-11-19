import { z } from "zod";
import {
  assessRegistrationPassword,
  passwordLength,
  passwordMax,
  registrationPasswordChecks,
  type RegistrationCheck,
} from "./registration-password.ts";
export const avatarIds = ["leaf", "moon", "flame", "peak"] as const;
export const marks = { leaf: "❧", moon: "☾", flame: "♨", peak: "▲" };
export const profileSchema = z
  .object({
    display: z.string().trim().min(2).max(40),
    avatar: z.enum(avatarIds),
    bio: z.string().max(360),
    publicProfile: z.boolean(),
  })
  .strict();
export const existingPassword = z
  .string()
  .min(1, "Введите пароль")
  .max(passwordMax * 2, "Пароль слишком длинный")
  .refine(
    (value) => passwordLength(value) <= passwordMax,
    "Пароль слишком длинный",
  );
export const credentials = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Введите имя игрока длиной от 3 символов")
      .max(32, "Имя игрока должно содержать не более 32 символов"),
    password: existingPassword,
  })
  .strict();
export const passwordPair = z
  .object({
    password: z
      .string()
      .max(passwordMax * 2, "Пароль должен содержать не более 128 символов"),
    confirmation: z
      .string()
      .max(passwordMax * 2, "Подтверждение слишком длинное"),
  })
  .strict();
export function validateNewPassword(
  data: z.infer<typeof passwordPair>,
  name = "",
  email = "",
) {
  const { checks } = assessRegistrationPassword(
    data.password,
    data.confirmation,
    name,
    email,
  );
  const order: RegistrationCheck[] = [
    "min",
    "max",
    "format",
    "common",
    "identity",
    "predictable",
    "confirmation",
  ];
  return order
    .filter((check) => checks[check] === false)
    .map((check) => ({
      code: "custom" as const,
      path: [check === "confirmation" ? "confirmation" : "password"],
      message: registrationPasswordChecks[check][1],
    }));
}
export const registration = credentials
  .extend({
    email: z
      .email("Введите адрес электронной почты")
      .max(254)
      .transform((s) => s.toLowerCase()),
    display: z
      .string()
      .trim()
      .min(2, "Отображаемое имя должно содержать не менее 2 символов")
      .max(40, "Отображаемое имя должно содержать не более 40 символов"),
    avatar: z.enum(avatarIds),
    ...passwordPair.shape,
    accepted: z.literal(true, "Примите условия экспедиции"),
  })
  .superRefine((data, ctx) => {
    for (const issue of validateNewPassword(data, data.name, data.email))
      ctx.addIssue(issue);
  });
export const appearance = z
  .object({
    skin: z.enum(["ochre", "umber", "ivory"]),
    hair: z.enum(["coal", "silver", "copper"]),
    cloak: z.enum(["jade", "plum", "amber"]),
    shape: z.enum(["scout", "warden"]),
    eyes: z.enum(["brown", "blue", "green"]),
    face: z.enum(["oval", "square"]),
    accessory: z.enum(["none", "brooch", "hood"]),
  })
  .strict();
export type Look = z.infer<typeof appearance>;
export const standardLook: Look = {
  skin: "ochre",
  hair: "coal",
  cloak: "jade",
  shape: "scout",
  eyes: "brown",
  face: "oval",
  accessory: "brooch",
};
export const gearDefs = {
  blade: {
    name: "Дорожный клинок",
    slot: "hand",
    power: 3,
    armor: 0,
    mass: 1.2,
    price: 2000,
  },
  vest: {
    name: "Кожаный жилет",
    slot: "body",
    power: 0,
    armor: 2,
    mass: 2.4,
    price: 5000,
  },
  shard: {
    name: "Сигнальный кристалл",
    slot: "pouch",
    power: 0,
    armor: 0,
    mass: 0.2,
    price: 100,
  },
} as const;
export type Gear = {
  id: string;
  kind: keyof typeof gearDefs;
  equipped: boolean;
};
export const skills = {
  walk: ["Ходьба", 0, 220, 0],
  run: ["Бег", 1, 320, 0],
  jump: ["Прыжок", 2, 600, 0],
  sprint: ["Спринт", 3, 700, 1],
  attack: ["Удар", 2, 750, 0],
  block: ["Блок", 1, 600, 0],
  dodge: ["Уклонение", 1, 500, 0],
  observe: ["Наблюдение", 0, 500, 0],
  search: ["Поиск", 1, 550, 0],
  rest: ["Передышка", 0, 1500, 0],
  climb: ["Лазание", 2, 800, 0],
  swim: ["Плавание", 2, 900, 0],
  stealth: ["Скрытность", 1, 1200, 0],
  interact: ["Взаимодействие", 0, 300, 0],
} as const;
export type Skill = keyof typeof skills;
export const skillIds = Object.keys(skills) as [Skill, ...Skill[]];
export type Extra = {
  creatureKnowledge?: Record<string, import("./creatures.ts").CreatureSighting>;
  duel?: boolean;
  hp: number;
  stamina: number;
  regenAt: number;
  guard: string;
  guardUntil: number;
  area: "field" | "vault" | "lodge" | "cave";
  facing: [number, number];
  gear: Gear[];
  uses: Partial<Record<Skill, number>>;
  cooldown: Partial<Record<Skill, number>>;
  look: Look;
};
export const extendedAction = z
  .object({
    type: z.literal("ability"),
    skill: z.enum(skillIds),
    dx: z.number().int().min(-1).max(1).optional(),
    dy: z.number().int().min(-1).max(1).optional(),
    target: z
      .union([
        z.enum([
          "sentinel",
          "trail-wolf",
          "trail-deer",
          "trail-scout",
          "cave-skeleton",
          "gate",
          "cache",
          "guide",
          "beacon",
          "lodge",
          "cave",
          "inscription",
          "well",
        ]),
        z.uuid(),
      ])
      .optional(),
  })
  .strict();
export const itemAction = z
  .object({
    type: z.literal("gear"),
    op: z.enum(["equip", "unequip", "drop", "take", "give"]),
    item: z.string().min(1).max(90),
    recipient: z.uuid().optional(),
  })
  .strict();
export const channelOf = (type: string) =>
  ({
    chat: "ooc",
    ic: "ic",
    whisper: "private",
    group: "private",
    gm: "narrative",
    intent: "narrative",
    talk: "narrative",
    level: "system",
  })[type] || "actions";
