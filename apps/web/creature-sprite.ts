import type { CreatureView } from "../../packages/shared/creatures.ts";

export function creatureSprite(
  ctx: CanvasRenderingContext2D,
  creature: CreatureView,
  x: number,
  y: number,
  scale: number,
  stride = 0,
  hit = false,
) {
  const { appearance, alive, facing, dimensions } = creature;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(
    scale * dimensions.width * (facing.x < 0 ? -1 : 1),
    scale * dimensions.height,
  );
  if (!alive) {
    ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = 0.65;
  } else ctx.rotate(facing.y * 0.12);
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#162322";
  const shape = (fill: string, points: number[]) => {
    ctx.fillStyle = hit ? "#f69278" : fill;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2)
      ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  const legs = alive ? stride : 0;
  if (
    appearance === "wolf" ||
    appearance === "deer" ||
    appearance === "beast"
  ) {
    const deer = appearance === "deer";
    const fur = deer ? "#b68b65" : "#939f9f";
    const shade = deer ? "#74533c" : "#566771";
    for (const [position, step] of [
      [-8, legs],
      [-4, -legs],
      [3, -legs],
      [7, legs],
    ]) {
      const foot = deer ? 9 : 7;
      shape(shade, [
        position - 1,
        -2,
        position + 2,
        -2,
        position + step + 1,
        foot,
        position + step - 1,
        foot,
      ]);
    }
    shape(
      shade,
      deer ? [-10, -4, -15, -8, -13, -2] : [-9, -4, -17, -7, -15, -1, -9, 0],
    );
    shape(fur, [-11, -5, -2, -8, 6, -7, 10, -3, 6, 2, -8, 2]);
    shape(
      fur,
      deer
        ? [3, -5, 7, -15, 13, -15, 16, -11, 12, -8, 8, -3]
        : [4, -5, 8, -12, 12, -8, 16, -6, 15, -2, 9, -1],
    );
    shape("#e7e1c3", [12, -8, 14, -8, 13, -6]);
    if (deer) {
      shape("#8fe4d8", [8, -15, 6, -23, 10, -20, 12, -24, 12, -16]);
      shape("#aedef1", [12, -15, 13, -21, 15, -18, 16, -22, 16, -16]);
    }
  } else if (appearance === "guardian") {
    shape("#65787b", [-8, 0, -2, 0, -2 + legs, 10, -9 + legs, 10]);
    shape("#465c66", [1, 0, 8, 0, 8 - legs, 10, 1 - legs, 10]);
    shape("#5fa4ad", [-12, -11, -7, -16, 6, -16, 12, -10, 8, 3, -7, 3]);
    shape("#a5ead7", [-6, -15, 0, -20, 6, -15, 4, -5, -3, -5]);
    shape("#d7b77c", [2, -8, 6, -6, 2, -1, -2, -6]);
    shape("#424c68", [7, -7, 15, -8, 14, 2, 10, 6, 6, 1]);
  } else if (appearance === "skeleton" || appearance === "undead") {
    shape("#cdc2a0", [-5, 0, -2, 0, -2 + legs, 10, -5 + legs, 10]);
    shape("#cdc2a0", [2, 0, 5, 0, 5 - legs, 10, 2 - legs, 10]);
    shape("#d6caba", [-8, -10, -5, -9, -7, 3, -10, 3]);
    shape("#d6caba", [6, -10, 9, -11, 11, 2, 8, 2]);
    shape("#f1e8c8", [-6, -10, 6, -10, 5, -2, 0, 1, -5, -2]);
    shape("#5e544b", [-4, -8, 4, -8, 3, -5, -3, -5]);
    shape("#eee3c5", [-6, -15, -4, -20, 4, -20, 7, -16, 4, -10, -3, -10]);
    shape("#384844", [-4, -16, 4, -16, 3, -13, -3, -13]);
  } else if (appearance === "goblin") {
    shape("#544a3f", [-7, 0, -2, 0, -2 + legs, 9, -7 + legs, 9]);
    shape("#544a3f", [2, 0, 6, 0, 7 - legs, 9, 2 - legs, 9]);
    shape("#805036", [-10, -6, -4, -12, 5, -12, 10, -4, 7, 4, -7, 4]);
    shape(
      "#a2b269",
      [
        -6, -15, -13, -18, -9, -11, -4, -10, 0, -8, 6, -10, 12, -17, 5, -15, 2,
        -18, -3, -18,
      ],
    );
    shape("#e2b567", [1, -14, 5, -14, 4, -12]);
    shape("#c79272", [-8, -5, 4, 1, 6, 3, -8, 1]);
  } else {
    shape(
      "#9886a8",
      [-11, 6, -12, -4, -4, -13, 3, -14, 11, -6, 12, 5, 5, 2, 0, 8, -6, 3],
    );
    shape("#e8dac8", [-4, -6, 7, -7, 4, -3, -2, -3]);
  }
  ctx.restore();
}
