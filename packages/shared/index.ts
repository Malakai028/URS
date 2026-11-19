import { z } from "zod";
export const roles = ["owner", "gm", "player", "spectator"] as const;
export const draftSchema = z
  .object({
    location: z.string().min(1).max(90),
    description: z.string().min(1).max(700),
    npc: z.string().min(1).max(64),
    hook: z.string().min(1).max(400),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;
export const worldSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().max(600),
    seed: z.string().min(1).max(80),
    land: z.enum(["Лес", "Нагорье", "Долина"]),
    access: z.enum(["invite", "listed"]),
    ai: z.boolean(),
  })
  .strict();
export const authSchema = z
  .object({
    name: z.string().trim().min(3).max(32),
    password: z
      .string()
      .min(8)
      .max(64)
      .refine((v) => Buffer.byteLength(v) <= 72),
  })
  .strict();
import { extendedAction, itemAction, type Extra } from "./phase2.ts";
export const actions = z.discriminatedUnion("type", [
  extendedAction,
  itemAction,
  z
    .object({
      type: z.literal("group"),
      recipients: z.array(z.uuid()).min(1).max(8),
      text: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("whisper"),
      recipient: z.uuid(),
      text: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      dx: z.number().int().min(-1).max(1),
      dy: z.number().int().min(-1).max(1),
    })
    .strict(),
  z
    .object({ type: z.enum(["roll", "talk", "survey", "use"]) })
    .strict(),
  z
    .object({
      type: z.literal("level"),
      expected: z.object({ level: z.number().int().nonnegative(), hero: z.uuid() }).strict().optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(["chat", "ic", "intent", "gm"]),
      text: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export type Action = z.infer<typeof actions>;
export const commandSchema = z
  .object({ key: z.uuid(), action: actions })
  .strict();
export const characterSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    race: z.enum(["R-001", "R-009"]),
    profession: z.enum(["C-001", "C-022"]),
    flaw: z.enum(["Утомляемость", "Рассеянность"]),
    mode: z.enum(["manual", "random", "partial"]),
  })
  .strict();
export type Character = {
  extra?: Extra;
  userId: string;
  name: string;
  race: string;
  profession: string;
  level: number;
  xp: string;
  tier: number;
  rank: number;
  q: number;
  threat: null;
  administration: null;
  x: number;
  y: number;
  energy: number;
  maxEnergy: number;
  capacity: number;
  inventory: number;
  currency: string;
  talked: boolean;
  surveyed: boolean;
  lastMove: number;
  explored: string[];
  rewards: string[];
  flaw: string;
  mode: string;
};
export type EventRecord = {
  id: string;
  worldId: string;
  actor: string;
  action: string;
  timestamp: string;
  visibility: string;
  text: string;
  audit: Record<string, unknown>;
};
