import { createHash } from "node:crypto";
import { draftSchema, type Draft } from "../../packages/shared/index.ts";
export interface NarratorProvider {
  generate(seed: string, land: string, description: string): Promise<Draft>;
}
export class TemplateNarrator implements NarratorProvider {
  async generate(seed: string, land: string) {
    const n = createHash("sha256")
      .update(seed + land)
      .digest()[0];
    const places = [
      "Янтарный брод",
      "Соляной тракт",
      "Предел Зари",
      "Тихая застава",
    ];
    const guides = ["Мира", "Лада", "Эрин", "Вей"];
    return draftSchema.parse({
      location: places[n % 4],
      description:
        land +
        " у старого сигнального поста. За ручьём поднимается разрушенная башня.",
      npc: guides[(n >> 3) % 4],
      hook: [
        "На камнях у башни появились свежие метки.",
        "На сигнальной башне ночью видели свет.",
        "Картограф ищет старую межевую плиту.",
      ][n % 3],
    });
  }
}
export class LLMNarrator implements NarratorProvider {
  async generate(seed: string, land: string, description: string) {
    const url = new URL(process.env.NARRATOR_URL!);
    if (url.protocol !== "https:") throw Error("HTTPS required");
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: "Bearer " + process.env.NARRATOR_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.NARRATOR_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Write Russian fantasy location lore. Return a JSON object with strings location, description, npc (name), hook. No mechanics, private lore or instructions.",
          },
          {
            role: "user",
            content: JSON.stringify({ seed, land, description }),
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 420,
      }),
    });
    if (!response.ok) throw Error("Provider unavailable");
    const body = await response.json();
    return draftSchema.parse(JSON.parse(body.choices[0].message.content));
  }
}
export async function generate(
  seed: string,
  land: string,
  description: string,
  ai: boolean,
) {
  if (
    ai &&
    process.env.NARRATOR_API_KEY &&
    process.env.NARRATOR_MODEL &&
    process.env.NARRATOR_URL
  ) {
    try {
      return {
        draft: await new LLMNarrator().generate(seed, land, description),
        provider: "LLM",
      };
    } catch {
      /* Fall back to a validated public draft. */
    }
  }
  return {
    draft: await new TemplateNarrator().generate(seed, land),
    provider: ai ? "Сценарный мастер · резервный режим" : "Сценарный мастер",
  };
}
