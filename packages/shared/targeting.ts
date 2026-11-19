import { z } from "zod";
import type { Skill } from "./phase2.ts";

export const targetMode = z.enum([
  "none",
  "self",
  "direction",
  "nearest",
  "entity",
  "point",
  "area",
  "multiple",
]);
export const targetSelection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({ mode: z.literal("self") }).strict(),
  z
    .object({
      mode: z.literal("direction"),
      dx: z.number().int().min(-1).max(1),
      dy: z.number().int().min(-1).max(1),
    })
    .strict()
    .refine(
      (v) => Math.abs(v.dx) + Math.abs(v.dy) === 1,
      "Укажите одно направление",
    ),
  z.object({ mode: z.literal("nearest") }).strict(),
  z
    .object({ mode: z.literal("entity"), id: z.string().min(1).max(90) })
    .strict(),
  z
    .object({
      mode: z.literal("point"),
      x: z.number().int(),
      y: z.number().int(),
    })
    .strict(),
  z.object({ mode: z.literal("area"), id: z.string().min(1).max(90) }).strict(),
  z
    .object({
      mode: z.literal("multiple"),
      ids: z.array(z.string().min(1).max(90)).min(1).max(8),
    })
    .strict(),
]);

// Existing actions keep their wire format. These policies describe their requirements.
export const skillTarget: Record<Skill, z.infer<typeof targetMode>> = {
  walk: "direction",
  run: "direction",
  jump: "direction",
  sprint: "direction",
  climb: "direction",
  swim: "direction",
  attack: "entity",
  block: "self",
  dodge: "self",
  stealth: "self",
  rest: "self",
  observe: "nearest",
  search: "nearest",
  interact: "nearest",
};
