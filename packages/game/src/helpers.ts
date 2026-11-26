import { pack } from "./content/pack";
import type { CityDef, InfiltrationEdgeDef } from "./content/pack";
import type {
  Affiliation,
  AssetId,
  CardId,
  CityId,
  InfiltrationSiteId,
  LiabilityId,
  OccupationId,
  PassportColor,
  PearlDoorNumber,
  RegionId,
  RestrictionId,
  RoomId,
  RuleId,
  SeatId,
  SecuritySymbol,
  SpecializationId,
  TeamId,
} from "./ids";
import type {
  AliasPage,
  AttachedAsset,
  Campaign,
  Game,
  LogInput,
  PlayerCard,
  ReadingKind,
  TeamPiece,
  World,
} from "./state";

export function cityDef(id: CityId): CityDef {
  return pack.cityById[id];
}

export function hasRule(campaign: Campaign, rule: RuleId): boolean {
  return campaign.rules.includes(rule);
}

export function log(game: Game, entry: LogInput): void {
  game.log.push({ seq: game.nextSeq++, ...entry } as Game["log"][number]);
}

export function pushReading(
  world: World,
  kind: ReadingKind,
  ref: string,
  title: string,
  text: string,
): number {
  const id = world.campaign.nextReadingId++;
  world.campaign.readings.push({
    id,
    kind,
    ref,
    title,
    text,
    month: world.campaign.month,
    gameIndex: world.campaign.results.length,
  });
  if (world.game) {
    log(world.game, { t: "reading", readingId: id, kind, ref, title });
  }
  return id;
}

export function canonicalEdge(a: CityId, b: CityId): [CityId, CityId] {
  return a < b ? [a, b] : [b, a];
}

export function hasCheckpoint(game: Game, a: CityId, b: CityId): boolean {
  const [x, y] = canonicalEdge(a, b);
  return game.checkpoints.some(([ca, cb]) => ca === x && cb === y);
}

export function areAdjacent(a: CityId, b: CityId): boolean {
  return cityDef(a).connections.includes(b);
}

/** Shortest hop distance between two cities on the world map. */
export function cityDistance(from: CityId, to: CityId): number {
  if (from === to) return 0;
  const visited = new Set<CityId>([from]);
  const queue: [CityId, number][] = [[from, 0]];
  let head = 0;
  while (head < queue.length) {
    const [cur, dist] = queue[head++]!;
    for (const next of cityDef(cur).connections) {
      if (next === to) return dist + 1;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, dist + 1]);
      }
    }
  }
  return Infinity;
}

/** Cities reachable within 1..maxSteps hops (excluding origin). */
export function citiesWithin(from: CityId, maxSteps: number): CityId[] {
  const visited = new Set<CityId>([from]);
  const result: CityId[] = [];
  const queue: [CityId, number][] = [[from, 0]];
  let head = 0;
  while (head < queue.length) {
    const [cur, dist] = queue[head++]!;
    if (dist >= maxSteps) continue;
    for (const next of cityDef(cur).connections) {
      if (!visited.has(next)) {
        visited.add(next);
        result.push(next);
        queue.push([next, dist + 1]);
      }
    }
  }
  return result;
}

export function activeAliasOf(world: World, seat: SeatId): AliasPage | null {
  const player = world.game?.players[seat];
  if (!player || !player.passport || !player.activeAlias) return null;
  return world.campaign.passports[player.passport].aliases[player.activeAlias];
}

export function currentOccupation(world: World, seat: SeatId): OccupationId | null {
  const player = world.game?.players[seat];
  if (!player) return null;
  if (player.tempAlias) return player.tempAlias;
  return activeAliasOf(world, seat)?.occupation ?? null;
}

export function currentSpecialization(world: World, seat: SeatId): SpecializationId | null {
  return activeAliasOf(world, seat)?.specialization ?? null;
}

export function activeAssets(world: World, seat: SeatId): AttachedAsset[] {
  const alias = activeAliasOf(world, seat);
  if (!alias) return [];
  return alias.assets.filter((a) => !a.dead);
}

export function hasAsset(world: World, seat: SeatId, id: AssetId): boolean {
  return activeAssets(world, seat).some((a) => a.id === id);
}

export function findAsset(world: World, seat: SeatId, id: AssetId): AttachedAsset | undefined {
  return activeAssets(world, seat).find((a) => a.id === id);
}

export function hasLiability(world: World, seat: SeatId, id: LiabilityId): boolean {
  const alias = activeAliasOf(world, seat);
  if (!alias) return false;
  return alias.liabilities.some((l) => l.id === id);
}

export function liabilityRegion(world: World, seat: SeatId, id: LiabilityId): RegionId | null {
  const alias = activeAliasOf(world, seat);
  if (!alias) return null;
  return alias.liabilities.find((l) => l.id === id)?.region ?? null;
}

export function isRestrictionActive(game: Game, id: RestrictionId): boolean {
  return game.activeRestrictions.includes(id) && game.ignoredRestrictionThisTurn !== id;
}

export function isTeamActive(team: TeamPiece): boolean {
  if (!team.city) return false;
  return cityDef(team.city).affiliation === team.affiliation;
}

export function activeTeamsInCity(game: Game, city: CityId): TeamPiece[] {
  return Object.values(game.teams).filter((t) => t.city === city && isTeamActive(t));
}

export function teamsInCity(game: Game, city: CityId): TeamPiece[] {
  return Object.values(game.teams).filter((t) => t.city === city);
}

export function effectiveSurveillance(world: World, city: CityId): number {
  const base = world.campaign.cities[city].surveillance;
  const sat = world.game?.satellites.includes(cityDef(city).region) ? 1 : 0;
  return Math.min(3, base + sat);
}

export function handLimit(world: World, seat: SeatId): number {
  return 7 + (hasAsset(world, seat, "prescription-pills") ? 1 : 0);
}

export function isSymptomCard(game: Game, cardId: CardId): boolean {
  return game.playerCards[cardId]?.kind === "symptom";
}

export function isCityCard(
  game: Game,
  cardId: CardId,
): game is Game & { playerCards: Record<CardId, Extract<PlayerCard, { kind: "city" }>> } {
  return game.playerCards[cardId]?.kind === "city";
}

export function cityOfCard(game: Game, cardId: CardId): CityId | null {
  const card = game.playerCards[cardId];
  return card?.kind === "city" ? card.city : null;
}

export function discardableHandCards(game: Game, seat: SeatId): CardId[] {
  return game.players[seat].hand.filter((id) => !isSymptomCard(game, id));
}

export function cityCardsInHand(game: Game, seat: SeatId): CardId[] {
  return game.players[seat].hand.filter((id) => game.playerCards[id]?.kind === "city");
}

export function seatsOverHandLimit(world: World): SeatId[] {
  const game = world.game;
  if (!game) return [];
  return game.seats.filter((seat) => {
    const hand = game.players[seat].hand;
    return hand.length > handLimit(world, seat) && discardableHandCards(game, seat).length > 0;
  });
}

export function ensureHandLimitDecisions(world: World): void {
  const game = world.game;
  if (!game) return;
  for (const seat of seatsOverHandLimit(world)) {
    const already = game.pending.some((d) => d.t === "hand-limit" && d.seat === seat);
    if (!already) {
      game.pending.unshift({ t: "hand-limit", seat });
    }
  }
}

export function discardFromHand(game: Game, seat: SeatId, cardId: CardId): void {
  const hand = game.players[seat].hand;
  const idx = hand.indexOf(cardId);
  if (idx === -1) throw new Error(`Card ${cardId} not in ${seat} hand`);
  hand.splice(idx, 1);
  const card = game.playerCards[cardId];
  if (card?.kind === "symptom") {
    game.supplies.symptoms.push(card.name);
    log(game, { t: "symptom", seat, action: "returned", name: card.name });
  } else {
    game.playerDiscard.push(cardId);
  }
}

export function giveSymptomCard(world: World, seat: SeatId): boolean {
  const game = world.game;
  if (!game || game.supplies.symptoms.length === 0) return false;
  const name = game.supplies.symptoms.shift()!;
  const id = `symptom-${game.nextSeq++}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  game.playerCards[id] = { id, kind: "symptom", name };
  game.players[seat].hand.push(id);
  log(game, { t: "symptom", seat, action: "gained", name });
  return true;
}

export function returnAllSymptoms(game: Game, seat: SeatId): number {
  const player = game.players[seat];
  const symptoms = player.hand.filter((id) => isSymptomCard(game, id));
  for (const id of symptoms) {
    discardFromHand(game, seat, id);
  }
  return symptoms.length;
}

export function giveActionTokens(game: Game, seat: SeatId, count: number): number {
  const given = Math.min(count, game.supplies.actionTokens);
  if (given <= 0) return 0;
  game.supplies.actionTokens -= given;
  game.players[seat].actionTokens += given;
  return given;
}

export function markUnknownElimination(world: World, city: CityId): void {
  const game = world.game;
  if (!game) return;
  for (const obj of game.objectives) {
    if (obj.kind !== "unknown-city" || obj.status !== "active" || obj.targetRevealed) continue;
    const def = cityDef(city);
    const hasFilter = Boolean(obj.unknownRegion || obj.unknownAffiliation || obj.unknownControlCentersOnly);
    if (!hasFilter) continue;
    const matches =
      (!obj.unknownRegion || def.region === obj.unknownRegion) &&
      (!obj.unknownAffiliation || def.affiliation === obj.unknownAffiliation) &&
      (!obj.unknownControlCentersOnly || world.campaign.cities[city].controlCenter);
    if (matches && !obj.eliminatedCities.includes(city)) {
      obj.eliminatedCities.push(city);
    }
  }
}

/** Moves a team piece to `to`, automatically removing a Pursuit token if the team is active there (Rule K). */
export function moveTeam(world: World, teamId: TeamId, to: CityId, by: string): void {
  const game = world.game!;
  const team = game.teams[teamId]!;
  const from = team.city;
  team.city = to;
  log(game, { t: "team-move", team: teamId, from, to, by });
  if (hasRule(world.campaign, "K") && isTeamActive(team) && game.locations[to].pursuit) {
    game.locations[to].pursuit = false;
    game.supplies.pursuitTokens += 1;
    log(game, {
      t: "pursuit",
      detail: `Active ${team.affiliation} team (${teamId}) removed Pursuit token in ${cityDef(to).name}`,
    });
  }
}

export function checkPursuitComplete(world: World): boolean {
  const game = world.game;
  if (!game) return false;
  const pursuitObj = game.objectives.find((o) => o.kind === "pursuit" && o.status === "active");
  if (!pursuitObj) return false;
  const anyLeft = Object.values(game.locations).some((loc) => loc.pursuit);
  return !anyLeft;
}

/**
 * Handles moving a player's pawn into `to`, firing all entry effects:
 * - Disease cubes (Rule H) & Contamination (Rule J) Symptom cards (skipped when exiting an infiltration site per Rule P)
 * - Red Army Doctor (return all Symptoms on entering Soviet city)
 * - Army Doctor contact (return all Symptoms on entering contact's city)
 * - Street Cleaner (remove all agents on entering Soviet city)
 * - Cover of Darkness (remove 1 agent when active player drives/ferries)
 * - Transport Crew (move carried teams along)
 */
export function enterCity(
  world: World,
  seat: SeatId,
  to: CityId,
  options: {
    by: string;
    fromInfiltration?: boolean;
    carryTeams?: TeamId[];
  },
): void {
  const game = world.game!;
  const player = game.players[seat];
  const from = player.location;
  player.location = to;
  log(game, { t: "move", seat, from, to, by: options.by });

  const loc = game.locations[to];
  const cCity = world.campaign.cities[to];

  if (!options.fromInfiltration) {
    if (hasRule(world.campaign, "H") && loc.diseaseCubes > 0) {
      giveSymptomCard(world, seat);
    }
    if (hasRule(world.campaign, "J") && cCity.contaminated) {
      giveSymptomCard(world, seat);
    }
  }

  // Red Army Doctor: when entering a Soviet city, return all Symptom cards
  if (currentOccupation(world, seat) === "red-army-doctor" && cityDef(to).affiliation === "soviet") {
    returnAllSymptoms(game, seat);
  }
  // Army Doctor contact: when entering Army Doctor's city, return all Symptom cards
  const armyDoc = findAsset(world, seat, "army-doctor");
  if (armyDoc && armyDoc.city === to) {
    returnAllSymptoms(game, seat);
  }
  // Street Cleaner: when entering a Soviet city, remove all agents from that city
  if (currentOccupation(world, seat) === "street-cleaner" && cityDef(to).affiliation === "soviet") {
    if (loc.agents > 0) {
      game.supplies.agents += loc.agents;
      log(game, {
        t: "note",
        text: `Street Cleaner removed ${loc.agents} agent(s) on entering ${cityDef(to).name}`,
      });
      loc.agents = 0;
    }
  }
  // Cover of Darkness: remove 1 agent from each city active player drives/ferries to
  if (options.by === "drive" && game.coverOfDarknessActive && seat === game.active && loc.agents > 0) {
    loc.agents -= 1;
    game.supplies.agents += 1;
    log(game, {
      t: "note",
      text: `Cover of Darkness removed 1 agent in ${cityDef(to).name}`,
    });
  }

  // Transport Crew: carry chosen teams with you
  if (options.carryTeams?.length) {
    for (const teamId of options.carryTeams) {
      moveTeam(world, teamId, to, "transport-crew");
    }
  }

  ensureHandLimitDecisions(world);
}

/** Can this seat mitigate 1 cover loss via Suitcase Full of Money or Collective Manager? */
export function canMitigateCover(world: World, seat: SeatId): {
  suitcase: boolean;
  collectiveManager: boolean;
} {
  const game = world.game;
  if (!game) return { suitcase: false, collectiveManager: false };
  const alias = activeAliasOf(world, seat);
  if (!alias || alias.burned) return { suitcase: false, collectiveManager: false };
  const suitcaseAsset = findAsset(world, seat, "suitcase-full-of-money");
  const suitcase = Boolean(suitcaseAsset && suitcaseAsset.boxesChecked < 3);
  const collectiveManager =
    currentOccupation(world, seat) === "collective-manager" &&
    cityCardsInHand(game, seat).length > 0;
  return { suitcase, collectiveManager };
}

/**
 * Queues `count` cover losses for `seat`. Resolves immediately when no interactive choice is needed;
 * pauses with `cover-mitigation`, `discard-card`, or `choose-liability` when player input is required.
 */
export function queueCoverLoss(world: World, seat: SeatId, count: number, source: string): void {
  const game = world.game;
  if (!game || count <= 0) return;
  game.coverQueue.push({ seat, remaining: count, source });
  drainCoverQueue(world);
}

/** Immediately burns `seat`'s active alias per rulebook p. 7. */
export function burnActiveAlias(world: World, seat: SeatId): void {
  const game = world.game!;
  const player = game.players[seat];
  if (!player.passport || !player.activeAlias) return;
  const passportColor = player.passport;
  const affiliation = player.activeAlias;
  const alias = world.campaign.passports[passportColor].aliases[affiliation];
  alias.burned = true;

  log(game, { t: "burned", seat, passport: passportColor, alias: affiliation });

  // Discard all cards in hand (symptoms return to supply, others to Player discard)
  while (player.hand.length > 0) {
    discardFromHand(game, seat, player.hand[0]!);
  }
  // Lose any remaining actions if it is currently this player's turn
  if (game.active === seat) {
    game.actionsLeft = 0;
  }
  // Leave infiltration site if inside one, and move pawn to Washington (no symptom triggers? Wait: if Washington has cubes/contamination? Rulebook says "move your pawn to Washington" — use enterCity? Wait: exiting burn shouldn't trap in infiltration)
  const from = player.location;
  player.infiltration = null;
  player.location = "washington";
  log(game, { t: "move", seat, from, to: "washington", by: "burned" });

  // Return passport to reserve; player will pick a Temporary Alias at the start of their next turn
  player.passport = null;
  player.activeAlias = null;
  player.tempAlias = null;
  player.needsTempAlias = true;
}

/** Performs 1 actual scratch on `seat`'s active alias (after any mitigation choice was declined). */
export function scratchOneCoverNow(world: World, seat: SeatId, source: string): void {
  const game = world.game!;
  const player = game.players[seat];

  // Temporary alias (Prologue or post-burn): discard 1 card instead of scratching cover
  if (player.tempAlias) {
    const discardable = discardableHandCards(game, seat);
    if (discardable.length === 0) {
      log(game, { t: "cover", seat, result: "temp-no-cards", source });
    } else if (discardable.length === 1) {
      discardFromHand(game, seat, discardable[0]!);
      log(game, { t: "cover", seat, result: "temp-discard", source });
    } else {
      log(game, { t: "cover", seat, result: "temp-discard-choice", source });
      game.pending.unshift({ t: "discard-card", seat, remaining: 1, source });
    }
    return;
  }

  // Already burned and awaiting temp alias on next turn: nothing to scratch
  const alias = activeAliasOf(world, seat);
  if (!alias || alias.burned) return;

  if (alias.coverScratched >= alias.coverTrack.length) {
    burnActiveAlias(world, seat);
    return;
  }

  const pip = alias.coverTrack[alias.coverScratched]!;
  alias.coverScratched += 1;
  log(game, { t: "cover", seat, result: pip, source });

  if (pip === "empty") return;
  if (pip === "discard") {
    const discardable = discardableHandCards(game, seat);
    if (discardable.length === 1) {
      discardFromHand(game, seat, discardable[0]!);
    } else if (discardable.length > 1) {
      game.pending.unshift({ t: "discard-card", seat, remaining: 1, source: `cover-pip:${source}` });
    }
    return;
  }
  if (pip === "liability") {
    if (alias.liabilities.length < 2 && world.campaign.availableLiabilities.length > 0) {
      game.pending.unshift({
        t: "choose-liability",
        seat,
        region: cityDef(player.location).region,
      });
    }
    return;
  }
  if (pip === "burned") {
    burnActiveAlias(world, seat);
  }
}

/** Drains `game.coverQueue` until empty or an interactive decision is pushed to `game.pending`. */
export function drainCoverQueue(world: World): void {
  const game = world.game;
  if (!game) return;
  while (game.coverQueue.length > 0 && game.pending.length === 0) {
    const head = game.coverQueue[0]!;
    if (head.remaining <= 0) {
      game.coverQueue.shift();
      continue;
    }
    const player = game.players[head.seat];
    // If the player was already burned earlier in the same burst, cancel remaining scratches on that burned alias
    if (!player.tempAlias && (!player.passport || !player.activeAlias)) {
      game.coverQueue.shift();
      continue;
    }
    const mit = canMitigateCover(world, head.seat);
    if (mit.suitcase || mit.collectiveManager) {
      head.remaining -= 1;
      const more = head.remaining;
      if (head.remaining === 0) game.coverQueue.shift();
      game.pending.unshift({
        t: "cover-mitigation",
        seat: head.seat,
        source: head.source,
        more,
      });
      return;
    }
    head.remaining -= 1;
    if (head.remaining === 0) game.coverQueue.shift();
    scratchOneCoverNow(world, head.seat, head.source);
  }
}

/** Direct cover scratch on a specific passport alias outside normal turn coverQueue (e.g. Debrief 192 / 231). */
export function scratchAliasCoverDirect(
  world: World,
  passport: PassportColor,
  affiliation: Affiliation,
  source: string,
): void {
  const alias = world.campaign.passports[passport].aliases[affiliation];
  if (!alias.created || alias.burned) return;
  // If this alias is currently active on a seated player, go through the normal seat cover queue!
  if (world.game) {
    const seated = world.game.seats.find((s) => {
      const p = world.game!.players[s];
      return p.passport === passport && p.activeAlias === affiliation;
    });
    if (seated) {
      queueCoverLoss(world, seated, 1, source);
      return;
    }
  }
  if (alias.coverScratched >= alias.coverTrack.length) return;
  const pip = alias.coverTrack[alias.coverScratched]!;
  alias.coverScratched += 1;
  if (world.game) {
    log(world.game, {
      t: "note",
      text: `${alias.name || `${passport} ${affiliation}`} scratched 1 cover (${pip}) from ${source}`,
    });
  }
  if (pip === "burned") {
    alias.burned = true;
  } else if (pip === "liability" && alias.liabilities.length < 2 && world.campaign.availableLiabilities.length > 0) {
    // Inactive alias gained a liability from debrief: assign the first non-region liability (or mark Washington's region)
    const lib = world.campaign.availableLiabilities.shift()!;
    const def = pack.liabilityById[lib];
    alias.liabilities.push({ id: lib, region: def.needsRegion ? "north-america" : null });
  }
}

// ============================================================================
// Infiltration & Security Token helpers
// ============================================================================

export function edgesOfRoom(site: InfiltrationSiteId, room: RoomId): InfiltrationEdgeDef[] {
  return pack.sites[site].edges.filter((e) => e.a === room || e.b === room);
}

export function otherRoom(edge: InfiltrationEdgeDef, from: RoomId): RoomId {
  return edge.a === from ? edge.b : edge.a;
}

export function findInfiltrationEdge(
  site: InfiltrationSiteId,
  from: RoomId,
  to: RoomId,
): InfiltrationEdgeDef | undefined {
  return pack.sites[site].edges.find(
    (e) => (e.a === from && e.b === to) || (e.a === to && e.b === from),
  );
}

export function isRoomDiscovered(campaign: Campaign, site: InfiltrationSiteId, room: RoomId): boolean {
  if (site !== "pearl") return true;
  const door = pack.roomById[room].pearlDoor;
  return door !== undefined && campaign.pearlOpenedDoors.includes(door);
}

/** Reveals all facedown security tokens on walls adjacent to `room`. */
export function revealAdjacentSecurityTokens(
  game: Game,
  site: InfiltrationSiteId,
  room: RoomId,
): number {
  const active = game.infiltrationSites[site];
  if (!active) return 0;
  const adjEdgeIds = new Set(edgesOfRoom(site, room).map((e) => e.id));
  let revealedCount = 0;
  for (const tok of active.tokens) {
    if (adjEdgeIds.has(tok.edgeId) && !tok.revealed) {
      tok.revealed = true;
      revealedCount += 1;
    }
  }
  return revealedCount;
}

export function formatSecuritySymbol(sym: SecuritySymbol): string {
  if (sym.kind === "keypad") return `#${sym.value}`;
  if (sym.kind === "region") return pack.regionNames[sym.region];
  return sym.affiliation.toUpperCase();
}

/**
 * Checks whether revealing `cards` satisfies all `required` security symbols.
 * - Before Rule R: each revealed card can satisfy at most 1 symbol.
 * - With Rule R: one card can satisfy up to 1 keypad, 1 region, AND 1 affiliation symbol simultaneously.
 * - With Portable Computing Device: keypad numbers may be ±1 of the required number.
 */
export function canSatisfySecurityTokens(
  world: World,
  seat: SeatId,
  required: readonly SecuritySymbol[],
  cardIds: readonly CardId[],
): boolean {
  const game = world.game!;
  if (required.length === 0) return true;
  if (new Set(cardIds).size !== cardIds.length) return false;
  const cities: CityDef[] = [];
  for (const id of cardIds) {
    if (!game.players[seat].hand.includes(id)) return false;
    const city = cityOfCard(game, id);
    if (!city) return false;
    cities.push(cityDef(city));
  }

  const allowMultiSymbol = hasRule(world.campaign, "R");
  const hasPortable = hasAsset(world, seat, "portable-computing-device");

  // Build available slots from the revealed cards.
  // Before Rule R: 1 slot per card (matches any single symbol of that card).
  // With Rule R: 3 slots per card (keypad, region, affiliation).
  type Slot =
    | { cardIdx: number; mode: "any" }
    | { cardIdx: number; mode: "keypad" | "region" | "affiliation" };

  const slots: Slot[] = [];
  for (let i = 0; i < cities.length; i++) {
    if (allowMultiSymbol) {
      slots.push({ cardIdx: i, mode: "keypad" });
      slots.push({ cardIdx: i, mode: "region" });
      slots.push({ cardIdx: i, mode: "affiliation" });
    } else {
      slots.push({ cardIdx: i, mode: "any" });
    }
  }

  const matches = (slot: Slot, sym: SecuritySymbol): boolean => {
    const c = cities[slot.cardIdx]!;
    if (slot.mode !== "any" && slot.mode !== sym.kind) return false;
    if (sym.kind === "keypad") {
      return hasPortable ? Math.abs(c.keypad - sym.value) <= 1 : c.keypad === sym.value;
    }
    if (sym.kind === "region") return c.region === sym.region;
    return c.affiliation === sym.affiliation;
  };

  // Standard augmenting-path bipartite matching (small: <= 3 tokens, <= 8 cards)
  const slotOwner: (number | null)[] = slots.map(() => null);
  const dfs = (tokIdx: number, visited: Set<number>): boolean => {
    const sym = required[tokIdx]!;
    for (let s = 0; s < slots.length; s++) {
      if (visited.has(s) || !matches(slots[s]!, sym)) continue;
      visited.add(s);
      if (slotOwner[s] === null || dfs(slotOwner[s]!, visited)) {
        slotOwner[s] = tokIdx;
        return true;
      }
    }
    return false;
  };

  for (let t = 0; t < required.length; t++) {
    if (!dfs(t, new Set())) return false;
  }
  return true;
}

export function usedTempAliases(game: Game): OccupationId[] {
  return game.seats
    .map((s) => game.players[s].tempAlias)
    .filter((occ): occ is OccupationId => occ !== null);
}

export function availableTempAliases(game: Game): OccupationId[] {
  const used = new Set(usedTempAliases(game));
  return pack.occupations
    .filter((o) => o.affiliation === "allied" && !used.has(o.id))
    .map((o) => o.id);
}

export function createdUnburnedAliases(campaign: Campaign, passport: PassportColor): Affiliation[] {
  const p = campaign.passports[passport];
  return (["allied", "neutral", "soviet"] as const).filter(
    (aff) => p.aliases[aff].created && !p.aliases[aff].burned,
  );
}

export function activeContactsList(
  campaign: Campaign,
): { passport: PassportColor; affiliation: Affiliation; assetIndex: number; asset: AttachedAsset }[] {
  const out: {
    passport: PassportColor;
    affiliation: Affiliation;
    assetIndex: number;
    asset: AttachedAsset;
  }[] = [];
  for (const color of Object.keys(campaign.passports) as PassportColor[]) {
    const p = campaign.passports[color];
    for (const aff of ["allied", "neutral", "soviet"] as const) {
      const alias = p.aliases[aff];
      if (!alias.created || alias.burned) continue;
      alias.assets.forEach((asset, assetIndex) => {
        if (!asset.dead && pack.assetById[asset.id].category === "contact") {
          out.push({ passport: color, affiliation: aff, assetIndex, asset });
        }
      });
    }
  }
  return out;
}

export function playerDisplayName(world: World, seat: SeatId): string {
  const p = world.game?.players[seat];
  if (!p) return seat;
  if (p.tempAlias) return `${seat} (${pack.occupationById[p.tempAlias].name})`;
  const alias = activeAliasOf(world, seat);
  if (alias) return `${alias.name || `${p.passport} ${p.activeAlias}`} (${seat})`;
  return seat;
}

export function formatPearlDoorRooms(door: PearlDoorNumber): string {
  const rooms = pack.sites.pearl.rooms.filter((r) => r.pearlDoor === door);
  return rooms.map((r) => `${r.name}: ${r.text}`).join("\n");
}
