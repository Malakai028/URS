import { createApp } from "./app.ts";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

if (process.env.NODE_ENV === "production") {
  const origin = URL.parse(process.env.PUBLIC_ORIGIN || "");
  if (origin?.protocol !== "https:" || origin.origin !== process.env.PUBLIC_ORIGIN)
    throw Error("Для публикации требуется PUBLIC_ORIGIN вида https://game.example.org");
  if (!process.env.DATABASE_FILE || !isAbsolute(process.env.DATABASE_FILE))
    throw Error("Для публикации требуется абсолютный DATABASE_FILE на постоянном диске");
  if (!existsSync("dist/index.html"))
    throw Error("Перед публикацией выполните npm run build");
}
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error("Некорректное значение PORT");
const app = createApp();
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.close();
  } catch {
    console.error("Ошибка завершения работы URE");
    process.exitCode = 1;
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
const address = await app.listen({ host: process.env.HOST || "0.0.0.0", port });
console.log("URE " + address);
