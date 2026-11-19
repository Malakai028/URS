import { standardLook, type Look } from "../../packages/shared/phase2.ts";
export function sprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  look: Look = standardLook,
  race = "",
  armor = false,
  armed = false,
  scale = 1,
) {
  const skin = { ochre: "#dbab7e", umber: "#9e745c", ivory: "#edd0ad" }[
      look.skin
    ],
    coat = { jade: "#73ac90", plum: "#b382ac", amber: "#cea263" }[look.cloak];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const rect = (color: string, a: number, b: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(a, b, w, h);
  };
  rect("#182827", -6, 5, 4, 5);
  rect("#182827", 2, 5, 4, 5);
  rect(coat, -7, -4, 14, 11);
  rect(armor ? "#a7b9b1" : coat, -5, -4, look.shape === "warden" ? 12 : 9, 8);
  rect(skin, -5, -12, look.face === "square" ? 11 : 10, 8);
  if (race === "R-009") {
    rect(skin, -7, -11, 2, 4);
    rect(skin, 5, -11, 2, 4);
  }
  rect(
    { coal: "#2e3030", silver: "#d1d4c4", copper: "#a16443" }[look.hair],
    -5,
    -15,
    11,
    4,
  );
  rect(
    { brown: "#573b32", blue: "#455f7d", green: "#385745" }[look.eyes],
    1,
    -9,
    2,
    2,
  );
  if (look.accessory === "brooch") rect("#ffe199", 2, -2, 3, 3);
  if (look.accessory === "hood") rect(coat, -6, -16, 12, 4);
  if (armed) {
    rect("#d6dace", 7, -9, 2, 13);
    rect("#ad8756", 5, 3, 6, 2);
  }
  ctx.restore();
}
