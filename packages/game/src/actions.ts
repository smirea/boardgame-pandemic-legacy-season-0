import { pack } from "./content/pack";
import {
  checkAllObjectivesResolved,
  checkAndCompletePursuitObjective,
  enterInfiltrationRoom,
} from "./flow";
import {
  activeAliasOf,
  activeTeamsInCity,
  areAdjacent,
  canSatisfySecurityTokens,
  canonicalEdge,
  cityDef,
  cityDistance,
  cityOfCard,
  createdUnburnedAliases,
  currentOccupation,
  currentSpecialization,
  discardFromHand,
  ensureHandLimitDecisions,
  enterCity,
  findAsset,
  findInfiltrationEdge,
  giveActionTokens,
  giveSymptomCard,
  hasAsset,
  hasCheckpoint,
  hasLiability,
  hasRule,
  isRestrictionActive,
  isSymptomCard,
  isTeamActive,
  liabilityRegion,
  log,
  moveTeam,
  teamsInCity,
} from "./helpers";
import type {
  Affiliation,
  AssetId,
  CardId,
  CityId,
  InfiltrationSiteId,
  ObjectiveId,
  RestrictionId,
  RoomId,
  SeatId,
  TeamId,
} from "./ids";
import { readDebrief } from "./legacy";
import type { World } from "./state";

export type Action =
  // Core 10 actions
  | { a: "drive"; to: CityId; carryTeams?: TeamId[] }
  | { a: "commercial-flight"; card: CardId; extraCard?: CardId; carryTeams?: TeamId[] }
  | { a: "unrecorded-flight"; card: CardId; to: CityId; carryTeams?: TeamId[] }
  | { a: "neutralize-agent"; count?: 1 | 2 }
  | { a: "share-intel"; target: SeatId; card: CardId; direction: "give" | "take"; extraDiscard?: CardId }
  | { a: "build-safehouse"; card?: CardId; extraCard?: CardId; relocateFrom?: CityId }
  | { a: "identify-target-city"; objective: ObjectiveId; cards: CardId[] }
  | { a: "assemble-team"; cards: CardId[]; relocateTeam?: TeamId }
  | { a: "drive-team"; team: TeamId; to: CityId }
  | { a: "acquire-targets"; objective: ObjectiveId; targetCity?: CityId }
  // Unlocked rulebook & specialization actions
  | { a: "treat" }
  | { a: "disrupt-trial"; objective: ObjectiveId }
  | { a: "change-alias"; affiliation: Affiliation }
  | { a: "spend-action-token" }
  | { a: "create-checkpoint"; card: CardId; neighbor: CityId; relocateFrom?: [CityId, CityId] }
  | { a: "get-treatment"; card: CardId }
  | { a: "disable-satellite" }
  | { a: "enter-infiltration"; site: InfiltrationSiteId }
  | { a: "exit-infiltration" }
  | { a: "infiltrate"; to: RoomId; revealCards: CardId[] }
  | { a: "complete-infiltration-objective"; objective: ObjectiveId; cards: CardId[] }
  | { a: "unlock-hatchway"; edgeId: string; cards: CardId[] }
  // Occupation actions
  | { a: "coordinator-move"; target: { kind: "team"; team: TeamId } | { kind: "pawn"; seat: SeatId }; to: CityId }
  | { a: "clinic-planner-flight"; card: CardId; to: CityId }
  | { a: "aluminum-take"; from: SeatId; card: CardId }
  | { a: "cargo-pilot-flight"; to: CityId; carryTeams?: TeamId[] }
  | { a: "first-assistant-draw"; card: CardId }
  // Asset actions & free actions
  | { a: "visa-move"; asset: AssetId; carryTeams?: TeamId[] }
  | { a: "shop-owner-swap"; discardCards: [CardId, CardId]; takeCard: CardId }
  | { a: "crime-boss-remove"; city: CityId }
  | { a: "politician-give"; to: SeatId; card: CardId }
  | { a: "field-medic-treat"; city: CityId }
  | { a: "cobbler-convert"; cards: CardId[]; team: TeamId }
  | { a: "test-pilot-remove-satellite"; region: import("./ids").RegionId }
  | { a: "spy-camera-draw" }
  | { a: "auth-424-remove"; city: CityId }
  | { a: "auth-715-clear"; city: CityId }
  | { a: "auth-405-move-team"; card: CardId; team: TeamId }
  | { a: "black-book-safehouse"; card: CardId; relocateFrom?: CityId }
  | { a: "experimental-medicine-treat" }
  | { a: "unapproved-supplements-treat"; city: CityId }
  | { a: "tracking-device-peek" }
  | { a: "use-help-from-sabik"; restriction: RestrictionId };

export function isFreeAction(action: Action): boolean {
  return (
    action.a === "spend-action-token" ||
    action.a === "tracking-device-peek" ||
    action.a === "use-help-from-sabik"
  );
}

/** Whether executing `action` reveals hidden information (used for undo consensus if needed). */
export function actionReveals(world: World, action: Action): boolean {
  if (
    action.a === "identify-target-city" ||
    action.a === "acquire-targets" ||
    action.a === "enter-infiltration" ||
    action.a === "infiltrate" ||
    action.a === "tracking-device-peek" ||
    action.a === "complete-infiltration-objective" ||
    action.a === "disrupt-trial"
  ) {
    return true;
  }
  void world;
  return false;
}

function checkCarryTeams(world: World, seat: SeatId, carryTeams?: TeamId[]): string | null {
  if (!carryTeams || carryTeams.length === 0) return null;
  if (currentSpecialization(world, seat) !== "transport-crew") {
    return "Only Transport Crew specialization may carry teams when moving";
  }
  const game = world.game!;
  if (new Set(carryTeams).size !== carryTeams.length) return "Duplicate team in carryTeams";
  const here = game.players[seat].location;
  for (const tid of carryTeams) {
    if (!game.teams[tid] || game.teams[tid].city !== here) {
      return `Team ${tid} is not in your current city`;
    }
  }
  return null;
}

function badCity(city: CityId | undefined): string | null {
  if (!city || !(city in pack.cityById)) return `Unknown city '${String(city ?? "")}'`;
  return null;
}

function checkUniqueCityCardsInHand(
  world: World,
  seat: SeatId,
  cards: readonly CardId[],
): string | null {
  const game = world.game!;
  if (new Set(cards).size !== cards.length) return "Duplicate cards specified";
  for (const id of cards) {
    if (!game.players[seat].hand.includes(id)) return `Card ${id} is not in your hand`;
    if (game.playerCards[id]?.kind !== "city") return `Card ${id} is not a City card`;
  }
  return null;
}

/** Validates whether `seat` may execute `action` right now. Returns null if legal, else reason string. */
export function checkAction(world: World, seat: SeatId, action: Action): string | null {
  const game = world.game;
  if (!game) return "No game in progress";
  if (game.active !== seat) return "Not your turn";
  if (game.pending.length > 0) return "Resolve the pending choice first";
  const player = game.players[seat];
  if (player.needsTempAlias) return "Alias was burned; no actions remaining this turn";

  const free = isFreeAction(action);
  if (!free && game.actionsLeft <= 0) return "No actions left this turn";

  // Rule Q: While at an Infiltration site, you may do only Infiltrate, Enter/Exit, Complete Infiltration Objective, Unlock Hatchway, or free spend-action-token / help-from-sabik
  if (player.infiltration) {
    const allowedInSite = new Set<Action["a"]>([
      "exit-infiltration",
      "infiltrate",
      "complete-infiltration-objective",
      "unlock-hatchway",
      "spend-action-token",
      "tracking-device-peek",
      "use-help-from-sabik",
    ]);
    if (!allowedInSite.has(action.a)) {
      return "While at an Infiltration site, you may only Infiltrate, Exit, Unlock Hatchway, or complete the site objective";
    }
  }

  const loc = player.location;
  const locDef = cityDef(loc);
  const gameLoc = game.locations[loc];
  const occ = currentOccupation(world, seat);
  const spec = currentSpecialization(world, seat);

  switch (action.a) {
    case "spend-action-token":
      if (!hasRule(world.campaign, "E")) return "Action tokens are not unlocked";
      if (player.actionTokens <= 0) return "You have no Action tokens";
      return null;

    case "tracking-device-peek":
      if (!hasAsset(world, seat, "tracking-device")) return "Requires Tracking Device asset";
      if (player.usedThisTurn.includes("tracking-device")) return "Already used Tracking Device this turn";
      if (game.threatDeck.length === 0) return "Threat deck is empty";
      return null;

    case "use-help-from-sabik":
      if (
        world.campaign.helpFromSabikBoxesLeft === null ||
        world.campaign.helpFromSabikBoxesLeft <= 0
      ) {
        return "Help from Sabik is not available";
      }
      if (game.ignoredRestrictionThisTurn !== null) {
        return "Already ignoring a Restriction card this turn";
      }
      if (!game.activeRestrictions.includes(action.restriction)) {
        return "That Restriction card is not active";
      }
      return null;

    case "drive": {
      const cityErr = badCity(action.to);
      if (cityErr) return cityErr;
      if (!areAdjacent(loc, action.to)) return `${cityDef(action.to).name} is not adjacent to ${locDef.name}`;
      return checkCarryTeams(world, seat, action.carryTeams);
    }

    case "commercial-flight": {
      if (!player.hand.includes(action.card)) return "Card is not in your hand";
      const targetCity = cityOfCard(game, action.card);
      if (!targetCity) return "Must use a City card for Commercial Flight";
      if (targetCity === loc) return "Already in that city";
      const targetDef = cityDef(targetCity);
      if (targetDef.affiliation === "soviet" && !hasAsset(world, seat, "forged-papers")) {
        return "Cannot take a Commercial Flight to a Soviet city without Forged Papers";
      }
      if (hasLiability(world, seat, "watch-list")) {
        if (gameLoc.incidents > 0 || game.locations[targetCity].incidents > 0) {
          return "Watch List liability prevents Commercial Flight into or out of a city with an Incident token";
        }
      }
      // Restriction 56 (Hesitant): must discard an additional City card to Commercial Flight to a neutral city
      if (targetDef.affiliation === "neutral" && isRestrictionActive(game, "hesitant")) {
        if (!action.extraCard) return "Restriction Hesitant requires discarding an additional card";
        if (action.extraCard === action.card) return "Extra card must be distinct";
        if (!player.hand.includes(action.extraCard) || isSymptomCard(game, action.extraCard)) {
          return "Extra card must be a non-Symptom card in your hand";
        }
      } else if (action.extraCard) {
        return "No extra card required for this flight";
      }
      return checkCarryTeams(world, seat, action.carryTeams);
    }

    case "unrecorded-flight": {
      const cityErr = badCity(action.to);
      if (cityErr) return cityErr;
      if (!player.hand.includes(action.card)) return "Card is not in your hand";
      if (cityOfCard(game, action.card) !== loc) return "Must discard the City card matching your current city";
      if (action.to === loc) return "Already in that city";
      if (
        (locDef.affiliation === "soviet" && hasLiability(world, seat, "airports-alerted-soviet")) ||
        (locDef.affiliation === "neutral" && hasLiability(world, seat, "airports-alerted-neutral")) ||
        (locDef.affiliation === "allied" && hasLiability(world, seat, "airports-alerted-allied"))
      ) {
        return `Airports Alerted liability prevents Unrecorded Flight from ${locDef.affiliation} cities`;
      }
      return checkCarryTeams(world, seat, action.carryTeams);
    }

    case "neutralize-agent": {
      if (gameLoc.agents <= 0) return "No agents in your current city";
      if (hasLiability(world, seat, "authorities-watching") && gameLoc.incidents > 0) {
        return "Authorities Watching liability prevents Neutralize Agent in a city with an Incident token";
      }
      if (hasLiability(world, seat, "careless") && world.campaign.cities[loc].controlCenter) {
        return "Careless liability prevents Neutralize Agent in a city with a Control Center";
      }
      if (hasLiability(world, seat, "symptomatic")) {
        const symptoms = player.hand.filter((id) => isSymptomCard(game, id)).length;
        if (symptoms >= 2) return "Symptomatic liability prevents Neutralize Agent with 2 or more Symptom cards";
      }
      const want = action.count ?? 1;
      if (want === 2 && !hasAsset(world, seat, "gunbrella") && spec !== "deep-cover") {
        return "Need Gunbrella or Deep Cover to remove more than 1 agent";
      }
      return null;
    }

    case "share-intel": {
      if (action.target === seat || !game.seats.includes(action.target)) return "Pick another player";
      const other = game.players[action.target];
      if (other.infiltration || other.location !== loc) return "Other player must be in your city";
      if (isRestrictionActive(game, "erratic") && loc === "washington") {
        return "Restriction Erratic prevents Share Intel in Washington";
      }
      if (
        hasLiability(world, seat, "cipher-decoded") &&
        liabilityRegion(world, seat, "cipher-decoded") === locDef.region
      ) {
        return "Cipher Decoded liability prevents Share Intel in this region";
      }
      const giver = action.direction === "give" ? seat : action.target;
      const giverHand = game.players[giver].hand;
      if (!giverHand.includes(action.card)) return "Giver does not hold that card";
      const cardCity = cityOfCard(game, action.card);
      if (!cardCity) return "Can only Share Intel with a City card";
      const giverIsRA = currentOccupation(world, giver) === "research-assistant";
      if (cardCity !== loc && !giverIsRA) {
        return "Shared card must match your current city (unless giver is Research Assistant)";
      }
      // Restriction 58 (Soft): active player must discard a City card to do Share Intel
      if (isRestrictionActive(game, "soft")) {
        if (!action.extraDiscard) return "Restriction Soft requires discarding a City card";
        if (!player.hand.includes(action.extraDiscard) || !cityOfCard(game, action.extraDiscard)) {
          return "Extra discard for Soft must be a City card in your hand";
        }
        if (action.direction === "give" && action.extraDiscard === action.card) {
          return "Cannot discard the same card you are giving";
        }
      } else if (action.extraDiscard) {
        return "No extra discard required for Share Intel";
      }
      return null;
    }

    case "build-safehouse": {
      if (gameLoc.safehouse) return "This city already has a safehouse";
      const needsOwnCard = occ !== "clinic-planner";
      if (needsOwnCard) {
        if (!action.card || !player.hand.includes(action.card) || cityOfCard(game, action.card) !== loc) {
          return "Must discard the City card matching your current city";
        }
      }
      if (isRestrictionActive(game, "passive")) {
        if (!action.extraCard || !player.hand.includes(action.extraCard) || !cityOfCard(game, action.extraCard)) {
          return "Restriction Passive requires discarding an additional City card";
        }
        if (action.card && action.extraCard === action.card) return "Extra card must be distinct";
      } else if (action.extraCard) {
        return "No extra card required";
      }
      if (game.supplies.safehouses <= 0) {
        if (!action.relocateFrom || !game.locations[action.relocateFrom].safehouse) {
          return "All 8 safehouses are placed; choose a city to relocate a safehouse from";
        }
      } else if (action.relocateFrom) {
        return "Safehouses remain in supply; no relocation needed";
      }
      return null;
    }

    case "identify-target-city": {
      if (!gameLoc.safehouse) return "Must be at a safehouse to Identify Target City";
      if (hasLiability(world, seat, "suspected-identify")) {
        return "Suspected liability prevents Identify Target City";
      }
      const obj = game.objectives.find((o) => o.id === action.objective && o.status === "active");
      if (!obj || obj.kind !== "unknown-city") return "Not an active unknown-target objective";
      if (obj.targetRevealed) return "Target city is already known";
      if (obj.noIdentifyAction) return "Identify Target City cannot be used on this objective";
      if (!obj.unknownRegion) return "Objective does not specify a region";
      if (!hasAsset(world, seat, "shortwave-radio") && locDef.region !== obj.unknownRegion) {
        return `Must be at a safehouse in ${pack.regionNames[obj.unknownRegion]} (or hold Shortwave Radio)`;
      }
      const err = checkUniqueCityCardsInHand(world, seat, action.cards);
      if (err) return err;
      const baseRequired = hasAsset(world, seat, "code-book") ? 2 : 3;
      const extraRequired = isRestrictionActive(game, "evasive") ? 1 : 0;
      const totalRequired = baseRequired + extraRequired;
      if (action.cards.length !== totalRequired) {
        return `Requires ${totalRequired} cards (${baseRequired} matching ${pack.regionNames[obj.unknownRegion]}${extraRequired ? " + 1 any City card for Evasive" : ""})`;
      }
      const matchingRegionCount = action.cards.filter(
        (id) => cityDef(cityOfCard(game, id)!).region === obj.unknownRegion,
      ).length;
      if (matchingRegionCount < baseRequired) {
        return `At least ${baseRequired} cards must match ${pack.regionNames[obj.unknownRegion]}`;
      }
      return null;
    }

    case "assemble-team": {
      if (!gameLoc.safehouse) return "Must be at a safehouse to Assemble a Team";
      if (isRestrictionActive(game, "too-cautious") && loc === "washington") {
        return "Restriction Too Cautious prevents Assemble Team in Washington";
      }
      const err = checkUniqueCityCardsInHand(world, seat, action.cards);
      if (err) return err;
      const baseRequired = occ === "hospital-administrator" ? 4 : 5;
      const extraRequired = isRestrictionActive(game, "arrogant") ? 1 : 0;
      const totalRequired = baseRequired + extraRequired;
      if (action.cards.length !== totalRequired) {
        return `Requires ${totalRequired} City cards (${baseRequired} ${locDef.affiliation}${extraRequired ? " + 1 any for Arrogant" : ""})`;
      }
      const matchingAff = action.cards.filter(
        (id) => cityDef(cityOfCard(game, id)!).affiliation === locDef.affiliation,
      ).length;
      if (matchingAff < baseRequired) {
        return `At least ${baseRequired} cards must be ${locDef.affiliation}`;
      }
      const unused = Object.values(game.teams).find(
        (t) => t.affiliation === locDef.affiliation && t.city === null,
      );
      if (!unused) {
        if (
          !action.relocateTeam ||
          game.teams[action.relocateTeam]?.affiliation !== locDef.affiliation ||
          game.teams[action.relocateTeam]?.city === null ||
          game.teams[action.relocateTeam]?.city === loc
        ) {
          return `All ${locDef.affiliation} teams are on the board; pick one to relocate`;
        }
      } else if (action.relocateTeam) {
        return "An unused team of this affiliation is still in supply";
      }
      return null;
    }

    case "drive-team": {
      const cityErr = badCity(action.to);
      if (cityErr) return cityErr;
      const team = game.teams[action.team];
      if (!team || !team.city) return "That team is not on the board";
      if (!areAdjacent(team.city, action.to)) return `${cityDef(action.to).name} is not adjacent to team's location`;
      if (isRestrictionActive(game, "callous") && !gameLoc.safehouse) {
        return "Restriction Callous requires being in a safehouse to Drive/Ferry a team";
      }
      if (
        hasLiability(world, seat, "tracked") &&
        liabilityRegion(world, seat, "tracked") === locDef.region
      ) {
        return "Tracked liability prevents Drive/Ferry Team while in this region";
      }
      if (hasLiability(world, seat, "suspected-allied-team") && team.affiliation === "allied") {
        return "Suspected liability prevents moving an Allied team";
      }
      return null;
    }

    case "acquire-targets": {
      if (isRestrictionActive(game, "oversight-required") && loc !== "washington") {
        return "Restriction Oversight Required: must be in Washington to Acquire Targets";
      }
      const obj = game.objectives.find((o) => o.id === action.objective && o.status === "active");
      if (!obj) return "Not an active objective";
      if (obj.kind === "known-cities") {
        const req = obj.requiredTeamsPerCity ?? 1;
        for (const target of obj.targetCities ?? []) {
          if (activeTeamsInCity(game, target).length < req) {
            return `Need ${req} active team(s) in ${cityDef(target).name}`;
          }
        }
        return null;
      }
      if (obj.kind === "unknown-city") {
        if (obj.targetRevealed && obj.hiddenCardId) {
          const target = cityOfCard(game, obj.hiddenCardId)!;
          if (activeTeamsInCity(game, target).length < (obj.requiredTeamsPerCity ?? 1)) {
            return `Need an active team in ${cityDef(target).name}`;
          }
          return null;
        }
        // Gambling on an unknown city: must have at least 1 active team in a possible candidate city!
        const anyCandidateActive = pack.cities.some(
          (ct) =>
            (!obj.unknownRegion || ct.region === obj.unknownRegion) &&
            (!obj.unknownAffiliation || ct.affiliation === obj.unknownAffiliation) &&
            (!obj.unknownControlCentersOnly || world.campaign.cities[ct.id].controlCenter) &&
            activeTeamsInCity(game, ct.id).length >= (obj.requiredTeamsPerCity ?? 1),
        );
        if (!anyCandidateActive) {
          return "Must have at least 1 active team in a candidate city to Acquire Targets";
        }
        return null;
      }
      if (obj.kind === "quarantine-exposed") {
        const target = action.targetCity;
        if (!target) return "Specify which Exposed City to quarantine";
        const cityErr = badCity(target);
        if (cityErr) return cityErr;
        if (cityDef(target).region !== obj.region) return "Target city is not in the objective region";
        if (world.campaign.cities[target].exposedIntensity === null) return "That city is not Exposed";
        if (activeTeamsInCity(game, target).length < (obj.requiredTeamsPerCity ?? 2)) {
          return `Need ${obj.requiredTeamsPerCity ?? 2} active teams in ${cityDef(target).name}`;
        }
        return null;
      }
      if (obj.kind === "bug-existing-control-center") {
        const ccCity = pack.cities.find(
          (ct) => ct.region === obj.region && world.campaign.cities[ct.id].controlCenter,
        );
        if (!ccCity) return "No Control Center found in objective region";
        if (activeTeamsInCity(game, ccCity.id).length < (obj.requiredTeamsPerCity ?? 2)) {
          return `Need ${obj.requiredTeamsPerCity ?? 2} active teams in ${ccCity.name}`;
        }
        return null;
      }
      return "Cannot use Acquire Targets on this objective type";
    }

    case "treat":
      if (spec !== "treat") return "Requires Treat specialization (Allied alias after March)";
      if (gameLoc.diseaseCubes <= 0) return "No Disease cubes in your current city";
      return null;

    case "disrupt-trial": {
      if (!hasRule(world.campaign, "L")) return "Disrupt Trial action is not unlocked";
      const obj = game.objectives.find((o) => o.id === action.objective && o.status === "active");
      if (!obj || obj.kind !== "disrupt-trial") return "Not an active Disrupt Trial objective";
      const trialCities = obj.trialCardIds
        .map((id) => cityOfCard(game, id))
        .filter((c): c is CityId => c !== null);
      const covered = trialCities.filter((cid) => activeTeamsInCity(game, cid).length > 0);
      if (obj.trialRequireAll) {
        if (trialCities.length === 0 || covered.length < trialCities.length) {
          return "September Disrupt Trial requires an active team in ALL remaining trial cities";
        }
      } else if (covered.length === 0) {
        return "Must have an active team in at least 1 trial city";
      }
      return null;
    }

    case "change-alias": {
      if (!hasRule(world.campaign, "M")) return "Change Alias action is not unlocked";
      if (!gameLoc.safehouse) return "Must be in a city with a safehouse to Change Alias";
      if (!player.passport) return "Temporary aliases cannot change pages";
      if (player.activeAlias === action.affiliation) return "Already using that alias";
      const targetAlias = world.campaign.passports[player.passport].aliases[action.affiliation];
      if (!targetAlias.created) return "That alias has not been created yet";
      if (targetAlias.burned) return "That alias is burned";
      return null;
    }

    case "create-checkpoint": {
      if (!hasRule(world.campaign, "N")) return "Create Checkpoint action is not unlocked";
      if (hasLiability(world, seat, "marginalized")) {
        return "Marginalized liability prevents Create Checkpoint";
      }
      const cityErr = badCity(action.neighbor);
      if (cityErr) return cityErr;
      if (!areAdjacent(loc, action.neighbor)) return `${cityDef(action.neighbor).name} is not adjacent`;
      if (hasCheckpoint(game, loc, action.neighbor)) return "Checkpoint already exists on that connection";
      if (!player.hand.includes(action.card)) return "Card not in hand";
      const cardCity = cityOfCard(game, action.card);
      if (!cardCity || cityDef(cardCity).affiliation !== locDef.affiliation) {
        return `Must discard a ${locDef.affiliation} City card matching your city's affiliation`;
      }
      if (game.supplies.checkpointTokens <= 0) {
        if (!action.relocateFrom || !hasCheckpoint(game, action.relocateFrom[0], action.relocateFrom[1])) {
          return "All 12 Checkpoint tokens are on the board; specify one to relocate";
        }
      } else if (action.relocateFrom) {
        return "Checkpoint tokens remain in supply";
      }
      return null;
    }

    case "get-treatment": {
      if (!hasRule(world.campaign, "O")) return "Get Treatment action is not unlocked";
      if (!gameLoc.safehouse) return "Must be in a safehouse to Get Treatment";
      if (!player.hand.includes(action.card) || !isSymptomCard(game, action.card)) {
        return "Must select a Symptom card in your hand";
      }
      return null;
    }

    case "disable-satellite": {
      if (!hasRule(world.campaign, "T")) return "Disable Satellite action is not unlocked";
      if (hasLiability(world, seat, "bad-cover-story")) {
        return "Bad Cover Story liability prevents Disable Satellite";
      }
      const cc = world.campaign.cities[loc];
      if (!cc.controlCenter) {
        return `${locDef.name} does not have a Control Center`;
      }
      if (!cc.bugged) {
        return `Control Center in ${locDef.name} is not bugged`;
      }
      if (!game.satellites.includes(locDef.region)) {
        return `No active Satellite token in ${pack.regionNames[locDef.region]}`;
      }
      return null;
    }

    case "enter-infiltration": {
      if (!hasRule(world.campaign, "P")) return "Enter/Exit Infiltration Site is not unlocked";
      const activeSite = game.infiltrationSites[action.site];
      if (!activeSite) return "That Infiltration site is not in play";
      const siteDef = pack.sites[action.site];
      if (loc !== siteDef.city) return `Must be in ${cityDef(siteDef.city).name} to enter ${siteDef.name}`;
      const alias = activeAliasOf(world, seat);
      if (!alias || alias.affiliation !== siteDef.requiredAffiliation) {
        return `Must use a ${siteDef.requiredAffiliation} alias to enter ${siteDef.name}`;
      }
      return null;
    }

    case "exit-infiltration": {
      if (!player.infiltration) return "Not at an Infiltration site";
      const siteDef = pack.sites[player.infiltration.site];
      if (player.infiltration.room !== siteDef.entrance) {
        return "Must be in the Entrance room to exit an Infiltration site";
      }
      return null;
    }

    case "infiltrate": {
      if (!hasRule(world.campaign, "Q")) return "Infiltrate action is not unlocked";
      if (!player.infiltration) return "Must be at an Infiltration site to Infiltrate";
      const { site, room } = player.infiltration;
      const edge = findInfiltrationEdge(site, room, action.to);
      if (!edge) return "Target room is not directly connected to your current room";
      if (edge.hatchway) {
        if (!hasRule(world.campaign, "S") || !world.campaign.pearlTunnels.includes(edge.id)) {
          return "Hatchways cannot be infiltrated without a Tunnel sticker and Rule S";
        }
        if (action.revealCards.length !== 1) return "Infiltrating through a tunnel requires revealing 1 City card";
        const err = checkUniqueCityCardsInHand(world, seat, action.revealCards);
        if (err) return err;
        return null;
      }
      const tokens = game.infiltrationSites[site]!.tokens.filter((t) => t.edgeId === edge.id);
      if (tokens.some((t) => !t.revealed)) return "Security tokens along this wall must be revealed first";
      if (!canSatisfySecurityTokens(world, seat, tokens.map((t) => t.symbol), action.revealCards)) {
        return "Revealed cards do not match the required Security token symbols";
      }
      return null;
    }

    case "complete-infiltration-objective": {
      if (!player.infiltration) return "Must be inside an Infiltration site";
      const obj = game.objectives.find((o) => o.id === action.objective && o.status === "active");
      if (!obj || obj.kind !== "infiltration") return "Not an active Infiltration objective";
      if (
        player.infiltration.site !== obj.infiltrationSite ||
        player.infiltration.room !== obj.infiltrationRoom
      ) {
        return `Must be in ${pack.roomById[obj.infiltrationRoom!].name}`;
      }
      const err = checkUniqueCityCardsInHand(world, seat, action.cards);
      if (err) return err;
      const need = obj.infiltrationDiscardCount ?? 3;
      if (action.cards.length !== need) return `Must discard exactly ${need} City cards`;
      if (obj.infiltrationDiscardAffiliation) {
        const allMatch = action.cards.every(
          (id) => cityDef(cityOfCard(game, id)!).affiliation === obj.infiltrationDiscardAffiliation,
        );
        if (!allMatch) {
          return `All ${need} discarded cards must be ${obj.infiltrationDiscardAffiliation} City cards`;
        }
      }
      return null;
    }

    case "unlock-hatchway": {
      if (!hasRule(world.campaign, "U")) return "Unlock Hatchway action is not unlocked";
      if (!player.infiltration || player.infiltration.site !== "pearl") {
        return "Must be inside PEARL Compound to Unlock Hatchway";
      }
      if (world.campaign.availableTunnels <= 0) return "No Tunnel stickers left in reserve";
      const edge = pack.sites.pearl.edges.find((e) => e.id === action.edgeId && e.hatchway);
      if (!edge) return "Not a PEARL hatchway";
      if (edge.a !== player.infiltration.room && edge.b !== player.infiltration.room) {
        return "That hatchway is not in your current room";
      }
      if (world.campaign.pearlTunnels.includes(edge.id)) return "Hatchway already has a Tunnel sticker";
      const err = checkUniqueCityCardsInHand(world, seat, action.cards);
      if (err) return err;
      const sum = action.cards.reduce((acc, id) => acc + cityDef(cityOfCard(game, id)!).keypad, 0);
      if (sum < 10) return `Keypad numbers total ${sum}; need 10 or more`;
      return null;
    }

    // --- Occupation actions ---
    case "coordinator-move": {
      if (occ !== "medical-conference-coordinator") {
        return "Requires Medical Conference Coordinator occupation";
      }
      const cityErr = badCity(action.to);
      if (cityErr) return cityErr;
      if (action.target.kind === "team") {
        const team = game.teams[action.target.team];
        if (!team || !team.city) return "Team is not on the board";
        const dist = cityDistance(team.city, action.to);
        if (dist < 1 || dist > 3) return "Target city must be 1 to 3 cities away";
        return null;
      }
      if (action.target.seat === seat || !game.seats.includes(action.target.seat)) {
        return "Must move a different player's pawn";
      }
      const other = game.players[action.target.seat];
      if (other.infiltration) return "Cannot move a pawn that is inside an Infiltration site";
      const dist = cityDistance(other.location, action.to);
      if (dist < 1 || dist > 3) return "Target city must be 1 to 3 cities away";
      return null;
    }

    case "clinic-planner-flight": {
      if (occ !== "clinic-planner") return "Requires Clinic Planner occupation";
      const cityErr = badCity(action.to);
      if (cityErr) return cityErr;
      if (!gameLoc.safehouse) return "Must be at a safehouse";
      if (!player.hand.includes(action.card) || !cityOfCard(game, action.card)) {
        return "Must discard a City card from your hand";
      }
      if (action.to === loc) return "Already in that city";
      return null;
    }

    case "aluminum-take": {
      if (occ !== "aluminum-salesperson") return "Requires Aluminum Salesperson occupation";
      if (player.usedThisTurn.includes("aluminum-take")) return "Already used Aluminum Salesperson this turn";
      if (action.from === seat || !game.seats.includes(action.from)) return "Choose another player";
      const other = game.players[action.from];
      if (other.infiltration || other.location !== loc) return "Other player must be in your city";
      if (!other.hand.includes(action.card) || !cityOfCard(game, action.card)) {
        return "Card must be a City card in the other player's hand";
      }
      return null;
    }

    case "cargo-pilot-flight": {
      if (occ !== "cargo-pilot") return "Requires Cargo Pilot occupation";
      const cityErr = badCity(action.to);
      if (cityErr) return cityErr;
      if (action.to === loc) return "Already in that city";
      if (!game.locations[action.to].safehouse) return "Destination must have a safehouse";
      return checkCarryTeams(world, seat, action.carryTeams);
    }

    case "first-assistant-draw": {
      if (occ !== "first-assistant") return "Requires First Assistant to Politburo Minister occupation";
      if (player.usedThisTurn.includes("first-assistant")) return "Already used First Assistant this turn";
      if (!game.playerDiscard.includes(action.card)) return "Card is not in Player discard pile";
      const cId = cityOfCard(game, action.card);
      if (!cId || cityDef(cId).affiliation !== "soviet") return "Must draw a Soviet City card";
      return null;
    }

    // --- Asset actions ---
    case "visa-move": {
      const asset = findAsset(world, seat, action.asset);
      if (!asset || pack.assetById[asset.id].category !== "visa" || !asset.city) {
        return "You do not have that Visa on your active alias";
      }
      if (asset.city === loc) return "Already in the Visa's city";
      return checkCarryTeams(world, seat, action.carryTeams);
    }

    case "shop-owner-swap": {
      const contact = findAsset(world, seat, "shop-owner");
      if (!contact || !contact.city) return "Requires active Shop Owner contact";
      if (loc !== contact.city) return `Must be in Shop Owner's city (${cityDef(contact.city).name})`;
      const err = checkUniqueCityCardsInHand(world, seat, action.discardCards);
      if (err) return err;
      if (!game.playerDiscard.includes(action.takeCard) || !cityOfCard(game, action.takeCard)) {
        return "Must take a City card from the Player discard pile";
      }
      return null;
    }

    case "crime-boss-remove": {
      const contact = findAsset(world, seat, "crime-boss");
      if (!contact || !contact.city) return "Requires active Crime Boss contact";
      const cityErr = badCity(action.city);
      if (cityErr) return cityErr;
      if (player.usedThisTurn.includes("crime-boss")) return "Already used Crime Boss this turn";
      if (action.city !== contact.city && !areAdjacent(contact.city, action.city)) {
        return `City must be ${cityDef(contact.city).name} or adjacent to it`;
      }
      if (game.locations[action.city].agents <= 0) return "No agents in that city";
      return null;
    }

    case "politician-give": {
      const contact = findAsset(world, seat, "politician");
      if (!contact || !contact.city) return "Requires active Politician contact";
      if (player.usedThisTurn.includes("politician")) return "Already used Politician this turn";
      if (loc !== contact.city) return `Must be in Politician's city (${cityDef(contact.city).name})`;
      if (action.to === seat || !game.seats.includes(action.to)) return "Choose another player";
      if (!player.hand.includes(action.card) || !cityOfCard(game, action.card)) {
        return "Must give a City card from your hand";
      }
      return null;
    }

    case "field-medic-treat": {
      const contact = findAsset(world, seat, "field-medic");
      if (!contact || !contact.city) return "Requires active Field Medic contact";
      const cityErr = badCity(action.city);
      if (cityErr) return cityErr;
      if (action.city !== contact.city && !areAdjacent(contact.city, action.city)) {
        return `City must be ${cityDef(contact.city).name} or adjacent to it`;
      }
      if (game.locations[action.city].diseaseCubes <= 0) return "No Disease cubes in that city";
      return null;
    }

    case "cobbler-convert": {
      const contact = findAsset(world, seat, "cobbler");
      if (!contact || !contact.city) return "Requires active Cobbler contact";
      const team = game.teams[action.team];
      if (!team || team.city !== contact.city) {
        return `Team must be in Cobbler's city (${cityDef(contact.city).name})`;
      }
      const err = checkUniqueCityCardsInHand(world, seat, action.cards);
      if (err) return err;
      if (action.cards.length !== 3) return "Must discard 3 City cards of the same affiliation";
      const targetAff = cityDef(cityOfCard(game, action.cards[0]!)!).affiliation;
      if (!action.cards.every((id) => cityDef(cityOfCard(game, id)!).affiliation === targetAff)) {
        return "All 3 discarded cards must share the same affiliation";
      }
      if (team.affiliation === targetAff) return "Team already has that affiliation";
      const replacement = Object.values(game.teams).find(
        (t) => t.affiliation === targetAff && t.city === null,
      );
      if (!replacement) return `No unused ${targetAff} team piece left in supply`;
      return null;
    }

    case "test-pilot-remove-satellite": {
      const contact = findAsset(world, seat, "test-pilot");
      if (!contact || !contact.city) return "Requires active Test Pilot contact";
      if (loc !== contact.city) return `Must be in Test Pilot's city (${cityDef(contact.city).name})`;
      if (!game.satellites.includes(action.region)) return "No Satellite token in that region";
      return null;
    }

    case "spy-camera-draw": {
      if (!hasAsset(world, seat, "spy-camera")) return "Requires Spy Camera asset";
      const matching = game.playerDiscard.find((id) => cityOfCard(game, id) === loc);
      if (!matching) return `City card for ${locDef.name} is not in Player discard pile`;
      return null;
    }

    case "auth-424-remove": {
      if (!hasAsset(world, seat, "auth-424")) return "Requires Authorization Code 424";
      const cityErr = badCity(action.city);
      if (cityErr) return cityErr;
      if (player.usedThisTurn.includes("auth-424")) return "Already used Authorization Code 424 this turn";
      if (!areAdjacent(loc, action.city)) return "Target city must be adjacent";
      if (game.locations[action.city].agents <= 0) return "No agents in that city";
      return null;
    }

    case "auth-715-clear": {
      if (!hasAsset(world, seat, "auth-715")) return "Requires Authorization Code 715";
      const cityErr = badCity(action.city);
      if (cityErr) return cityErr;
      if (activeTeamsInCity(game, action.city).length === 0) {
        return "City must contain an active team";
      }
      if (game.locations[action.city].agents <= 0) return "No agents in that city";
      return null;
    }

    case "auth-405-move-team": {
      if (!hasAsset(world, seat, "auth-405")) return "Requires Authorization Code 405";
      const team = game.teams[action.team];
      if (!team || !team.city) return "Team is not on the board";
      if (!player.hand.includes(action.card) || !cityOfCard(game, action.card)) {
        return "Must discard a City card from your hand";
      }
      if (team.city === cityOfCard(game, action.card)) return "Team is already in that city";
      return null;
    }

    case "black-book-safehouse": {
      if (!hasAsset(world, seat, "black-book")) return "Requires Black Book asset";
      if (!player.hand.includes(action.card)) return "Card not in hand";
      const target = cityOfCard(game, action.card);
      if (!target) return "Must discard a City card";
      if (game.locations[target].safehouse) return `${cityDef(target).name} already has a safehouse`;
      if (game.supplies.safehouses <= 0) {
        if (!action.relocateFrom || !game.locations[action.relocateFrom].safehouse) {
          return "All 8 safehouses are placed; choose one to relocate";
        }
      } else if (action.relocateFrom) {
        return "Safehouses remain in supply";
      }
      return null;
    }

    case "experimental-medicine-treat":
      if (!hasAsset(world, seat, "experimental-medicine")) return "Requires Experimental Medicine";
      if (gameLoc.diseaseCubes <= 0) return "No Disease cubes in your city";
      return null;

    case "unapproved-supplements-treat":
      if (!hasAsset(world, seat, "unapproved-supplements")) return "Requires Unapproved Supplements";
      if (!areAdjacent(loc, action.city)) return "Target city must be adjacent";
      if (game.locations[action.city].diseaseCubes <= 0) return "No Disease cubes in that city";
      return null;
  }
}

export function applyAction(world: World, seat: SeatId, action: Action): void {
  const game = world.game!;
  const player = game.players[seat];
  const loc = player.location;
  const free = isFreeAction(action);
  if (!free) game.actionsLeft -= 1;

  const cost = free ? 0 : 1;

  switch (action.a) {
    case "spend-action-token":
      player.actionTokens -= 1;
      game.supplies.actionTokens += 1;
      game.actionsLeft += 1;
      log(game, { t: "action", seat, action: action.a, detail: "Spent 1 Action token (+1 action)", cost: 0 });
      break;

    case "tracking-device-peek": {
      player.usedThisTurn.push("tracking-device");
      game.peekedThreatCards = game.threatDeck.slice(0, 2);
      const names = game.peekedThreatCards.map((c) =>
        c.kind === "infection" ? `INFECTION:${cityDef(c.city).name}` : cityDef(c.city).name,
      );
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Tracking Device peeked top 2 Threat cards: ${names.join(", ")}`,
        cost: 0,
      });
      break;
    }

    case "use-help-from-sabik":
      world.campaign.helpFromSabikBoxesLeft! -= 1;
      game.ignoredRestrictionThisTurn = action.restriction;
      if (world.campaign.helpFromSabikBoxesLeft === 0) {
        world.campaign.helpFromSabikBoxesLeft = null;
      }
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Help from Sabik ignored ${pack.restrictionById[action.restriction].name} for this turn`,
        cost: 0,
      });
      break;

    case "drive":
      log(game, { t: "action", seat, action: action.a, detail: `Drove to ${cityDef(action.to).name}`, cost });
      enterCity(world, seat, action.to, { by: "drive", carryTeams: action.carryTeams });
      checkAndCompletePursuitObjective(world, seat);
      break;

    case "commercial-flight": {
      const dest = cityOfCard(game, action.card)!;
      const destAff = cityDef(dest).affiliation;
      const keptCard = destAff === "allied" && !isRestrictionActive(game, "unpredictable");
      if (!keptCard) {
        discardFromHand(game, seat, action.card);
      }
      let extraNote = "";
      if (action.extraCard) {
        const extraCity = cityOfCard(game, action.extraCard);
        const extraCardObj = game.playerCards[action.extraCard];
        const extraName = extraCity
          ? cityDef(extraCity).name
          : extraCardObj?.kind === "event"
            ? pack.eventById[extraCardObj.event].name
            : action.extraCard;
        discardFromHand(game, seat, action.extraCard);
        extraNote = `; Hesitant discarded ${extraName}`;
      }
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Commercial Flight to ${cityDef(dest).name} (${keptCard ? "revealed & kept" : "discarded"} ${cityDef(dest).name}${extraNote})`,
        cost,
      });
      enterCity(world, seat, dest, { by: "commercial-flight", carryTeams: action.carryTeams });
      checkAndCompletePursuitObjective(world, seat);
      break;
    }

    case "unrecorded-flight":
      discardFromHand(game, seat, action.card);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Unrecorded Flight to ${cityDef(action.to).name} (discarded ${cityDef(loc).name})`,
        cost,
      });
      enterCity(world, seat, action.to, { by: "unrecorded-flight", carryTeams: action.carryTeams });
      checkAndCompletePursuitObjective(world, seat);
      break;

    case "neutralize-agent": {
      const gameLoc = game.locations[loc];
      let toRemove: number = action.count ?? 1;
      if (currentSpecialization(world, seat) === "deep-cover") {
        toRemove = gameLoc.agents;
      } else if (hasAsset(world, seat, "gunbrella") && action.count === undefined) {
        toRemove = Math.min(2, gameLoc.agents);
      } else {
        toRemove = Math.min(toRemove, gameLoc.agents);
      }
      gameLoc.agents -= toRemove;
      game.supplies.agents += toRemove;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Neutralized ${toRemove} agent(s) in ${cityDef(loc).name}`,
        cost,
      });
      break;
    }

    case "share-intel": {
      const from = action.direction === "give" ? seat : action.target;
      const to = action.direction === "give" ? action.target : seat;
      const fromHand = game.players[from].hand;
      fromHand.splice(fromHand.indexOf(action.card), 1);
      game.players[to].hand.push(action.card);
      if (action.extraDiscard) discardFromHand(game, seat, action.extraDiscard);
      const sharedCityName = cityDef(cityOfCard(game, action.card)!).name;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail:
          action.direction === "give"
            ? `Gave ${sharedCityName} to ${action.target}`
            : `Took ${sharedCityName} from ${action.target}`,
        cost,
      });
      ensureHandLimitDecisions(world);
      break;
    }

    case "build-safehouse": {
      if (action.card) discardFromHand(game, seat, action.card);
      if (action.extraCard) discardFromHand(game, seat, action.extraCard);
      if (action.relocateFrom) {
        game.locations[action.relocateFrom].safehouse = false;
      } else {
        game.supplies.safehouses -= 1;
      }
      game.locations[loc].safehouse = true;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Built safehouse in ${cityDef(loc).name}`,
        cost,
      });
      break;
    }

    case "identify-target-city": {
      const obj = game.objectives.find((o) => o.id === action.objective)!;
      const isElectrician = currentOccupation(world, seat) === "electrician";
      let cardNote = "";
      if (!isElectrician) {
        for (const id of action.cards) discardFromHand(game, seat, id);
      } else if (isRestrictionActive(game, "evasive") && action.cards.length > 0) {
        // Electrician replaces discarding the required region cards with revealing them,
        // but Evasive's additional City card must still be discarded.
        const extraCard =
          action.cards.find(
            (id) => !obj.unknownRegion || cityDef(cityOfCard(game, id)!).region !== obj.unknownRegion,
          ) ?? action.cards[action.cards.length - 1]!;
        discardFromHand(game, seat, extraCard);
        const extraCity = cityOfCard(game, extraCard);
        cardNote = ` (Electrician revealed region cards; discarded ${extraCity ? cityDef(extraCity).name : extraCard} for Evasive)`;
      } else {
        cardNote = " (Electrician revealed cards)";
      }
      obj.targetRevealed = true;
      const targetCity = obj.hiddenCardId ? cityOfCard(game, obj.hiddenCardId) : null;
      if (targetCity) obj.revealedTargetCity = targetCity;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Identified target city for ${obj.title}: ${targetCity ? cityDef(targetCity).name : "unknown"}${cardNote}`,
        cost,
      });
      break;
    }

    case "assemble-team": {
      for (const id of action.cards) discardFromHand(game, seat, id);
      const aff = cityDef(loc).affiliation;
      const team = action.relocateTeam
        ? game.teams[action.relocateTeam]!
        : Object.values(game.teams).find((t) => t.affiliation === aff && t.city === null)!;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Assembled ${aff} team (${team.id}) in ${cityDef(loc).name}`,
        cost,
      });
      moveTeam(world, team.id, loc, "assemble-team");
      checkAndCompletePursuitObjective(world, seat);
      break;
    }

    case "drive-team":
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Drove team ${action.team} to ${cityDef(action.to).name}`,
        cost,
      });
      moveTeam(world, action.team, action.to, "drive-team");
      checkAndCompletePursuitObjective(world, seat);
      break;

    case "acquire-targets": {
      const obj = game.objectives.find((o) => o.id === action.objective)!;
      if (obj.kind === "unknown-city") {
        const targetCity = obj.hiddenCardId ? cityOfCard(game, obj.hiddenCardId)! : undefined;
        obj.targetRevealed = true;
        if (targetCity) obj.revealedTargetCity = targetCity;
        const ok = targetCity !== undefined && activeTeamsInCity(game, targetCity).length >= (obj.requiredTeamsPerCity ?? 1);
        obj.status = ok ? "completed" : "failed";
        log(game, {
          t: "action",
          seat,
          action: action.a,
          detail: `Acquire Targets on ${obj.title} (target was ${targetCity ? cityDef(targetCity).name : "?"}): ${ok ? "COMPLETED" : "FAILED"}`,
          cost,
        });
        log(game, {
          t: "objective",
          objective: obj.id,
          status: obj.status,
          detail: `${obj.title} (${targetCity ? cityDef(targetCity).name : "?"})`,
        });
        readDebrief(world, ok ? obj.debriefComplete : obj.debriefFail, {
          seat,
          objective: obj,
          targetCity,
        });
        checkAllObjectivesResolved(world);
        break;
      }

      obj.status = "completed";
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Acquire Targets completed ${obj.title}`,
        cost,
      });
      log(game, {
        t: "objective",
        objective: obj.id,
        status: "completed",
        detail: obj.title,
      });
      readDebrief(world, obj.debriefComplete, {
        seat,
        objective: obj,
        targetCity: action.targetCity,
      });
      checkAllObjectivesResolved(world);
      break;
    }

    case "treat":
      game.locations[loc].diseaseCubes -= 1;
      game.supplies.diseaseCubes += 1;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Treated 1 Disease cube in ${cityDef(loc).name}`,
        cost,
      });
      break;

    case "disrupt-trial": {
      const obj = game.objectives.find((o) => o.id === action.objective)!;
      const trialCities = obj.trialCardIds
        .map((id) => cityOfCard(game, id))
        .filter((c): c is CityId => c !== null);
      const disrupted = trialCities.filter((cid) => activeTeamsInCity(game, cid).length > 0);
      obj.status = "completed";
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Disrupted trial in ${disrupted.map((c) => cityDef(c).name).join(", ")}`,
        cost,
      });
      log(game, {
        t: "objective",
        objective: obj.id,
        status: "completed",
        detail: `${obj.title} (disrupted ${disrupted.length}/${trialCities.length})`,
      });
      if (hasLiability(world, seat, "incautious")) {
        giveSymptomCard(world, seat);
        giveSymptomCard(world, seat);
        ensureHandLimitDecisions(world);
      }
      readDebrief(world, obj.debriefComplete, {
        seat,
        objective: obj,
        disruptedCities: disrupted,
      });
      checkAllObjectivesResolved(world);
      break;
    }

    case "change-alias":
      player.activeAlias = action.affiliation;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Switched alias to ${action.affiliation}`,
        cost,
      });
      ensureHandLimitDecisions(world);
      break;

    case "create-checkpoint": {
      discardFromHand(game, seat, action.card);
      if (action.relocateFrom) {
        const [rx, ry] = canonicalEdge(action.relocateFrom[0], action.relocateFrom[1]);
        const idx = game.checkpoints.findIndex(([a, b]) => a === rx && b === ry);
        if (idx !== -1) game.checkpoints.splice(idx, 1);
      } else {
        game.supplies.checkpointTokens -= 1;
      }
      game.checkpoints.push(canonicalEdge(loc, action.neighbor));
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Placed Checkpoint between ${cityDef(loc).name} and ${cityDef(action.neighbor).name}`,
        cost,
      });
      break;
    }

    case "get-treatment":
      discardFromHand(game, seat, action.card);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Returned Symptom card in ${cityDef(loc).name}`,
        cost,
      });
      break;

    case "disable-satellite": {
      const region = cityDef(loc).region;
      game.satellites = game.satellites.filter((r) => r !== region);
      game.supplies.satellites += 1;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Disabled Satellite in ${pack.regionNames[region]}`,
        cost,
      });
      log(game, { t: "satellite", region, action: "disabled" });
      break;
    }

    case "enter-infiltration": {
      const siteDef = pack.sites[action.site];
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Entered ${siteDef.name}`,
        cost,
      });
      enterInfiltrationRoom(world, seat, action.site, siteDef.entrance);
      if (hasAsset(world, seat, "infrared-goggles") && !player.usedThisTurn.includes("infrared-goggles")) {
        player.usedThisTurn.push("infrared-goggles");
        const got = giveActionTokens(game, seat, 2);
        if (got > 0) log(game, { t: "note", text: `Infrared Goggles granted ${got} Action token(s)` });
      }
      break;
    }

    case "exit-infiltration": {
      const siteDef = pack.sites[player.infiltration!.site];
      player.infiltration = null;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Exited ${siteDef.name} back to ${cityDef(siteDef.city).name}`,
        cost,
      });
      enterCity(world, seat, siteDef.city, { by: "exit-infiltration", fromInfiltration: true });
      if (hasAsset(world, seat, "infrared-goggles") && !player.usedThisTurn.includes("infrared-goggles")) {
        player.usedThisTurn.push("infrared-goggles");
        const got = giveActionTokens(game, seat, 2);
        if (got > 0) log(game, { t: "note", text: `Infrared Goggles granted ${got} Action token(s)` });
      }
      break;
    }

    case "infiltrate": {
      const { site } = player.infiltration!;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Infiltrated to ${pack.roomById[action.to].name} (revealed ${action.revealCards.length} card(s))`,
        cost,
      });
      enterInfiltrationRoom(world, seat, site, action.to);
      break;
    }

    case "complete-infiltration-objective": {
      const obj = game.objectives.find((o) => o.id === action.objective)!;
      for (const id of action.cards) discardFromHand(game, seat, id);
      obj.status = "completed";
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Completed Infiltration objective: ${obj.title}`,
        cost,
      });
      log(game, {
        t: "objective",
        objective: obj.id,
        status: "completed",
        detail: obj.title,
      });
      readDebrief(world, obj.debriefComplete, { seat, objective: obj });
      checkAllObjectivesResolved(world);
      break;
    }

    case "unlock-hatchway": {
      for (const id of action.cards) discardFromHand(game, seat, id);
      world.campaign.pearlTunnels.push(action.edgeId);
      world.campaign.availableTunnels -= 1;
      const edge = pack.sites.pearl.edges.find((e) => e.id === action.edgeId)!;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Unlocked Hatchway tunnel between ${pack.roomById[edge.a].name} and ${pack.roomById[edge.b].name}`,
        cost,
      });
      break;
    }

    case "coordinator-move": {
      if (action.target.kind === "team") {
        log(game, {
          t: "action",
          seat,
          action: action.a,
          detail: `Medical Conference Coordinator moved team ${action.target.team} to ${cityDef(action.to).name}`,
          cost,
        });
        moveTeam(world, action.target.team, action.to, "coordinator");
        checkAndCompletePursuitObjective(world, seat);
      } else {
        log(game, {
          t: "action",
          seat,
          action: action.a,
          detail: `Medical Conference Coordinator moved ${action.target.seat} to ${cityDef(action.to).name}`,
          cost,
        });
        enterCity(world, action.target.seat, action.to, { by: "coordinator" });
      }
      break;
    }

    case "clinic-planner-flight": {
      const discCity = cityOfCard(game, action.card);
      discardFromHand(game, seat, action.card);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Clinic Planner flew to ${cityDef(action.to).name}${discCity ? ` (discarded ${cityDef(discCity).name})` : ""}`,
        cost,
      });
      enterCity(world, seat, action.to, { by: "clinic-planner" });
      break;
    }

    case "aluminum-take": {
      player.usedThisTurn.push("aluminum-take");
      const otherHand = game.players[action.from].hand;
      otherHand.splice(otherHand.indexOf(action.card), 1);
      player.hand.push(action.card);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Aluminum Salesperson took ${cityDef(cityOfCard(game, action.card)!).name} from ${action.from}`,
        cost,
      });
      ensureHandLimitDecisions(world);
      break;
    }

    case "cargo-pilot-flight":
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Cargo Pilot flew to safehouse in ${cityDef(action.to).name}`,
        cost,
      });
      enterCity(world, seat, action.to, { by: "cargo-pilot", carryTeams: action.carryTeams });
      checkAndCompletePursuitObjective(world, seat);
      break;

    case "first-assistant-draw": {
      player.usedThisTurn.push("first-assistant");
      const idx = game.playerDiscard.indexOf(action.card);
      game.playerDiscard.splice(idx, 1);
      player.hand.push(action.card);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `First Assistant drew ${cityDef(cityOfCard(game, action.card)!).name} from discard`,
        cost,
      });
      ensureHandLimitDecisions(world);
      break;
    }

    case "visa-move": {
      const asset = findAsset(world, seat, action.asset)!;
      const to = asset.city!;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Used Visa to move to ${cityDef(to).name}`,
        cost,
      });
      enterCity(world, seat, to, { by: "visa", carryTeams: action.carryTeams });
      checkAndCompletePursuitObjective(world, seat);
      break;
    }

    case "shop-owner-swap": {
      discardFromHand(game, seat, action.discardCards[0]);
      discardFromHand(game, seat, action.discardCards[1]);
      const idx = game.playerDiscard.indexOf(action.takeCard);
      game.playerDiscard.splice(idx, 1);
      player.hand.push(action.takeCard);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Shop Owner swapped 2 cards for ${cityDef(cityOfCard(game, action.takeCard)!).name}`,
        cost,
      });
      ensureHandLimitDecisions(world);
      break;
    }

    case "crime-boss-remove":
      player.usedThisTurn.push("crime-boss");
      game.locations[action.city].agents -= 1;
      game.supplies.agents += 1;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Crime Boss removed 1 agent from ${cityDef(action.city).name}`,
        cost,
      });
      break;

    case "politician-give": {
      player.usedThisTurn.push("politician");
      player.hand.splice(player.hand.indexOf(action.card), 1);
      game.players[action.to].hand.push(action.card);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Politician gave ${cityDef(cityOfCard(game, action.card)!).name} to ${action.to}`,
        cost,
      });
      ensureHandLimitDecisions(world);
      break;
    }

    case "field-medic-treat":
      game.locations[action.city].diseaseCubes -= 1;
      game.supplies.diseaseCubes += 1;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Field Medic treated 1 Disease cube in ${cityDef(action.city).name}`,
        cost,
      });
      break;

    case "cobbler-convert": {
      for (const id of action.cards) discardFromHand(game, seat, id);
      const targetAff = cityDef(cityOfCard(game, action.cards[0]!)!).affiliation;
      const oldTeam = game.teams[action.team]!;
      const city = oldTeam.city!;
      const newTeam = Object.values(game.teams).find(
        (t) => t.affiliation === targetAff && t.city === null,
      )!;
      oldTeam.city = null;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Cobbler converted ${oldTeam.id} into ${newTeam.id} in ${cityDef(city).name}`,
        cost,
      });
      moveTeam(world, newTeam.id, city, "cobbler");
      checkAndCompletePursuitObjective(world, seat);
      break;
    }

    case "test-pilot-remove-satellite":
      game.satellites = game.satellites.filter((r) => r !== action.region);
      game.supplies.satellites += 1;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Test Pilot removed Satellite in ${pack.regionNames[action.region]}`,
        cost,
      });
      log(game, { t: "satellite", region: action.region, action: "removed" });
      break;

    case "spy-camera-draw": {
      const idx = game.playerDiscard.findIndex((id) => cityOfCard(game, id) === loc);
      const [cardId] = game.playerDiscard.splice(idx, 1) as [CardId];
      player.hand.push(cardId);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Spy Camera retrieved ${cityDef(loc).name} from discard`,
        cost,
      });
      ensureHandLimitDecisions(world);
      break;
    }

    case "auth-424-remove":
      player.usedThisTurn.push("auth-424");
      game.locations[action.city].agents -= 1;
      game.supplies.agents += 1;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Authorization Code 424 removed 1 agent from ${cityDef(action.city).name}`,
        cost,
      });
      break;

    case "auth-715-clear": {
      const removed = game.locations[action.city].agents;
      game.locations[action.city].agents = 0;
      game.supplies.agents += removed;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Authorization Code 715 removed all ${removed} agent(s) in ${cityDef(action.city).name}`,
        cost,
      });
      break;
    }

    case "auth-405-move-team": {
      const dest = cityOfCard(game, action.card)!;
      discardFromHand(game, seat, action.card);
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Authorization Code 405 moved team ${action.team} to ${cityDef(dest).name}`,
        cost,
      });
      moveTeam(world, action.team, dest, "auth-405");
      checkAndCompletePursuitObjective(world, seat);
      break;
    }

    case "black-book-safehouse": {
      const target = cityOfCard(game, action.card)!;
      discardFromHand(game, seat, action.card);
      if (action.relocateFrom) {
        game.locations[action.relocateFrom].safehouse = false;
      } else {
        game.supplies.safehouses -= 1;
      }
      game.locations[target].safehouse = true;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Black Book placed safehouse in ${cityDef(target).name}`,
        cost,
      });
      break;
    }

    case "experimental-medicine-treat": {
      const removed = game.locations[loc].diseaseCubes;
      game.locations[loc].diseaseCubes = 0;
      game.supplies.diseaseCubes += removed;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Experimental Medicine removed all ${removed} Disease cube(s) in ${cityDef(loc).name}`,
        cost,
      });
      break;
    }

    case "unapproved-supplements-treat":
      game.locations[action.city].diseaseCubes -= 1;
      game.supplies.diseaseCubes += 1;
      log(game, {
        t: "action",
        seat,
        action: action.a,
        detail: `Unapproved Supplements removed 1 Disease cube from ${cityDef(action.city).name}`,
        cost,
      });
      break;
  }

  void teamsInCity;
  void createdUnburnedAliases;
  void isTeamActive;
}
