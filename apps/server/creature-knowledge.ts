import { atlas } from "../../packages/content/atlas.ts";
import type {
  CreatureJournalEntry,
  CreatureSighting,
  CreatureView,
} from "../../packages/shared/creatures.ts";
import type { Extra } from "../../packages/shared/phase2.ts";
import { combatProfile } from "./creature-profiles.ts";

export const journalSpecies = new Set(["B-001", "B-011", "B-036", "B-065"]);
const bestiary = new Map(atlas.bestiary.map((row) => [row.id, row]));
export function knowledgeStage(entry?: CreatureSighting) {
  if (!entry) return 0;
  if (!entry.identified) return 1;
  if ((entry.victories?.length ?? 0) >= 2) return 4;
  return entry.fought ? 3 : 2;
}

type Discovery = "seen" | "identified" | "hit" | "victory" | "ability";
export function discover(
  extra: Extra,
  creature: CreatureView,
  event: Discovery,
  now: number,
  ability?: string,
) {
  const id = creature.speciesId;
  if (!id || !journalSpecies.has(id)) return false;
  const old = extra.creatureKnowledge?.[id];
  const entry: CreatureSighting = {
    firstAt: now,
    ...old,
    lastAt: now,
    area: creature.area,
    behavior: creature.behavior,
  };
  let changed = !old;
  if (event === "identified" && !entry.identified) {
    entry.identified = true;
    changed = true;
  }
  if (["hit", "victory", "ability"].includes(event) && !entry.fought) {
    entry.fought = true;
    changed = true;
  }
  if (event === "victory") {
    const victories = entry.victories ?? [];
    if (victories.length < 2 && !victories.includes(creature.worldId)) {
      entry.victories = [...victories, creature.worldId];
      changed = true;
    }
  }
  if (event === "ability" && ability && entry.ability !== ability) {
    entry.ability = ability;
    changed = true;
  }
  if (!changed) return false;
  (extra.creatureKnowledge ??= {})[id] = entry;
  return true;
}
export function projectCreature(creature: CreatureView, extra?: Extra) {
  const id = creature.speciesId;
  if (!id || !journalSpecies.has(id)) return creature;
  const stage = knowledgeStage(extra?.creatureKnowledge?.[id]);
  const identified = stage >= 2;
  return {
    ...creature,
    knowledgeStage: stage,
    name: identified ? creature.name : "Неопознанное существо",
    species: identified ? creature.species : "Вид неизвестен",
    speciesId: identified ? id : null,
    category: identified ? creature.category : "Категория неизвестна",
    description: identified
      ? creature.description
      : "Вид можно определить наблюдением с доступной клетки.",
    hp: stage >= 3 ? creature.hp : null,
    maxHp: stage >= 3 ? creature.maxHp : null,
    stepMs: stage >= 3 ? creature.stepMs : null,
  };
}
export function learnedCreature(creature: CreatureView, extra?: Extra) {
  const id = creature.speciesId;
  const entry = id ? extra?.creatureKnowledge?.[id] : undefined;
  const stage = knowledgeStage(entry);
  const profile = combatProfile(id);
  if (stage < 3 || !profile) return undefined;
  return {
    anatomy: profile.anatomy,
    ability: entry?.ability,
    ...(stage >= 4
      ? { mitigation: profile.mitigation, reach: profile.reach }
      : {}),
  };
}
export function creatureJournal(extra: Extra): CreatureJournalEntry[] {
  return Object.entries(extra.creatureKnowledge ?? {})
    .filter(([id]) => journalSpecies.has(id))
    .map(([id, entry]) => {
      const stage = knowledgeStage(entry);
      return {
        stage,
        speciesId: stage >= 2 ? id : null,
        name:
          stage >= 2 ? (bestiary.get(id)?.name ?? id) : "Неопознанное существо",
        firstAt: entry.firstAt,
        lastAt: entry.lastAt,
        area: entry.area,
        behavior: entry.behavior,
        ability: stage >= 3 ? entry.ability : undefined,
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}
