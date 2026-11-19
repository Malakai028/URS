import type { KeyboardEvent } from "react";
export type Command = { move?: [number, number]; run?: boolean; key?: string };
const directions: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
export function gameKey(
  e: KeyboardEvent<HTMLCanvasElement>,
  dispatch: (c: Command) => void,
) {
  if (
    e.target !== e.currentTarget ||
    document.activeElement !== e.currentTarget ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  )
    return;
  const move = directions[e.code],
    key = e.code;
  if (!move && !/^(Enter|Space|Key[EFICKMJ]|Escape|Digit[1-9])$/.test(key)) return;
  e.preventDefault();
  e.stopPropagation();
  if (!e.repeat || move) dispatch(move ? { move, run: e.shiftKey } : { key });
}
