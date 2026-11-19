import React, { useState, useEffect, useRef } from "react";
import {
  appearance,
  standardLook,
  type Look,
} from "../../packages/shared/phase2.ts";
import { sprite } from "./sprite.ts";
import { formData, type Api } from "./account.tsx";
export function Portrait({
  look,
  race,
  armed = false,
  armored = false,
}: {
  look?: Look;
  race?: string;
  armed?: boolean;
  armored?: boolean;
}) {
  const r = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = r.current?.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, 80, 92);
      sprite(ctx, 39, 55, look, race, armored, armed, 3);
    }
  }, [look, race, armed, armored]);
  return (
    <canvas
      className="portrait"
      ref={r}
      width={80}
      height={92}
      aria-label="Портрет персонажа"
    />
  );
}
const labels = {
  skin: "Кожа",
  hair: "Волосы",
  cloak: "Плащ",
  shape: "Силуэт",
  eyes: "Глаза",
  face: "Лицо",
  accessory: "Аксессуар",
};
const words: Record<string, string> = {
  ochre: "Охра",
  umber: "Умбра",
  ivory: "Светлый",
  coal: "Уголь",
  silver: "Серебро",
  copper: "Медь",
  jade: "Нефрит",
  plum: "Слива",
  amber: "Янтарь",
  scout: "Следопыт",
  warden: "Дозорный",
  brown: "Карие",
  blue: "Синие",
  green: "Зелёные",
  oval: "Овал",
  square: "Угловатое",
  none: "Без украшения",
  brooch: "Брошь",
  hood: "Капюшон",
};
export function Heroes({
  api,
  id,
  canSelect,
  changed,
}: {
  api: Api;
  id: string;
  canSelect: boolean;
  changed: () => Promise<void>;
}) {
  const [list, L] = useState<any[]>([]),
    [edit, E] = useState<any>(null),
    [look, K] = useState<Look>(standardLook),
    [msg, M] = useState(""),
    [del, D] = useState(""),
    [busy, B] = useState(false);
  const submitting = useRef(false);
  const load = () => api("heroes").then(L);
  useEffect(() => {
    api("heroes")
      .then(L)
      .catch((e) => M(e.message));
  }, [api]);
  const perform = async (path: string, body: any) => {
    if (submitting.current) return;
    submitting.current = true;
    B(true);
    M("");
    try {
      await api(path, body);
      await load();
      await changed();
      E(null);
      D("");
      M("Сохранено");
    } catch (e) {
      M((e as Error).message);
    } finally {
      submitting.current = false;
      B(false);
    }
  };
  return (
    <fieldset className="interaction" disabled={busy}>
      <h2>Мои персонажи</h2>
      <button
        onClick={() => {
          E({});
          K(standardLook);
        }}
      >
        Новый герой
      </button>
      <p role="status">{busy ? "Сохранение…" : msg}</p>
      {edit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = formData(e.currentTarget);
            void perform(
              edit.id ? "heroes/" + edit.id : "heroes",
              edit.id
                ? { op: "edit", ...f, look }
                : { ...f, look, mode: "manual" },
            );
          }}
        >
          <Portrait look={look} race={edit.race} />
          <label>
            Имя героя
            <input
              name="name"
              required
              minLength={2}
              maxLength={40}
              defaultValue={edit.name}
            />
          </label>
          {!edit.id && (
            <>
              <label>
                Раса
                <select name="race">
                  <option value="R-001">Человек</option>
                  <option value="R-009">Эльф</option>
                </select>
              </label>
              <label>
                Путь
                <select name="profession">
                  <option value="C-001">Воин</option>
                  <option value="C-022">Маг</option>
                </select>
              </label>
              <label>
                Недостаток
                <select name="flaw">
                  <option>Утомляемость</option>
                  <option>Рассеянность</option>
                </select>
              </label>
            </>
          )}
          <div className="choices">
            {(Object.keys(labels) as (keyof Look)[]).map((k) => (
              <label key={k}>
                {labels[k]}
                <select
                  value={look[k]}
                  onChange={(e) => K({ ...look, [k]: e.target.value })}
                >
                  {appearance.shape[k].options.map((v) => (
                    <option key={v} value={v}>
                      {words[v]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button>Сохранить героя</button>
          <button
            type="button"
            onClick={() => {
              E(null);
              M("");
            }}
          >
            Отмена
          </button>
        </form>
      )}
      {list.map((h) => (
        <article className="heroentry" key={h.id}>
          <Portrait look={h.extra?.look} race={h.race} />
          <section>
            <h3>{h.name}</h3>
            <p>
              {h.archived ? "Архив" : h.world || "Свободен"} · Уровень {h.level}{" "}
              · {h.xp} XP · {h.rankName}
            </p>
            <details>
              <summary>История героя</summary>
              {h.history?.length ? (
                h.history.map((e: any, i: number) => (
                  <p key={i}>
                    {new Date(e.at).toLocaleString("ru")} · {e.text}
                  </p>
                ))
              ) : (
                <p>Для этого героя пока нет записей новой редакции.</p>
              )}
            </details>
            <details>
              <summary>Характеристики и состояние</summary>
              <table>
                <thead>
                  <tr>
                    <th>Характеристика</th>
                    <th>Сейчас</th>
                    <th>Норма</th>
                    <th>Макс.</th>
                    <th>Потенциал</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(h.attributes || {}).map((v: any) => (
                    <tr key={v.label}>
                      <td>
                        {v.label} ({v.unit})
                      </td>
                      <td>{v.current}</td>
                      <td>{v.normal}</td>
                      <td>{v.maximum}</td>
                      <td>{v.potential}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <div className="toolbar">
              <button
                onClick={() => {
                  E(h);
                  K(h.extra?.look || standardLook);
                }}
              >
                Изменить
              </button>
              <button
                onClick={() => perform("heroes/" + h.id, { op: "duplicate" })}
              >
                Копия шаблона
              </button>
              {canSelect && id && !h.worldId && !h.archived && (
                <button
                  onClick={() =>
                    perform("worlds/" + id + "/select", { hero: h.id })
                  }
                >
                  Выбрать для мира
                </button>
              )}
              {id && h.worldId === id && (
                <button
                  onClick={() =>
                    perform("worlds/" + id + "/select", { hero: null })
                  }
                >
                  Отправить на отдых
                </button>
              )}
              {!h.worldId && (
                <button
                  onClick={() =>
                    perform("heroes/" + h.id, {
                      op: h.archived ? "restore" : "archive",
                    })
                  }
                >
                  {h.archived ? "Восстановить" : "В архив"}
                </button>
              )}
              {h.archived && <button onClick={() => D(h.id)}>Удалить…</button>}
            </div>
            {del === h.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform("heroes/" + h.id, {
                    op: "delete",
                    ...formData(e.currentTarget),
                  });
                }}
              >
                <label>
                  Введите имя героя
                  <input name="confirmation" required />
                </label>
                <button>Удалить навсегда</button>
              </form>
            )}
          </section>
        </article>
      ))}
    </fieldset>
  );
}
