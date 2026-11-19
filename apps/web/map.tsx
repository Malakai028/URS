import React, { useEffect, useRef, useState } from "react";
import { terrain } from "../../packages/engine/index.ts";
import { gameKey, type Command } from "./input.ts";
import { sprite } from "./sprite.ts";
import { creatureSprite } from "./creature-sprite.ts";
import type { CreatureView } from "../../packages/shared/creatures.ts";
import type { Look } from "../../packages/shared/phase2.ts";
type Tile = { kind: string; lit: boolean } | null;
export type Pin = {
  id?: string;
  look?: Look;
  race?: string;
  armored?: boolean;
  armed?: boolean;
  x?: number;
  y?: number;
  name: string;
  userId?: string;
  kind?: string;
  creature?: CreatureView;
};
const palette: Record<string, string> = {
  hazard: "#895455",
  water: "#22484e",
  rock: "#4f5450",
  forest: "#344b3d",
  grass: "#566148",
  trail: "#716d50",
};
function brush(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  t: number,
  noise: number,
) {
  const u = t / 20;
  ctx.save();
  ctx.translate(x + t / 2, y + t / 2);
  ctx.scale(u, u);
  ctx.lineWidth = 0.7;
  if (kind === "forest") {
    for (let n = 0; n < 3; n++) {
      const a = (n - 1) * 4,
        b = (n % 2) * 4 + noise;
      ctx.fillStyle = n === 1 ? "#253c32" : "#2c4436";
      ctx.strokeStyle = "#668068";
      ctx.beginPath();
      ctx.moveTo(a, b - 7);
      ctx.lineTo(a - 3.4, b + 1);
      ctx.lineTo(a - 1.8, b + 1);
      ctx.lineTo(a - 4, b + 5);
      ctx.lineTo(a + 4, b + 5);
      ctx.lineTo(a + 1.8, b + 1);
      ctx.lineTo(a + 3, b + 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === "rock") {
    ctx.fillStyle = "#394b47";
    ctx.strokeStyle = "#9b9d82";
    ctx.beginPath();
    ctx.moveTo(-9, 6);
    ctx.lineTo(-2, -6);
    ctx.lineTo(1, -2);
    ctx.lineTo(4, -7);
    ctx.lineTo(10, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.strokeStyle = kind === "water" ? "#628c8c" : "#9e9b703f";
    ctx.beginPath();
    ctx.moveTo(-6, noise);
    ctx.quadraticCurveTo(-3, noise - 1, 1, noise);
    ctx.stroke();
  }
  ctx.restore();
}
export function MapView({
  tiles,
  party = [],
  objects = [],
  me,
  step,
  preview = false,
  offset = { x: 0, y: 0 },
  extent = 24,
  command,
  select,
  selected,
  hover,
}: {
  tiles?: Tile[][];
  party?: Pin[];
  objects?: Pin[];
  me?: string;
  step?: (dx: number, dy: number) => void;
  preview?: boolean;
  offset?: { x: number; y: number };
  extent?: number;
  command?: (c: Command) => void;
  select?: (p: Pin) => void;
  selected?: string;
  hover?: (id: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
      null,
    );
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState([0, 0]),
    [box, setBox] = useState([600, 420]);
  const [follow, setFollow] = useState(true),
    [grid, setGrid] = useState(true),
    [expanded, setExpanded] = useState(false);
  const stationary = useRef([12.5, 12.5]);
  const lastPins = useRef(
    new Map<string, { x: number; y: number; hp?: number }>(),
  );
  const creatureHits = useRef<
    { pin: Pin; x: number; y: number; radius: number }[]
  >([]);
  const geo = useRef({ t: 20, ox: 0, oy: 0 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() =>
      setBox([el.clientWidth, el.clientHeight]),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current!,
      ctx = el.getContext("2d")!;
    const [w, h] = box,
      dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = w * dpr;
    el.height = h * dpr;
    ctx.scale(dpr, dpr);
    const before = lastPins.current;
    const after = new Map<string, { x: number; y: number; hp?: number }>();
    let frame = 0;
    const start = performance.now();
    function draw(fraction: number) {
      if (!ctx) return;
      ctx.fillStyle = "#202d2b";
      ctx.fillRect(0, 0, w, h);
      const t =
          (preview ? Math.max(w, h) / 21 : Math.max(20, Math.min(w, h) / 13)) *
          zoom,
        center = party.find((p) => p.userId === me),
        cx = follow ? (center?.x ?? 12) + 0.5 : stationary.current[0],
        cy = follow ? (center?.y ?? 12) + 0.5 : stationary.current[1];
      const clamp = (v: number, min: number, max: number) =>
        Math.max(min, Math.min(max, v));
      const ox =
          w / 2 -
          clamp(
            cx * t - (follow ? 0 : pan[0]),
            offset.x * t,
            (offset.x + (tiles?.[0]?.length || 24)) * t,
          ),
        oy =
          h / 2 -
          clamp(
            cy * t - (follow ? 0 : pan[1]),
            offset.y * t,
            (offset.y + (tiles?.length || 24)) * t,
          );
      geo.current = { t, ox, oy };
      for (let y = offset.y; y < offset.y + (tiles?.length || 24); y++)
        for (let x = offset.x; x < offset.x + (tiles?.[0]?.length || 24); x++) {
          const px = ox + x * t,
            py = oy + y * t;
          if (px + t < 0 || px > w || py + t < 0 || py > h) continue;
          const tile = preview
            ? { kind: terrain("atlas", "Лес", x, y), lit: true }
            : tiles?.[y - offset.y]?.[x - offset.x];
          const noise = ((x * 67 + y * 41) % 7) - 3;
          ctx.fillStyle = tile ? palette[tile.kind] : "#293330";
          ctx.fillRect(px, py, t + 0.3, t + 0.3);
          ctx.fillStyle = "rgba(230,220,170," + (noise + 3) * 0.012 + ")";
          ctx.fillRect(px, py, t, t);
          if (tile) brush(ctx, tile.kind, px, py, t, noise);
          if (tile && !tile.lit) {
            ctx.fillStyle = "#0b19198c";
            ctx.fillRect(px, py, t, t);
          }
          ctx.strokeStyle = "#c5ceb818";
          ctx.lineWidth = 0.6;
          if (grid) ctx.strokeRect(px, py, t, t);
        }
      const pins: Pin[] = preview
        ? [
            { x: 13, y: 11, name: "Сигнальная башня", kind: "ruin" },
            { x: 9, y: 15, name: "Переправа", kind: "npc" },
          ]
        : [...objects, ...party];
      creatureHits.current = [];
      const labels: { name: string; x: number; y: number; priority: number }[] =
        [];
      pins.forEach((p, i) => {
        if (p.x === undefined || p.y === undefined) return;
        const stack = pins
          .slice(0, i)
          .filter((q) => q.x === p.x && q.y === p.y).length;
        const motionKey = p.creature ? "creature:" + p.id : p.userId;
        const old = motionKey ? before.get(motionKey) : undefined;
        const anim = old && Math.abs(old.x - p.x) + Math.abs(old.y - p.y) <= 3;
        const px = anim ? old.x + (p.x - old.x) * fraction : p.x,
          py = anim ? old.y + (p.y - old.y) * fraction : p.y;
        if (motionKey)
          after.set(motionKey, {
            x: p.x,
            y: p.y,
            hp: p.creature?.hp ?? undefined,
          });
        const stride =
          anim && (old.x !== p.x || old.y !== p.y)
            ? Math.sin(fraction * Math.PI) * 3
            : 0;
        const x = ox + (px + 0.5) * t + stack * 7,
          y = oy + (py + 0.5) * t - stack * 6 - stride;
        if (p.creature) {
          const scale = Math.min(1.75, t / 23);
          const radius = Math.max(12, scale * 15);
          if (
            p.creature.alive ||
            !objects.some(
              (o) => o.kind === "loot" && o.x === p.x && o.y === p.y,
            )
          )
            creatureHits.current.push({ pin: p, x, y: y - 5 * scale, radius });
          if (selected === p.id) {
            ctx.beginPath();
            ctx.ellipse(x, y + 8 * scale, radius, 5 * scale, 0, 0, Math.PI * 2);
            ctx.strokeStyle = "#ffe2a0";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          creatureSprite(
            ctx,
            p.creature,
            x,
            y,
            scale,
            stride,
            old?.hp !== undefined &&
              p.creature.hp !== null &&
              p.creature.hp < old.hp &&
              fraction < 0.8,
          );
          labels.push({
            name: p.name,
            x,
            y: y - 25 * scale,
            priority: selected === p.id ? 2 : 1,
          });
          return;
        }
        ctx.fillStyle =
          p.userId === me
            ? "#9ed8c2"
            : p.kind
              ? "#e0b978"
              : ["#d1aade", "#e39982", "#97bfe0"][i % 3];
        ctx.strokeStyle = "#142626";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (p.kind) {
          ctx.moveTo(x, y - 9);
          ctx.lineTo(x + 8, y);
          ctx.lineTo(x, y + 9);
          ctx.lineTo(x - 8, y);
          ctx.closePath();
        } else ctx.arc(x, y, 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        if (!p.kind)
          sprite(
            ctx,
            x,
            y,
            p.look,
            p.race,
            p.armored,
            p.armed,
            Math.min(1.5, t / 21),
          );
        else if (!preview) {
          ctx.fillStyle = "#272d29";
          ctx.font = "bold 12px Georgia";
          ctx.textAlign = "center";
          ctx.fillText(
            (
              {
                npc: "Л",
                loot: "◇",
                ruin: "П",
                chest: "□",
                beacon: "✦",
              } as Record<string, string>
            )[p.kind] || "?",
            x,
            y + 4,
          );
        }
        labels.push({ name: p.name, x, y: y - 18, priority: 0 });
      });
      const painted: { x: number; y: number; width: number }[] = [];
      ctx.font = "bold 11px Georgia";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#182522";
      ctx.lineWidth = 3;
      for (const label of labels.sort((a, b) => b.priority - a.priority)) {
        if (label.x < 0 || label.x > w || label.y < -16 || label.y > h + 16)
          continue;
        const width = Math.min(w - 12, ctx.measureText(label.name).width + 6);
        if (width <= 4) continue;
        const x = clamp(label.x, width / 2, w - width / 2);
        const y = [label.y, label.y - 13, label.y - 26, label.y - 39].find(
          (candidate) =>
            candidate >= 10 &&
            !painted.some(
              (old) =>
                Math.abs(old.x - x) < (old.width + width) / 2 &&
                Math.abs(old.y - candidate) < 12,
            ),
        );
        if (y === undefined) continue;
        painted.push({ x, y, width });
        ctx.strokeText(label.name, x, y, width - 4);
        ctx.fillStyle = "#f6eed6";
        ctx.fillText(label.name, x, y, width - 4);
      }
      if (!preview) {
        const sx = w - 74,
          sy = 36;
        ctx.fillStyle = "#13231fee";
        ctx.fillRect(sx, sy, 68, 68);
        ctx.strokeStyle = "#a6ad90";
        ctx.strokeRect(sx, sy, 68, 68);
        ctx.strokeStyle = "#91afa0";
        ctx.strokeRect(
          sx + (offset.x / extent) * 68,
          sy + (offset.y / extent) * 68,
          ((tiles?.[0]?.length || 1) / extent) * 68,
          ((tiles?.length || 1) / extent) * 68,
        );
        for (const pin of pins) {
          if (pin.x === undefined || pin.y === undefined) continue;
          ctx.fillStyle = pin.userId === me ? "#fff0ac" : "#94c9af";
          ctx.fillRect(
            sx + (pin.x / extent) * 68,
            sy + (pin.y / extent) * 68,
            3,
            3,
          );
        }
      }
    }
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 130;
    function tick(now: number) {
      const f = duration ? Math.min(1, (now - start) / duration) : 1;
      draw(f);
      if (f < 1 && !preview) frame = requestAnimationFrame(tick);
    }
    tick(start);
    lastPins.current = after;
    return () => cancelAnimationFrame(frame);
  }, [
    tiles,
    party,
    objects,
    me,
    preview,
    box,
    pan,
    zoom,
    follow,
    grid,
    offset.x,
    offset.y,
    extent,
    selected,
  ]);
  function hitCreature(canvas: HTMLCanvasElement, x: number, y: number) {
    const rect = canvas.getBoundingClientRect();
    return creatureHits.current.findLast(
      (hit) =>
        Math.hypot(hit.x - (x - rect.left), hit.y - (y - rect.top)) <=
        hit.radius,
    )?.pin;
  }
  return (
    <div
      className={
        "map " + (preview ? "preview" : "") + (expanded ? " expanded" : "")
      }
    >
      <canvas
        ref={ref}
        aria-label={
          preview ? "Карта приграничья" : "Карта мира. Стрелки для движения"
        }
        tabIndex={preview ? -1 : 0}
        onKeyDown={(e) =>
          gameKey(e, (input) => {
            if (input.key === "Escape") {
              setExpanded(false);
              return;
            }
            if (input.key === "KeyM") {
              setExpanded((v) => !v);
              return;
            }
            command?.(input);
          })
        }
        onPointerDown={(e) => {
          if (preview) return;
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan[0], py: pan[1] };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d && e.pointerType !== "touch")
            hover?.(
              hitCreature(e.currentTarget, e.clientX, e.clientY)?.id || "",
            );
          if (follow && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
            const p = party.find((q) => q.userId === me);
            stationary.current = [(p?.x ?? 12) + 0.5, (p?.y ?? 12) + 0.5];
            setFollow(false);
          }
          if (d) setPan([d.px + e.clientX - d.x, d.py + e.clientY - d.y]);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
          const creature = hitCreature(e.currentTarget, e.clientX, e.clientY);
          if (creature) {
            select?.(creature);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect(),
            { t, ox, oy } = geo.current,
            p = party.find((a) => a.userId === me);
          const tx = Math.floor((e.clientX - rect.left - ox) / t),
            ty = Math.floor((e.clientY - rect.top - oy) / t);
          const match = [...objects, ...party].find(
            (o) => o.x === tx && o.y === ty && o.userId !== me,
          );
          if (match) {
            select?.(match);
            return;
          }
          if (p?.x !== undefined && p.y !== undefined) {
            const dx = Math.floor((e.clientX - rect.left - ox) / t) - p.x,
              dy = Math.floor((e.clientY - rect.top - oy) / t) - p.y;
            if (Math.abs(dx) + Math.abs(dy) === 1) step?.(dx, dy);
          }
        }}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => hover?.("")}
      />
      <span className="compass" aria-hidden="true">
        N<br />✧
      </span>
      {!preview && (
        <div className="maptools">
          <button onClick={() => setGrid(!grid)} aria-pressed={grid}>
            Сетка
          </button>
          <button onClick={() => setExpanded(!expanded)}>
            {expanded ? "Свернуть" : "Развернуть"}
          </button>
          <button
            aria-label="Увеличить карту"
            onClick={() => setZoom(Math.min(3, zoom * 1.25))}
          >
            ＋
          </button>
          <button
            aria-label="Уменьшить карту"
            onClick={() => setZoom(Math.max(0.45, zoom / 1.25))}
          >
            −
          </button>
          <button
            onClick={() => {
              setFollow(true);
              setPan([0, 0]);
              setZoom(1);
            }}
          >
            Центр
          </button>
        </div>
      )}
    </div>
  );
}
