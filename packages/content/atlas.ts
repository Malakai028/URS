import { readFileSync } from "node:fs";
import { catalog } from "./index.ts";
import { gearDefs, skills } from "../shared/phase2.ts";
function book(name: string) {
  return readFileSync(
    new URL("../../docs/reference/extracted/" + name + ".txt", import.meta.url),
    "utf8",
  ).split(/\r?\n/);
}
const characters = book("03_Character_Races_Classes"),
  creatures = book("04_Bestiary");
function cards(
  rows: Record<string, string>[],
  lines: string[],
  width: number,
  source: string,
): Record<string, string>[] {
  return rows.map((r) => {
    const at = lines.indexOf(r.id);
    return {
      ...r,
      source,
      description:
        at < 0
          ? "Подробная карточка ожидает редакции."
          : lines.slice(at + 2, at + width).join(" · "),
      edition: "0.6",
      stage: ["R-001", "R-009", "C-001", "C-022"].includes(r.id)
        ? "Игровой прототип"
        : "Проектная запись",
    };
  });
}
export const atlas = {
  ...catalog,
  spells: [
    {
      id: "thermal",
      name: "Реактивная гиперемия",
      description:
        "Фантастический термомагический эффект. Известное авторское название отражает возможность сочетания противоположных свойств. Конкретные численные правила открыты.",
      source: "Книга V · температурные сочетания",
      stage: "Справочная запись",
    },
  ],
  materials: [
    {
      id: "wood",
      name: "Древесина",
      description:
        "Материал отделён от ранга и редкости предмета. Древний деревянный посох может превосходить металлический клинок по магическим свойствам.",
      source: "Книга V · типы предметов",
    },
  ],
  statuses: [
    {
      id: "down",
      name: "Обессилен",
      description:
        "При нулевом здоровье действия встречи блокируются. Передышка восстанавливает до пяти единиц здоровья.",
      source: "Прототип фазы 02",
    },
  ],
  npcs: [
    {
      id: "guide",
      name: "Проводник переправы",
      description:
        "Хранит сведения о сигнальном посте. Поговорите с ним из соседней клетки. Первая беседа приносит 40 опыта в текущем мире.",
      source: "Экспедиция фазы 02",
    },
  ],
  races: cards(catalog.races, characters, 4, "Книга III"),
  classes: cards(catalog.classes, characters, 4, "Книга III"),
  bestiary: cards(catalog.bestiary, creatures, 5, "Книга IV"),
  items: Object.entries(gearDefs).map(([id, g]) => ({
    id,
    ...g,
    description: "Масса " + g.mass + " кг. Слот " + g.slot + ".",
    source: "Прототип фазы 02",
  })),
  skills: Object.entries(skills).map(([id, [name, cost, ms, level]]) => ({
    id,
    name,
    description:
      "Выносливость " +
      cost +
      " · восстановление " +
      ms +
      " мс · уровень " +
      level,
    source: "Прототип фазы 02",
  })),
  threats: [
    "Бедствие",
    "Катастрофа",
    "Катаклизм",
    "Апокалипсис",
    "Созвездие",
  ].map((name, i) => ({
    id: "T" + i,
    name,
    source: "Книга VII",
    description:
      "Три звена по три степени. Добровольная администрация в своей юрисдикции. Уровень, тир, ранг, Q, характеристики и испытания проверяются совместно. Численные пороги открыты.",
    stage: i === 4 ? "Особая система" : "Категория угрозы",
  })),
  concepts: [
    {
      id: "synergy",
      name: "Синергии",
      source: "Книга V",
      description:
        "Сочетание нескольких компонентов зависит от условий мира, затрат и порядка применения. Рецепты открываются в игре.",
    },
    {
      id: "authority",
      name: "Полномочия администрации",
      source: "Книга VII",
      description:
        "Иерархия в мире отделена от боевой силы и прав доступа к платформе.",
    },
    {
      id: "sentinel",
      name: "Осколочный страж",
      source: "Прототип фазы 02",
      description:
        "Охраняет сигнальный маяк в башне. Здоровье 16, сопротивление 1. При близком столкновении отвечает на атаку. После победы общий маяк можно зажечь.",
    },
  ],
};
