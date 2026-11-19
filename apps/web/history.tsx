import React, { useEffect, useRef, useState } from "react";

import type { Api } from "./account.tsx";
export function recentEvents(events: any[]) {
  const rows: any[] = [];
  for (const event of events) {
    const prev = rows.at(-1),
      moving = (e: any) =>
        e?.action === "move" ||
        ["walk", "run", "jump", "sprint"].includes(e?.audit.skill);
    if (prev && moving(event) && moving(prev) && event.actor === prev.actor) {
      prev.steps += 1;
      prev.movement.push(event);
      continue;
    }
    rows.push({ ...event, steps: 1, movement: [] });
  }
  return rows;
}
export function History({ api, id }: { api: Api; id: string }) {
  const [q, Q] = useState(""),
    [channel, C] = useState("all");
  const url =
    "worlds/" +
    id +
    "/history?q=" +
    encodeURIComponent(q) +
    "&channel=" +
    channel;
  return (
    <>
      <h2>История мира</h2>
      <input
        aria-label="Поиск по всей истории"
        maxLength={100}
        placeholder="Поиск по всей истории…"
        value={q}
        onChange={(e) => Q(e.target.value)}
      />
      <select
        aria-label="Фильтр истории"
        value={channel}
        onChange={(e) => C(e.target.value)}
      >
        {Object.entries({
          all: "Все доступные события",
          ooc: "Чат игроков",
          ic: "Речь персонажей",
          private: "Личные и группы",
          system: "Система",
          narrative: "Повествование",
          actions: "Действия",
        }).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <HistoryResults key={url} api={api} url={url} />
    </>
  );
}

function HistoryResults({ api, url }: { api: Api; url: string }) {
  const [rows, R] = useState<any[]>([]),
    [error, E] = useState(""),
    [busy, B] = useState(true),
    [more, setMore] = useState(false);
  const pending = useRef(false);
  const load = async (before?: number) => {
    if (pending.current) return;
    pending.current = true;
    B(true);
    E("");
    try {
      const next = await api(before ? url + "&before=" + before : url);
      R((previous) => (before ? [...previous, ...next] : next));
      setMore(next.length === 50);
    } catch (e) {
      E((e as Error).message);
    } finally {
      pending.current = false;
      B(false);
    }
  };
  useEffect(() => {
    void load();
  }, [api, url]);
  return (
    <>
      <p role="status">
        {busy ? "Загрузка…" : error || rows.length + " событий"}
      </p>
      {rows.map((e) => (
        <details key={e.id}>
          <summary>
            {new Date(e.timestamp).toLocaleString("ru")} · {e.audit.actor} ·{" "}
            {e.text}
          </summary>
          <pre>{JSON.stringify(e.audit, null, 2)}</pre>
        </details>
      ))}
      {more && (
        <button disabled={busy} onClick={() => void load(rows.at(-1)?.cursor)}>
          Предыдущие события
        </button>
      )}
    </>
  );
}
