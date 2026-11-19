import React, { useLayoutEffect, useRef, useState } from "react";
import {
  calculateQ,
  getLevelUpCost,
  indexToTier,
  indexToRank,
  rankToIndex,
  tierToIndex,
  convertCurrency,
  rules,
} from "../../packages/engine/index.ts";
import { skills, gearDefs } from "../../packages/shared/phase2.ts";
const titles: Record<string, string> = {
  spells: "Заклинания",
  materials: "Материалы",
  statuses: "Состояния",
  npcs: "Архетипы NPC",
  races: "Расы",
  classes: "Пути",
  bestiary: "Бестиарий",
  tiers: "Тиры",
  ranks: "Ранги",
  currencies: "Валюты",
  skills: "Способности",
  items: "Предметы",
  concepts: "Законы мира",
  threats: "Угрозы",
};
const title = (r: any) => r.name || r.designation || r.currency;
export function Encyclopedia({
  catalog,
  user,
  initialBestiary,
}: {
  catalog: any;
  user: string;
  initialBestiary?: string;
}) {
  const [cat, C] = useState(initialBestiary ? "bestiary" : "races"),
    [q, Q] = useState(""),
    [idx, P] = useState(0),
    [detail, D] = useState<any>(() =>
      initialBestiary
        ? catalog?.bestiary.find(
            (row: { id: string }) => row.id === initialBestiary,
          )
        : undefined,
    ),
    [sort, S] = useState(false),
    [only, O] = useState(false);
  const entry = useRef<{ index: number; scroll: number } | null>(null),
    results = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (detail) heading.current?.focus();
    else if (entry.current !== null) {
      const container =
        results.current?.closest("dialog") || document.scrollingElement;
      const record =
        results.current?.querySelectorAll("button")[entry.current.index];
      (record || results.current?.parentElement?.querySelector("input"))?.focus(
        { preventScroll: true },
      );
      if (container) container.scrollTop = entry.current.scroll;
      entry.current = null;
    }
  }, [detail]);
  const key = "ure:favorites:" + user;
  const [favorites, F] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(saved)
        ? saved.filter((v) => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  });
  if (!catalog) return <p>Загружаем каталоги…</p>;
  const rows = (catalog[cat] || []).filter(
    (r: any) =>
      Object.values(r)
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(q.toLowerCase()) &&
      (!only || favorites.includes(cat + title(r))),
  );
  if (sort)
    rows.sort((a: any, b: any) => title(a).localeCompare(title(b), "ru"));
  const favorite = () => {
    const k = cat + title(detail),
      f = favorites.includes(k)
        ? favorites.filter((x) => x !== k)
        : [...favorites, k];
    F(f);
    localStorage.setItem(key, JSON.stringify(f));
  };
  if (detail)
    return (
      <article>
        <button className="link" onClick={() => D(null)}>
          ← К результатам
        </button>
        <small>
          {titles[cat]} / {detail.stage || "Справочник"}
        </small>
        <h2 tabIndex={-1} ref={heading}>
          {title(detail)}
        </h2>
        <p>
          {detail.description ||
            (cat === "tiers"
              ? "Строгая классификация тира по букве, повторениям и модификатору."
              : cat === "ranks"
                ? "Порядок V → I внутри семейства рангов."
                : cat !== "currencies"
                  ? "Описание пока отсутствует в каталоге."
                  : detail.wooden_units
                    ? "Предложенный курс в деревянных монетах: " +
                      detail.wooden_units
                    : "Курс для этой валюты открыт.")}
        </p>
        <dl>
          {Object.entries(detail)
            .filter(
              ([k]) => !["description", "name", "designation"].includes(k),
            )
            .map(([k, v]) => (
              <div key={k}>
                <dt>
                  {(
                    {
                      family: "Семейство",
                      category: "Категория",
                      status: "Статус источника",
                      index: "Индекс",
                      source: "Источник",
                      edition: "Редакция",
                      stage: "Полнота",
                    } as Record<string, string>
                  )[k] || k}
                </dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
        <p>Источник: {detail.source || titles[cat] + ", каталог v0.6"}.</p>
        <button onClick={favorite}>
          {favorites.includes(cat + title(detail))
            ? "Убрать из избранного"
            : "В избранное"}
        </button>
        <h3>Связанные записи</h3>
        {(catalog[cat] || [])
          .filter(
            (r: any) =>
              r !== detail &&
              ((detail.family && r.family === detail.family) ||
                (detail.category && r.category === detail.category) ||
                Math.abs(Number(detail.index) - Number(r.index)) === 1),
          )
          .slice(0, 3)
          .map((r: any) => (
            <button key={title(r)} onClick={() => D(r)}>
              {title(r)}
            </button>
          ))}
      </article>
    );
  return (
    <section>
      <small>Библиотека URE · 0.6</small>
      <h2>Энциклопедия</h2>
      <div className="filters">
        <select
          aria-label="Каталог"
          value={cat}
          onChange={(e) => {
            C(e.target.value);
            P(0);
          }}
        >
          {Object.entries(titles).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          aria-label="Поиск"
          placeholder="Поиск в записях…"
          value={q}
          onChange={(e) => {
            Q(e.target.value);
            P(0);
          }}
        />
      </div>
      <div className="toolbar">
        <button aria-pressed={sort} onClick={() => S(!sort)}>
          По алфавиту
        </button>
        <button
          aria-pressed={only}
          onClick={() => {
            O(!only);
            P(0);
          }}
        >
          Избранное
        </button>
        <span>{rows.length} записей</span>
      </div>
      <div ref={results}>
        {!rows.length && <p role="status">Записи не найдены</p>}
        {rows.slice(idx * 20, idx * 20 + 20).map((r: any, index: number) => (
          <button
            className="record"
            key={title(r)}
            onClick={() => {
              entry.current = {
                index,
                scroll:
                  (
                    results.current?.closest("dialog") ||
                    document.scrollingElement
                  )?.scrollTop ?? 0,
              };
              D(r);
            }}
          >
            <span>{title(r)}</span>
            <small>{r.stage || r.id || r.index || "Курс"} ›</small>
          </button>
        ))}
      </div>
      <div className="row">
        <button disabled={!idx} onClick={() => P(idx - 1)}>
          Назад
        </button>
        <button
          disabled={(idx + 1) * 20 >= rows.length}
          onClick={() => P(idx + 1)}
        >
          Далее
        </button>
      </div>
    </section>
  );
}
const formulas: Record<
  string,
  [string, string, string, (a: number, b: number) => number]
> = {
  distance: [
    "Смещение X, клеток",
    "Смещение Y, клеток",
    "|x| + |y|",
    (a, b) => Math.abs(a) + Math.abs(b),
  ],
  travel: ["Расстояние, м", "Скорость, м/с", "t = s / v, с", (a, b) => a / b],
  load: [
    "Сила, усл. ед.",
    "Коэффициент, кг/ед.",
    "Масса = сила × коэффициент",
    (a, b) => a * b,
  ],
  damage: [
    "Сила атаки",
    "Сопротивление",
    "max(1, атака − сопротивление) при попадании",
    (a, b) => Math.max(1, a - b),
  ],
  energy: [
    "Число применений",
    "Стоимость",
    "Расход = число × стоимость",
    (a, b) => a * b,
  ],
  prob: [
    "Способность",
    "Сложность",
    "clamp(floor(50 + 25 log₂(C/D)), 0, 100), %",
    (a, b) =>
      Math.min(100, Math.max(0, Math.floor(50 + 25 * Math.log2(a / b)))),
  ],
  price: [
    "Количество",
    "Цена единицы",
    "Стоимость = количество × цена",
    (a, b) => a * b,
  ],
  craft: [
    "Цена материалов",
    "Стоимость труда",
    "Себестоимость = материалы + труд",
    (a, b) => a + b,
  ],
};
const names: Record<string, string> = {
  q: "Сравнение Q",
  currency: "Обмен валют",
  xp: "Опыт и уровни",
  tier: "Индекс тира",
  rank: "Индекс ранга",
  distance: "Дистанция",
  travel: "Время в пути",
  load: "Грузоподъёмность",
  damage: "Урон",
  energy: "Расход энергии",
  prob: "Вероятность d100",
  price: "Цена предметов",
  craft: "Ремесло",
  skill: "Требования навыка",
};
export function Tools({
  catalog,
  heroes = [],
}: {
  catalog: any;
  heroes?: any[];
}) {
  const [subjects, choose] = useState<Record<string, any>>({});
  const [mode, M] = useState("q"),
    [a, A] = useState("0"),
    [b, B] = useState("0"),
    [c, C] = useState("0"),
    [d, D] = useState("0"),
    [left, L] = useState(0),
    [right, R] = useState(1),
    [skill, K] = useState<keyof typeof skills>("run");
  const number = (label: string, v: string, set: (s: string) => void) => (
    <label>
      {label}
      <input value={v} onChange={(e) => set(e.target.value)} />
    </label>
  );
  let fields,
    formula = "",
    result = "";
  try {
    const n = Number(a),
      m = Number(b);
    if (mode === "currency") {
      const currencies = catalog?.currencies || [];
      const select = (
        v: number,
        change: (n: number) => void,
        label: string,
      ) => (
        <label>
          {label}
          <select value={v} onChange={(e) => change(+e.target.value)}>
            {currencies.map((r: any, i: number) => (
              <option value={i} key={i}>
                {r.currency}
              </option>
            ))}
          </select>
        </label>
      );
      fields = (
        <>
          {number("Количество", a, A)}
          {select(left, L, "Из валюты")}
          {select(right, R, "В валюту")}
        </>
      );
      formula = "Сумма × исходный курс / целевой курс";
      const from = currencies[left]?.wooden_units,
        to = currencies[right]?.wooden_units;
      if (!from || !to) result = "Курс не установлен";
      else {
        const x = convertCurrency(BigInt(a), BigInt(from), BigInt(to));
        result = x.units + " · остаток " + x.remainderWood + " деревянных";
      }
    } else if (mode === "q") {
      const pick = (
        side: string,
        x: (s: string) => void,
        y: (s: string) => void,
      ) => (
        <select
          aria-label="Подставить героя"
          defaultValue=""
          onChange={(e) => {
            const h = heroes.find((v) => v.id === e.target.value);
            choose((old) => ({ ...old, [side]: h }));
            if (h) {
              x(String(h.tier));
              y(String(h.rank));
            }
          }}
        >
          <option value="">Свой пример</option>
          {heroes.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} · способность {h.capacity}
            </option>
          ))}
        </select>
      );
      fields = (
        <div className="choices">
          {[
            [a, A, b, B, "A"],
            [c, C, d, D, "B"],
          ].map((row) => {
            const [t, setT, r, setR, label] = row as [
              string,
              (v: string) => void,
              string,
              (v: string) => void,
              string,
            ];
            return (
              <section key={label}>
                <h3>Персонаж {label}</h3>
                {pick(label, setT, setR)}
                {number("Индекс тира", t, setT)}
                {number("Индекс ранга", r, setR)}
              </section>
            );
          })}
        </div>
      );
      formula =
        "T = 100 × 1.012ⁱ, R = 100 × 1.18ʲ, Q = T + R. Способности проверяются отдельно.";
      const q1 = calculateQ(n, m),
        q2 = calculateQ(+c, +d);
      result =
        [
          ["A", n, m, q1],
          ["B", +c, +d, q2],
        ]
          .map(
            ([l, t, r, q]) =>
              l +
              " · " +
              indexToTier(+t) +
              " / " +
              indexToRank(+r) +
              " · " +
              (100 * rules.tierGrowth ** +t).toPrecision(5) +
              " + " +
              (100 * rules.rankGrowth ** +r).toPrecision(5) +
              " = " +
              (+q).toPrecision(6),
          )
          .join("\n") +
        "\nΔQ = " +
        (q1 - q2).toPrecision(6);
    } else if (mode === "xp") {
      fields = number("Текущий уровень", a, A);
      formula = "ceil(100 × (L+1)² × (11/5)ᴸ)";
      if (n > 5000) throw Error("Предел интерактивного расчёта — 5000");
      result = getLevelUpCost(n).toLocaleString("ru") + " XP";
    } else if (mode === "tier" || mode === "rank") {
      fields = number("Обозначение или индекс", a, A);
      formula =
        mode === "tier" ? "i = 210b + 21(n−1) + m + 10" : "j = 5r + (5−v)";
      result = String(
        /^\d+$/.test(a)
          ? mode === "tier"
            ? indexToTier(n)
            : indexToRank(n)
          : mode === "tier"
            ? tierToIndex(a)
            : rankToIndex(a),
      );
    } else if (mode === "skill") {
      fields = (
        <>
          {number("Уровень", a, A)}
          <select
            value={skill}
            onChange={(e) => K(e.target.value as keyof typeof skills)}
          >
            {Object.entries(skills).map(([k, v]) => (
              <option key={k} value={k}>
                {v[0]}
              </option>
            ))}
          </select>
        </>
      );
      formula = "Уровень ≥ порога способности";
      result =
        (n >= skills[skill][3] ? "Доступна" : "Закрыта") +
        " · " +
        skills[skill][1] +
        " выносливости";
    } else {
      const [la, lb, f, fn] = formulas[mode];
      fields = (
        <>
          {number(la, a, A)}
          {number(lb, b, B)}
        </>
      );
      formula = f;
      const val = fn(n, m);
      if (!Number.isFinite(val) || n < 0 || m < 0)
        throw Error("Проверьте значения");
      result = String(val);
    }
  } catch {
    result = "Проверьте диапазон и формат значений";
  }
  return (
    <section>
      <h2>Игровые инструменты</h2>
      <label>
        Инструмент
        <select
          aria-label="Инструмент"
          value={mode}
          onChange={(e) => {
            M(e.target.value);
            A("0");
            B("1");
          }}
        >
          {Object.entries(names).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {fields}
      {mode === "q" && (subjects.A || subjects.B) && (
        <table>
          <caption>Характеристики выбранных героев</caption>
          <thead>
            <tr>
              <th>Характеристика</th>
              <th>{subjects.A?.name || "A"}</th>
              <th>{subjects.B?.name || "B"}</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys((subjects.A || subjects.B)?.attributes || {}).map(
              (k) => (
                <tr key={k}>
                  <td>{(subjects.A || subjects.B).attributes[k].label}</td>
                  <td>{subjects.A?.attributes[k]?.current ?? "—"}</td>
                  <td>{subjects.B?.attributes[k]?.current ?? "—"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      <p>{formula}</p>
      <output>{result}</output>
      <small>URE 0.6 · проектные параметры фазы 02</small>
      {mode === "price" && (
        <p>
          {Object.values(gearDefs)
            .map((g) => g.name + " — " + g.price)
            .join(" · ")}{" "}
          деревянных (прототип).
        </p>
      )}
    </section>
  );
}
