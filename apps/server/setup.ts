import { openDb } from "./db.ts";
import { catalog } from "../../packages/content/index.ts";
const store = openDb();
if (process.argv.includes("--seed")) store.seed();
store.db.close();
console.log(
  "Схема v2 и начальные определения готовы.",
  Object.keys(catalog).join(", "),
);
