import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { appearance } from "../../packages/shared/phase2.ts";
import {
  characterSchema,
  type Character,
} from "../../packages/shared/index.ts";
import { newCharacter, ensure, characterView, sight } from "./game.ts";
import { details } from "./adventure.ts";
import type { Store } from "./db.ts";
export function heroApi(
  app: FastifyInstance,
  db: Store,
  user: (r: FastifyRequest) => Record<string, any>,
  context: (r: FastifyRequest) => {
    u: Record<string, any>;
    id: string;
    role: string;
  },
  broadcast: (id: string) => void,
) {
  const { all, one, run, transaction } = db;
  function own(uid: string, id: string) {
    const hero = one(
      "SELECT h.*, a.world_id FROM heroes h LEFT JOIN active_heroes a ON h.id=a.hero_id WHERE h.id=? AND h.user_id=?",
      id,
      uid,
    );
    ensure(hero, "Персонаж недоступен", 404);
    return hero;
  }
  app.get("/api/heroes", async (r) =>
    all(
      "SELECT h.*,w.name world,a.world_id FROM heroes h LEFT JOIN active_heroes a ON a.hero_id=h.id LEFT JOIN worlds w ON w.id=a.world_id WHERE h.user_id=? ORDER BY h.rowid DESC",
      user(r).id,
    ).map((h) => ({
      id: h.id,
      archived: !!h.archived,
      world: h.world,
      worldId: h.world_id,
      history: all(
        "SELECT json_extract(record,'$.text') text,json_extract(record,'$.timestamp') at FROM events WHERE user_id=? AND json_extract(record,'$.audit.heroId')=? ORDER BY rowid DESC LIMIT 8",
        h.user_id,
        h.id,
      ),
      ...characterView(JSON.parse(h.state)),
    })),
  );
  app.post("/api/heroes", async (r) => {
    const u = user(r),
      p = characterSchema.extend({ look: appearance }).parse(r.body);
    ensure(
      p.mode === "manual",
      "Генерация случайных героев доступна при входе в мир",
    );
    const c = newCharacter(u.id, p);
    details(c).look = p.look;
    const id = randomUUID();
    run("INSERT INTO heroes VALUES (?,?,?,0)", id, u.id, JSON.stringify(c));
    return { id };
  });
  app.post("/api/heroes/:id", async (r) => {
    const uid = user(r).id,
      id = (r.params as { id: string }).id;
    const p = z
      .discriminatedUnion("op", [
        z
          .object({
            op: z.literal("edit"),
            name: z.string().trim().min(2).max(40),
            look: appearance,
          })
          .strict(),
        z.object({ op: z.enum(["archive", "restore", "duplicate"]) }).strict(),
        z
          .object({ op: z.literal("delete"), confirmation: z.string() })
          .strict(),
      ])
      .parse(r.body);
    const h = own(uid, id),
      c: Character = JSON.parse(h.state);
    transaction(() => {
      if (p.op === "edit") {
        c.name = p.name;
        details(c).look = p.look;
        const json = JSON.stringify(c);
        run("UPDATE heroes SET state=? WHERE id=?", json, id);
        if (h.world_id)
          run(
            "UPDATE characters SET state=? WHERE world_id=? AND user_id=?",
            json,
            h.world_id,
            uid,
          );
      } else if (p.op === "duplicate") {
        const copy = newCharacter(uid, {
          name: c.name.slice(0, 30) + " · копия",
          race: c.race,
          profession: c.profession,
          mode: "manual",
          flaw: c.flaw,
        });
        details(copy).look = details(c).look;
        run(
          "INSERT INTO heroes VALUES (?,?,?,0)",
          randomUUID(),
          uid,
          JSON.stringify(copy),
        );
      } else {
        ensure(!h.world_id, "Сначала завершите участие этого героя в мире");
        if (p.op === "delete") {
          ensure(
            p.confirmation === c.name,
            "Введите имя героя для подтверждения",
          );
          run("DELETE FROM visits WHERE hero_id=?", id);
          run("DELETE FROM heroes WHERE id=?", id);
        } else
          run(
            "UPDATE heroes SET archived=? WHERE id=?",
            +(p.op === "archive"),
            id,
          );
      }
    });
    if (h.world_id) broadcast(h.world_id);
    return { ok: true };
  });
  app.post("/api/worlds/:id/select", async (r) => {
    const { u, id, role } = context(r);
    ensure(role !== "spectator", "Роль наблюдателя", 403);
    const p = z.object({ hero: z.uuid().nullable() }).strict().parse(r.body);
    transaction(() => {
      const old = one(
        "SELECT a.hero_id,c.state FROM active_heroes a JOIN characters c USING(world_id,user_id) WHERE world_id=? AND user_id=?",
        id,
        u.id,
      );
      if (old) {
        run(
          "INSERT OR REPLACE INTO visits VALUES (?,?,?)",
          old.hero_id,
          id,
          old.state,
        );
        run(
          "DELETE FROM active_heroes WHERE world_id=? AND user_id=?",
          id,
          u.id,
        );
        run("DELETE FROM characters WHERE world_id=? AND user_id=?", id, u.id);
        run("DELETE FROM builds WHERE world_id=? AND user_id=?", id, u.id);
      }
      if (!p.hero) return;
      const h = own(u.id, p.hero);
      ensure(
        !h.archived && !h.world_id,
        "Герой занят в другой экспедиции или архивирован",
      );
      const c: Character = JSON.parse(h.state);
      const cfg = JSON.parse(
        one("SELECT draft FROM worlds WHERE id=?", id)!.draft,
      ).config;
      ensure(
        !cfg || (c.level >= cfg.minLevel && c.level <= cfg.maxLevel),
        "Уровень вне условий входа",
      );
      const last = one(
        "SELECT state FROM visits WHERE hero_id=? AND world_id=?",
        p.hero,
        id,
      );
      const local = last
        ? JSON.parse(last.state)
        : {
            x: 12,
            y: 12,
            explored: sight(12, 12),
            talked: false,
            surveyed: false,
          };
      Object.assign(c, {
        x: local.x,
        y: local.y,
        explored: local.explored,
        talked: local.talked,
        surveyed: local.surveyed,
        lastMove: 0,
      });
      details(c).area = local.extra?.area || "field";
      details(c).duel = false;
      run("INSERT INTO characters VALUES (?,?,?)", id, u.id, JSON.stringify(c));
      run("UPDATE heroes SET state=? WHERE id=?", JSON.stringify(c), p.hero);
      run("INSERT INTO active_heroes VALUES (?,?,?)", id, u.id, p.hero);
    });
    broadcast(id);
    return { ok: true };
  });
}
