import { pack } from "./content/pack";
import { hasRule } from "./helpers";
import type { PassportColor } from "./ids";
import { PASSPORT_COLORS } from "./ids";
import type { World } from "./state";

/** Checks physical piece conservation, card conservation, bounds, and state integrity. Empty array = clean. */
export function violations(world: World): string[] {
  const errs: string[] = [];
  const c = world.campaign;

  if (c.funding < 1 || c.funding > 10) {
    errs.push(`Funding out of bounds [1..10]: ${c.funding}`);
  }
  if (c.month < 0 || c.month > 12) {
    errs.push(`Campaign month out of bounds [0..12]: ${c.month}`);
  }
  for (const city of pack.cities) {
    const cc = c.cities[city.id];
    if (cc.surveillance < 0 || cc.surveillance > 3) {
      errs.push(`Campaign surveillance out of bounds [0..3] in ${city.id}: ${cc.surveillance}`);
    }
    if (cc.exposedIntensity !== null && (cc.exposedIntensity < 0 || cc.exposedIntensity > 3)) {
      errs.push(`Exposed intensity out of bounds [0..3] in ${city.id}: ${cc.exposedIntensity}`);
    }
  }
  for (const color of PASSPORT_COLORS) {
    const p = c.passports[color as PassportColor];
    for (const aff of ["allied", "neutral", "soviet"] as const) {
      const al = p.aliases[aff];
      if (al.coverScratched < 0 || al.coverScratched > al.coverTrack.length) {
        errs.push(`Cover scratched out of bounds on ${color}/${aff}: ${al.coverScratched}/${al.coverTrack.length}`);
      }
      if (al.assets.length > 3) {
        errs.push(`More than 3 assets on ${color}/${aff}: ${al.assets.length}`);
      }
      if (al.liabilities.length > 2) {
        errs.push(`More than 2 liabilities on ${color}/${aff}: ${al.liabilities.length}`);
      }
    }
  }

  const game = world.game;
  if (!game) return errs;

  // Piece conservation
  let agentsOnBoard = 0;
  let cubesOnBoard = 0;
  let safehousesOnBoard = 0;
  let incOutOnBoard = 0;
  let pursuitOnBoard = 0;

  for (const city of pack.cities) {
    const loc = game.locations[city.id];
    if (loc.agents < 0 || loc.agents > 3) {
      errs.push(`Agents in ${city.id} out of bounds [0..3]: ${loc.agents}`);
    }
    if (loc.diseaseCubes < 0 || loc.diseaseCubes > 3) {
      errs.push(`Disease cubes in ${city.id} out of bounds [0..3]: ${loc.diseaseCubes}`);
    }
    if (loc.incidents < 0) errs.push(`Negative incidents in ${city.id}: ${loc.incidents}`);
    if (loc.outbreaks < 0) errs.push(`Negative outbreaks in ${city.id}: ${loc.outbreaks}`);
    agentsOnBoard += loc.agents;
    cubesOnBoard += loc.diseaseCubes;
    if (loc.safehouse) safehousesOnBoard += 1;
    incOutOnBoard += loc.incidents + loc.outbreaks;
    if (loc.pursuit) pursuitOnBoard += 1;
  }

  if (agentsOnBoard + game.supplies.agents !== pack.supplies.agents) {
    errs.push(
      `Agent conservation failed: board(${agentsOnBoard}) + supply(${game.supplies.agents}) !== ${pack.supplies.agents}`,
    );
  }
  if (safehousesOnBoard + game.supplies.safehouses !== pack.supplies.safehouses) {
    errs.push(
      `Safehouse conservation failed: board(${safehousesOnBoard}) + supply(${game.supplies.safehouses}) !== ${pack.supplies.safehouses}`,
    );
  }
  if (incOutOnBoard + game.supplies.incidentOutbreakTokens !== pack.supplies.incidentOutbreakTokens) {
    errs.push(
      `Incident/Outbreak token conservation failed: board(${incOutOnBoard}) + supply(${game.supplies.incidentOutbreakTokens}) !== ${pack.supplies.incidentOutbreakTokens}`,
    );
  }
  if (cubesOnBoard + game.supplies.diseaseCubes !== c.diseaseCubeSupplyMax) {
    errs.push(
      `Disease cube conservation failed: board(${cubesOnBoard}) + supply(${game.supplies.diseaseCubes}) !== ${c.diseaseCubeSupplyMax}`,
    );
  }
  if (hasRule(c, "E")) {
    const playerTokens = game.seats.reduce((acc, s) => acc + game.players[s].actionTokens, 0);
    if (playerTokens + game.supplies.actionTokens !== pack.supplies.actionTokens) {
      errs.push(
        `Action token conservation failed: players(${playerTokens}) + supply(${game.supplies.actionTokens}) !== ${pack.supplies.actionTokens}`,
      );
    }
  }
  if (hasRule(c, "K")) {
    if (pursuitOnBoard + game.supplies.pursuitTokens !== pack.supplies.pursuitTokens) {
      errs.push(
        `Pursuit token conservation failed: board(${pursuitOnBoard}) + supply(${game.supplies.pursuitTokens}) !== ${pack.supplies.pursuitTokens}`,
      );
    }
  }
  if (hasRule(c, "N")) {
    if (game.checkpoints.length + game.supplies.checkpointTokens !== pack.supplies.checkpointTokens) {
      errs.push(
        `Checkpoint conservation failed: board(${game.checkpoints.length}) + supply(${game.supplies.checkpointTokens}) !== ${pack.supplies.checkpointTokens}`,
      );
    }
  }
  if (hasRule(c, "D")) {
    if (game.satellites.length + game.supplies.satellites !== pack.supplies.satellites) {
      errs.push(
        `Satellite conservation failed: board(${game.satellites.length}) + supply(${game.supplies.satellites}) !== ${pack.supplies.satellites}`,
      );
    }
  }
  if (hasRule(c, "H")) {
    const handSymptoms = game.seats.reduce(
      (acc, s) =>
        acc + game.players[s].hand.filter((id) => game.playerCards[id]?.kind === "symptom").length,
      0,
    );
    if (handSymptoms + game.supplies.symptoms.length !== pack.symptomNames.length) {
      errs.push(
        `Symptom conservation failed: hands(${handSymptoms}) + supply(${game.supplies.symptoms.length}) !== ${pack.symptomNames.length}`,
      );
    }
  }

  // Player card uniqueness across deck, discard, hands, objective hidden/trial slots
  if (Object.keys(game.playerCards).length > 0) {
    const seen = new Map<string, string>();
    const mark = (id: string, where: string) => {
      if (seen.has(id)) {
        errs.push(`Duplicate player card ${id} in ${seen.get(id)} and ${where}`);
      } else {
        seen.set(id, where);
      }
      if (!game.playerCards[id]) {
        errs.push(`Unknown player card ${id} in ${where}`);
      }
    };
    for (const id of game.playerDeck) mark(id, "playerDeck");
    for (const id of game.playerDiscard) mark(id, "playerDiscard");
    for (const s of game.seats) {
      for (const id of game.players[s].hand) mark(id, `hand:${s}`);
    }
    for (const obj of game.objectives) {
      if (obj.hiddenCardId) mark(obj.hiddenCardId, `obj:${obj.id}:hidden`);
      for (const id of obj.trialCardIds) mark(id, `obj:${obj.id}:trial`);
    }
  }

  // Threat card uniqueness across threatDeck, threatDiscard, gameEndArea
  const threatSeen = new Map<string, string>();
  const markThreat = (id: string, where: string) => {
    if (threatSeen.has(id)) {
      errs.push(`Duplicate threat card ${id} in ${threatSeen.get(id)} and ${where}`);
    } else {
      threatSeen.set(id, where);
    }
  };
  for (const t of game.threatDeck) markThreat(t.id, "threatDeck");
  for (const t of game.threatDiscard) markThreat(t.id, "threatDiscard");
  for (const t of game.gameEndArea) markThreat(t.id, "gameEndArea");

  // Upkeep bounds
  if (game.upkeep && game.upkeep.spent > game.upkeep.budget) {
    errs.push(`Upkeep overspent: ${game.upkeep.spent} > ${game.upkeep.budget}`);
  }

  if (game.actionsLeft < 0) {
    errs.push(`Negative actionsLeft: ${game.actionsLeft}`);
  }

  return errs;
}
