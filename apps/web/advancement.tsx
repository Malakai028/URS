import React, { useState } from "react";
import type { Character } from "../../packages/shared/index.ts";
import { skills } from "../../packages/shared/phase2.ts";
import {
  attributes,
  energyAfterLevel,
} from "../../packages/engine/attributes.ts";
import { getMilestoneRewards } from "../../packages/engine/index.ts";

export function Advancement({
  character,
  cost,
}: {
  character: Character;
  cost: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Что даст уровень {character.level + 1}</summary>
      {open && <LevelComparison character={character} cost={cost} />}
    </details>
  );
}

function LevelComparison({
  character,
  cost,
}: {
  character: Character;
  cost: string;
}) {
  const level = character.level + 1;
  const raised = {
    ...character,
    level,
    ...energyAfterLevel(character.maxEnergy),
  };
  const before = attributes(character);
  const after = attributes(raised);
  const balance = BigInt(character.xp) - BigInt(cost);
  const unlocked = Object.values(skills).filter(
    ([, , , required]) => required === level,
  );
  const milestones = getMilestoneRewards(level).filter(
    (node) => node !== "base",
  );
  return (
    <>
      <p>
        Стоимость {cost} XP.{" "}
        {balance < 0n
          ? `Не хватает ${-balance} XP.`
          : `После оплаты останется ${balance} XP.`}
      </p>
      <dl aria-label="Характеристики до и после повышения">
        {["strength", "carry", "perception"].map((key) => (
          <div key={key}>
            <dt>{before[key].label}</dt>
            <dd>
              {before[key].current} → {after[key].current} {after[key].unit}
            </dd>
          </div>
        ))}
        <div>
          <dt>Силы</dt>
          <dd>
            {character.energy}/{character.maxEnergy} → {raised.energy}/
            {raised.maxEnergy}
          </dd>
        </div>
      </dl>
      {unlocked.length > 0 && (
        <p>
          Откроется способность: {unlocked.map(([label]) => label).join(", ")}.
        </p>
      )}
      {milestones.length > 0 && (
        <p>
          В истории развития будут отмечены рубежи: {milestones.join(", ")}.
        </p>
      )}
    </>
  );
}
