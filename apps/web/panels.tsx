import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { skills, gearDefs, type Skill } from "../../packages/shared/phase2.ts";
import { formData, type Api } from "./account.tsx";
export function Panel({
  close,
  children,
  title,
}: {
  close: () => void;
  children: ReactNode;
  title: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    const el = document.activeElement as HTMLElement;
    d.showModal();
    return () => {
      d.close();
      el?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modalhead">
        <small>Атлас / {title}</small>
        <button onClick={close} aria-label="Закрыть окно">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export const topics: Record<string, string> = {
  interface: "Управление",
  rules: "Расчёты",
  character: "Создание героя",
  quest: "Задание",
  npc: "Диалог NPC",
  encounter: "Встреча",
  narrate: "Описание сцены",
  continue: "Продолжение кампании",
};
export function Assistant({ api, id }: { api: Api; id: string }) {
  const [result, R] = useState<any>(),
    [busy, B] = useState(false);
  const submitting = useRef(false);
  return (
    <>
      <h2>Помощник мастера</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          const f = formData(e.currentTarget);
          B(true);
          R(undefined);
          try {
            R(await api("assistant", { ...f, ai: !!f.ai, world: id }));
          } catch (e) {
            R({ text: (e as Error).message, provider: "Соединение" });
          } finally {
            submitting.current = false;
            B(false);
          }
        }}
      >
        <label>
          Тема
          <select name="topic">
            {Object.entries(topics).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Вопрос
          <textarea name="question" maxLength={500} />
        </label>
        <label className="inline">
          <input type="checkbox" name="ai" defaultChecked />
          Использовать подключённый ИИ
        </label>
        <button disabled={busy}>
          {busy ? "Готовим ответ…" : "Обратиться к мастеру"}
        </button>
      </form>
      {result && (
        <section className="answer">
          <small>{result.provider}</small>
          <p>{result.text}</p>
        </section>
      )}
    </>
  );
}
export const planLabels: Record<string, string> = {
  name: "Название",
  theme: "Тема",
  history: "История",
  geography: "География",
  regions: "Регионы",
  cultures: "Культуры",
  factions: "Фракции",
  settlements: "Поселения",
  npcs: "Персонажи мира",
  start: "Точка старта",
  quests: "Задания",
  threats: "Опасности",
  laws: "Законы мира",
};
export function Inventory({ s, act }: { s: any; act: (a: any) => void }) {
  const c = s.character,
    e = c.extra,
    [recipient, R] = useState("");
  return (
    <>
      <h2>Снаряжение</h2>
      <p>
        Походные пайки × {c.inventory} · Силы {c.energy}/{c.maxEnergy}
      </p>
      <button
        disabled={!s.room || !c.inventory || c.energy >= c.maxEnergy}
        onClick={() => act({ type: "use" })}
      >
        Съесть паёк
      </button>
      <label>
        Передать участнику
        <select value={recipient} onChange={(ev) => R(ev.target.value)}>
          <option value="">Выбрать…</option>
          {s.party
            .filter((p: any) => p.userId !== c.userId)
            .map((p: any) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      {e.gear.length === 0 && (
        <p>Снаряжение можно найти в тайнике у стоянки.</p>
      )}
      {e.gear.map((g: any) => {
        const def = gearDefs[g.kind as keyof typeof gearDefs];
        return (
          <article className="gear" key={g.id}>
            <h3>{def.name}</h3>
            <p>
              {def.mass} кг · Защита {def.armor} · Сила удара +{def.power} ·{" "}
              {g.equipped ? "Надето" : "В рюкзаке"}
            </p>
            <div className="toolbar">
              {[
                [
                  g.equipped ? "unequip" : "equip",
                  g.equipped ? "Снять" : "Надеть",
                ],
                ["drop", "Оставить"],
                ...(recipient ? [["give", "Передать"]] : []),
              ].map(([op, n]) => (
                <button
                  key={op}
                  onClick={() =>
                    act({
                      type: "gear",
                      op,
                      item: g.id,
                      ...(op === "give" ? { recipient } : {}),
                    })
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </article>
        );
      })}
      {s.objects
        .filter((p: any) => p.kind === "loot")
        .map((p: any) => (
          <button
            key={p.id}
            onClick={() => act({ type: "gear", op: "take", item: p.id })}
          >
            Подобрать: {p.name}
          </button>
        ))}
    </>
  );
}
export function SkillBook({ c, cast }: { c: any; cast: (k: Skill) => void }) {
  return (
    <>
      <h2>Способности</h2>
      <p>
        Здоровье {c.extra.hp}/18 · Выносливость {c.extra.stamina}/12
      </p>
      {Object.entries(skills).map(([k, [name, cost, ms, l]]) => (
        <article key={k} className="gear">
          <div className="row">
            <h3>{name}</h3>
            <button disabled={l > c.level} onClick={() => cast(k as Skill)}>
              {l > c.level ? "С уровня " + l : "Применить"}
            </button>
          </div>
          <p>
            Расход {cost} · Восстановление {ms / 1000} с · Применений{" "}
            {c.extra.uses[k] || 0}
          </p>
        </article>
      ))}
    </>
  );
}
