import { z } from "zod";
import { generate } from "./narrator.ts";
const line = z.string().trim().min(1).max(900);
export const planSchema = z
  .object({
    name: line,
    theme: line,
    history: line,
    geography: line,
    regions: line,
    cultures: line,
    factions: line,
    settlements: line,
    npcs: line,
    start: line,
    quests: line,
    threats: line,
    laws: line,
  })
  .strict();
async function propose(system: string, context: unknown) {
  if (
    !process.env.NARRATOR_API_KEY ||
    !process.env.NARRATOR_MODEL ||
    !process.env.NARRATOR_URL?.startsWith("https://")
  )
    return null;
  try {
    const response = await fetch(process.env.NARRATOR_URL, {
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
              system +
              " Ответ на русском в JSON. Только общедоступный лор. Не раскрывай скрытые комбинации и не предлагай оптимальные сборки.",
          },
          { role: "user", content: JSON.stringify(context) },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
      }),
    });
    if (response.ok)
      return JSON.parse((await response.json()).choices[0].message.content);
  } catch {
    /* Template response below. */
  }
  return null;
}
export async function worldPlan(
  name: string,
  seed: string,
  land: string,
  description: string,
  ai: boolean,
) {
  const d = (await generate(seed, land, description, false)).draft;
  const fallback = {
    name,
    theme: description || "Дозор на границе аномальной зоны",
    history:
      "До большого паводка караваны ходили через " +
      d.location +
      ". После исчезновения дозора старая башня перестала подавать сигналы.",
    geography:
      land +
      " вдоль извилистой реки. Тропа ведёт от стоянки к сигнальной башне.",
    regions: "Приграничный тракт и нижний ярус башни",
    cultures:
      "Картографы помечают безопасные тропы вышитыми лентами, перевозчики читают огни маяков.",
    factions:
      "Дозор переправы и артель перевозчиков спорят об открытии дороги.",
    settlements: d.location + " служит перевалочной станцией.",
    npcs: d.npc + " хранит ключи от дорожного тайника.",
    start: "Стоянка у переправы (12, 12)",
    quests:
      "Поговорить с проводником, найти снаряжение, обследовать башню и восстановить маяк.",
    threats:
      "Под башней остался осколочный страж. Официальный статус угрозы не присвоен.",
    laws: "Вход по правилам мира. Бой между игроками отключён. В этой экспедиции обессиленный герой восстанавливается передышкой.",
  };
  const v = ai
    ? planSchema.safeParse(
        await propose(
          "Создай связанное предложение мира. Верни те же 13 строковых полей, что у образца. Не изменяй механику.",
          fallback,
        ),
      )
    : null;
  return v?.success
    ? { plan: v.data, provider: "LLM" }
    : { plan: fallback, provider: "Сценарный мастер" };
}
const replies: Record<string, string> = {
  interface:
    "Откройте комнату и сфокусируйте карту. W/A/S/D — шаг, Shift — бег, пробел — прыжок. I открывает снаряжение.",
  rules:
    "В журнале раскройте событие. Для d100 показаны способность, сложность, модификатор и целевой порог.",
  character:
    "В библиотеке можно настроить внешность и выбрать свободного героя. Уровень повышается при расходовании накопленного опыта.",
  npc: "Проводник у переправы знает дорогу к башне. Для беседы встаньте рядом с ним.",
  quest:
    "Дозор ждёт сигнала с башни. Разведайте дорогу и проверьте, кому нужна помощь.",
  encounter:
    "Осмотрите окружение и оцените состояние группы. Решение о действии и его цели остаётся за игроком.",
  narrate:
    "Над трактом стихает ветер. Проводник всматривается в сторону башни.",
  continue:
    "Продолжите экспедицию с последнего события журнала. Ранее открытые области и предметы остаются в сохранении.",
};
export async function help(
  topic: string,
  question: string,
  context: unknown,
  ai: boolean,
) {
  const fallback = replies[topic] || replies.interface;
  const result = ai
    ? z
        .object({ text: z.string().min(1).max(2500) })
        .strict()
        .safeParse(
          await propose(
            "Ты помощник игрового мастера URE. Пиши только предложение или объяснение. Верни поле text.",
            { topic, question, context, reference: fallback },
          ),
        )
    : null;
  return result?.success
    ? { text: result.data.text, provider: "LLM" }
    : {
        text: fallback + (context ? " " + String(context) : ""),
        provider: "Сценарный мастер",
      };
}
