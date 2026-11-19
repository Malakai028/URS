import React, { useEffect, useRef } from "react";
import {
  behaviorLabels,
  type CreatureInspection,
  type CreatureJournalEntry,
  type CreatureView,
  type Point,
} from "../../packages/shared/creatures.ts";
import { creatureSprite } from "./creature-sprite.ts";

function Health({ creature }: { creature: CreatureView }) {
  if (creature.hp === null || creature.maxHp === null)
    return <small>{condition(creature)}</small>;
  return (
    <div className="creature-health">
      <span>
        Здоровье {creature.hp}/{creature.maxHp}
      </span>
      <progress
        aria-label="Здоровье существа"
        value={creature.hp}
        max={creature.maxHp}
      />
    </div>
  );
}
const stages = ["Неизвестно", "Встречено", "Опознано", "Изучено", "Эксперт"];
function condition(creature: CreatureView) {
  if (!creature.alive) return "Мертво";
  if (creature.condition === "critical") return "Тяжело ранено";
  if (creature.condition === "wounded") return "Ранено";
  if (creature.condition === "healthy") return "Без видимых ран";
  return "Нет данных о ранах";
}

export function CreatureQuick({
  creature,
  actor,
  inspect,
}: {
  creature: CreatureView;
  actor?: Point;
  inspect: () => void;
}) {
  const distance = actor
    ? Math.abs(actor.x - creature.position.x) +
      Math.abs(actor.y - creature.position.y)
    : null;
  return (
    <section className="creature-quick" aria-label="Сведения о существе">
      <div className="row">
        <strong>{creature.name}</strong>
        <button onClick={inspect}>Подробный осмотр</button>
      </div>
      <small>
        {creature.species !== creature.name && creature.species + " · "}
        Уровень {creature.level ?? "не установлен"} ·{" "}
        {creature.relationship === "hostile" ? "Враждебное" : "Нейтральное"}
      </small>
      <Health creature={creature} />
      <small>
        {behaviorLabels[creature.behavior]}
        {creature.cue && " · " + creature.cue}
        {distance === null ? "" : " · клеток до цели " + distance}
      </small>
    </section>
  );
}

const areas = {
  field: "Тракт",
  vault: "Башня",
  cave: "Пещера",
  lodge: "Посёлок",
};
export function CreatureCard({
  inspection,
  creature,
  openBestiary,
  identify,
  actor,
}: {
  inspection: CreatureInspection;
  creature: CreatureView;
  openBestiary: (id: string) => void;
  identify?: () => void;
  actor?: Point;
}) {
  const portrait = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = portrait.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    creatureSprite(ctx, creature, 61, 74, 3.3);
  }, [creature]);
  const admin = inspection.simulation;
  const classifications = [
    creature.tier,
    creature.rank,
    creature.q,
    creature.threat,
    creature.rarity,
  ];
  return (
    <article className="creature-file">
      <header>
        <canvas aria-hidden="true" ref={portrait} width="122" height="112" />
        <div>
          <small>{creature.category}</small>
          <h3>{creature.name}</h3>
          {creature.species !== creature.name && <p>{creature.species}</p>}
          <Health creature={creature} />
        </div>
      </header>
      {creature.knowledgeStage !== undefined && (
        <p>Знание · {stages[creature.knowledgeStage]}</p>
      )}
      <p>{creature.description}</p>
      {identify && <button onClick={identify}>Определить вид</button>}
      {creature.speciesId && (
        <button onClick={() => openBestiary(creature.speciesId!)}>
          Открыть в бестиарии
        </button>
      )}
      <h4>Классификация</h4>
      <dl>
        <dt>Уровень</dt>
        <dd>{creature.level ?? "Не установлен"}</dd>
        <dt>Тир, ранг, Q, угроза и редкость</dt>
        <dd>
          {classifications.some((value) => value !== null)
            ? classifications.map((value) => value ?? "—").join(" / ")
            : "Не определены"}
        </dd>
      </dl>
      <h4>Наблюдение</h4>
      <dl>
        <dt>Состояние</dt>
        <dd>{condition(creature)}</dd>
        <dt>Поведение</dt>
        <dd>
          {behaviorLabels[creature.behavior]} {creature.cue}
        </dd>
        <dt>Движение</dt>
        <dd>{creature.moved ? "В движении" : "Стоит"}</dd>
        <dt>Темп шага</dt>
        <dd>
          {creature.stepMs
            ? "До 1 клетки за " + creature.stepMs / 1000 + " с"
            : "—"}
        </dd>
        <dt>Место наблюдения</dt>
        <dd>
          {areas[creature.area]} · {creature.position.x}, {creature.position.y}
        </dd>
        {actor && (
          <>
            <dt>Расстояние</dt>
            <dd>
              {Math.abs(actor.x - creature.position.x) +
                Math.abs(actor.y - creature.position.y)}{" "}
              кл.
            </dd>
          </>
        )}
        <dt>Габариты модели</dt>
        <dd>
          {creature.dimensions.width} × {creature.dimensions.height} клетки
        </dd>
        <dt>Отношение</dt>
        <dd>
          {creature.relationship === "hostile" ? "Враждебное" : "Нейтральное"}
        </dd>
      </dl>
      <h4>Изученные свойства</h4>
      <dl>
        <dt>Анатомия и способность</dt>
        <dd>
          {[inspection.learned?.anatomy, inspection.learned?.ability]
            .filter(Boolean)
            .join(" · ") || "Нет подтверждённых сведений"}
        </dd>
        <dt>Снижение урона и досягаемость</dt>
        <dd>
          {inspection.learned?.mitigation ?? "—"} /{" "}
          {inspection.learned?.reach ?? "—"}
        </dd>
        <dt>Уязвимости</dt>
        <dd>Нет подтверждённых сведений</dd>
      </dl>
      {admin && (
        <details>
          <summary>Данные мастера</summary>
          <dl>
            <dt>Встреча</dt>
            <dd>
              {creature.encounterId} / {creature.id}
            </dd>
            <dt>Место спавна и радиус территории</dt>
            <dd>
              {admin.home.x}, {admin.home.y} · {admin.radius}
            </dd>
            <dt>Профиль и маршрут</dt>
            <dd>
              {admin.profile} ·{" "}
              {admin.route.map((p) => `${p.x},${p.y}`).join(" → ") || "—"}
            </dd>
            <dt>Текущая цель</dt>
            <dd>{admin.target ?? "—"}</dd>
            <dt>Последнее действие</dt>
            <dd>{admin.lastAction}</dd>
            <dt>Последняя замеченная клетка</dt>
            <dd>
              {admin.lastSeen
                ? admin.lastSeen.x + ", " + admin.lastSeen.y
                : "—"}
            </dd>
            <dt>Сопротивление</dt>
            <dd>{admin.resistance ?? "Не определено"}</dd>
            {admin.combat && (
              <>
                <dt>Временный боевой профиль</dt>
                <dd>
                  Способность {admin.combat.aptitude} · обнаружение{" "}
                  {admin.combat.detection} кл. · урон {admin.combat.damage} ·
                  пауза {admin.combat.cooldownMs / 1000} с
                </dd>
              </>
            )}
          </dl>
        </details>
      )}
    </article>
  );
}

export function CreatureJournal({
  entries,
  open,
}: {
  entries: CreatureJournalEntry[];
  open: (id: string) => void;
}) {
  if (!entries.length)
    return <p>Здесь появятся сведения о встреченных существах.</p>;
  return (
    <ul className="creature-journal">
      {entries.map((entry, index) => (
        <li key={entry.speciesId ?? index}>
          <strong>{entry.name}</strong>
          <p>
            {stages[entry.stage]} · {areas[entry.area]} ·{" "}
            {behaviorLabels[entry.behavior]}
          </p>
          <small>
            Последняя запись {new Date(entry.lastAt).toLocaleString("ru")}
          </small>
          {entry.ability && <p>{entry.ability}</p>}
          {entry.speciesId && (
            <button onClick={() => open(entry.speciesId!)}>
              Открыть в бестиарии
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
