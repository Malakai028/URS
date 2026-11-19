export type Area = "field" | "vault" | "lodge" | "cave";
export type Point = { x: number; y: number };
export const creatureStepMs = 2000;
export type CreatureBehavior =
  | "idle"
  | "wander"
  | "patrol"
  | "alert"
  | "investigate"
  | "pursue"
  | "return_home"
  | "flee"
  | "dead";
export type CreatureAppearance =
  | "guardian"
  | "wolf"
  | "goblin"
  | "deer"
  | "skeleton"
  | "beast"
  | "undead"
  | "other";

export type CreatureMotion = {
  position: Point;
  facing: Point;
  behavior: CreatureBehavior;
  moved: boolean;
  routeIndex: number;
  target: string | null;
  lastSeen: Point | null;
  lastAction: "step" | "notice" | "hit" | "death" | "rest" | "strike";
  updatedAt: number;
  hp?: number;
  provokedBy?: string;
  lastAttackAt?: number;
  stepAt?: number;
};

export type CreatureView = {
  id: string;
  worldId: string;
  area: Area;
  encounterId: string;
  speciesId: string | null;
  name: string;
  individualName: string | null;
  species: string;
  category: string;
  description: string;
  level: number | null;
  tier: string | null;
  rank: string | null;
  q: number | null;
  threat: string | null;
  rarity: string | null;
  hp: number | null;
  maxHp: number | null;
  alive: boolean;
  relationship: "hostile" | "neutral";
  position: Point;
  behavior: CreatureBehavior;
  moved: boolean;
  facing: Point;
  stepMs: number | null;
  appearance: CreatureAppearance;
  dimensions: { width: number; height: number };
  condition?: "healthy" | "wounded" | "critical";
  attackable?: boolean;
  knowledgeStage?: number;
  cue?: string;
};

export type CreatureSighting = {
  firstAt: number;
  lastAt: number;
  area: Area;
  behavior: CreatureBehavior;
  identified?: boolean;
  fought?: boolean;
  ability?: string;
  victories?: string[];
};
export type CreatureJournalEntry = {
  stage: number;
  speciesId: string | null;
  name: string;
  firstAt: number;
  lastAt: number;
  area: Area;
  behavior: CreatureBehavior;
  ability?: string;
};

export type CreatureInspection = {
  creature: CreatureView;
  knowledge: "observation" | "gm";
  learned?: {
    anatomy?: string;
    ability?: string;
    mitigation?: number;
    reach?: number;
  };
  source?: Record<string, string>;
  simulation?: {
    home: Point;
    radius: number;
    route: Point[];
    profile: string;
    target: string | null;
    lastSeen: Point | null;
    lastAction: CreatureMotion["lastAction"];
    updatedAt: number;
    resistance: number | null;
    combat?: {
      aptitude: number;
      detection: number;
      damage: number;
      cooldownMs: number;
    };
  };
};

export const behaviorLabels: Record<CreatureBehavior, string> = {
  idle: "Покой",
  wander: "Бродит",
  patrol: "Патрулирует",
  alert: "Насторожилось",
  investigate: "Проверяет место",
  pursue: "Преследует",
  return_home: "Возвращается",
  flee: "Убегает",
  dead: "Мертво",
};
