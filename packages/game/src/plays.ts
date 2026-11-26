import { pack } from "./content/pack";
import {
  activeEventsInReserve,
  advanceEscalationStep,
  checkAllObjectivesResolved,
  checkAndCompletePursuitObjective,
} from "./flow";
import {
  activeAliasOf,
  activeContactsList,
  areAdjacent,
  availableTempAliases,
  canMitigateCover,
  canonicalEdge,
  cityDef,
  cityDistance,
  cityOfCard,
  discardFromHand,
  discardableHandCards,
  drainCoverQueue,
  ensureHandLimitDecisions,
  enterCity,
  findAsset,
  giveActionTokens,
  handLimit,
  hasCheckpoint,
  hasRule,
  isSymptomCard,
  log,
  moveTeam,
  queueCoverLoss,
  scratchOneCoverNow,
} from "./helpers";
import type {
  Affiliation,
  AssetId,
  CardId,
  CityId,
  EventId,
  LiabilityId,
  OccupationId,
  PassportColor,
  RegionId,
  RestrictionId,
  SeatId,
  TeamId,
} from "./ids";
import { PASSPORT_COLORS } from "./ids";
import {
  addIntelCard,
  assignFreeAsset,
  evaluatePsych1,
  evaluatePsych2,
  openDoor,
  readDebrief,
} from "./legacy";
import type { DeploymentAnswer, TransmissionMethod, World } from "./state";

export type Play =
  | { e: "a-holdover-from-the-war"; city: CityId; relocateFrom?: CityId }
  | { e: "airlift"; target: { kind: "pawn"; seat: SeatId } | { kind: "team"; team: TeamId }; to: CityId }
  | { e: "counter-intelligence"; threatCardId: string }
  | { e: "cover-of-darkness" }
  | { e: "forecast" }
  | { e: "bureaucratic-entanglements"; targets: CityId[] }
  | { e: "encoded-messages"; seatA: SeatId; cardA: CardId; seatB: SeatId; cardB: CardId }
  | { e: "weekend-rendezvous"; to: CityId; seats: SeatId[] }
  | { e: "scramble-teams"; moves: { team: TeamId; to: CityId }[] }
  | { e: "diversion"; sources: CityId[]; to: CityId }
  | { e: "one-quiet-night" }
  | { e: "undocumented-actions"; restriction: RestrictionId }
  | { e: "extended-time" }
  | { e: "border-security" }
  | { e: "trial-vaccine"; targets: CityId[] }
  | { e: "spectrum-interference"; regions: RegionId[] }
  | { e: "decryption-book" };

export type RoomChoiceAnswer =
  | { room: "pearl-loading-dock"; skip: true }
  | { room: "pearl-loading-dock"; skip: false; trialCity: CityId }
  | { room: "pearl-control-room"; skip: true }
  | { room: "pearl-control-room"; skip: false; card: CardId }
  | { room: "pearl-courtyard"; take: boolean }
  | { room: "pearl-archives"; card: CardId }
  | { room: "pearl-directors-office"; skip: true }
  | { room: "pearl-directors-office"; skip: false; cards: CardId[] }
  | { room: "pearl-access-panel"; skip: true }
  | { room: "pearl-access-panel"; skip: false; tokenA: string; tokenB: string }
  | { room: "lg-briefing-room"; skip: true }
  | { room: "lg-briefing-room"; skip: false; event: EventId }
  | { room: "lg-armory"; skip: true }
  | { room: "lg-armory"; skip: false; asset: AssetId; city?: CityId };

export type Answer =
  | {
      t: "create-aliases";
      entries: Record<PassportColor, { name: string; occupation: OccupationId }>;
    }
  | {
      t: "psych-questions";
      answers: Record<number, "AGREE" | "DISAGREE" | 1 | 2 | 3 | 4 | 5>;
    }
  | { t: "transmission-report"; method: TransmissionMethod }
  | { t: "deployment-report"; answer: DeploymentAnswer }
  | { t: "sabik-offer"; choice: "accept" | "decline" }
  | { t: "file-report"; chosen: number }
  | { t: "door14-briefcase"; choice: "open" | "blow-up" | "ignore" }
  | { t: "place-counter-surveillance"; city: CityId }
  | { t: "kill-contact"; passport: PassportColor; affiliation: Affiliation; assetIndex: number }
  | {
      t: "free-infrared-goggles";
      passport?: PassportColor;
      affiliation?: Affiliation;
      skip?: boolean;
    }
  | { t: "december-choice"; choice: "a" | "b" }
  | { t: "distribute-action-tokens"; seat: SeatId }
  | { t: "choose-return-symptom"; seat: SeatId; card: CardId }
  | { t: "remove-agents-board"; city: CityId }
  | { t: "reveal-pearl-tokens"; tokenId: string }
  | { t: "place-free-checkpoint"; a: CityId; b: CityId; relocateFrom?: [CityId, CityId] }
  | { t: "pick-temp-alias"; occupation: OccupationId }
  | { t: "hand-limit"; card: CardId }
  | { t: "discard-card"; card: CardId }
  | { t: "cover-mitigation"; choice: "scratch" | "suitcase" | "collective-manager"; card?: CardId }
  | { t: "choose-liability"; liability: LiabilityId }
  | { t: "escalation" }
  | { t: "remove-safehouse"; city: CityId }
  | { t: "forecast"; order: string[] }
  | { t: "border-security"; neighbor?: CityId; relocateFrom?: [CityId, CityId]; done?: boolean }
  | { t: "room-choice"; choice: RoomChoiceAnswer };

function findEventCardInHand(world: World, seat: SeatId, event: EventId): CardId | null {
  const game = world.game;
  if (!game) return null;
  for (const id of game.players[seat].hand) {
    const card = game.playerCards[id];
    if (card?.kind === "event" && card.event === event) return id;
  }
  return null;
}

/** Validates playing Event card `play` from `seat`'s hand during `phase`. */
export function checkPlay(
  world: World,
  seat: SeatId,
  phase: string,
  play: Play,
): string | null {
  const game = world.game;
  if (!game) return "No game in progress";
  if (!phase.startsWith("playing.")) return "Events can only be played during gameplay";

  const cardId = findEventCardInHand(world, seat, play.e);
  if (!cardId) return `You do not hold ${pack.eventById[play.e].name}`;

  const topPending = game.pending[0];
  if (topPending) {
    // Two explicit Pandemic timing windows while a decision is pending:
    // 1. Counter-Intelligence between Add Agents and Intensify steps of an Escalation
    const isCounterIntelWindow =
      play.e === "counter-intelligence" &&
      topPending.t === "escalation" &&
      topPending.step === "intensify";
    // 2. Playing an Event card from hand to satisfy a hand-limit check
    const isHandLimitWindow = topPending.t === "hand-limit" && topPending.seat === seat;
    if (!isCounterIntelWindow && !isHandLimitWindow) {
      return "Resolve the pending choice before playing an Event card";
    }
  }

  if (play.e === "cover-of-darkness" && phase !== "playing.actions") {
    return "Cover of Darkness may only be played during the Do Actions step";
  }

  switch (play.e) {
    case "a-holdover-from-the-war": {
      if (game.locations[play.city].safehouse) return `${cityDef(play.city).name} already has a safehouse`;
      if (game.supplies.safehouses <= 0) {
        if (!play.relocateFrom || !game.locations[play.relocateFrom].safehouse) {
          return "All 8 safehouses are on the board; specify relocateFrom";
        }
      } else if (play.relocateFrom) {
        return "Safehouses remain in supply";
      }
      return null;
    }

    case "airlift": {
      if (play.target.kind === "pawn") {
        if (!game.seats.includes(play.target.seat)) return "Invalid seat";
        const p = game.players[play.target.seat];
        if (p.infiltration) return "Cannot Airlift a pawn that is inside an Infiltration site";
        if (p.location === play.to) return "Pawn is already in that city";
        return null;
      }
      const team = game.teams[play.target.team];
      if (!team || !team.city) return "Team is not on the board";
      if (team.city === play.to) return "Team is already in that city";
      return null;
    }

    case "counter-intelligence": {
      const found = game.threatDiscard.find((t) => t.id === play.threatCardId);
      if (!found) return "That card is not in the Threat discard pile";
      return null;
    }

    case "cover-of-darkness":
      if (game.coverOfDarknessActive) return "Cover of Darkness is already active this turn";
      return null;

    case "forecast":
      if (game.threatDeck.length === 0) return "Threat deck is empty";
      return null;

    case "bureaucratic-entanglements": {
      if (play.targets.length < 1 || play.targets.length > 2) {
        return "Choose 1 or 2 agents to remove";
      }
      const counts = new Map<CityId, number>();
      for (const c of play.targets) counts.set(c, (counts.get(c) ?? 0) + 1);
      for (const [city, need] of counts) {
        if (game.locations[city].agents < need) {
          return `${cityDef(city).name} does not have ${need} agent(s)`;
        }
      }
      return null;
    }

    case "encoded-messages": {
      if (play.seatA === play.seatB) return "Choose 2 distinct players";
      if (!game.seats.includes(play.seatA) || !game.seats.includes(play.seatB)) return "Invalid seat";
      if (!game.players[play.seatA].hand.includes(play.cardA)) return `${play.seatA} does not hold ${play.cardA}`;
      if (!game.players[play.seatB].hand.includes(play.cardB)) return `${play.seatB} does not hold ${play.cardB}`;
      if (isSymptomCard(game, play.cardA) || isSymptomCard(game, play.cardB)) {
        return "Symptom cards cannot be swapped";
      }
      if (
        (play.seatA === seat && play.cardA === cardId) ||
        (play.seatB === seat && play.cardB === cardId)
      ) {
        return "Cannot swap the Encoded Messages card being played";
      }
      return null;
    }

    case "weekend-rendezvous": {
      const hasAnchor = game.seats.some(
        (s) => !game.players[s].infiltration && game.players[s].location === play.to,
      );
      if (!hasAnchor) return `No pawn is currently in ${cityDef(play.to).name}`;
      if (play.seats.length === 0) return "Choose at least 1 pawn to move";
      if (new Set(play.seats).size !== play.seats.length) return "Duplicate seats";
      for (const s of play.seats) {
        if (!game.seats.includes(s)) return "Invalid seat";
        const p = game.players[s];
        if (p.infiltration) return `Cannot move ${s} while inside an Infiltration site`;
        if (p.location === play.to) return `${s} is already in ${cityDef(play.to).name}`;
      }
      return null;
    }

    case "scramble-teams": {
      if (play.moves.length === 0) return "Specify at least 1 team to move";
      const seen = new Set<TeamId>();
      for (const m of play.moves) {
        if (seen.has(m.team)) return "Duplicate team in moves";
        seen.add(m.team);
        const team = game.teams[m.team];
        if (!team || !team.city) return `Team ${m.team} is not on the board`;
        const dist = cityDistance(team.city, m.to);
        if (dist < 1 || dist > 3) return `${cityDef(m.to).name} must be 1 to 3 cities from ${cityDef(team.city).name}`;
      }
      return null;
    }

    case "diversion": {
      if (play.sources.length < 1 || play.sources.length > 3) {
        return "Move between 1 and 3 Incident tokens";
      }
      const counts = new Map<CityId, number>();
      for (const src of play.sources) {
        if (src === play.to) return "Source city must differ from destination city";
        counts.set(src, (counts.get(src) ?? 0) + 1);
      }
      for (const [src, need] of counts) {
        if (game.locations[src].incidents < need) {
          return `${cityDef(src).name} does not have ${need} Incident token(s)`;
        }
      }
      return null;
    }

    case "one-quiet-night": {
      if (game.skipThreat) return "One Quiet Night is already active this turn";
      if (phase === "playing.threat" && game.threatsDrawnThisTurn > 0) {
        return "Cannot play One Quiet Night after already drawing Threat cards this turn";
      }
      return null;
    }

    case "undocumented-actions": {
      if (!game.activeRestrictions.includes(play.restriction)) {
        return "That Restriction card is not active this game";
      }
      return null;
    }

    case "extended-time": {
      if (!hasRule(world.campaign, "E")) return "Action tokens are not unlocked";
      if (game.supplies.actionTokens <= 0) return "No Action tokens remaining in supply";
      return null;
    }

    case "border-security": {
      if (!hasRule(world.campaign, "N")) return "Checkpoints are not unlocked";
      const anyEligible = game.seats.some((s) => {
        const p = game.players[s];
        if (p.infiltration) return false;
        return cityDef(p.location).connections.some((nb) => !hasCheckpoint(game, p.location, nb));
      });
      if (!anyEligible) return "No player has an adjacent connection without a Checkpoint";
      return null;
    }

    case "trial-vaccine": {
      const totalCubes = Object.values(game.locations).reduce((acc, l) => acc + l.diseaseCubes, 0);
      if (totalCubes === 0) return "No Disease cubes on the board";
      const expected = Math.min(2, totalCubes);
      if (play.targets.length !== expected) {
        return `Must select ${expected} Disease cube(s) to remove`;
      }
      const counts = new Map<CityId, number>();
      for (const c of play.targets) counts.set(c, (counts.get(c) ?? 0) + 1);
      for (const [city, need] of counts) {
        if (game.locations[city].diseaseCubes < need) {
          return `${cityDef(city).name} does not have ${need} Disease cube(s)`;
        }
      }
      return null;
    }

    case "spectrum-interference": {
      if (play.regions.length < 1 || play.regions.length > 2) return "Choose 1 or 2 Satellite tokens";
      if (new Set(play.regions).size !== play.regions.length) return "Duplicate regions";
      for (const r of play.regions) {
        if (!game.satellites.includes(r)) return `No Satellite token in ${pack.regionNames[r]}`;
      }
      return null;
    }

    case "decryption-book": {
      const pearl = game.infiltrationSites.pearl;
      if (!pearl) return "PEARL Compound is not in play";
      const unrevealed = pearl.tokens.filter((t) => !t.revealed).length;
      if (unrevealed === 0) return "All Security tokens in PEARL Compound are already revealed";
      return null;
    }
  }
}

export function applyPlay(world: World, seat: SeatId, phase: string, play: Play): void {
  const game = world.game!;
  const cardId = findEventCardInHand(world, seat, play.e)!;
  discardFromHand(game, seat, cardId);

  switch (play.e) {
    case "a-holdover-from-the-war": {
      if (play.relocateFrom) {
        game.locations[play.relocateFrom].safehouse = false;
      } else {
        game.supplies.safehouses -= 1;
      }
      game.locations[play.city].safehouse = true;
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Placed safehouse in ${cityDef(play.city).name}`,
      });
      break;
    }

    case "airlift": {
      if (play.target.kind === "pawn") {
        log(game, {
          t: "event",
          seat,
          event: play.e,
          detail: `Airlifted ${play.target.seat} to ${cityDef(play.to).name}`,
        });
        enterCity(world, play.target.seat, play.to, { by: "airlift" });
      } else {
        log(game, {
          t: "event",
          seat,
          event: play.e,
          detail: `Airlifted team ${play.target.team} to ${cityDef(play.to).name}`,
        });
        moveTeam(world, play.target.team, play.to, "airlift");
        checkAndCompletePursuitObjective(world, seat);
      }
      break;
    }

    case "counter-intelligence": {
      const idx = game.threatDiscard.findIndex((t) => t.id === play.threatCardId);
      const [removed] = game.threatDiscard.splice(idx, 1);
      if (removed) game.gameEndArea.push(removed);
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Moved ${removed ? cityDef(removed.city).name : play.threatCardId} from Threat discard to Game End area`,
      });
      break;
    }

    case "cover-of-darkness":
      game.coverOfDarknessActive = true;
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: "Active player removes 1 agent from each city they drive/ferry to this turn",
      });
      break;

    case "forecast": {
      const top = game.threatDeck.slice(0, 6);
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Inspecting top ${top.length} Threat card(s)`,
      });
      game.pending.unshift({ t: "forecast", seat, cards: top.map((c) => ({ ...c })) });
      break;
    }

    case "bureaucratic-entanglements": {
      for (const city of play.targets) {
        game.locations[city].agents -= 1;
        game.supplies.agents += 1;
      }
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Removed agent(s) from ${play.targets.map((c) => cityDef(c).name).join(", ")}`,
      });
      break;
    }

    case "encoded-messages": {
      const handA = game.players[play.seatA].hand;
      const handB = game.players[play.seatB].hand;
      handA.splice(handA.indexOf(play.cardA), 1);
      handB.splice(handB.indexOf(play.cardB), 1);
      handA.push(play.cardB);
      handB.push(play.cardA);
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Swapped ${play.cardA} (${play.seatA}) <-> ${play.cardB} (${play.seatB})`,
      });
      break;
    }

    case "weekend-rendezvous": {
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Moved ${play.seats.join(", ")} to ${cityDef(play.to).name}`,
      });
      for (const s of play.seats) {
        enterCity(world, s, play.to, { by: "weekend-rendezvous" });
      }
      break;
    }

    case "scramble-teams": {
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Moved ${play.moves.map((m) => `${m.team}->${cityDef(m.to).name}`).join(", ")}`,
      });
      for (const m of play.moves) {
        moveTeam(world, m.team, m.to, "scramble-teams");
      }
      checkAndCompletePursuitObjective(world, seat);
      break;
    }

    case "diversion": {
      for (const src of play.sources) {
        game.locations[src].incidents -= 1;
        game.locations[play.to].incidents += 1;
      }
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Moved ${play.sources.length} Incident token(s) from ${play.sources.map((c) => cityDef(c).name).join(", ")} to ${cityDef(play.to).name}`,
      });
      break;
    }

    case "one-quiet-night": {
      game.skipThreat = true;
      if (phase === "playing.threat") game.threatsLeft = 0;
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: "Skipping Draw Threat Cards step this turn",
      });
      break;
    }

    case "undocumented-actions": {
      game.activeRestrictions = game.activeRestrictions.filter((r) => r !== play.restriction);
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Removed ${pack.restrictionById[play.restriction].name} for this game`,
      });
      break;
    }

    case "extended-time": {
      const got = giveActionTokens(game, game.active, 2);
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Gave ${got} Action token(s) to ${game.active}`,
      });
      break;
    }

    case "border-security": {
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: "Each player may place up to 2 Checkpoints adjacent to their city",
      });
      const eligible = game.seats.filter((s) => !game.players[s].infiltration);
      if (eligible.length > 0) {
        game.pending.unshift({ t: "border-security", seatsLeft: eligible, placedByCurrent: 0 });
      }
      break;
    }

    case "trial-vaccine": {
      for (const city of play.targets) {
        game.locations[city].diseaseCubes -= 1;
        game.supplies.diseaseCubes += 1;
      }
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Removed Disease cube(s) from ${play.targets.map((c) => cityDef(c).name).join(", ")}`,
      });
      break;
    }

    case "spectrum-interference": {
      for (const r of play.regions) {
        game.satellites = game.satellites.filter((x) => x !== r);
        game.supplies.satellites += 1;
        log(game, { t: "satellite", region: r, action: "disabled" });
      }
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Removed Satellite token(s) in ${play.regions.map((r) => pack.regionNames[r]).join(", ")}`,
      });
      break;
    }

    case "decryption-book": {
      const unrevealed = game.infiltrationSites.pearl!.tokens.filter((t) => !t.revealed).length;
      const count = Math.min(4, unrevealed);
      log(game, {
        t: "event",
        seat,
        event: play.e,
        detail: `Reveal ${count} Security token(s) in PEARL Compound`,
      });
      game.pending.unshift({
        t: "reveal-pearl-tokens",
        seat,
        remaining: count,
        source: "Event: Decryption Book",
      });
      break;
    }
  }

  autoResolve(world);
}

// ============================================================================
// Decision validation & resolution
// ============================================================================

/** Which seat owns the top pending decision (null = any seated player / team consensus). */
export function decisionOwner(world: World): SeatId | null {
  const top = world.game?.pending[0];
  if (!top) return null;
  switch (top.t) {
    case "hand-limit":
    case "discard-card":
    case "cover-mitigation":
    case "choose-liability":
    case "pick-temp-alias":
    case "remove-agents-board":
    case "reveal-pearl-tokens":
    case "place-free-checkpoint":
    case "forecast":
    case "room-choice":
      return top.seat;
    case "border-security":
      return top.seatsLeft[0] ?? null;
    case "escalation":
      return world.game?.active ?? null;
    default:
      return null;
  }
}

export function checkDecide(world: World, seat: SeatId | null, answer: Answer): string | null {
  const game = world.game;
  if (!game) return "No game in progress";
  const top = game.pending[0];
  if (!top) return "No pending decision";
  if (answer.t !== top.t) return `Expected decision '${top.t}', got '${answer.t}'`;

  const owner = decisionOwner(world);
  if (owner !== null && seat !== owner) {
    return `Decision belongs to ${owner}`;
  }

  const c = world.campaign;

  switch (top.t) {
    case "create-aliases": {
      const ans = answer as Extract<Answer, { t: "create-aliases" }>;
      const validOccs = new Set(
        pack.occupations.filter((o) => o.affiliation === top.affiliation).map((o) => o.id),
      );
      const used = new Set<OccupationId>();
      for (const color of PASSPORT_COLORS) {
        const entry = ans.entries[color];
        if (!entry) return `Missing entry for ${color} passport`;
        if (!entry.name.trim()) return `Alias name for ${color} passport cannot be empty`;
        if (!validOccs.has(entry.occupation)) {
          return `${entry.occupation} is not a valid ${top.affiliation} occupation`;
        }
        if (used.has(entry.occupation)) {
          return `Occupation ${entry.occupation} assigned to multiple passports`;
        }
        used.add(entry.occupation);
      }
      return null;
    }

    case "psych-questions": {
      const ans = answer as Extract<Answer, { t: "psych-questions" }>;
      for (const q of top.questions) {
        const val = ans.answers[q.number];
        if (q.kind === "agree-disagree") {
          if (val !== "AGREE" && val !== "DISAGREE") {
            return `Question ${q.number} requires AGREE or DISAGREE`;
          }
        } else {
          if (val !== 1 && val !== 2 && val !== 3 && val !== 4 && val !== 5) {
            return `Question ${q.number} requires a number 1..5`;
          }
        }
      }
      return null;
    }

    case "transmission-report": {
      const ans = answer as Extract<Answer, { t: "transmission-report" }>;
      if (!["airborne", "animal-contact", "saliva", "waterborne"].includes(ans.method)) {
        return "Invalid transmission method";
      }
      return null;
    }

    case "deployment-report": {
      const ans = answer as Extract<Answer, { t: "deployment-report" }>;
      if (!["jellyfish", "agent-sabik", "pollen", "unknown"].includes(ans.answer)) {
        return "Invalid deployment answer";
      }
      return null;
    }

    case "sabik-offer": {
      const ans = answer as Extract<Answer, { t: "sabik-offer" }>;
      if (ans.choice !== "accept" && ans.choice !== "decline") return "Choose accept or decline";
      return null;
    }

    case "file-report": {
      const ans = answer as Extract<Answer, { t: "file-report" }>;
      if (!top.options.includes(ans.chosen)) {
        return `Must choose Operations ${top.options[0]} or ${top.options[1]}`;
      }
      return null;
    }

    case "door14-briefcase": {
      const ans = answer as Extract<Answer, { t: "door14-briefcase" }>;
      if (!["open", "blow-up", "ignore"].includes(ans.choice)) {
        return "Choose open, blow-up, or ignore";
      }
      return null;
    }

    case "place-counter-surveillance": {
      const ans = answer as Extract<Answer, { t: "place-counter-surveillance" }>;
      if (c.cities[ans.city].surveillance <= 0) {
        return `${cityDef(ans.city).name} has no Surveillance to remove`;
      }
      return null;
    }

    case "kill-contact": {
      const ans = answer as Extract<Answer, { t: "kill-contact" }>;
      const list = activeContactsList(c);
      const ok = list.some(
        (x) =>
          x.passport === ans.passport &&
          x.affiliation === ans.affiliation &&
          x.assetIndex === ans.assetIndex,
      );
      if (!ok) return "Must select a living Contact on an unburned alias";
      return null;
    }

    case "free-infrared-goggles": {
      const ans = answer as Extract<Answer, { t: "free-infrared-goggles" }>;
      const hasSlot = PASSPORT_COLORS.some((color) =>
        (["allied", "neutral", "soviet"] as const).some((aff) => {
          const al = c.passports[color].aliases[aff];
          return al.created && !al.burned && al.assets.length < 3;
        }),
      );
      if (ans.skip) return hasSlot ? null : null;
      if (!ans.passport || !ans.affiliation) return "Specify passport and affiliation";
      const al = c.passports[ans.passport].aliases[ans.affiliation];
      if (!al.created || al.burned) return "Alias is not active";
      if (al.assets.length >= 3) return "Alias has no empty Asset slots";
      return null;
    }

    case "december-choice": {
      const ans = answer as Extract<Answer, { t: "december-choice" }>;
      if (ans.choice !== "a" && ans.choice !== "b") return "Choose a or b";
      return null;
    }

    case "distribute-action-tokens": {
      const ans = answer as Extract<Answer, { t: "distribute-action-tokens" }>;
      if (!game.seats.includes(ans.seat)) return "Invalid seat";
      return null;
    }

    case "choose-return-symptom": {
      const ans = answer as Extract<Answer, { t: "choose-return-symptom" }>;
      if (!game.seats.includes(ans.seat)) return "Invalid seat";
      if (!game.players[ans.seat].hand.includes(ans.card) || !isSymptomCard(game, ans.card)) {
        return "Must select a Symptom card in that player's hand";
      }
      return null;
    }

    case "remove-agents-board": {
      const ans = answer as Extract<Answer, { t: "remove-agents-board" }>;
      if (game.locations[ans.city].agents <= 0) return `No agents in ${cityDef(ans.city).name}`;
      return null;
    }

    case "reveal-pearl-tokens": {
      const ans = answer as Extract<Answer, { t: "reveal-pearl-tokens" }>;
      const tok = game.infiltrationSites.pearl?.tokens.find((t) => t.id === ans.tokenId);
      if (!tok) return "Unknown PEARL Security token";
      if (tok.revealed) return "That Security token is already faceup";
      return null;
    }

    case "place-free-checkpoint": {
      const ans = answer as Extract<Answer, { t: "place-free-checkpoint" }>;
      if (!areAdjacent(ans.a, ans.b)) return `${cityDef(ans.a).name} and ${cityDef(ans.b).name} are not adjacent`;
      if (hasCheckpoint(game, ans.a, ans.b)) return "Checkpoint already exists on that connection";
      if (game.supplies.checkpointTokens <= 0) {
        if (!ans.relocateFrom || !hasCheckpoint(game, ans.relocateFrom[0], ans.relocateFrom[1])) {
          return "All 12 Checkpoints are on the board; specify relocateFrom";
        }
      } else if (ans.relocateFrom) {
        return "Checkpoint tokens remain in supply";
      }
      return null;
    }

    case "pick-temp-alias": {
      const ans = answer as Extract<Answer, { t: "pick-temp-alias" }>;
      if (!availableTempAliases(game).includes(ans.occupation)) {
        return "Choose an unused Allied occupation as your Temporary Alias";
      }
      return null;
    }

    case "hand-limit": {
      const ans = answer as Extract<Answer, { t: "hand-limit" }>;
      if (!game.players[top.seat].hand.includes(ans.card)) return "Card is not in your hand";
      if (isSymptomCard(game, ans.card)) return "Symptom cards cannot be discarded for hand limit";
      return null;
    }

    case "discard-card": {
      const ans = answer as Extract<Answer, { t: "discard-card" }>;
      if (!game.players[top.seat].hand.includes(ans.card)) return "Card is not in your hand";
      if (isSymptomCard(game, ans.card)) return "Symptom cards cannot be discarded";
      return null;
    }

    case "cover-mitigation": {
      const ans = answer as Extract<Answer, { t: "cover-mitigation" }>;
      const mit = canMitigateCover(world, top.seat);
      if (ans.choice === "scratch") return null;
      if (ans.choice === "suitcase") {
        return mit.suitcase ? null : "Suitcase Full of Money is not available";
      }
      if (ans.choice === "collective-manager") {
        if (!mit.collectiveManager) return "Collective Manager mitigation is not available";
        if (!ans.card || !game.players[top.seat].hand.includes(ans.card) || !cityOfCard(game, ans.card)) {
          return "Must discard a City card from your hand";
        }
        return null;
      }
      return "Invalid mitigation choice";
    }

    case "choose-liability": {
      const ans = answer as Extract<Answer, { t: "choose-liability" }>;
      if (!c.availableLiabilities.includes(ans.liability)) {
        return "That Liability sticker is not available";
      }
      return null;
    }

    case "escalation":
      return null;

    case "remove-safehouse": {
      const ans = answer as Extract<Answer, { t: "remove-safehouse" }>;
      if (cityDef(ans.city).region !== top.region) {
        return `Must pick a safehouse in ${pack.regionNames[top.region]}`;
      }
      if (!game.locations[ans.city].safehouse) return "That city has no safehouse";
      return null;
    }

    case "forecast": {
      const ans = answer as Extract<Answer, { t: "forecast" }>;
      if (ans.order.length !== top.cards.length) return `Must order all ${top.cards.length} Threat cards`;
      const expected = new Set(top.cards.map((x) => x.id));
      const given = new Set(ans.order);
      if (given.size !== expected.size || ![...expected].every((id) => given.has(id))) {
        return "Order must contain the exact same Threat card IDs";
      }
      return null;
    }

    case "border-security": {
      const ans = answer as Extract<Answer, { t: "border-security" }>;
      if (ans.done) return null;
      if (!ans.neighbor) return "Specify an adjacent city or set done: true";
      const curSeat = top.seatsLeft[0]!;
      const loc = game.players[curSeat].location;
      if (!areAdjacent(loc, ans.neighbor)) return `${cityDef(ans.neighbor).name} is not adjacent to ${cityDef(loc).name}`;
      if (hasCheckpoint(game, loc, ans.neighbor)) return "Checkpoint already exists on that connection";
      if (game.supplies.checkpointTokens <= 0) {
        if (!ans.relocateFrom || !hasCheckpoint(game, ans.relocateFrom[0], ans.relocateFrom[1])) {
          return "All 12 Checkpoints are on the board; specify relocateFrom";
        }
      } else if (ans.relocateFrom) {
        return "Checkpoint tokens remain in supply";
      }
      return null;
    }

    case "room-choice": {
      const ans = answer as Extract<Answer, { t: "room-choice" }>;
      if (ans.choice.room !== top.room) return `Expected room-choice for ${top.room}`;
      const p = game.players[top.seat];
      switch (ans.choice.room) {
        case "pearl-loading-dock": {
          if (ans.choice.skip) return null;
          const trialObj = game.objectives.find(
            (o) => o.kind === "disrupt-trial" && o.status === "active",
          );
          if (!trialObj) return "No active Disrupt Trial objective";
          const targetCity = ans.choice.trialCity;
          const found = trialObj.trialCardIds.some((id) => cityOfCard(game, id) === targetCity);
          if (!found) return `${cityDef(targetCity).name} is not under the Disrupt Trial objective`;
          return null;
        }
        case "pearl-control-room": {
          if (ans.choice.skip) return null;
          if (!p.hand.includes(ans.choice.card)) return "Card is not in your hand";
          const city = cityOfCard(game, ans.choice.card);
          if (!city) return "Must discard a City card";
          const reg = cityDef(city).region;
          if (!game.satellites.includes(reg)) return `No Satellite token in ${pack.regionNames[reg]}`;
          return null;
        }
        case "pearl-courtyard":
          return null;
        case "pearl-archives": {
          if (!game.playerDiscard.includes(ans.choice.card) || !cityOfCard(game, ans.choice.card)) {
            return "Must pick a City card from the Player discard pile";
          }
          return null;
        }
        case "pearl-directors-office": {
          if (ans.choice.skip) return null;
          const availableCityCards = game.playerDiscard.filter((id) => cityOfCard(game, id) !== null);
          const expected = Math.min(2, availableCityCards.length);
          if (ans.choice.cards.length !== expected) return `Must select ${expected} City card(s)`;
          if (new Set(ans.choice.cards).size !== ans.choice.cards.length) return "Duplicate cards";
          for (const id of ans.choice.cards) {
            if (!availableCityCards.includes(id)) return `${id} is not a City card in the discard pile`;
          }
          return null;
        }
        case "pearl-access-panel": {
          if (ans.choice.skip) return null;
          const { tokenA, tokenB } = ans.choice;
          if (tokenA === tokenB) return "Pick 2 distinct Security tokens";
          const tokens = game.infiltrationSites.pearl?.tokens ?? [];
          const a = tokens.find((t) => t.id === tokenA && t.revealed);
          const b = tokens.find((t) => t.id === tokenB && t.revealed);
          if (!a || !b) return "Both Security tokens must be faceup in PEARL Compound";
          return null;
        }
        case "lg-briefing-room": {
          if (ans.choice.skip) return null;
          if (!activeEventsInReserve(world).includes(ans.choice.event)) {
            return "That Event card is not in the reserve";
          }
          return null;
        }
        case "lg-armory": {
          if (ans.choice.skip) return null;
          if (!c.availableAssets.includes(ans.choice.asset)) return "Asset is not available";
          const def = pack.assetById[ans.choice.asset];
          if (def.needsCity) {
            if (!ans.choice.city) return `${def.name} requires a city`;
            if (def.sovietOnly && cityDef(ans.choice.city).affiliation !== "soviet") {
              return `${def.name} must be placed in a Soviet city`;
            }
          }
          return null;
        }
      }
    }
  }
}

export function applyDecide(world: World, answer: Answer): void {
  const game = world.game!;
  const c = world.campaign;
  const top = game.pending[0]!;

  switch (top.t) {
    case "create-aliases": {
      const ans = answer as Extract<Answer, { t: "create-aliases" }>;
      game.pending.shift();
      for (const color of PASSPORT_COLORS) {
        const entry = ans.entries[color];
        const alias = c.passports[color].aliases[top.affiliation];
        alias.created = true;
        alias.name = entry.name.trim();
        alias.occupation = entry.occupation;
      }
      log(game, {
        t: "note",
        text: `Created ${top.affiliation} aliases: ${PASSPORT_COLORS.map((col) => `${col}=${ans.entries[col].name} (${pack.occupationById[ans.entries[col].occupation].name})`).join(", ")}`,
      });
      break;
    }

    case "psych-questions": {
      const ans = answer as Extract<Answer, { t: "psych-questions" }>;
      game.pending.shift();
      for (const q of top.questions) {
        c.psychAnswers[q.number] = ans.answers[q.number]!;
      }
      c.personnelFile.push({
        id: top.cardId,
        title: `Psych Questions (${top.cardId})`,
        text: top.questions.map((q) => `Q${q.number}: ${q.prompt} -> ${ans.answers[q.number]}`).join("\n"),
      });
      log(game, {
        t: "note",
        text: `Recorded Psych answers (${top.cardId}): ${top.questions.map((q) => `Q${q.number}=${ans.answers[q.number]}`).join(", ")}`,
      });
      // Immediately trigger Evaluation 1 after 03-04 and Evaluation 2 after 06-06!
      if (top.cardId === "legacy/03-04") evaluatePsych1(world);
      if (top.cardId === "legacy/06-06") evaluatePsych2(world);
      break;
    }

    case "transmission-report": {
      const ans = answer as Extract<Answer, { t: "transmission-report" }>;
      game.pending.shift();
      c.transmissionMethod = ans.method;
      c.intelFile.push({
        id: top.cardId,
        title: "MEDUSA Transmission Report (April)",
        text: `Reported transmission method: ${ans.method}`,
      });
      log(game, { t: "note", text: `Filed MEDUSA Transmission Report: ${ans.method}` });
      break;
    }

    case "deployment-report": {
      const ans = answer as Extract<Answer, { t: "deployment-report" }>;
      game.pending.shift();
      c.deploymentReport = ans.answer;
      c.intelFile.push({
        id: top.cardId,
        title: "MEDUSA Deployment Report (August)",
        text: `Reported deployment mechanism: ${ans.answer}`,
      });
      log(game, { t: "note", text: `Filed MEDUSA Deployment Report: ${ans.answer}` });
      break;
    }

    case "sabik-offer": {
      const ans = answer as Extract<Answer, { t: "sabik-offer" }>;
      game.pending.shift();
      log(game, {
        t: "note",
        text: `Sabik's Offer (Operations 76): team chose to ${ans.choice.toUpperCase()}`,
      });
      if (ans.choice === "accept") {
        readDebrief(world, 242);
      } else {
        readDebrief(world, 139);
      }
      break;
    }

    case "file-report": {
      const ans = answer as Extract<Answer, { t: "file-report" }>;
      game.pending.shift();
      const other = top.options[0] === ans.chosen ? top.options[1] : top.options[0];
      addIntelCard(world, ans.chosen);
      if (!c.destroyedOpsCards.includes(other)) c.destroyedOpsCards.push(other);
      log(game, {
        t: "note",
        text: `Filed Operations ${ans.chosen} in Intelligence File (destroyed Operations ${other})`,
      });
      break;
    }

    case "door14-briefcase": {
      const ans = answer as Extract<Answer, { t: "door14-briefcase" }>;
      game.pending.shift();
      if (ans.choice === "open") {
        openDoor(world, "19");
      } else if (ans.choice === "blow-up") {
        openDoor(world, "24");
      } else {
        c.door14State = "ignored";
        log(game, { t: "note", text: "Door 14 briefcase left unopened for now (may resolve later)" });
      }
      break;
    }

    case "place-counter-surveillance": {
      const ans = answer as Extract<Answer, { t: "place-counter-surveillance" }>;
      c.cities[ans.city].surveillance = Math.max(0, c.cities[ans.city].surveillance - 1);
      top.remaining -= 1;
      log(game, {
        t: "note",
        text: `${top.source}: reduced Surveillance in ${cityDef(ans.city).name} to ${c.cities[ans.city].surveillance}`,
      });
      const anyLeft = pack.cities.some((ct) => c.cities[ct.id].surveillance > 0);
      if (top.remaining <= 0 || !anyLeft) game.pending.shift();
      break;
    }

    case "kill-contact": {
      const ans = answer as Extract<Answer, { t: "kill-contact" }>;
      game.pending.shift();
      const asset = c.passports[ans.passport].aliases[ans.affiliation].assets[ans.assetIndex]!;
      asset.dead = true;
      log(game, {
        t: "note",
        text: `${top.source}: crossed out ${pack.assetById[asset.id].name} on ${ans.passport} (${ans.affiliation})`,
      });
      break;
    }

    case "free-infrared-goggles": {
      const ans = answer as Extract<Answer, { t: "free-infrared-goggles" }>;
      game.pending.shift();
      if (!ans.skip && ans.passport && ans.affiliation) {
        assignFreeAsset(world, ans.passport, ans.affiliation, "infrared-goggles");
        log(game, {
          t: "note",
          text: `Added free Infrared Goggles to ${ans.passport} (${ans.affiliation})`,
        });
      }
      break;
    }

    case "december-choice": {
      const ans = answer as Extract<Answer, { t: "december-choice" }>;
      game.pending.shift();
      const debriefNum =
        top.variant === "cia-sabik"
          ? ans.choice === "a"
            ? 144
            : 164
          : ans.choice === "a"
            ? 138
            : 158;
      readDebrief(world, debriefNum);
      break;
    }

    case "distribute-action-tokens": {
      const ans = answer as Extract<Answer, { t: "distribute-action-tokens" }>;
      giveActionTokens(game, ans.seat, 1);
      top.remaining -= 1;
      log(game, { t: "note", text: `${top.source}: gave 1 Action token to ${ans.seat}` });
      if (top.remaining <= 0 || game.supplies.actionTokens <= 0) game.pending.shift();
      break;
    }

    case "choose-return-symptom": {
      const ans = answer as Extract<Answer, { t: "choose-return-symptom" }>;
      game.pending.shift();
      discardFromHand(game, ans.seat, ans.card);
      log(game, { t: "note", text: `${top.source}: returned Symptom card from ${ans.seat}` });
      break;
    }

    case "remove-agents-board": {
      const ans = answer as Extract<Answer, { t: "remove-agents-board" }>;
      game.locations[ans.city].agents -= 1;
      game.supplies.agents += 1;
      top.remaining -= 1;
      log(game, {
        t: "note",
        text: `${top.source}: removed 1 agent from ${cityDef(ans.city).name}`,
      });
      const anyLeft = Object.values(game.locations).some((l) => l.agents > 0);
      if (top.remaining <= 0 || !anyLeft) game.pending.shift();
      break;
    }

    case "reveal-pearl-tokens": {
      const ans = answer as Extract<Answer, { t: "reveal-pearl-tokens" }>;
      const tok = game.infiltrationSites.pearl!.tokens.find((t) => t.id === ans.tokenId)!;
      tok.revealed = true;
      top.remaining -= 1;
      log(game, {
        t: "note",
        text: `${top.source}: revealed PEARL Security token ${tok.id} (${tok.symbol.kind})`,
      });
      const anyLeft = game.infiltrationSites.pearl!.tokens.some((t) => !t.revealed);
      if (top.remaining <= 0 || !anyLeft) game.pending.shift();
      break;
    }

    case "place-free-checkpoint": {
      const ans = answer as Extract<Answer, { t: "place-free-checkpoint" }>;
      game.pending.shift();
      if (ans.relocateFrom) {
        const [rx, ry] = canonicalEdge(ans.relocateFrom[0], ans.relocateFrom[1]);
        const idx = game.checkpoints.findIndex(([a, b]) => a === rx && b === ry);
        if (idx !== -1) game.checkpoints.splice(idx, 1);
      } else {
        game.supplies.checkpointTokens -= 1;
      }
      game.checkpoints.push(canonicalEdge(ans.a, ans.b));
      log(game, {
        t: "note",
        text: `${top.source}: placed Checkpoint between ${cityDef(ans.a).name} and ${cityDef(ans.b).name}`,
      });
      break;
    }

    case "pick-temp-alias": {
      const ans = answer as Extract<Answer, { t: "pick-temp-alias" }>;
      game.pending.shift();
      const player = game.players[top.seat];
      player.tempAlias = ans.occupation;
      player.needsTempAlias = false;
      log(game, {
        t: "note",
        text: `${top.seat} took Temporary Alias: ${pack.occupationById[ans.occupation].name}`,
      });
      // Immediately complete start-of-turn surveillance check (player is in Washington with safehouse -> 0 loss)
      game.surveillanceChecked = true;
      log(game, { t: "turn", turn: game.turn, seat: top.seat });
      break;
    }

    case "hand-limit": {
      const ans = answer as Extract<Answer, { t: "hand-limit" }>;
      discardFromHand(game, top.seat, ans.card);
      log(game, { t: "note", text: `${top.seat} discarded ${ans.card} for hand limit` });
      if (
        game.players[top.seat].hand.length <= handLimit(world, top.seat) ||
        discardableHandCards(game, top.seat).length === 0
      ) {
        game.pending.shift();
      }
      break;
    }

    case "discard-card": {
      const ans = answer as Extract<Answer, { t: "discard-card" }>;
      discardFromHand(game, top.seat, ans.card);
      top.remaining -= 1;
      log(game, { t: "note", text: `${top.seat} discarded ${ans.card} (${top.source})` });
      if (top.remaining <= 0 || discardableHandCards(game, top.seat).length === 0) {
        game.pending.shift();
      }
      break;
    }

    case "cover-mitigation": {
      const ans = answer as Extract<Answer, { t: "cover-mitigation" }>;
      game.pending.shift();
      if (ans.choice === "suitcase") {
        const suitcase = findAsset(world, top.seat, "suitcase-full-of-money")!;
        suitcase.boxesChecked += 1;
        log(game, {
          t: "cover",
          seat: top.seat,
          result: `mitigated via Suitcase Full of Money (${suitcase.boxesChecked}/3)`,
          source: top.source,
        });
      } else if (ans.choice === "collective-manager" && ans.card) {
        discardFromHand(game, top.seat, ans.card);
        log(game, {
          t: "cover",
          seat: top.seat,
          result: `mitigated via Collective Manager (discarded ${ans.card})`,
          source: top.source,
        });
      } else {
        scratchOneCoverNow(world, top.seat, top.source);
      }
      break;
    }

    case "choose-liability": {
      const ans = answer as Extract<Answer, { t: "choose-liability" }>;
      game.pending.shift();
      const idx = c.availableLiabilities.indexOf(ans.liability);
      c.availableLiabilities.splice(idx, 1);
      const def = pack.liabilityById[ans.liability];
      const alias = activeAliasOf(world, top.seat);
      if (alias) {
        alias.liabilities.push({
          id: ans.liability,
          region: def.needsRegion ? top.region : null,
        });
      }
      log(game, {
        t: "note",
        text: `${top.seat} gained Liability: ${def.name}${def.needsRegion ? ` (${pack.regionNames[top.region]})` : ""}`,
      });
      break;
    }

    case "escalation":
      advanceEscalationStep(world);
      break;

    case "remove-safehouse": {
      const ans = answer as Extract<Answer, { t: "remove-safehouse" }>;
      game.pending.shift();
      game.locations[ans.city].safehouse = false;
      game.supplies.safehouses += 1;
      log(game, {
        t: "note",
        text: `${top.source}: removed safehouse in ${cityDef(ans.city).name}`,
      });
      break;
    }

    case "forecast": {
      const ans = answer as Extract<Answer, { t: "forecast" }>;
      game.pending.shift();
      const byId = new Map(top.cards.map((card) => [card.id, card]));
      const reordered = ans.order.map((id) => byId.get(id)!);
      game.threatDeck = [...reordered, ...game.threatDeck.slice(top.cards.length)];
      game.peekedThreatCards = reordered.slice(0, 2);
      log(game, {
        t: "note",
        text: `${top.seat} reordered top ${reordered.length} Threat cards via Forecast`,
      });
      break;
    }

    case "border-security": {
      const ans = answer as Extract<Answer, { t: "border-security" }>;
      const curSeat = top.seatsLeft[0]!;
      const loc = game.players[curSeat].location;
      if (ans.done || !ans.neighbor) {
        top.seatsLeft.shift();
        top.placedByCurrent = 0;
        if (top.seatsLeft.length === 0) game.pending.shift();
        break;
      }
      if (ans.relocateFrom) {
        const [rx, ry] = canonicalEdge(ans.relocateFrom[0], ans.relocateFrom[1]);
        const idx = game.checkpoints.findIndex(([a, b]) => a === rx && b === ry);
        if (idx !== -1) game.checkpoints.splice(idx, 1);
      } else {
        game.supplies.checkpointTokens -= 1;
      }
      game.checkpoints.push(canonicalEdge(loc, ans.neighbor));
      top.placedByCurrent += 1;
      log(game, {
        t: "note",
        text: `Border Security (${curSeat}): placed Checkpoint between ${cityDef(loc).name} and ${cityDef(ans.neighbor).name}`,
      });
      const moreAdj = cityDef(loc).connections.some((nb) => !hasCheckpoint(game, loc, nb));
      if (top.placedByCurrent >= 2 || !moreAdj) {
        top.seatsLeft.shift();
        top.placedByCurrent = 0;
        if (top.seatsLeft.length === 0) game.pending.shift();
      }
      break;
    }

    case "room-choice": {
      const ans = answer as Extract<Answer, { t: "room-choice" }>;
      game.pending.shift();
      const seat = top.seat;
      const p = game.players[seat];
      switch (ans.choice.room) {
        case "pearl-loading-dock": {
          if (ans.choice.skip) break;
          const trialObj = game.objectives.find(
            (o) => o.kind === "disrupt-trial" && o.status === "active",
          )!;
          const targetCity = ans.choice.trialCity;
          const idx = trialObj.trialCardIds.findIndex((id) => cityOfCard(game, id) === targetCity);
          if (idx !== -1) {
            const [cardId] = trialObj.trialCardIds.splice(idx, 1) as [CardId];
            p.hand.push(cardId);
            log(game, {
              t: "infiltration",
              seat,
              site: "pearl",
              room: "pearl-loading-dock",
              detail: `Took ${cityDef(targetCity).name} from Disrupt Trial into hand -> Debrief 105`,
            });
            readDebrief(world, 105, { seat, objective: trialObj });
            ensureHandLimitDecisions(world);
          }
          break;
        }
        case "pearl-control-room": {
          if (ans.choice.skip) break;
          const city = cityOfCard(game, ans.choice.card)!;
          const reg = cityDef(city).region;
          discardFromHand(game, seat, ans.choice.card);
          game.satellites = game.satellites.filter((r) => r !== reg);
          game.supplies.satellites += 1;
          if (!c.destroyedSatellites.includes(reg)) c.destroyedSatellites.push(reg);
          // Also remove satellite card from player deck/discard if present
          const satId = `satellite:${reg}`;
          game.playerDeck = game.playerDeck.filter((id) => id !== satId);
          game.playerDiscard = game.playerDiscard.filter((id) => id !== satId);
          log(game, { t: "satellite", region: reg, action: "destroyed" });
          log(game, {
            t: "infiltration",
            seat,
            site: "pearl",
            room: "pearl-control-room",
            detail: `Destroyed ${pack.regionNames[reg]} Satellite permanently`,
          });
          break;
        }
        case "pearl-courtyard": {
          if (!ans.choice.take) break;
          const got = giveActionTokens(game, seat, 2);
          log(game, {
            t: "infiltration",
            seat,
            site: "pearl",
            room: "pearl-courtyard",
            detail: `Scratched 1 cover to take ${got} Action token(s)`,
          });
          queueCoverLoss(world, seat, 1, "PEARL Courtyard");
          break;
        }
        case "pearl-archives": {
          const idx = game.playerDiscard.indexOf(ans.choice.card);
          const [cardId] = game.playerDiscard.splice(idx, 1) as [CardId];
          p.hand.push(cardId);
          log(game, {
            t: "infiltration",
            seat,
            site: "pearl",
            room: "pearl-archives",
            detail: `Took ${cityDef(cityOfCard(game, cardId)!).name} from Player discard`,
          });
          ensureHandLimitDecisions(world);
          break;
        }
        case "pearl-directors-office": {
          if (ans.choice.skip) break;
          for (const cardId of ans.choice.cards) {
            const idx = game.playerDiscard.indexOf(cardId);
            if (idx !== -1) {
              game.playerDiscard.splice(idx, 1);
              p.hand.push(cardId);
            }
          }
          log(game, {
            t: "infiltration",
            seat,
            site: "pearl",
            room: "pearl-directors-office",
            detail: `Scratched 1 cover to take ${ans.choice.cards.length} City card(s) from discard`,
          });
          queueCoverLoss(world, seat, 1, "PEARL Director's Office");
          ensureHandLimitDecisions(world);
          break;
        }
        case "pearl-access-panel": {
          if (ans.choice.skip) break;
          const { tokenA, tokenB } = ans.choice;
          const tokens = game.infiltrationSites.pearl!.tokens;
          const a = tokens.find((t) => t.id === tokenA)!;
          const b = tokens.find((t) => t.id === tokenB)!;
          const tmp = a.symbol;
          a.symbol = b.symbol;
          b.symbol = tmp;
          log(game, {
            t: "infiltration",
            seat,
            site: "pearl",
            room: "pearl-access-panel",
            detail: `Swapped Security tokens ${a.id} and ${b.id}`,
          });
          break;
        }
        case "lg-briefing-room": {
          if (ans.choice.skip) break;
          const evId = `event:${ans.choice.event}`;
          game.playerCards[evId] = { id: evId, kind: "event", event: ans.choice.event };
          p.hand.push(evId);
          log(game, {
            t: "infiltration",
            seat,
            site: "langley",
            room: "lg-briefing-room",
            detail: `Scratched 2 cover to take ${pack.eventById[ans.choice.event].name} from reserve`,
          });
          queueCoverLoss(world, seat, 2, "Langley Briefing Room");
          ensureHandLimitDecisions(world);
          break;
        }
        case "lg-armory": {
          if (ans.choice.skip) break;
          if (p.passport) {
            assignFreeAsset(world, p.passport, "allied", ans.choice.asset, ans.choice.city);
            log(game, {
              t: "infiltration",
              seat,
              site: "langley",
              room: "lg-armory",
              detail: `Added free ${pack.assetById[ans.choice.asset].name} to ${p.passport} Allied alias`,
            });
          }
          break;
        }
      }
      break;
    }
  }

  autoResolve(world);
}

/** Resolves an ignored Door 14 briefcase later in lobby or upkeep. */
export function resolveIgnoredDoor14(world: World, choice: "open" | "blow-up"): void {
  if (choice === "open") {
    openDoor(world, "19");
  } else {
    openDoor(world, "24");
  }
}

/** Cleans up satisfied hand-limit prompts and drains any queued cover losses. */
export function autoResolve(world: World): void {
  const game = world.game;
  if (!game) return;

  // Drop hand-limit decisions that are already satisfied (or moot once the game has ended)
  game.pending = game.pending.filter((d) => {
    if (d.t !== "hand-limit") return true;
    if (game.outcome) return false;
    const p = game.players[d.seat];
    return p.hand.length > handLimit(world, d.seat) && discardableHandCards(game, d.seat).length > 0;
  });

  // Always drain queued cover losses — including postgame debrief cover losses (e.g. Debrief 225, 231)
  drainCoverQueue(world);

  if (game.outcome) return;
  ensureHandLimitDecisions(world);
  checkAllObjectivesResolved(world);
}
