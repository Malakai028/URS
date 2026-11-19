import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { MapView } from "./map.tsx";
import { CreatureCard, CreatureJournal, CreatureQuick } from "./creatures.tsx";
import type {
  CreatureInspection,
  CreatureView,
} from "../../packages/shared/creatures.ts";
import { History, recentEvents } from "./history.tsx";
import { Access, Profile } from "./account.tsx";
import { Heroes, Portrait } from "./heroes.tsx";
import { Advancement } from "./advancement.tsx";
import type { Character } from "../../packages/shared/index.ts";
import { Encyclopedia, Tools } from "./reference.tsx";
import {
  Panel,
  Inventory,
  SkillBook,
  Assistant,
  planLabels,
} from "./panels.tsx";
import {
  channelOf,
  skills,
  marks,
  type Skill,
} from "../../packages/shared/phase2.ts";
import type { Command } from "./input.ts";
import { skillTarget } from "../../packages/shared/targeting.ts";
import {
  rejectionStatus,
  type ActionStatus,
} from "../../packages/shared/action-feedback.ts";
import "./style.css";
import "./phase2.css";
type Data = Record<string, any>;
async function api(path: string, body?: unknown) {
  const res = await fetch(
    "/api/" + path,
    body === undefined
      ? { signal: AbortSignal.timeout(25_000) }
      : {
          signal: AbortSignal.timeout(25_000),
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(Error(data.error), {
      status: res.status,
      retryAfter: Number(res.headers.get("Retry-After")),
    });
  return data;
}
const dataOf = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget)) as Record<
    string,
    string
  >;
};
const names: Record<string, string> = {
  "R-001": "Человек",
  "R-009": "Эльф",
  "C-001": "Воин",
  "C-022": "Маг",
};
const tabs: Record<string, string> = {
  game: "Экспедиция",
  lore: "Описание мира",
  lobby: "Комната",
  rules: "Справочник",
};
function Brand() {
  return (
    <div className="brand">
      <i>✧</i> URE <span>Атлас миров</span>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function App() {
  const [hoverCreature, setHoverCreature] = useState("");
  const [inspectId, setInspectId] = useState("");
  const [creatureInfo, setCreatureInfo] = useState<CreatureInspection | null>(
    null,
  );
  const [creatureError, setCreatureError] = useState("");
  const [bestiaryEntry, setBestiaryEntry] = useState("");
  const [gmCreature, setGmCreature] = useState(false);
  const [accessMessage, setAccessMessage] = useState("");
  const [accessLinkView, setAccessLinkView] = useState(0);
  const [me, setMe] = useState<Data | null>(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [id, setId] = useState(
      new URLSearchParams(location.search).get("world") || "",
    ),
    [tab, setTab] = useState("game"),
    [wizard, setWizard] = useState(false),
    [worlds, setWorlds] = useState<Data>({ mine: [], listed: [] }),
    [s, setS] = useState<Data | null>(null),
    [live, setLive] = useState("Подключение…"),
    [catalog, setCatalog] = useState<Data | null>(null);
  const [invite, setInvite] = useState(""),
    [join, setJoin] = useState(
      new URLSearchParams(location.search).get("invite") || "",
    ),
    [channel, setChannel] = useState("chat"),
    [message, setMessage] = useState(""),
    [chatOpen, setChatOpen] = useState(false),
    [delivery, setDelivery] = useState("");
  const chatInput = useRef<HTMLInputElement>(null);
  const mapCanvas = () =>
    document.querySelector<HTMLCanvasElement>(".mapcard canvas");
  const openChat = () => {
    setChatOpen(true);
  };
  const focusMap = () => {
    setChatOpen(false);
    mapCanvas()?.focus();
  };
  useEffect(() => {
    if (chatOpen) chatInput.current?.focus({ preventScroll: true });
  }, [chatOpen]);
  const [panel, show] = useState(""),
    [target, aim] = useState(""),
    [feedback, tell] = useState(""),
    [filter, filterBy] = useState("ooc"),
    [search, find] = useState(""),
    [direct, dm] = useState(""),
    [plan, planSet] = useState<any>(null),
    [heroes, hSet] = useState<any[]>([]);
  useEffect(() => {
    if (me && panel === "Инструменты")
      api("heroes")
        .then(hSet)
        .catch((e) => setError(e.message));
  }, [me, panel]);
  const [group, groupTo] = useState<string[]>([]),
    [read, markRead] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!s) return;
    const last = s.events
      .filter((e: Data) => (e.audit.channel || channelOf(e.action)) === filter)
      .at(-1)?.timestamp;
    if (last)
      markRead((old) =>
        old[id + filter] === last ? old : { ...old, [id + filter]: last },
      );
  }, [s, filter, id]);
  const channelName = (key: string, label: string) => {
    const n =
      key === filter
        ? 0
        : (s?.events || []).filter(
            (e: Data) =>
              (e.audit.channel || channelOf(e.action)) === key &&
              e.timestamp > (read[id + key] || ""),
          ).length;
    return label + (n ? " (" + n + ")" : "");
  };
  const gate = useRef(false);
  const [actionStatus, statusSet] = useState<ActionStatus>("success");
  const task = async (fn: () => Promise<ActionStatus | void>) => {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    statusSet("pending");
    setError("");
    tell("");
    try {
      const result = await fn();
      statusSet(result || "success");
    } catch (e) {
      tell("");
      const failure = e as Error & { status?: number };
      statusSet(rejectionStatus(failure.status || 0, failure.message));
      setError(
        failure.status
          ? failure.message
          : "Не удалось связаться с сервером. Проверьте соединение.",
      );
    } finally {
      setBusy(false);
      gate.current = false;
    }
  };
  useEffect(() => {
    if (/^#(reset|verify)=/.test(location.hash)) {
      setBoot(false);
      return;
    }
    api("me")
      .then(setMe)
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    const openAccountLink = () => {
      if (!/^#(reset|verify)=/.test(location.hash)) return;
      setAccessMessage("");
      setMe(null);
      setId("");
      setS(null);
      show("");
      setAccessLinkView((view) => view + 1);
    };
    window.addEventListener("hashchange", openAccountLink);
    return () => window.removeEventListener("hashchange", openAccountLink);
  }, []);
  const open = (next: string) => {
    setChatOpen(false);
    setDelivery("");
    setMessage("");
    setChannel("chat");
    dm("");
    groupTo([]);
    find("");
    filterBy("ooc");
    setId(next);
    show("");
    aim("");
    setHoverCreature("");
    setBestiaryEntry("");
    tell("");
    planSet(null);
    setS(null);
    setInvite("");
    setTab("game");
    setWizard(false);
    setError("");
    history.replaceState(null, "", next ? "?world=" + next : location.pathname);
  };
  const seq = useRef(0);
  const worldScope = useRef(id);
  worldScope.current = id;
  const refresh = useCallback(async () => {
    if (worldScope.current !== id) return;
    const n = ++seq.current;
    if (id) {
      const snap = await api("worlds/" + id);
      if (n === seq.current && worldScope.current === id) setS(snap);
    } else {
      const list = await api("worlds");
      if (n === seq.current && worldScope.current === id) setWorlds(list);
    }
  }, [id]);
  useEffect(() => {
    if (!me) return;
    let stopped = false;
    let ws: WebSocket | undefined, timer: ReturnType<typeof setTimeout>;
    const reload = () =>
      refresh().catch((e) => {
        if (!stopped) setError(e.message);
      });
    void reload();
    function connect() {
      if (stopped || !id) return;
      setLive("Подключение…");
      ws = new WebSocket(
        (location.protocol === "https:" ? "wss://" : "ws://") +
          location.host +
          "/live?world=" +
          id,
      );
      ws.onopen = () => {
        if (!stopped) setLive("В сети");
      };
      ws.onmessage = () => {
        if (!stopped) void reload();
      };
      ws.onclose = (event) => {
        if (stopped) return;
        tell("");
        setLive("Переподключение…");
        timer = setTimeout(async () => {
          if (event.code === 4001) {
            try {
              await api("me");
            } catch (error) {
              if (!stopped && (error as { status?: number }).status === 401) {
                setAccessMessage("Сеанс завершён. Войдите снова.");
                setId("");
                setS(null);
                show("");
                history.replaceState(null, "", location.pathname);
                setMe(null);
                return;
              }
            }
          }
          connect();
        }, 1600);
      };
    }
    connect();
    return () => {
      stopped = true;
      seq.current++;
      clearTimeout(timer);
      ws?.close();
    };
  }, [me, id, refresh]);
  const journalVersion = JSON.stringify(
    (s?.creatureJournal ?? []).map((entry: Data) => [
      entry.speciesId,
      entry.stage,
    ]),
  );
  useEffect(() => {
    let active = true;
    if (me)
      api("catalog" + (id ? "?world=" + encodeURIComponent(id) : ""))
        .then((data) => {
          if (active) setCatalog(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [me, id, journalVersion]);
  const local = (suffix: string, body?: unknown) =>
    api("worlds/" + id + "/" + suffix, body);
  const act = (action: Data) =>
    task(async () => {
      const event = await local("action", { key: crypto.randomUUID(), action });
      tell(
        event.text +
          (event.audit.attempts?.length
            ? " d100: " +
              event.audit.attempts.map((a: Data) => a.roll).join(", ")
            : ""),
      );
      filterBy(event.audit.channel || channelOf(action.type));
      await refresh();
      return event.audit.success === false ? "failed" : "success";
    });
  const manager = s && ["owner", "gm"].includes(s.role),
    c = s?.character;
  const creatureAt = (creatureId: string): CreatureView | undefined =>
    s?.objects.find((object: Data) => object.id === creatureId)?.creature;
  const selectedCreature = creatureAt(target);
  const quickCreature = creatureAt(hoverCreature) ?? selectedCreature;
  const inspectedCreature = creatureAt(inspectId);
  const inspectRevision = gmCreature
    ? s
    : `${inspectedCreature?.knowledgeStage}|${inspectedCreature?.cue}`;
  const inspect = (creatureId: string) => {
    aim(creatureId);
    setInspectId(creatureId);
    setCreatureInfo(null);
    setCreatureError("");
    setGmCreature(false);
    show("Осмотр существа");
  };
  useEffect(() => {
    if (panel !== "Осмотр существа" || !id || !inspectId) return;
    let active = true;
    api(
      "worlds/" +
        id +
        "/creatures/" +
        encodeURIComponent(inspectId) +
        (gmCreature ? "?mode=gm" : ""),
    )
      .then((data) => {
        if (active) {
          setCreatureInfo(data);
          setCreatureError("");
        }
      })
      .catch((error) => {
        if (active)
          setCreatureError(
            error.status === 404
              ? "Существо вне поля наблюдения"
              : "Осмотр временно недоступен",
          );
      });
    return () => {
      active = false;
    };
  }, [id, panel, inspectId, inspectRevision, gmCreature]);
  const openCreatureBestiary = (entry: string) =>
    task(async () => {
      setCatalog(await api("catalog?world=" + encodeURIComponent(id)));
      setBestiaryEntry(entry);
      show("Энциклопедия");
    });
  const slots: Skill[] = [
    "observe",
    "search",
    "interact",
    "attack",
    "block",
    "dodge",
    "stealth",
    "rest",
    "sprint",
  ];
  const cast = (skill: Skill) => {
    if (skill === "observe" && selectedCreature)
      return inspect(selectedCreature.id);
    if (
      skill === "interact" &&
      s?.objects.some((o: Data) => o.id === target && o.kind === "loot")
    )
      return act({ type: "gear", op: "take", item: target });
    return act({
      type: "ability",
      skill,
      ...(["entity", "nearest"].includes(skillTarget[skill]) && target
        ? { target }
        : {}),
    });
  };
  const command = (input: Command) => {
    if (!s?.room || !c || panel) return;
    if (input.move) {
      void act({
        type: "ability",
        skill: input.run ? "run" : "walk",
        dx: input.move[0],
        dy: input.move[1],
      });
      return;
    }
    const key = input.key || "";
    const panels: Record<string, string> = {
      KeyI: "Снаряжение",
      KeyC: "Персонажи",
      KeyK: "Способности",
      KeyJ: "История",
    };
    if (key === "Enter") openChat();
    else if (panels[key]) show(panels[key]);
    else if (key === "Space") void cast("jump");
    else if (key === "KeyE") void cast("interact");
    else if (key === "KeyF") void cast("observe");
    else if (key.startsWith("Digit"))
      void cast(slots[Number(key.slice(5)) - 1]);
  };
  const notice = error && (
    <div className="error" role="alert" data-action-state={actionStatus}>
      {error}
      <button onClick={() => setError("")} aria-label="Закрыть сообщение">
        ×
      </button>
    </div>
  );
  if (boot)
    return (
      <main>
        <Brand />
        <p>Открываем атлас…</p>
      </main>
    );
  if (!me)
    return (
      <main className="access">
        <section className="cover">
          <MapView preview />
          <div className="coverShade" />
          <header>
            <Brand />
          </header>
          <div className="coverTitle">
            <small>UNIVERSAL RPG ENGINE</small>
            <h1>
              Атлас
              <br />
              <em>миров</em>
            </h1>
            <p>Постоянные миры для ваших совместных приключений.</p>
          </div>
          <footer>
            Полевая картография <span>URE / 0.6</span>
          </footer>
        </section>
        <Access
          key={accessLinkView}
          api={api}
          initialMessage={accessMessage}
          login={(account) => {
            setAccessMessage("");
            setMe(account);
          }}
        />
      </main>
    );
  return (
    <>
      <header className="top">
        <Brand />
        <div>
          <button aria-haspopup="dialog" onClick={() => show("Профиль")}>
            {me.display || me.name}
          </button>
          <button
            onClick={() =>
              task(async () => {
                await api("logout", {});
                open("");
                setMe(null);
              })
            }
          >
            Выйти
          </button>
        </div>
      </header>
      <main aria-busy={busy}>
        <div className="hubnav">
          {["Персонажи", "Энциклопедия", "Инструменты", "Помощник"].map((n) => (
            <button key={n} onClick={() => show(n)}>
              {n}
            </button>
          ))}
        </div>
        <fieldset className="interaction">
          {notice}{" "}
          {feedback && !!id && (
            <div
              className="feedback"
              role="status"
              data-action-state={actionStatus}
            >
              {feedback}
            </div>
          )}
          {busy && (
            <div role="status" className="busy" data-action-state="pending">
              Сохранение…
            </div>
          )}
          {(!id || !s) && id && (
            <>
              <button onClick={() => open("")}>← Мои миры</button>
              <p>Открываем мир…</p>
            </>
          )}
          {!id && !wizard && (
            <>
              <div className="title">
                <div>
                  <small>Картотека экспедиций</small>
                  <h1>Мои миры</h1>
                </div>
                <button className="primary" onClick={() => setWizard(true)}>
                  ＋ Создать мир
                </button>
              </div>
              <section className="dash">
                <div className="worldlist">
                  {worlds.mine.length === 0 ? (
                    <article className="card empty">
                      <MapView preview />
                      <div>
                        <h2>Первый мир</h2>
                        <p>
                          Создайте мир или войдите в комнату по приглашению.
                        </p>
                      </div>
                    </article>
                  ) : (
                    worlds.mine.map((w: Data) => (
                      <article className="card worldcard" key={w.id}>
                        <small>
                          {w.land} ·{" "}
                          {w.role === "owner" ? "Ваш мир" : "Общий мир"}
                        </small>
                        <h2>{w.name}</h2>
                        <p>{w.description}</p>
                        <div className="row">
                          <span>{w.character || "Без персонажа"}</span>
                          <button onClick={() => open(w.id)}>
                            Продолжить →
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
                <aside className="card">
                  <h3>Присоединиться</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void task(async () => {
                        let code = join.trim();
                        if (code.includes("://"))
                          code = new URL(code).searchParams.get("invite") || "";
                        open((await api("join", { code })).id);
                        setJoin("");
                      });
                    }}
                  >
                    <Field label="Код или ссылка">
                      <input
                        value={join}
                        onChange={(e) => setJoin(e.target.value)}
                        required
                      />
                    </Field>
                    <button disabled={busy}>Войти в комнату</button>
                  </form>
                  {worlds.listed.length > 0 && (
                    <>
                      <h3>Открытые миры</h3>
                      {worlds.listed.map((w: Data) => (
                        <button
                          key={w.id}
                          onClick={() =>
                            task(async () =>
                              open(
                                (await api("worlds/" + w.id + "/watch", {})).id,
                              ),
                            )
                          }
                        >
                          {w.name} · наблюдать
                        </button>
                      ))}
                    </>
                  )}
                </aside>
              </section>
            </>
          )}
          {!id && wizard && (
            <>
              <button disabled={busy} onClick={() => setWizard(false)}>
                ← Мои миры
              </button>
              <section className="card formcard">
                <small>Атлас миров</small>
                <h1>Новый мир</h1>
                <form
                  onSubmit={(e) => {
                    const f = dataOf(e);
                    void task(async () =>
                      open(
                        (
                          await api("worlds", {
                            ...f,
                            name: plan?.plan.name || f.name,
                            ai: !plan && f.ai === "on",
                            ...(plan ? { plan: plan.plan } : {}),
                          })
                        ).id,
                      ),
                    );
                  }}
                >
                  <Field label="Название мира">
                    <input
                      autoFocus
                      name="name"
                      minLength={2}
                      maxLength={80}
                      required
                    />
                  </Field>
                  <Field label="Описание">
                    <textarea name="description" maxLength={600} />
                  </Field>
                  <Field label="Ландшафт">
                    <select name="land">
                      {["Лес", "Долина", "Нагорье"].map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Зерно карты">
                    <input
                      name="seed"
                      defaultValue={String(Date.now())}
                      maxLength={80}
                      required
                    />
                  </Field>
                  <Field label="Доступ">
                    <select name="access">
                      <option value="invite">По приглашению</option>
                      <option value="listed">Открыт для наблюдателей</option>
                    </select>
                  </Field>
                  <label className="inline">
                    <input name="ai" type="checkbox" />
                    Предложить мир с ИИ
                  </label>
                  <p>
                    Без подключения к ИИ местность и сюжет задаёт сценарный
                    мастер по зерну мира.
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      const form = e.currentTarget.form!;
                      if (!form.reportValidity()) return;
                      const f = Object.fromEntries(new FormData(form));
                      void task(async () =>
                        planSet(
                          await api("world-plan", { ...f, ai: f.ai === "on" }),
                        ),
                      );
                    }}
                  >
                    Подготовить предложение
                  </button>
                  {plan && (
                    <section>
                      <small>{plan.provider} · Черновик</small>
                      {Object.entries(plan.plan).map(([k, v]) => (
                        <label key={k}>
                          {planLabels[k]}
                          <textarea
                            value={String(v)}
                            required
                            maxLength={k === "name" ? 80 : 900}
                            onChange={(e) =>
                              planSet({
                                ...plan,
                                plan: { ...plan.plan, [k]: e.target.value },
                              })
                            }
                          />
                        </label>
                      ))}
                    </section>
                  )}
                  <button className="primary" disabled={busy}>
                    Сохранить мир
                  </button>
                </form>
              </section>
            </>
          )}
          {id && s && (
            <>
              <button className="link" disabled={busy} onClick={() => open("")}>
                ← Мои миры
              </button>
              <div className="title">
                <div>
                  <small>
                    {s.world.land} / {s.world.draft.location}
                  </small>
                  <h1>{s.world.name}</h1>
                </div>
                <span className="live">{live}</span>
              </div>
              <nav className="world-tabs" aria-label="Разделы мира">
                {Object.entries(tabs).map(([k, v]) => (
                  <button
                    key={k}
                    aria-current={tab === k ? "page" : undefined}
                    onClick={() => setTab(k)}
                  >
                    {v}
                  </button>
                ))}
              </nav>
              {tab === "lore" && (
                <article className="card prose">
                  <small>{s.world.provider}</small>
                  <h2>{s.world.draft.location}</h2>
                  <p>{s.world.description}</p>
                  {s.role === "owner" && (
                    <details>
                      <summary>Условия входа и поединков</summary>
                      <form
                        onSubmit={(e) => {
                          const v = dataOf(e);
                          void task(async () => {
                            await local("settings", {
                              pvp: !!v.pvp,
                              minLevel: Number(v.minLevel),
                              maxLevel: Number(v.maxLevel),
                            });
                            await refresh();
                            tell("Условия мира сохранены");
                          });
                        }}
                      >
                        <label>
                          Минимальный уровень
                          <input
                            type="number"
                            min="0"
                            max="5000"
                            name="minLevel"
                            defaultValue={s.config.minLevel}
                          />
                        </label>
                        <label>
                          Максимальный уровень при входе
                          <input
                            type="number"
                            min="0"
                            max="5000"
                            name="maxLevel"
                            defaultValue={s.config.maxLevel}
                          />
                        </label>
                        <label className="inline">
                          <input
                            name="pvp"
                            type="checkbox"
                            defaultChecked={s.config.pvp}
                          />
                          Разрешить добровольные поединки
                        </label>
                        <button>Сохранить условия</button>
                      </form>
                    </details>
                  )}
                  {s.config.pvp && c && (
                    <button
                      onClick={() =>
                        task(async () => {
                          await local("consent", { duel: !c.extra.duel });
                          await refresh();
                        })
                      }
                    >
                      {c.extra.duel
                        ? "Отозвать согласие на поединки"
                        : "Участвовать в поединках"}
                    </button>
                  )}
                  <p>{s.world.draft.description}</p>
                  {s.world.draft.plan &&
                    Object.entries(s.world.draft.plan).map(([k, v]) => (
                      <details key={k}>
                        <summary>{planLabels[k]}</summary>
                        <p>{String(v)}</p>
                      </details>
                    ))}
                  {s.world.draft.hook && (
                    <blockquote>{s.world.draft.hook}</blockquote>
                  )}
                  <p>
                    Версия правил {s.world.ruleset} ·{" "}
                    {s.world.access === "invite"
                      ? "Доступ по приглашению"
                      : "Открыт для наблюдения"}
                  </p>
                </article>
              )}
              {tab === "rules" && (
                <Encyclopedia catalog={catalog} user={me.id} />
              )}
              {tab === "lobby" && (
                <div className="card formcard">
                  <small>Совместная игра</small>
                  <h2>Комната</h2>
                  <p>
                    {s.room
                      ? "Комната открыта."
                      : "Мир сохранён. Комната ещё закрыта."}
                  </p>
                  {manager && !s.room && (
                    <button
                      className="primary"
                      onClick={() =>
                        task(async () => {
                          await local("room", {});
                          await refresh();
                        })
                      }
                    >
                      Открыть комнату
                    </button>
                  )}
                  {manager && s.room && (
                    <form
                      onSubmit={(e) => {
                        const f = dataOf(e);
                        void task(async () =>
                          setInvite((await local("invite", f)).code),
                        );
                      }}
                    >
                      <Field label="Роль приглашённого">
                        <select name="role">
                          <option value="player">Игрок</option>
                          <option value="spectator">Наблюдатель</option>
                          {s.role === "owner" && (
                            <option value="gm">Мастер</option>
                          )}
                        </select>
                      </Field>
                      <button>Создать приглашение</button>
                    </form>
                  )}
                  {invite && (
                    <>
                      <Field label="Ссылка на 24 часа">
                        <input
                          readOnly
                          value={location.origin + "/?invite=" + invite}
                          onFocus={(e) => e.target.select()}
                        />
                      </Field>
                      <Field label="Код приглашения">
                        <input
                          readOnly
                          value={invite}
                          onFocus={(e) => e.target.select()}
                        />
                      </Field>
                    </>
                  )}
                </div>
              )}
              {tab === "game" && !c && s.role !== "spectator" && (
                <Builder
                  key={id}
                  initial={s.pendingBuild}
                  local={local}
                  done={refresh}
                  task={task}
                />
              )}
              {(c || s.role === "spectator") && (
                <div hidden={tab !== "game"}>
                  <nav
                    className="toolbar expedition"
                    aria-label="Панели экспедиции"
                  >
                    <span>
                      {
                        (
                          {
                            vault: "Башня · нижний ярус",
                            lodge: "Посёлок перевозчиков",
                            cave: "Пещера у перевала",
                            field: "Приграничный тракт",
                          } as Record<string, string>
                        )[s.area]
                      }
                    </span>
                    {c && (
                      <button
                        onClick={() =>
                          document.getElementById("character-sheet")?.focus()
                        }
                      >
                        Персонаж
                      </button>
                    )}
                    {c &&
                      ["Снаряжение", "Способности", "Задания"].map((n) => (
                        <button
                          key={n}
                          aria-haspopup="dialog"
                          onClick={() => show(n)}
                        >
                          {n}
                        </button>
                      ))}
                    <button onClick={focusMap}>Карта</button>
                    <button
                      aria-haspopup="dialog"
                      onClick={() => show("История")}
                    >
                      Журнал
                    </button>
                    {c && s.room && (
                      <button
                        onClick={() =>
                          chatOpen
                            ? chatInput.current?.focus({ preventScroll: true })
                            : openChat()
                        }
                        aria-expanded={chatOpen}
                      >
                        Чат
                      </button>
                    )}
                    <button
                      aria-haspopup="dialog"
                      onClick={() => show("Помощник")}
                    >
                      Помощник
                    </button>
                  </nav>
                  <div className="workspace">
                    <aside className="card sheet" aria-label="Лист персонажа">
                      <small>
                        {s.role === "spectator" ? "Роль" : "Персонаж"}
                      </small>
                      {c && (
                        <Portrait
                          look={c.extra.look}
                          race={c.race}
                          armored={c.extra.gear.some(
                            (g: Data) => g.equipped && g.kind === "vest",
                          )}
                        />
                      )}
                      <h2 id="character-sheet" tabIndex={-1}>
                        {c?.name || "Наблюдатель"}
                      </h2>
                      {c && (
                        <p>
                          Здоровье {c.extra.hp}/18 · Выносливость{" "}
                          {c.extra.stamina}/12
                        </p>
                      )}
                      {c && (
                        <>
                          <p>
                            {names[c.race]} · {names[c.profession]}
                          </p>
                          <dl>
                            {[
                              ["Уровень", c.level],
                              ["Опыт", c.xp + " / " + c.nextCost],
                              ["Силы", c.energy + " / " + c.maxEnergy],
                              ["Тир", c.tierName],
                              ["Ранг", c.rankName],
                              ["Оценка Q", c.q],
                              ["Координаты", c.x + ", " + c.y],
                            ].map(([k, v]) => (
                              <div key={k}>
                                <dt>{k}</dt>
                                <dd>{v}</dd>
                              </div>
                            ))}
                          </dl>
                          <Advancement character={c as Character} cost={c.nextCost} />
                          <button
                            disabled={
                              busy || !s.room || BigInt(c.xp) < BigInt(c.nextCost)
                            }
                            onClick={() => act({
                              type: "level",
                              expected: { level: c.level, hero: s.activeHeroId },
                            })}
                          >
                            Повысить уровень
                          </button>
                          <h3>Инвентарь</h3>
                          <button
                            disabled={
                              !s.room ||
                              !c.inventory ||
                              c.energy === c.maxEnergy
                            }
                            onClick={() => act({ type: "use" })}
                          >
                            Паёк × {c.inventory}
                          </button>
                        </>
                      )}
                    </aside>
                    <div className="card mapcard">
                      <div className="row">
                        <h3>Карта местности</h3>
                        <small>
                          {s.extent} × {s.extent}
                        </small>
                      </div>
                      <MapView
                        tiles={s.tiles}
                        extent={s.extent}
                        offset={s.offset}
                        command={command}
                        selected={target}
                        hover={setHoverCreature}
                        select={(p) => {
                          aim(p.id || p.userId || "");
                          tell(p.name + " · " + p.x + ", " + p.y);
                        }}
                        party={s.party}
                        objects={s.objects}
                        me={me.id}
                        step={
                          c && s.room
                            ? (dx, dy) => act({ type: "move", dx, dy })
                            : undefined
                        }
                      />
                      {quickCreature && (
                        <CreatureQuick
                          creature={quickCreature}
                          actor={c}
                          inspect={() => inspect(quickCreature.id)}
                        />
                      )}
                      <div className="maplegend">
                        Стрелки / WASD — шаг　·　Shift — бег　·　Пробел — прыжок
                      </div>
                      {c && s.room && (
                        <div className="directions">
                          {[
                            ["←", -1, 0],
                            ["↑", 0, -1],
                            ["↓", 0, 1],
                            ["→", 1, 0],
                          ].map(([label, dx, dy]) => (
                            <button
                              key={label}
                              aria-label={"Шаг " + label}
                              onClick={() => act({ type: "move", dx, dy })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <aside className="card" aria-label="Объекты и действия">
                      {c && s.room && (
                        <>
                          <label>
                            Цель действия
                            <select
                              value={target}
                              onChange={(e) => aim(e.target.value)}
                            >
                              <option value="">Ближайшая доступная цель</option>
                              {target &&
                                !s.objects.some((p: Data) => p.id === target) &&
                                !s.party.some(
                                  (p: Data) =>
                                    p.userId === target && p.x !== undefined,
                                ) && (
                                  <option value={target}>
                                    Выбранная цель вне поля наблюдения
                                  </option>
                                )}
                              {s.objects.map((p: Data) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                              {s.config.pvp &&
                                s.party
                                  .filter(
                                    (p: Data) =>
                                      p.x !== undefined && p.userId !== me.id,
                                  )
                                  .map((p: Data) => (
                                    <option key={p.userId} value={p.userId}>
                                      {p.name} · поединок
                                    </option>
                                  ))}
                            </select>
                          </label>
                          <button
                            onClick={() => {
                              if (
                                selectedCreature &&
                                !selectedCreature.attackable
                              )
                                return inspect(target);
                              if (
                                selectedCreature?.attackable ||
                                s.party.some((p: Data) => p.userId === target)
                              )
                                return cast("attack");
                              return cast("interact");
                            }}
                          >
                            {selectedCreature && !selectedCreature.attackable
                              ? "Осмотреть существо"
                              : "Действовать"}
                          </button>
                        </>
                      )}
                      <hr />
                      <h3>Ориентиры</h3>
                      {c && (
                        <button onClick={() => show("Журнал существ")}>
                          Журнал существ
                        </button>
                      )}
                      {s.objects.map((o: Data) => (
                        <p
                          key={o.id}
                          data-creature={o.creature ? o.id : undefined}
                        >
                          {o.creature ? (
                            <button
                              type="button"
                              className="creature-select"
                              aria-pressed={target === o.id}
                              onFocus={() => setHoverCreature(o.id)}
                              onBlur={() => setHoverCreature("")}
                              onClick={() => aim(o.id)}
                            >
                              {o.name}
                            </button>
                          ) : (
                            o.name
                          )}
                          <br />
                          <small>
                            {o.x}, {o.y}
                          </small>
                        </p>
                      ))}
                      <h3>Участники</h3>
                      {s.party.map((p: Data) => (
                        <p key={p.userId}>
                          <span>{p.name}</span>
                          {p.x !== undefined && (
                            <span
                              className="position"
                              aria-label={"Позиция " + p.name}
                            >
                              <small>
                                {p.x}, {p.y}
                              </small>
                            </span>
                          )}
                        </p>
                      ))}
                      {!s.room ? (
                        <button onClick={() => setTab("lobby")}>
                          Перейти в комнату →
                        </button>
                      ) : (
                        c && (
                          <div className="stack">
                            {[
                              ["talk", "Поговорить"],
                              ["survey", "Исследовать руины"],
                              ["roll", "Бросить d100"],
                            ].map(([type, label]) => (
                              <button
                                disabled={busy}
                                key={type}
                                onClick={() => act({ type })}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )
                      )}
                    </aside>
                  </div>
                  {c && s.room && (
                    <div className="hotbar">
                      {slots.map((k, i) => (
                        <button
                          title={skills[k][0]}
                          key={k}
                          disabled={c.level < skills[k][3] || busy}
                          onClick={() => cast(k)}
                        >
                          <kbd>{i + 1}</kbd>
                          {skills[k][0]}
                        </button>
                      ))}
                    </div>
                  )}
                  <section className="card journal" id="journal">
                    <div className="row">
                      <h2>Журнал экспедиции</h2>
                      <button onClick={() => show("История")}>
                        Вся история
                      </button>
                      <small>Последние события</small>
                    </div>
                    {!s.events.length && (
                      <p>Здесь появятся действия и сообщения участников.</p>
                    )}
                    <div className="toolbar">
                      <label>
                        Канал журнала
                        <select
                          value={filter}
                          onChange={(e) => filterBy(e.target.value)}
                        >
                          {Object.entries({
                            ooc: "Игроки",
                            ic: "Речь персонажей",
                            narrative: "Повествование",
                            actions: "Действия",
                            system: "Система",
                            private: "Личные",
                          }).map(([k, v]) => (
                            <option key={k} value={k}>
                              {channelName(k, v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <input
                        aria-label="Поиск в журнале"
                        placeholder="Найти событие…"
                        value={search}
                        onChange={(e) => find(e.target.value)}
                      />
                    </div>
                    <div className="entries">
                      {recentEvents(
                        [...s.events]
                          .reverse()
                          .filter(
                            (e) =>
                              (e.audit.channel || channelOf(e.action)) ===
                                filter &&
                              e.text
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          ),
                      ).map((e: Data) => (
                        <details key={e.id}>
                          <summary>
                            <time>
                              {new Date(e.timestamp).toLocaleTimeString("ru", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </time>
                            <span className="speaker">
                              {e.audit.look && (
                                <Portrait
                                  look={e.audit.look}
                                  race={e.audit.race}
                                />
                              )}
                            </span>
                            <b>
                              {marks[e.audit.avatar as keyof typeof marks] ||
                                (e.action === "ic" ? "♟" : "")}{" "}
                              {e.audit.actor}
                            </b>{" "}
                            {e.text}
                            {e.audit.attempts?.length
                              ? " · d100: " +
                                e.audit.attempts
                                  .map((a: Data) => a.roll)
                                  .join(", ")
                              : ""}
                            {e.steps > 1 ? " · переходов " + e.steps : ""}
                          </summary>
                          {e.audit.attempts?.map((attempt: Data, i: number) => (
                            <p key={i}>
                              Этап {i + 1}.{" "}
                              {attempt.capacity !== undefined && (
                                <>
                                  Способность {attempt.capacity}, сложность{" "}
                                  {attempt.difficulty}, поправка{" "}
                                  {attempt.modifier}.{" "}
                                </>
                              )}
                              Бросок d100 — {attempt.roll}.
                              {attempt.target === undefined
                                ? " "
                                : " Порог успеха — " + attempt.target + ". "}
                              {attempt.success ? "Успех." : "Неудача."}
                            </p>
                          ))}
                          <p>Начислено опыта: {e.audit.xpAward}.</p>
                          <details>
                            <summary>Данные расчёта</summary>
                            <pre>{JSON.stringify(e.audit, null, 2)}</pre>
                          </details>
                        </details>
                      ))}
                    </div>
                    {s.room && c && (
                      <form
                        className={chatOpen ? "compose chat-dock" : "compose"}
                        aria-label="Чат экспедиции"
                        onKeyDown={(e) => {
                          if (e.key === "Escape" && chatOpen) {
                            e.preventDefault();
                            focusMap();
                          }
                        }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void task(async () => {
                            setDelivery("Отправка…");
                            try {
                              await local("action", {
                                key: crypto.randomUUID(),
                                action: {
                                  type: channel,
                                  text: message,
                                  ...(channel === "whisper"
                                    ? { recipient: direct }
                                    : channel === "group"
                                      ? { recipients: group }
                                      : {}),
                                },
                              });
                            } catch (e) {
                              const failure = e as Error & { status?: number };
                              setDelivery(
                                failure.status
                                  ? "Отклонено: " + failure.message
                                  : "Отправка не подтверждена. Проверьте журнал перед повтором.",
                              );
                              return "failed";
                            }
                            setDelivery("Отправлено");
                            filterBy(channelOf(channel));
                            setMessage("");
                            await refresh().catch(() => {});
                          });
                        }}
                      >
                        {chatOpen && (
                          <button
                            type="button"
                            onClick={focusMap}
                            aria-label="Закрыть чат"
                          >
                            ×
                          </button>
                        )}
                        {chatOpen && (
                          <ul
                            className="chat-recent"
                            aria-label="Недавние сообщения выбранного канала"
                          >
                            {s.events
                              .filter(
                                (event: Data) =>
                                  (event.audit.channel ||
                                    channelOf(event.action)) ===
                                  channelOf(channel),
                              )
                              .slice(-5)
                              .map((event: Data) => (
                                <li key={event.id}>
                                  <time dateTime={event.timestamp}>
                                    {new Date(
                                      event.timestamp,
                                    ).toLocaleTimeString("ru", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </time>
                                  {" · "}
                                  {event.audit.actor}
                                  {" · "}
                                  {event.text}
                                </li>
                              ))}
                          </ul>
                        )}
                        <select
                          aria-label="Канал"
                          disabled={busy}
                          value={channel}
                          onChange={(e) => setChannel(e.target.value)}
                        >
                          <option value="chat">Чат игроков</option>
                          <option value="ic">Речь персонажа</option>
                          <option value="whisper">Личное</option>
                          <option value="group">Группа</option>
                          <option value="intent">Заявка</option>
                          {manager && <option value="gm">Слово мастера</option>}
                        </select>
                        {channel === "group" && (
                          <label>
                            Участники группы
                            <select
                              multiple
                              disabled={busy}
                              required
                              value={group}
                              onChange={(e) =>
                                groupTo(
                                  [...e.target.selectedOptions].map(
                                    (o) => o.value,
                                  ),
                                )
                              }
                            >
                              {s.party
                                .filter((p: Data) => p.userId !== me.id)
                                .map((p: Data) => (
                                  <option key={p.userId} value={p.userId}>
                                    {p.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        {channel === "whisper" && (
                          <select
                            aria-label="Получатель"
                            disabled={busy}
                            required
                            value={direct}
                            onChange={(e) => dm(e.target.value)}
                          >
                            <option value="">Получатель…</option>
                            {s.party
                              .filter((p: Data) => p.userId !== me.id)
                              .map((p: Data) => (
                                <option key={p.userId} value={p.userId}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        )}
                        <input
                          ref={chatInput}
                          aria-label="Сообщение"
                          readOnly={busy}
                          placeholder={
                            channel === "intent"
                              ? "поговорить / осмотреть руины / проверка или заявка мастеру"
                              : "Сообщение партии…"
                          }
                          value={message}
                          maxLength={500}
                          onChange={(e) => setMessage(e.target.value)}
                          required
                        />
                        <button disabled={busy}>Отправить</button>
                        {(delivery || (chatOpen && live !== "В сети")) && (
                          <small className="chat-delivery" role="status">
                            {chatOpen && live !== "В сети"
                              ? live === "Переподключение…"
                                ? "Связь прервана. "
                                : live + " "
                              : ""}
                            {delivery}
                          </small>
                        )}
                      </form>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </fieldset>
        {panel && (
          <Panel
            title={panel}
            close={() => {
              show("");
              setBestiaryEntry("");
            }}
          >
            {panel === "Помощник" && <Assistant api={api} id={id} />}
            {panel === "Инструменты" && (
              <Tools catalog={catalog} heroes={heroes} />
            )}
            {panel === "Энциклопедия" && (
              <Encyclopedia
                key={bestiaryEntry || "catalog"}
                catalog={catalog}
                user={me.id}
                initialBestiary={bestiaryEntry}
              />
            )}
            {panel === "Осмотр существа" &&
              (inspectedCreature && creatureInfo && !creatureError ? (
                <>
                  {manager && (
                    <button
                      aria-pressed={gmCreature}
                      onClick={() => {
                        setCreatureInfo(null);
                        setGmCreature((value) => !value);
                      }}
                    >
                      Данные мастера
                    </button>
                  )}
                  <CreatureCard
                    inspection={creatureInfo}
                    creature={
                      gmCreature ? creatureInfo.creature : inspectedCreature
                    }
                    actor={c}
                    identify={
                      !gmCreature &&
                      inspectedCreature.knowledgeStage !== undefined &&
                      inspectedCreature.knowledgeStage < 2
                        ? () =>
                            act({
                              type: "ability",
                              skill: "observe",
                              target: inspectId,
                            })
                        : undefined
                    }
                    openBestiary={openCreatureBestiary}
                  />
                </>
              ) : (
                <p role="status">
                  {creatureError ||
                    (inspectedCreature
                      ? "Осматриваем существо…"
                      : "Существо вне поля наблюдения")}
                </p>
              ))}
            {panel === "Журнал существ" && (
              <CreatureJournal
                entries={s?.creatureJournal ?? []}
                open={openCreatureBestiary}
              />
            )}
            {panel === "Персонажи" && (
              <Heroes
                api={api}
                id={id}
                canSelect={!!s && s.role !== "spectator"}
                changed={refresh}
              />
            )}
            {panel === "Профиль" && (
              <Profile
                api={api}
                saved={(profile) =>
                  setMe((current) =>
                    current?.id === me.id
                      ? {
                          ...current,
                          display: profile.display,
                          avatar: profile.avatar,
                        }
                      : current,
                  )
                }
                logout={(message) => {
                  setAccessMessage(message);
                  setMe(null);
                  show("");
                  open("");
                }}
              />
            )}
            {panel === "Снаряжение" && c && <Inventory s={s} act={act} />}
            {panel === "Способности" && c && <SkillBook c={c} cast={cast} />}
            {panel === "Задания" && (
              <>
                <h2>Свет над трактом</h2>
                {c && <p>{c.talked ? "Вы поговорили с проводником." : "Поговорите с проводником у переправы (13, 12)."}</p>}
                <h3>Прогресс партии</h3>
                <ul>
                  <li>{s?.cacheOpened ? "Тайник открыт партией." : "Тайник дозора закрыт."}</li>
                  <li>{s?.beacon ? "Маяк горит. Задание партии выполнено." : "Маяк пока погашен."}</li>
                </ul>
                {c && !s?.beacon && <p>{s?.area === "vault"
                  ? "За стражем находится маяк (6, 4). После победы подойдите к нему и нажмите «Действовать»."
                  : s?.area !== "field"
                    ? "Вернитесь на тракт через выход. Вход в башню находится в клетке (15, 14)."
                    : s?.cacheOpened
                      ? "Возьмите оставшееся снаряжение, если оно вам нужно. Подойдите ко входу в башню (15, 14) и нажмите «Действовать»."
                      : "Подойдите к тайнику (12, 13) и нажмите «Действовать». Там можно снарядиться перед походом в башню."}</p>}
              </>
            )}
            {panel === "История" && <History api={api} id={id} />}
            {notice}
            {feedback && ["Снаряжение", "Способности"].includes(panel) && (
              <p role="status">{feedback}</p>
            )}
          </Panel>
        )}
      </main>
    </>
  );
}
function Builder({
  local,
  done,
  task,
  initial,
}: {
  initial: Data | null;
  local: (s: string, b: any) => Promise<any>;
  done: () => Promise<void>;
  task: (f: () => Promise<void>) => Promise<void>;
}) {
  const [mode, modeSet] = useState(initial?.mode || "manual"),
    [draft, set] = useState<Data | null>(initial);
  return (
    <section className="formcard card">
      <small>Новый персонаж · уровень 0</small>
      <h2>Лист персонажа</h2>
      <form
        onSubmit={(e) => {
          const f = dataOf(e);
          void task(async () => {
            await local("character", {
              ...f,
              mode,
              ...(draft
                ? {
                    race: draft.race,
                    profession: draft.profession,
                    flaw: draft.flaw,
                  }
                : {}),
            });
            await done();
          });
        }}
      >
        <Field label="Имя персонажа">
          <input name="name" required minLength={2} maxLength={40} />
        </Field>
        <Field label="Способ создания">
          <select
            value={mode}
            disabled={!!draft}
            onChange={(e) => modeSet(e.target.value)}
          >
            <option value="manual">Ручная сборка</option>
            <option value="random">Полный рандом</option>
            <option value="partial">Частичный рандом</option>
          </select>
        </Field>
        {mode !== "manual" && !draft && (
          <button
            type="button"
            onClick={() =>
              task(async () => set(await local("build", { mode })))
            }
          >
            Сгенерировать
          </button>
        )}
        {(mode === "manual" || draft) && (
          <>
            {Object.entries({
              race: ["Раса", "R-001", "R-009"],
              profession: ["Путь", "C-001", "C-022"],
              flaw: ["Недостаток", "Утомляемость", "Рассеянность"],
            }).map(([key, [label, ...values]]) => (
              <div key={key}>
                <Field label={label}>
                  {draft ? (
                    <span>{names[draft[key]] || draft[key]}</span>
                  ) : (
                    <select name={key}>
                      {values.map((v) => (
                        <option key={v} value={v}>
                          {names[v] || v}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {draft && mode === "partial" && (
                  <button
                    type="button"
                    disabled={draft.used.includes(key)}
                    onClick={() =>
                      task(async () =>
                        set(await local("build", { mode, field: key })),
                      )
                    }
                  >
                    Заменить · {label} (5 ОС из{" "}
                    {draft.fate ?? 15 - 5 * draft.used.length})
                  </button>
                )}
              </div>
            ))}
            <p>
              Два игровых происхождения и два пути. Остальные записи доступны в
              справочнике. Ручная сборка использует 10 ОС: происхождение и путь
              по 5 ОС.
            </p>
            <button className="primary">Создать персонажа</button>
          </>
        )}
      </form>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
