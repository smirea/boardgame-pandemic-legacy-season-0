import { pack } from "./content/pack";
import {
  activeAssets,
  activeTeamsInCity,
  availableTempAliases,
  checkPursuitComplete,
  cityDef,
  createdUnburnedAliases,
  currentOccupation,
  effectiveSurveillance,
  ensureHandLimitDecisions,
  findAsset,
  giveActionTokens,
  giveSymptomCard,
  hasCheckpoint,
  hasLiability,
  hasRule,
  isTeamActive,
  liabilityRegion,
  log,
  markUnknownElimination,
  queueCoverLoss,
  revealAdjacentSecurityTokens,
} from "./helpers";
import type {
  Affiliation,
  CardId,
  CityId,
  EventId,
  InfiltrationSiteId,
  PassportColor,
  RegionId,
  SeatId,
  SecuritySymbol,
  TeamId,
} from "./ids";
import { readDebrief, readLegacySetup } from "./legacy";
import { nextInt, shuffle } from "./rng";
import type {
  ActiveInfiltrationSite,
  ActiveObjective,
  Game,
  GameCity,
  PlayerState,
  TeamPiece,
  ThreatCard,
  World,
} from "./state";

export type SeatingInput = { seat: SeatId; passport: PassportColor | null };

export function endGameNow(world: World, reason: string): void {
  const game = world.game;
  if (!game || game.outcome) return;
  game.outcome = { ended: true, reason, evaluation: null };
  game.pending = [];
  game.coverQueue = [];
  log(game, { t: "end", evaluation: null, reason });
}

export function isOver(world: World): boolean {
  return world.game?.outcome !== null && world.game?.outcome !== undefined;
}

export function checkAllObjectivesResolved(world: World): void {
  const game = world.game;
  if (!game || game.outcome || game.objectives.length === 0) return;
  // Wait for any Debrief decisions (e.g. file-report Ops 60/61, december-choice) before ending the game
  if (game.pending.length > 0 || game.coverQueue.length > 0) return;
  if (game.objectives.every((o) => o.status !== "active")) {
    endGameNow(world, "All objectives have been completed or failed");
  }
}

export function addAgentsToCity(world: World, city: CityId, count: number): CityId[] {
  const game = world.game!;
  const loc = game.locations[city];
  const incidentCities: CityId[] = [];
  for (let i = 0; i < count; i++) {
    if (game.outcome) break;
    if (loc.agents >= 3) {
      incidentCities.push(city);
      break;
    }
    if (game.supplies.agents <= 0) {
      endGameNow(world, `Needed to place an agent in ${cityDef(city).name} but agent supply is empty`);
      break;
    }
    loc.agents += 1;
    game.supplies.agents -= 1;
  }
  return incidentCities;
}

/**
 * Resolves an Incident wave (rulebook p. 14):
 * Places an Incident token in each city in `cities`, scratches cover of players there without a safehouse,
 * draws ONE bottom Threat card to Game End Area and resolves its Incident effect, looping if that triggers
 * further 4th-agent incidents.
 */
export function resolveIncidentWave(world: World, initialCities: CityId[]): void {
  const game = world.game!;
  let wave = [...new Set(initialCities)];

  while (wave.length > 0 && !game.outcome) {
    // 1. Place Incident tokens & apply local cover loss + Recognized liability
    for (const city of wave) {
      if (game.supplies.incidentOutbreakTokens <= 0) {
        endGameNow(
          world,
          `Needed to place an Incident token in ${cityDef(city).name} but Incident/Outbreak supply is empty`,
        );
        return;
      }
      game.locations[city].incidents += 1;
      game.supplies.incidentOutbreakTokens -= 1;
      game.stats.incidents += 1;

      const incRegion = cityDef(city).region;
      for (const seat of game.seats) {
        const p = game.players[seat];
        if (p.infiltration) continue;
        if (p.location === city && !game.locations[city].safehouse) {
          queueCoverLoss(world, seat, 1, `Incident in ${cityDef(city).name}`);
        }
        // Liability: RECOGNIZED (if you are in this region, lose a cover whenever an Incident token is added to it)
        if (
          hasLiability(world, seat, "recognized-region") &&
          liabilityRegion(world, seat, "recognized-region") === incRegion &&
          cityDef(p.location).region === incRegion
        ) {
          queueCoverLoss(world, seat, 1, `Recognized liability (Incident in ${pack.regionNames[incRegion]})`);
        }
      }
    }

    // 2. Draw ONE bottom Threat card (skipping Infection cards? Rulebook: bottom card of Threat deck!
    // Infection cards have no incident effect; if bottom card happens to be an infection card, place in Game End area with no effect.)
    if (game.threatDeck.length === 0) {
      log(game, { t: "note", text: "Threat deck empty; no bottom card to draw for incident effect" });
      return;
    }
    const bottom = game.threatDeck.pop()!;
    game.gameEndArea.push(bottom);
    game.peekedThreatCards = [];

    if (bottom.kind === "infection") {
      log(game, {
        t: "incident",
        city: wave[0]!,
        bottomCard: bottom.id,
        title: "INFECTION CARD DRAWN",
        detail: `Bottom card was Infection (${cityDef(bottom.city).name}); placed in Game End area (no incident effect).`,
      });
      return;
    }

    const def = cityDef(bottom.city);
    const eff = def.incidentEffect;
    const nextWave: CityId[] = [];

    switch (eff.kind) {
      case "sleeper-cells": {
        const targets = pack.cities.filter(
          (ct) => ct.region === eff.region && game.locations[ct.id].incidents > 0,
        );
        for (const ct of targets) {
          if (game.outcome) break;
          const inc = addAgentsToCity(world, ct.id, 1);
          nextWave.push(...inc);
        }
        log(game, {
          t: "incident",
          city: wave[0]!,
          bottomCard: bottom.id,
          title: def.incidentTitle,
          detail: `${def.incidentText} (affected ${targets.map((t) => t.name).join(", ") || "no cities"})`,
        });
        break;
      }
      case "safehouse-compromised": {
        const safehouses = pack.cities
          .filter((ct) => ct.region === eff.region && game.locations[ct.id].safehouse)
          .map((ct) => ct.id);
        if (safehouses.length === 1) {
          game.locations[safehouses[0]!].safehouse = false;
          game.supplies.safehouses += 1;
          log(game, {
            t: "incident",
            city: wave[0]!,
            bottomCard: bottom.id,
            title: def.incidentTitle,
            detail: `${def.incidentText} (removed safehouse in ${cityDef(safehouses[0]!).name})`,
          });
        } else if (safehouses.length > 1) {
          log(game, {
            t: "incident",
            city: wave[0]!,
            bottomCard: bottom.id,
            title: def.incidentTitle,
            detail: `${def.incidentText} (choose 1 safehouse in ${pack.regionNames[eff.region]} to remove)`,
          });
          game.pending.push({
            t: "remove-safehouse",
            region: eff.region,
            source: `${def.name} (${def.incidentTitle})`,
          });
        } else {
          log(game, {
            t: "incident",
            city: wave[0]!,
            bottomCard: bottom.id,
            title: def.incidentTitle,
            detail: `${def.incidentText} (no safehouse in ${pack.regionNames[eff.region]})`,
          });
        }
        break;
      }
      case "recognized": {
        const affectedSeats: SeatId[] = [];
        for (const seat of game.seats) {
          const p = game.players[seat];
          if (p.infiltration) continue;
          const r = cityDef(p.location).region;
          if (eff.regions.includes(r) && !game.locations[p.location].safehouse) {
            affectedSeats.push(seat);
            queueCoverLoss(world, seat, 1, `Incident: ${def.incidentTitle} (${def.name})`);
          }
        }
        log(game, {
          t: "incident",
          city: wave[0]!,
          bottomCard: bottom.id,
          title: def.incidentTitle,
          detail: `${def.incidentText} (affected: ${affectedSeats.join(", ") || "none"})`,
        });
        break;
      }
      case "teams-compromised": {
        const shifted: string[] = [];
        for (const team of Object.values(game.teams)) {
          if (!team.city) continue;
          if (
            effectiveSurveillance(world, team.city) > 0 &&
            !game.locations[team.city].safehouse
          ) {
            const from = team.city;
            team.city = "washington";
            shifted.push(`${team.id} (${cityDef(from).name} -> Washington)`);
            log(game, {
              t: "team-move",
              team: team.id,
              from,
              to: "washington",
              by: "teams-compromised",
            });
            if (hasRule(world.campaign, "K") && isTeamActive(team) && game.locations.washington.pursuit) {
              game.locations.washington.pursuit = false;
              game.supplies.pursuitTokens += 1;
              checkAndCompletePursuitObjective(world, game.active);
            }
          }
        }
        log(game, {
          t: "incident",
          city: wave[0]!,
          bottomCard: bottom.id,
          title: def.incidentTitle,
          detail: `${def.incidentText} (shifted: ${shifted.join(", ") || "none"})`,
        });
        break;
      }
    }

    wave = [...new Set(nextWave)];
  }
}

/** Places 1 Disease cube in `city`, or resolves Outbreak + Chain Reaction Outbreaks (Rules Y, Z, AA). */
export function resolveDiseaseInfection(world: World, originCity: CityId): void {
  const game = world.game!;
  if (game.locations[originCity].diseaseCubes < 3) {
    if (game.supplies.diseaseCubes <= 0) {
      endGameNow(
        world,
        `Needed to add a Disease cube in ${cityDef(originCity).name} but Disease cube supply is empty`,
      );
      return;
    }
    game.locations[originCity].diseaseCubes += 1;
    game.supplies.diseaseCubes -= 1;
    return;
  }

  // Outbreak + BFS chain reactions (Rule Z: each city may outbreak at most once per Infection card)
  const outbroken = new Set<CityId>([originCity]);
  const queue: { city: CityId; chain: boolean }[] = [{ city: originCity, chain: false }];

  while (queue.length > 0 && !game.outcome) {
    const { city, chain } = queue.shift()!;
    if (game.supplies.incidentOutbreakTokens <= 0) {
      endGameNow(
        world,
        `Needed to place an Outbreak token in ${cityDef(city).name} but Incident/Outbreak supply is empty`,
      );
      return;
    }
    game.locations[city].outbreaks += 1;
    game.supplies.incidentOutbreakTokens -= 1;
    game.stats.outbreaks += 1;
    log(game, { t: "outbreak", city, chain });

    for (const neighbor of cityDef(city).connections) {
      if (outbroken.has(neighbor)) continue;
      if (game.locations[neighbor].diseaseCubes >= 3) {
        outbroken.add(neighbor);
        queue.push({ city: neighbor, chain: true });
      } else {
        if (game.supplies.diseaseCubes <= 0) {
          endGameNow(
            world,
            `Needed to add a Disease cube in ${cityDef(neighbor).name} during outbreak in ${cityDef(city).name}, but Disease cube supply is empty`,
          );
          return;
        }
        game.locations[neighbor].diseaseCubes += 1;
        game.supplies.diseaseCubes -= 1;
      }
    }
  }
}

export function createGame(world: World, seating: SeatingInput[]): void {
  const c = world.campaign;
  const prologueRestore = c.month === 0 ? (JSON.parse(JSON.stringify(c)) as typeof c) : null;

  const seats = seating.map((s) => s.seat);
  const locations = Object.fromEntries(
    pack.cities.map((city): [CityId, GameCity] => [
      city.id,
      {
        agents: 0,
        diseaseCubes: 0,
        safehouse: c.cities[city.id].permanentSafehouse,
        incidents: 0,
        outbreaks: 0,
        pursuit: false,
      },
    ]),
  ) as Record<CityId, GameCity>;

  const permanentSafehouseCount = Object.values(locations).filter((l) => l.safehouse).length;

  const teams: Record<TeamId, TeamPiece> = {};
  for (const aff of pack.affiliations) {
    for (let i = 1; i <= pack.supplies.teamsPerAffiliation; i++) {
      const id = `${aff}-${i}`;
      teams[id] = { id, affiliation: aff, city: null };
    }
  }

  const players = Object.fromEntries(
    seating.map(({ seat, passport }, idx): [SeatId, PlayerState] => {
      const prologueTemp =
        c.month === 0
          ? pack.occupations.filter((o) => o.affiliation === "allied")[idx]!.id
          : null;
      return [
        seat,
        {
          seat,
          passport: c.month === 0 ? null : passport,
          activeAlias: null,
          tempAlias: prologueTemp,
          needsTempAlias: false,
          location: "washington",
          infiltration: null,
          hand: [],
          actionTokens: 0,
          usedThisTurn: [],
        },
      ];
    }),
  ) as Record<SeatId, PlayerState>;

  const game: Game = {
    seats,
    players,
    active: seats[0]!,
    turn: 1,
    actionsLeft: 4,
    coverOfDarknessActive: false,
    ignoredRestrictionThisTurn: null,
    surveillanceChecked: false,
    openingThreatsLeft: 9,
    threatsLeft: 0,
    threatsDrawnThisTurn: 0,
    cardsDrawn: false,
    skipThreat: false,
    queuedEscalations: 0,
    hassledChecked: false,
    peekedThreatCards: [],
    threatLevelIndex: 0,
    locations,
    teams,
    checkpoints: [],
    satellites: [],
    supplies: {
      agents: pack.supplies.agents,
      incidentOutbreakTokens: pack.supplies.incidentOutbreakTokens,
      diseaseCubes: c.diseaseCubeSupplyMax,
      safehouses: pack.supplies.safehouses - permanentSafehouseCount,
      actionTokens: hasRule(c, "E") ? pack.supplies.actionTokens : 0,
      pursuitTokens: hasRule(c, "K") ? pack.supplies.pursuitTokens : 0,
      checkpointTokens: hasRule(c, "N") ? pack.supplies.checkpointTokens : 0,
      satellites: hasRule(c, "D") ? pack.supplies.satellites : 0,
      symptoms: hasRule(c, "H") ? [...pack.symptomNames] : [],
    },
    playerCards: {},
    playerDeck: [],
    playerDiscard: [],
    threatDeck: [],
    threatDiscard: [],
    gameEndArea: [],
    pickedEvents: [],
    discretionaryCheckedThisGame: 0,
    aliasesChosen: [],
    objectives: [],
    activeRestrictions: [...c.restrictions],
    infiltrationSites: {},
    loadingDockVisitsThisGame: 0,
    coverQueue: [],
    pending: [],
    stats: { incidents: 0, outbreaks: 0, escalations: 0 },
    outcome: null,
    endedVotes: [],
    postgameResolved: false,
    upkeep: null,
    log: [],
    nextSeq: 1,
    prologueRestore,
  };

  world.game = game;
  log(game, {
    t: "note",
    text: `Starting ${pack.monthNames[c.month]}${c.month > 0 ? ` (Attempt ${c.attempt})` : ""} with ${seats.length} players (Funding ${c.funding})`,
  });

  // Step 1 of Setup: Check Legacy Deck & prepare objectives
  if (c.door24CounterSurvPending && c.door24CounterSurvPending > 0) {
    const targetable = pack.cities.filter((ct) => c.cities[ct.id].surveillance > 0).length;
    if (targetable > 0) {
      game.pending.push({
        t: "place-counter-surveillance",
        remaining: c.door24CounterSurvPending,
        source: "Door 24 (New Zealand Briefcase)",
      });
    }
    c.door24CounterSurvPending = 0;
  }
  readLegacySetup(world);
}

/**
 * Runs once `setup.legacy` decisions are cleared, transitioning into `setup.threat`:
 * - Initializes Threat deck (48 shuffled city cards)
 * - Adds named Infection cards faceup to Threat discard (Rule B)
 * - Places starting-intensity Disease cubes (Rule C)
 * - Places Pursuit objective starting token
 * - Initializes Infiltration site security tokens (shared shuffled pool of 9 or 30 tokens)
 * - Default picks first `funding` unlocked Events for `setup.events`
 */
export function prepareThreatAndBoardSetup(world: World): void {
  const c = world.campaign;
  const game = world.game!;

  // Sync supplies that might have unlocked during setup.legacy
  game.supplies.diseaseCubes = c.diseaseCubeSupplyMax;
  if (hasRule(c, "E")) game.supplies.actionTokens = pack.supplies.actionTokens;
  if (hasRule(c, "K")) game.supplies.pursuitTokens = pack.supplies.pursuitTokens;
  if (hasRule(c, "N")) game.supplies.checkpointTokens = pack.supplies.checkpointTokens;
  if (hasRule(c, "D")) game.supplies.satellites = pack.supplies.satellites;
  if (hasRule(c, "H")) game.supplies.symptoms = [...pack.symptomNames];
  game.activeRestrictions = [...c.restrictions];

  // Threat deck: 48 city Threat cards, shuffled
  const cityThreats: ThreatCard[] = pack.cities.map((ct) => ({
    id: `threat-${ct.id}`,
    kind: "city",
    city: ct.id,
  }));
  game.threatDeck = shuffle(c.rng, cityThreats);
  game.threatDiscard = [];
  game.openingThreatsLeft = 9;

  // Rule B: Add all named Infection cards faceup to Threat discard pile
  if (hasRule(c, "B") && c.infectionCards.length > 0) {
    for (const inf of c.infectionCards) {
      game.threatDiscard.push({
        id: inf.id,
        kind: "infection",
        infectionId: inf.id,
        city: inf.city,
        startingIntensity: inf.startingIntensity,
      });
    }
    log(game, {
      t: "note",
      text: `Rule B setup: added ${c.infectionCards.length} Infection card(s) faceup to Threat discard (${c.infectionCards.map((inf) => cityDef(inf.city).name).join(", ")})`,
    });
  }

  // Rule C: Add Disease cubes to cities with a starting intensity
  if (hasRule(c, "C")) {
    const seeded: string[] = [];
    for (const inf of c.infectionCards) {
      if (inf.startingIntensity <= 0) continue;
      for (let i = 0; i < inf.startingIntensity; i++) {
        if (game.supplies.diseaseCubes <= 0) {
          endGameNow(world, `Ran out of Disease cubes during starting intensity setup in ${cityDef(inf.city).name}`);
          return;
        }
        game.locations[inf.city].diseaseCubes += 1;
        game.supplies.diseaseCubes -= 1;
      }
      seeded.push(`${cityDef(inf.city).name}(+${inf.startingIntensity})`);
    }
    if (seeded.length > 0) {
      log(game, {
        t: "note",
        text: `Rule C setup: placed starting-intensity Disease cubes in ${seeded.join(", ")}`,
      });
    }
  }

  // Pursuit objectives: place starting Pursuit token (unless already completed on attempt 1)
  for (const obj of game.objectives) {
    if (obj.kind === "pursuit" && obj.status === "active" && obj.pursuitStartCity) {
      if (game.supplies.pursuitTokens > 0) {
        game.locations[obj.pursuitStartCity].pursuit = true;
        game.supplies.pursuitTokens -= 1;
        log(game, {
          t: "pursuit",
          detail: `Placed starting Pursuit token in ${cityDef(obj.pursuitStartCity).name}`,
        });
      }
    }
  }

  // Infiltration sites: build shared shuffled Security token pool (9 from Box 0006 + 21 from Box 0003)
  const activeSites: InfiltrationSiteId[] = [];
  for (const obj of game.objectives) {
    if (obj.kind === "infiltration" && obj.infiltrationSite && !activeSites.includes(obj.infiltrationSite)) {
      activeSites.push(obj.infiltrationSite);
    }
  }
  // Once PEARL is opened (month >= 9), PEARL is always infiltrateable even if only for side rooms/Loading Dock
  if (c.openedBoxes.includes("0003") && !activeSites.includes("pearl")) {
    activeSites.push("pearl");
  }
  if (activeSites.length > 0) {
    const rawPool: SecuritySymbol[] = [
      ...pack.box0006Tokens,
      ...(c.openedBoxes.includes("0003") ? pack.box0003Tokens : []),
    ];
    const tokenPool = shuffle(c.rng, rawPool);
    let cursor = 0;
    for (const siteId of activeSites) {
      const siteDef = pack.sites[siteId];
      const placed: ActiveInfiltrationSite["tokens"] = [];
      for (const edge of siteDef.edges) {
        for (let slot = 0; slot < edge.securitySlots; slot++) {
          const sym = tokenPool[cursor++];
          if (!sym) throw new Error(`Security token pool exhausted while setting up ${siteId}`);
          placed.push({
            id: `${siteId}:${edge.id}:${slot}`,
            edgeId: edge.id,
            slotIndex: slot,
            symbol: sym,
            revealed: false,
          });
        }
      }
      game.infiltrationSites[siteId] = { site: siteId, tokens: placed };
    }
  }

  // Sabik branch November special setup bonuses:
  // sealed-11-03: immediately turn over 4 Security tokens in PEARL
  if (
    c.attempt === 1 &&
    game.objectives.some((o) => o.cardCode === "sealed-11-03" && o.status === "active") &&
    game.infiltrationSites.pearl
  ) {
    game.pending.push({
      t: "reveal-pearl-tokens",
      seat: game.seats[0]!,
      remaining: 4,
      source: "Legacy sealed-11-03 (Sabik's PEARL Intel)",
    });
  }
  // sealed-11-04: immediately place 1 Checkpoint token on the board
  if (
    c.attempt === 1 &&
    game.objectives.some((o) => o.cardCode === "sealed-11-04" && o.status === "active")
  ) {
    game.pending.push({
      t: "place-free-checkpoint",
      seat: game.seats[0]!,
      source: "Legacy sealed-11-04 (Sabik's Australian Contact)",
    });
  }

  // Default event selection equal to funding
  const count = Math.min(c.funding, c.unlockedEvents.length);
  game.pickedEvents = c.unlockedEvents.slice(0, count);
}

/** Flips 1 of the 9 opening Threat cards (3×3 agents, 3×2 agents, 3×1 agent). */
export function flipOpeningThreat(world: World): void {
  const game = world.game!;
  if (game.openingThreatsLeft <= 0 || game.outcome) return;
  const idx = 9 - game.openingThreatsLeft; // 0..8
  const agentsToAdd = idx < 3 ? 3 : idx < 6 ? 2 : 1;
  const card = game.threatDeck.shift()!;
  game.threatDiscard.push(card);
  game.openingThreatsLeft -= 1;

  if (card.kind === "city") {
    addAgentsToCity(world, card.city, agentsToAdd);
    log(game, {
      t: "threat",
      card: card.id,
      city: card.city,
      effect: `opening setup: +${agentsToAdd} agent(s)`,
    });
  }
}

function eligibleCitiesForUnknownObjective(world: World, obj: ActiveObjective): CityId[] {
  return pack.cities
    .filter((ct) => {
      if (obj.unknownRegion && ct.region !== obj.unknownRegion) return false;
      if (obj.unknownAffiliation && ct.affiliation !== obj.unknownAffiliation) return false;
      if (obj.unknownControlCentersOnly && !world.campaign.cities[ct.id].controlCenter) return false;
      return true;
    })
    .map((ct) => ct.id);
}

/**
 * Steps 7–9 & 11 of Setup:
 * - Removes objective target/trial City cards from the 48 City cards
 * - Adds chosen Events (+ Discretionary Budget extras) and Relapse (if in deck)
 * - Shuffles & deals starting hands (2p=4, 3p=3, 4p=2)
 * - Splits remaining cards into 5 piles (smaller piles on the right), shuffles 1 Escalation into each
 * - Adds Satellite cards (Rule D) into piles starting from the right
 * - Stacks left-to-right into `playerDeck`
 * - Randomly selects starting player
 * - Auto-assigns single-alias characters' activeAlias (if a passport has >1 unburned created alias, waits in `setup.aliases`!)
 */
export function setupPlayerDeck(world: World): void {
  const c = world.campaign;
  const game = world.game!;

  // Consume checked Discretionary Budget boxes
  if (game.discretionaryCheckedThisGame > 0 && c.discretionaryBudgetBoxesLeft !== null) {
    const before = c.discretionaryBudgetBoxesLeft;
    c.discretionaryBudgetBoxesLeft = Math.max(
      0,
      c.discretionaryBudgetBoxesLeft - game.discretionaryCheckedThisGame,
    );
    const remaining = c.discretionaryBudgetBoxesLeft;
    if (c.discretionaryBudgetBoxesLeft === 0) c.discretionaryBudgetBoxesLeft = null;
    log(game, {
      t: "note",
      text: `Discretionary Budget: checked ${game.discretionaryCheckedThisGame} box(es) (${before} → ${remaining} left${remaining === 0 ? "; card destroyed" : ""})`,
    });
  }

  // Create the 48 City Player cards
  const cityCardIdByCity = {} as Record<CityId, CardId>;
  const availableCityCardIds: CardId[] = [];
  for (const ct of pack.cities) {
    const id = `city:${ct.id}`;
    game.playerCards[id] = { id, kind: "city", city: ct.id };
    cityCardIdByCity[ct.id] = id;
    availableCityCardIds.push(id);
  }

  const removedIds = new Set<CardId>();

  // Set up unknown-city & disrupt-trial objectives by pulling cards out BEFORE dealing!
  for (const obj of game.objectives) {
    if (obj.status !== "active") continue;
    if (obj.kind === "unknown-city") {
      const pool = eligibleCitiesForUnknownObjective(world, obj).filter(
        (cid) => !removedIds.has(cityCardIdByCity[cid]),
      );
      if (pool.length === 0) {
        // Edge case: e.g. Dec Stop LION'S TOOTH with 0 Control Centers (impossible in real play, safe fallback)
        const fallback = pack.cities.filter((ct) => !removedIds.has(cityCardIdByCity[ct.id])).map((ct) => ct.id);
        const picked = shuffle(c.rng, fallback)[0]!;
        const cardId = cityCardIdByCity[picked];
        removedIds.add(cardId);
        obj.hiddenCardId = cardId;
      } else {
        const picked = shuffle(c.rng, pool)[0]!;
        const cardId = cityCardIdByCity[picked];
        removedIds.add(cardId);
        obj.hiddenCardId = cardId;
      }
    } else if (obj.kind === "disrupt-trial" && obj.trialRegion && obj.trialCount) {
      const pool = pack.cities
        .filter((ct) => ct.region === obj.trialRegion && !removedIds.has(cityCardIdByCity[ct.id]))
        .map((ct) => ct.id);
      const picked = shuffle(c.rng, pool).slice(0, obj.trialCount);
      obj.trialCardIds = picked.map((cid) => {
        const cardId = cityCardIdByCity[cid];
        removedIds.add(cardId);
        return cardId;
      });
      log(game, {
        t: "note",
        text: `Trial cities for ${obj.title}: ${picked.map((cid) => cityDef(cid).name).join(", ")}`,
      });
    }
  }

  // Remaining City cards + picked Event cards + Relapse (if active)
  const deckCards: CardId[] = availableCityCardIds.filter((id) => !removedIds.has(id));
  for (const ev of game.pickedEvents) {
    const id = `event:${ev}`;
    game.playerCards[id] = { id, kind: "event", event: ev };
    deckCards.push(id);
  }
  if (c.relapseInDeck) {
    const id = "relapse-09-11";
    game.playerCards[id] = { id, kind: "relapse" };
    deckCards.push(id);
  }

  const shuffled = shuffle(c.rng, deckCards);
  const handSize = game.seats.length === 2 ? 4 : game.seats.length === 3 ? 3 : 2;
  let relapseDealt = false;

  for (const seat of game.seats) {
    for (let i = 0; i < handSize; i++) {
      const cardId = shuffled.shift()!;
      const card = game.playerCards[cardId]!;
      if (card.kind === "relapse") {
        relapseDealt = true;
        game.playerDiscard.push(cardId);
      } else {
        game.players[seat].hand.push(cardId);
        if (card.kind === "city") markUnknownElimination(world, card.city);
      }
    }
  }

  if (relapseDealt) {
    triggerRelapse(world, "dealt during setup");
  }

  // Divide remaining cards into 5 piles as equal as possible, smaller piles toward the right
  const baseSize = Math.floor(shuffled.length / 5);
  const extra = shuffled.length % 5;
  const piles: CardId[][] = [];
  let cursor = 0;
  for (let p = 0; p < 5; p++) {
    const size = baseSize + (p < extra ? 1 : 0);
    piles.push(shuffled.slice(cursor, cursor + size));
    cursor += size;
  }

  // Shuffle 1 Escalation card into each of the 5 piles
  for (let p = 0; p < 5; p++) {
    const escId = `escalation-${p + 1}`;
    game.playerCards[escId] = { id: escId, kind: "escalation" };
    piles[p]!.push(escId);
  }

  // Rule D: Add Satellite cards to piles starting from the right (pile index 4 down to 0)
  if (hasRule(c, "D")) {
    const activeRegions = pack.regions.filter(
      (r) =>
        !c.destroyedSatellites.includes(r) &&
        pack.cities.some((ct) => ct.region === r && c.cities[ct.id].controlCenter),
    );
    const satRegions = shuffle(c.rng, activeRegions).slice(0, 5); // 6th card stays in reserve!
    for (let i = 0; i < satRegions.length; i++) {
      const region = satRegions[i]!;
      const satId = `satellite:${region}`;
      game.playerCards[satId] = { id: satId, kind: "satellite", region };
      const pileIdx = 4 - i;
      piles[pileIdx]!.push(satId);
    }
  }

  // Shuffle each pile independently and stack left (0) on top to right (4) on bottom
  game.playerDeck = piles.flatMap((pile) => shuffle(c.rng, pile));

  // Randomly select starting player (Rulebook Step 11)
  game.active = game.seats[nextInt(c.rng, game.seats.length)]!;

  // Resolve starting aliases: auto-select for Prologue or passports with <=1 unburned alias!
  game.aliasesChosen = [];
  for (const seat of game.seats) {
    const player = game.players[seat];
    if (c.month === 0 || !player.passport) {
      game.aliasesChosen.push(seat);
      continue;
    }
    const choices = createdUnburnedAliases(c, player.passport);
    if (choices.length === 0) {
      // All aliases of this passport are burned -> assign an unused temporary alias
      const avail = availableTempAliases(game);
      player.passport = null;
      player.activeAlias = null;
      player.tempAlias = avail[0] ?? "research-assistant";
      game.aliasesChosen.push(seat);
    } else if (choices.length === 1) {
      player.activeAlias = choices[0]!;
      game.aliasesChosen.push(seat);
    }
  }
}

export function allAliasesChosen(world: World): boolean {
  const game = world.game;
  if (!game) return false;
  return game.seats.every((s) => game.aliasesChosen.includes(s));
}

export function chooseStartingAlias(world: World, seat: SeatId, affiliation: Affiliation): void {
  const game = world.game!;
  game.players[seat].activeAlias = affiliation;
  if (!game.aliasesChosen.includes(seat)) game.aliasesChosen.push(seat);
}

/** Step 1 of Player Turn: Check Surveillance (+ start-of-turn Plastics Technician / Dr. Robert / burned Temp Alias). */
export function runCheckSurveillance(world: World): void {
  const game = world.game!;
  const seat = game.active;
  const player = game.players[seat];

  if (player.needsTempAlias) {
    game.pending.unshift({ t: "pick-temp-alias", seat });
    return;
  }

  game.surveillanceChecked = true;
  log(game, { t: "turn", turn: game.turn, seat });

  // Plastics Technician: if you begin your turn with this alias, take 1 Action token
  if (currentOccupation(world, seat) === "plastics-technician") {
    const got = giveActionTokens(game, seat, 1);
    if (got > 0) log(game, { t: "note", text: `Plastics Technician gained ${got} Action token` });
  }
  // Dr. Robert contact: if you start your turn in Dr. Robert's city, take 2 Action tokens
  const drRobert = findAsset(world, seat, "dr-robert");
  if (drRobert && drRobert.city === player.location && !player.infiltration) {
    const got = giveActionTokens(game, seat, 2);
    if (got > 0) log(game, { t: "note", text: `Dr. Robert granted ${got} Action token(s)` });
  }

  // Check Surveillance (ignored if in safehouse or in infiltration site)
  if (!player.infiltration && !game.locations[player.location].safehouse) {
    const surv = effectiveSurveillance(world, player.location);
    if (surv > 0) {
      queueCoverLoss(world, seat, surv, `Surveillance in ${cityDef(player.location).name}`);
    }
  }
}

/** Step 3 of Player Turn: Mop Up! */
export function runMopUp(world: World): void {
  const game = world.game!;
  const seat = game.active;
  const player = game.players[seat];

  // 1. Remove ALL agents in every city containing an active team
  for (const city of pack.cities) {
    const loc = game.locations[city.id];
    if (loc.agents > 0 && activeTeamsInCity(game, city.id).length > 0) {
      game.supplies.agents += loc.agents;
      log(game, {
        t: "note",
        text: `Mop Up: active team removed ${loc.agents} agent(s) in ${city.name}`,
      });
      loc.agents = 0;
    }
  }

  // 2. Room Mop Up cover-scratch penalties (before Get Out shifts pawn out!)
  if (player.infiltration) {
    const room = player.infiltration.room;
    if (room === "ss-front-room" || room === "pearl-gatehouse" || room === "pearl-barracks") {
      queueCoverLoss(world, seat, 1, `Mop Up in ${pack.roomById[room].name}`);
    } else if (room === "pearl-greenhouse") {
      queueCoverLoss(world, seat, 2, `Mop Up in ${pack.roomById[room].name}`);
    }
    // 3. Rule V (Get Out!): shift pawn back to Infiltration city (no Symptom cards!)
    const siteCity = pack.sites[player.infiltration.site].city;
    player.infiltration = null;
    player.location = siteCity;
    log(game, {
      t: "note",
      text: `Get Out! shifted ${seat} back to ${cityDef(siteCity).name}`,
    });
  }

  // 4. Rule E: discard down to 3 Action tokens at end of Mop Up
  if (player.actionTokens > 3) {
    const excess = player.actionTokens - 3;
    player.actionTokens = 3;
    game.supplies.actionTokens += excess;
    log(game, { t: "note", text: `${seat} discarded ${excess} excess Action token(s) down to 3` });
  }

  game.cardsDrawn = false;
  game.hassledChecked = false;
  game.queuedEscalations = 0;
}

function triggerRelapse(world: World, when: string): void {
  const game = world.game!;
  log(game, { t: "note", text: `RELAPSE triggered (${when})!` });
  for (const seat of game.seats) {
    const p = game.players[seat];
    if (!p.passport) continue;
    const count = world.campaign.passports[p.passport].chronicInfections * 2;
    for (let i = 0; i < count; i++) {
      giveSymptomCard(world, seat);
    }
  }
  ensureHandLimitDecisions(world);
}

/** Step 4 of Player Turn: Draw 2 Player Cards together! */
export function drawTwoPlayerCards(world: World): void {
  const game = world.game!;
  const seat = game.active;
  game.cardsDrawn = true;
  if (game.playerDeck.length < 2) {
    endGameNow(world, "Cannot draw 2 Player cards — Player deck exhausted");
    return;
  }

  const drawn = [game.playerDeck.shift()!, game.playerDeck.shift()!];
  log(game, { t: "draw", seat, cards: drawn });

  const satellites: RegionId[] = [];
  let escalations = 0;
  let relapseCount = 0;
  const drawnCities: CityId[] = [];

  for (const cardId of drawn) {
    const card = game.playerCards[cardId]!;
    if (card.kind === "satellite") {
      satellites.push(card.region);
      game.playerDiscard.push(cardId);
    } else if (card.kind === "escalation") {
      escalations += 1;
      game.playerDiscard.push(cardId);
    } else if (card.kind === "relapse") {
      relapseCount += 1;
      game.playerDiscard.push(cardId);
    } else {
      game.players[seat].hand.push(cardId);
      if (card.kind === "city") {
        drawnCities.push(card.city);
        markUnknownElimination(world, card.city);
      }
    }
  }

  // Rule W: Resolve Satellite cards FIRST before Escalations!
  for (const region of satellites) {
    if (!game.satellites.includes(region) && game.supplies.satellites > 0) {
      game.satellites.push(region);
      game.supplies.satellites -= 1;
      log(game, { t: "satellite", region, action: "launched" });
    }
  }

  // Resolve Relapse if drawn
  for (let i = 0; i < relapseCount; i++) {
    triggerRelapse(world, "drawn from Player deck");
  }

  // Monitored liabilities: if you draw 2 City cards of matching affiliation at end of turn, lose 1 cover
  if (drawnCities.length === 2) {
    const a1 = cityDef(drawnCities[0]!).affiliation;
    const a2 = cityDef(drawnCities[1]!).affiliation;
    if (a1 === a2) {
      const libMap = {
        soviet: "monitored-soviet",
        neutral: "monitored-neutral",
        allied: "monitored-allied",
      } as const;
      if (hasLiability(world, seat, libMap[a1])) {
        queueCoverLoss(world, seat, 1, `Monitored (${a1}) liability`);
      }
    }
  }

  // Queue Escalations (resolved BEFORE hand limit per rulebook p. 15!)
  if (escalations > 0) {
    game.queuedEscalations = escalations;
    game.pending.unshift({
      t: "escalation",
      step: "increase",
      escalationsLeft: escalations,
    });
  } else {
    finalizePostDrawChecks(world);
  }
}

/** Advances one explicit step of an Escalation card (so Counter-Intelligence can intervene before Intensify!). */
export function advanceEscalationStep(world: World): void {
  const game = world.game!;
  const dec = game.pending[0];
  if (!dec || dec.t !== "escalation") return;

  if (dec.step === "increase") {
    game.stats.escalations += 1;
    if (game.threatLevelIndex < pack.threatTrack.length - 1) {
      game.threatLevelIndex += 1;
    }
    const level = pack.threatTrack[game.threatLevelIndex]!;
    log(game, {
      t: "escalation",
      step: "increase",
      detail: `Threat Level marker advanced to slot ${game.threatLevelIndex + 1}/${pack.threatTrack.length} (Threat Level ${level})`,
    });
    dec.step = "add-agents";
    return;
  }

  if (dec.step === "add-agents") {
    game.peekedThreatCards = [];
    if (game.threatDeck.length === 0) {
      log(game, { t: "escalation", step: "add-agents", detail: "Threat deck empty" });
      dec.step = "intensify";
      return;
    }
    const bottom = game.threatDeck.pop()!;
    game.threatDiscard.push(bottom);
    if (bottom.kind === "city") {
      dec.drawnBottomCity = bottom.city;
      const loc = game.locations[bottom.city];
      let added = 0;
      let incidentTriggered = false;
      for (let i = 0; i < 3; i++) {
        if (game.outcome) break;
        if (loc.agents >= 3) {
          incidentTriggered = true;
          break;
        }
        if (game.supplies.agents <= 0) {
          endGameNow(
            world,
            `Needed to place an agent in ${cityDef(bottom.city).name} during Escalation but supply is empty`,
          );
          return;
        }
        loc.agents += 1;
        game.supplies.agents -= 1;
        added += 1;
      }
      log(game, {
        t: "escalation",
        step: "add-agents",
        detail: `Bottom Threat card ${cityDef(bottom.city).name}: +${added} agent(s)${incidentTriggered ? " + INCIDENT" : ""}`,
      });
      dec.step = "intensify";
      if (incidentTriggered) {
        resolveIncidentWave(world, [bottom.city]);
      }
    } else {
      // Bottom card was an Infection card (rare edge case if threat deck reshuffled oddly)
      log(game, {
        t: "escalation",
        step: "add-agents",
        detail: `Bottom card was Infection (${cityDef(bottom.city).name}); placed in Threat discard`,
      });
      resolveDiseaseInfection(world, bottom.city);
      dec.step = "intensify";
    }
    return;
  }

  if (dec.step === "intensify") {
    const reshuffled = shuffle(world.campaign.rng, game.threatDiscard);
    game.threatDeck = [...reshuffled, ...game.threatDeck];
    game.threatDiscard = [];
    game.peekedThreatCards = [];
    log(game, {
      t: "escalation",
      step: "intensify",
      detail: `Shuffled ${reshuffled.length} Threat discard card(s) onto top of Threat deck`,
    });

    if (hasRule(world.campaign, "X") && hasActivePursuitObjective(game)) {
      dec.step = "pursuit";
      return;
    }
    finishOneEscalation(world, dec.escalationsLeft);
    return;
  }

  if (dec.step === "pursuit") {
    resolveEscalationPursuitStep(world);
    finishOneEscalation(world, dec.escalationsLeft);
  }
}

function hasActivePursuitObjective(game: Game): boolean {
  return game.objectives.some((o) => o.kind === "pursuit" && o.status === "active");
}

function finishOneEscalation(world: World, escalationsLeft: number): void {
  const game = world.game!;
  game.pending.shift();
  const nextLeft = escalationsLeft - 1;
  game.queuedEscalations = nextLeft;
  if (nextLeft > 0 && !game.outcome) {
    game.pending.unshift({ t: "escalation", step: "increase", escalationsLeft: nextLeft });
  } else if (!game.outcome) {
    finalizePostDrawChecks(world);
  }
}

/** Rule X: Add a Pursuit token to every city adjacent to a city already containing a Pursuit token. */
function resolveEscalationPursuitStep(world: World): void {
  const game = world.game!;
  const pursuitObj = game.objectives.find((o) => o.kind === "pursuit" && o.status === "active");
  if (!pursuitObj) return;

  const existing = pack.cities.filter((ct) => game.locations[ct.id].pursuit).map((ct) => ct.id);
  const toAdd = new Set<CityId>();
  for (const city of existing) {
    for (const neighbor of cityDef(city).connections) {
      if (game.locations[neighbor].pursuit) continue;
      if (hasCheckpoint(game, city, neighbor)) continue;
      if (activeTeamsInCity(game, neighbor).length > 0) continue;
      toAdd.add(neighbor);
    }
  }

  let failedReason: string | null = null;
  const placed: CityId[] = [];
  for (const city of toAdd) {
    if (game.supplies.pursuitTokens <= 0) {
      failedReason = "Needed to place a Pursuit token but supply is empty";
      break;
    }
    game.locations[city].pursuit = true;
    game.supplies.pursuitTokens -= 1;
    placed.push(city);
    if (cityDef(city).affiliation === "soviet") {
      failedReason = `Pursuit token reached Soviet city ${cityDef(city).name}`;
    }
  }

  log(game, {
    t: "pursuit",
    detail: `Escalation Pursuit spread to: ${placed.map((c) => cityDef(c).name).join(", ") || "none"}${failedReason ? ` -> FAILED (${failedReason})` : ""}`,
  });

  if (failedReason) {
    pursuitObj.status = "failed";
    const debriefNum =
      world.campaign.attempt === 2 && pursuitObj.debriefFailAttempt2 !== undefined
        ? pursuitObj.debriefFailAttempt2
        : pursuitObj.debriefFail;
    log(game, {
      t: "objective",
      objective: pursuitObj.id,
      status: "failed",
      detail: `${pursuitObj.title}: ${failedReason}`,
    });
    readDebrief(world, debriefNum, { objective: pursuitObj });
    checkAllObjectivesResolved(world);
  }
}

export function finalizePostDrawChecks(world: World): void {
  const game = world.game!;
  if (game.outcome) return;
  // Hand limit applies after resolving any Escalation cards drawn
  ensureHandLimitDecisions(world);
  // Hassled liabilities: if you end turn in matching city without safehouse, discard 1 card (after Draw Cards step)
  if (!game.hassledChecked) {
    game.hassledChecked = true;
    const seat = game.active;
    const player = game.players[seat];
    if (!player.infiltration && !game.locations[player.location].safehouse) {
      const aff = cityDef(player.location).affiliation;
      const libMap = {
        soviet: "hassled-soviet",
        neutral: "hassled-neutral",
        allied: "hassled-allied",
      } as const;
      if (hasLiability(world, seat, libMap[aff])) {
        const discardable = player.hand.filter((id) => game.playerCards[id]?.kind !== "symptom");
        if (discardable.length > 0) {
          game.pending.push({
            t: "discard-card",
            seat,
            remaining: 1,
            source: `Hassled (${aff}) liability`,
          });
        }
      }
    }
  }
}

export function startThreatStep(world: World): void {
  const game = world.game!;
  game.threatsDrawnThisTurn = 0;
  game.threatsLeft = game.skipThreat ? 0 : pack.threatTrack[game.threatLevelIndex]!;
  if (game.skipThreat) {
    log(game, { t: "note", text: "One Quiet Night skipped the Draw Threat Cards step" });
  }
}

/** Flips 1 Threat/Infection card during Step 5 (Draw Threat Cards). */
export function drawOneThreatCard(world: World): void {
  const game = world.game!;
  if (game.threatsLeft <= 0 || game.outcome) return;
  game.threatsLeft -= 1;
  game.threatsDrawnThisTurn += 1;

  if (game.threatDeck.length === 0) {
    log(game, { t: "note", text: "Threat deck empty; no card drawn" });
    return;
  }

  const card = game.threatDeck.shift()!;
  game.threatDiscard.push(card);
  if (game.peekedThreatCards.length > 0 && game.peekedThreatCards[0]?.id === card.id) {
    game.peekedThreatCards.shift();
  } else {
    game.peekedThreatCards = [];
  }

  if (card.kind === "infection") {
    const beforeOutbreaks = game.stats.outbreaks;
    const endedBefore = game.outcome !== null;
    resolveDiseaseInfection(world, card.city);
    log(game, {
      t: "threat",
      card: card.id,
      city: card.city,
      effect:
        !endedBefore && game.outcome
          ? "FAILED (Disease cube supply empty)"
          : game.stats.outbreaks > beforeOutbreaks
            ? "INFECTION -> OUTBREAK"
            : "INFECTION (+1 Disease cube)",
    });
    return;
  }

  const endedBefore = game.outcome !== null;
  const inc = addAgentsToCity(world, card.city, 1);
  const incidentSupplyEmpty = inc.length > 0 && game.supplies.incidentOutbreakTokens <= 0;
  log(game, {
    t: "threat",
    card: card.id,
    city: card.city,
    effect:
      !endedBefore && game.outcome
        ? "FAILED (agent supply empty)"
        : incidentSupplyEmpty
          ? "FAILED (Incident supply empty)"
          : inc.length > 0
            ? "INCIDENT (4th agent)"
            : "+1 agent",
  });
  if (inc.length > 0) {
    resolveIncidentWave(world, inc);
  }
}

/** Finishes current player's turn (Followed liability + clockwise handoff). */
export function finishTurn(world: World): void {
  const game = world.game!;
  const seat = game.active;
  const player = game.players[seat];

  // Followed liabilities: if you end your turn in a matching city without an agent, add 1 agent
  if (!player.infiltration && game.locations[player.location].agents === 0) {
    const aff = cityDef(player.location).affiliation;
    const libMap = {
      soviet: "followed-soviet",
      neutral: "followed-neutral",
      allied: "followed-allied",
    } as const;
    if (hasLiability(world, seat, libMap[aff])) {
      addAgentsToCity(world, player.location, 1);
      log(game, {
        t: "note",
        text: `Followed (${aff}) liability added 1 agent to ${cityDef(player.location).name}`,
      });
      if (game.outcome) return;
    }
  }

  const nextIdx = (game.seats.indexOf(seat) + 1) % game.seats.length;
  game.active = game.seats[nextIdx]!;
  game.turn += 1;
  game.actionsLeft = 4;
  game.coverOfDarknessActive = false;
  game.ignoredRestrictionThisTurn = null;
  game.surveillanceChecked = false;
  game.cardsDrawn = false;
  game.threatsDrawnThisTurn = 0;
  game.skipThreat = false;
  game.hassledChecked = false;
  game.players[game.active].usedThisTurn = [];
}

/** Completes Pursuit objective immediately if active team removed the final Pursuit token. */
export function checkAndCompletePursuitObjective(world: World, seat: SeatId): void {
  const game = world.game;
  if (!game || !checkPursuitComplete(world)) return;
  const obj = game.objectives.find((o) => o.kind === "pursuit" && o.status === "active");
  if (!obj) return;
  obj.status = "completed";
  log(game, {
    t: "objective",
    objective: obj.id,
    status: "completed",
    detail: `Completed ${obj.title} — last Pursuit token removed`,
  });
  readDebrief(world, obj.debriefComplete, { seat, objective: obj });
  checkAllObjectivesResolved(world);
}

/** Helper used when entering an infiltration room to reveal adjacent tokens and trigger room entry effects. */
export function enterInfiltrationRoom(
  world: World,
  seat: SeatId,
  site: InfiltrationSiteId,
  room: keyof typeof pack.roomById,
): void {
  const game = world.game!;
  const c = world.campaign;
  const player = game.players[seat];
  player.infiltration = { site, room };

  const roomDef = pack.roomById[room];
  if (site === "pearl" && roomDef.pearlDoor !== undefined && !c.pearlOpenedDoors.includes(roomDef.pearlDoor)) {
    c.pearlOpenedDoors.push(roomDef.pearlDoor);
    const doorRooms = pack.sites.pearl.rooms.filter((r) => r.pearlDoor === roomDef.pearlDoor);
    const text = doorRooms.map((r) => `${r.name.toUpperCase()}\n${r.text}`).join("\n\n");
    log(game, {
      t: "infiltration",
      seat,
      site,
      room,
      detail: `Opened PEARL Door ${roomDef.pearlDoor}: ${doorRooms.map((r) => r.name).join(" & ")}`,
    });
    // Push full room text as a reading so players & bots see the newly uncovered PEARL area verbatim!
    const id = c.nextReadingId++;
    c.readings.push({
      id,
      kind: "room",
      ref: `pearl/door-${roomDef.pearlDoor}`,
      title: `PEARL Area ${roomDef.pearlDoor}: ${doorRooms.map((r) => r.name).join(" & ")}`,
      text,
      month: c.month,
      gameIndex: c.results.length,
    });
    log(game, {
      t: "reading",
      readingId: id,
      kind: "room",
      ref: `pearl/door-${roomDef.pearlDoor}`,
      title: `PEARL Area ${roomDef.pearlDoor}: ${doorRooms.map((r) => r.name).join(" & ")}`,
    });
  }

  const flipped = revealAdjacentSecurityTokens(game, site, room);
  log(game, {
    t: "infiltration",
    seat,
    site,
    room,
    detail: `Entered ${roomDef.name} (${flipped} security token(s) revealed)`,
  });

  // Trigger room entry effects!
  switch (room) {
    case "hq-office":
    case "pearl-manufacturing-facility": {
      const got = giveActionTokens(game, seat, 1);
      if (got > 0) log(game, { t: "note", text: `${roomDef.name}: gained ${got} Action token` });
      break;
    }
    case "pearl-records-room": {
      if (c.pearlDoor41Placed) {
        // Door 41 overrides Records Room: reveal City card underneath Stop Operation LION'S TOOTH!
        const lion = game.objectives.find(
          (o) => (o.cardCode === "12-05" || o.cardCode === "sealed-12-04") && o.status === "active",
        );
        if (lion && !lion.targetRevealed) {
          lion.targetRevealed = true;
          const hidden = lion.hiddenCardId ? game.playerCards[lion.hiddenCardId] : null;
          if (hidden?.kind === "city") lion.revealedTargetCity = hidden.city;
          const cityName = hidden?.kind === "city" ? cityDef(hidden.city).name : "unknown";
          log(game, {
            t: "note",
            text: `Records Room (Door 41): revealed Operation LION'S TOOTH target city — ${cityName}!`,
          });
        }
      } else {
        const got = giveActionTokens(game, seat, 1);
        if (got > 0) log(game, { t: "note", text: `Records Room: gained ${got} Action token` });
      }
      break;
    }
    case "hq-security":
      queueCoverLoss(world, seat, 1, "Sabik's HQ Security Room");
      break;
    case "pearl-holding-cells":
      queueCoverLoss(world, seat, 3, "PEARL Holding Cells");
      break;
    case "pearl-monitoring-room": {
      const unrevealed = game.infiltrationSites.pearl?.tokens.filter((t) => !t.revealed).length ?? 0;
      if (unrevealed > 0) {
        game.pending.push({
          t: "reveal-pearl-tokens",
          seat,
          remaining: Math.min(2, unrevealed),
          source: "PEARL Monitoring Room",
        });
      }
      break;
    }
    case "pearl-loading-dock": {
      const hasTrialCards = game.objectives.some(
        (o) => o.kind === "disrupt-trial" && o.status === "active" && o.trialCardIds.length > 0,
      );
      if (hasTrialCards) {
        game.pending.push({ t: "room-choice", seat, room: "pearl-loading-dock" });
      }
      break;
    }
    case "pearl-control-room": {
      const canMatchSat = game.satellites.some((r) =>
        player.hand.some((id) => {
          const card = game.playerCards[id];
          return card?.kind === "city" && cityDef(card.city).region === r;
        }),
      );
      if (canMatchSat) {
        game.pending.push({ t: "room-choice", seat, room: "pearl-control-room" });
      }
      break;
    }
    case "pearl-courtyard": {
      if (game.supplies.actionTokens > 0) {
        game.pending.push({ t: "room-choice", seat, room: "pearl-courtyard" });
      }
      break;
    }
    case "pearl-archives": {
      const hasCityDiscard = game.playerDiscard.some((id) => game.playerCards[id]?.kind === "city");
      if (hasCityDiscard) {
        game.pending.push({ t: "room-choice", seat, room: "pearl-archives" });
      }
      break;
    }
    case "pearl-directors-office": {
      const hasCityDiscard = game.playerDiscard.some((id) => game.playerCards[id]?.kind === "city");
      if (hasCityDiscard) {
        game.pending.push({ t: "room-choice", seat, room: "pearl-directors-office" });
      }
      break;
    }
    case "pearl-access-panel": {
      const faceup = game.infiltrationSites.pearl?.tokens.filter((t) => t.revealed).length ?? 0;
      if (faceup >= 2) {
        game.pending.push({ t: "room-choice", seat, room: "pearl-access-panel" });
      }
      break;
    }
    case "lg-briefing-room": {
      const reserveEvents = c.unlockedEvents.filter(
        (ev) => !Object.values(game.playerCards).some((pc) => pc.kind === "event" && pc.event === ev),
      );
      if (reserveEvents.length > 0) {
        game.pending.push({ t: "room-choice", seat, room: "lg-briefing-room" });
      }
      break;
    }
    case "lg-armory": {
      const alliedAlias = player.passport ? c.passports[player.passport].aliases.allied : null;
      if (
        alliedAlias &&
        alliedAlias.created &&
        !alliedAlias.burned &&
        alliedAlias.assets.length < 3 &&
        c.availableAssets.length > 0
      ) {
        game.pending.push({ t: "room-choice", seat, room: "lg-armory" });
      }
      break;
    }
    default:
      break;
  }
}

export function isPlayerInActiveSite(world: World, seat: SeatId): boolean {
  return world.game?.players[seat]?.infiltration !== null;
}

export function activeEventsInReserve(world: World): EventId[] {
  const c = world.campaign;
  const game = world.game;
  if (!game) return [...c.unlockedEvents];
  return c.unlockedEvents.filter(
    (ev) => !Object.values(game.playerCards).some((pc) => pc.kind === "event" && pc.event === ev),
  );
}

export function unusedAssetSlots(world: World, seat: SeatId): number {
  const player = world.game?.players[seat];
  if (!player?.passport || !player.activeAlias) return 0;
  return Math.max(0, 3 - world.campaign.passports[player.passport].aliases[player.activeAlias].assets.length);
}

export function seatHasContact(world: World, seat: SeatId): boolean {
  return activeAssets(world, seat).some((a) => pack.assetById[a.id].category === "contact");
}
