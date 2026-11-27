import { pack } from "./content/pack";
import {
  activeContactsList,
  cityDef,
  cityOfCard,
  ensureHandLimitDecisions,
  hasRule,
  log,
  pushDecision,
  pushEffect,
  pushReading,
  queueCoverLoss,
  scratchAliasCoverDirect,
} from "./helpers";
import type {
  Affiliation,
  AssetId,
  BoxId,
  CityId,
  DoorId,
  EventId,
  PassportColor,
  RuleId,
  SeatId,
} from "./ids";
import { PASSPORT_COLORS } from "./ids";
import { createRng } from "./rng";
import type {
  ActiveObjective,
  ActiveObjectiveTemplate,
  AliasPage,
  Campaign,
  CampaignCity,
  Evaluation,
  Passport,
  Purchase,
  World,
} from "./state";

function makeAlias(color: PassportColor, affiliation: Affiliation): AliasPage {
  const track = pack.passportTracks[`${color}-${affiliation}`];
  if (!track) throw new Error(`Missing passport cover track for ${color}-${affiliation}`);
  return {
    affiliation,
    created: false,
    name: "",
    occupation: null,
    specialization: null,
    assets: [],
    liabilities: [],
    coverTrack: [...track],
    coverScratched: 0,
    burned: false,
  };
}

function makePassport(color: PassportColor): Passport {
  return {
    color,
    aliases: {
      allied: makeAlias(color, "allied"),
      neutral: makeAlias(color, "neutral"),
      soviet: makeAlias(color, "soviet"),
    },
    chronicInfections: 0,
  };
}

export function newCampaign(seed: number): Campaign {
  const cities = Object.fromEntries(
    pack.cities.map((c): [CityId, CampaignCity] => [
      c.id,
      {
        permanentSafehouse: c.printedSafehouse,
        surveillance: c.startingSurveillance,
        exposedIntensity: null,
        contaminated: false,
        controlCenter: false,
        bugged: false,
      },
    ]),
  ) as Record<CityId, CampaignCity>;

  const passports = Object.fromEntries(
    PASSPORT_COLORS.map((color) => [color, makePassport(color)]),
  ) as Record<PassportColor, Passport>;

  return {
    rng: createRng(seed),
    month: 0,
    attempt: 1,
    funding: 5,
    branch: "cia",
    legacyOrder: [...pack.legacyDrawOrder],
    legacyIndex: 0,
    legacyPause: null,
    openedBoxes: [],
    openedDoors: [],
    destroyedBox0005: false,
    rules: [],
    readings: [],
    nextReadingId: 1,
    intelFile: [],
    personnelFile: [],
    psychAnswers: {},
    transmissionMethod: null,
    deploymentReport: null,
    discretionaryBudgetBoxesLeft: null,
    helpFromSabikBoxesLeft: null,
    restrictions: [],
    door14State: "unopened",
    door19BonusPending: false,
    relapseInDeck: false,
    diseaseCubeSupplyMax: 0,
    passports,
    cities,
    infectionCards: [],
    destroyedSatellites: [],
    unlockedEvents: pack.events.filter((e) => e.unlockedBy === "start").map((e) => e.id),
    availableAssets: pack.assets.filter((a) => a.unlockedBy === "start").map((a) => a.id),
    availableLiabilities: pack.liabilities.filter((l) => l.unlockedBy === "start").map((l) => l.id),
    availablePermanentSafehouses: pack.supplies.permanentSafehouseStickers,
    availableCounterSurveillance: pack.supplies.startingCounterSurveillanceStickers,
    availableContaminationStickers: 0,
    availableTunnels: 0,
    availableChronicInfections: 0,
    pearlOpenedDoors: [],
    pearlTunnels: [],
    pearlDoor41Placed: false,
    destroyedOpsCards: [],
    replayObjectives: null,
    results: [],
    finalScore: null,
    finalEvaluationDebrief: null,
    endingDebriefs: [],
    seating: [],
  };
}

function addRule(campaign: Campaign, rule: RuleId): void {
  if (!campaign.rules.includes(rule)) campaign.rules.push(rule);
}

function addEvent(campaign: Campaign, event: EventId): void {
  if (!campaign.unlockedEvents.includes(event)) campaign.unlockedEvents.push(event);
}

function addAssetsFromDoor(campaign: Campaign, door: DoorId): void {
  for (const asset of pack.assets) {
    if (asset.unlockedBy === door && !campaign.availableAssets.includes(asset.id)) {
      campaign.availableAssets.push(asset.id);
    }
  }
}

function addLiabilitiesFromDoor(campaign: Campaign, door: DoorId): void {
  for (const lib of pack.liabilities) {
    if (lib.unlockedBy === door && !campaign.availableLiabilities.includes(lib.id)) {
      campaign.availableLiabilities.push(lib.id);
    }
  }
}

function adjustFunding(world: World, delta: number, reason: string): void {
  const c = world.campaign;
  const raw = c.funding + delta;
  if (raw > 10 && c.door14State === "unopened") {
    c.funding = 10;
    if (world.game) {
      log(world.game, {
        t: "note",
        text: `Funding reached max 10 (${reason}); opening Door 14!`,
      });
    }
    openDoor(world, "14");
    return;
  }
  c.funding = Math.max(1, Math.min(10, raw));
  const capNote = raw > 10 ? " (capped at 10)" : raw < 1 ? " (floored at 1)" : "";
  if (world.game) {
    log(world.game, {
      t: "note",
      text: `Funding ${delta >= 0 ? `+${delta}` : delta} → ${c.funding}${capNote} (${reason})`,
    });
  }
}

export function openDoor(world: World, door: DoorId): void {
  const c = world.campaign;
  if (c.openedDoors.includes(door)) return;
  c.openedDoors.push(door);

  const texts = pack.doorArchive[door] ?? [];
  const fallbackText =
    door === "47"
      ? "Opened Dossier Door 47 — PEARL Compound Entrance (Novosibirsk) is now accessible."
      : `Opened Dossier Door ${door}.`;
  pushReading(
    world,
    "door",
    `door/${door}`,
    `Dossier Door ${door}`,
    texts.join("\n\n---\n\n") || fallbackText,
  );

  // Rule doors
  const ruleDoors: Partial<Record<DoorId, RuleId>> = {
    A: "A",
    C: "C",
    F: "F",
    G: "G",
    H: "H",
    J: "J",
    L: "L",
    O: "O",
    S: "S",
    T: "T",
    U: "U",
  };
  if (ruleDoors[door]) {
    addRule(c, ruleDoors[door]!);
    if (door === "H" && world.game && world.game.supplies.symptoms.length === 0) {
      world.game.supplies.symptoms = [...pack.symptomNames];
    }
  }

  // Asset & Liability doors
  addAssetsFromDoor(c, door);
  addLiabilitiesFromDoor(c, door);

  // Special doors
  switch (door) {
    case "14":
      c.door14State = "pending";
      if (world.game) pushDecision(world, { t: "door14-briefcase" });
      break;
    case "19":
      c.door14State = "opened-19";
      if (world.game?.upkeep) {
        world.game.upkeep.budget += 6;
        log(world.game, {
          t: "note",
          text: `Door 19: added +6 budgetary units to Spend Budget (budget now ${world.game.upkeep.budget})`,
        });
      } else {
        c.door19BonusPending = true;
      }
      break;
    case "24": {
      c.door14State = "blown-24";
      const targetable = pack.cities.filter((ct) => c.cities[ct.id].surveillance > 0).length;
      if (targetable > 0) {
        if (world.game) {
          pushDecision(world, {
            t: "place-counter-surveillance",
            remaining: 6,
            source: "Door 24 (New Zealand Briefcase)",
          });
        } else {
          c.door24CounterSurvPending = 6;
        }
      }
      break;
    }
    case "30":
      c.availableCounterSurveillance += 12;
      break;
    case "41":
      c.pearlDoor41Placed = true;
      break;
    case "42":
      c.availableTunnels += pack.supplies.tunnelStickers;
      break;
    case "43":
      c.availableChronicInfections += 3;
      break;
    case "47":
      if (!c.pearlOpenedDoors.includes(1)) c.pearlOpenedDoors.push(1);
      break;
    default:
      break;
  }
}

export function openBox(world: World, box: BoxId): void {
  const c = world.campaign;
  if (c.openedBoxes.includes(box)) return;
  c.openedBoxes.push(box);

  const texts = pack.boxArchive[box] ?? [];
  const fallback =
    box === "0005"
      ? "Opened Safe Deposit Box 0005 (contains the sealed Sabik Legacy deck, replacing the remaining CIA Legacy deck)."
      : `Opened Safe Deposit Box ${box}.`;
  pushReading(
    world,
    "box",
    `box/${box}`,
    `Safe Deposit Box ${box}`,
    texts.join("\n\n---\n\n") || fallback,
  );

  switch (box) {
    case "0001": {
      c.diseaseCubeSupplyMax += 6;
      c.availableContaminationStickers += pack.supplies.contaminationStickers;
      addRule(c, "B");
      addRule(c, "Y");
      addRule(c, "Z");
      addRule(c, "AA");
      addRule(c, "BB");
      for (const color of PASSPORT_COLORS) {
        c.passports[color].aliases.allied.specialization = "treat";
      }
      if (world.game) world.game.supplies.diseaseCubes = c.diseaseCubeSupplyMax;
      break;
    }
    case "0002": {
      for (const color of PASSPORT_COLORS) {
        c.passports[color].aliases.soviet.specialization = "deep-cover";
      }
      if (world.game) pushDecision(world, { t: "create-aliases", affiliation: "soviet" });
      break;
    }
    case "0003": {
      addRule(c, "R");
      openDoor(world, "47");
      break;
    }
    case "0004": {
      c.diseaseCubeSupplyMax += 10;
      addRule(c, "K");
      addRule(c, "N");
      addRule(c, "X");
      if (world.game) {
        world.game.supplies.diseaseCubes = c.diseaseCubeSupplyMax;
        world.game.supplies.pursuitTokens = pack.supplies.pursuitTokens;
        world.game.supplies.checkpointTokens = pack.supplies.checkpointTokens;
      }
      break;
    }
    case "0005": {
      c.branch = "sabik";
      c.legacyOrder = [...pack.sealedLegacyOrder];
      c.legacyIndex = 0;
      c.legacyPause = null;
      // Immediately read sealed-11-01 onward for November setup
      readLegacySetup(world);
      break;
    }
    case "0006": {
      addRule(c, "P");
      addRule(c, "Q");
      addRule(c, "V");
      break;
    }
    case "0007": {
      addRule(c, "E");
      addRule(c, "M");
      for (const color of PASSPORT_COLORS) {
        c.passports[color].aliases.neutral.specialization = "transport-crew";
      }
      if (world.game) {
        world.game.supplies.actionTokens = pack.supplies.actionTokens;
        pushDecision(world, { t: "create-aliases", affiliation: "neutral" });
      }
      break;
    }
    case "0008": {
      c.diseaseCubeSupplyMax += 12;
      addRule(c, "D");
      addRule(c, "W");
      if (world.game) {
        world.game.supplies.diseaseCubes = c.diseaseCubeSupplyMax;
        world.game.supplies.satellites = pack.supplies.satellites;
      }
      break;
    }
  }
}

export function readOperationsCard(world: World, num: number): void {
  const card = pack.operationsArchive[num];
  if (!card) throw new Error(`Missing operations card ${num}`);
  pushReading(world, "operations", `operations/${num}`, `Operations Card ${num}`, card.text);
}

export function addRestriction(world: World, opsNumber: number): void {
  readOperationsCard(world, opsNumber);
  const restrictionId = pack.restrictionByOps[opsNumber];
  if (!restrictionId) throw new Error(`Operations card ${opsNumber} is not a restriction`);
  if (!world.campaign.restrictions.includes(restrictionId)) {
    world.campaign.restrictions.push(restrictionId);
  }
  if (world.game && !world.game.activeRestrictions.includes(restrictionId)) {
    world.game.activeRestrictions.push(restrictionId);
  }
}

export function addIntelCard(world: World, opsNumber: number): void {
  const card = pack.operationsArchive[opsNumber];
  if (!card) throw new Error(`Missing operations card ${opsNumber}`);
  readOperationsCard(world, opsNumber);
  const id = `operations/${opsNumber}`;
  if (!world.campaign.intelFile.some((item) => item.id === id)) {
    world.campaign.intelFile.push({
      id,
      title: `Operations Card ${opsNumber}`,
      text: card.text,
    });
  }
}

function makeObjectiveFromTemplate(tpl: ActiveObjectiveTemplate): ActiveObjective {
  return {
    ...tpl,
    hiddenCardId: null,
    targetRevealed: false,
    trialCardIds: [],
    eliminatedCities: [],
  };
}

function opsObjectiveTemplate(num: number): ActiveObjectiveTemplate {
  switch (num) {
    case 66:
      return {
        id: "jun-3a",
        cardCode: "ops-66",
        title: "Bug Completed Control Center in Asia",
        description: "Acquire Target in the city in Asia containing a Control Center, using 2 active teams at the same time.",
        kind: "bug-existing-control-center",
        status: "active",
        region: "asia",
        requiredTeamsPerCity: 2,
        debriefComplete: 187,
        debriefFail: 204,
      };
    case 67:
      return {
        id: "jul-3a",
        cardCode: "ops-67",
        title: "Bug Completed Control Center in Africa",
        description: "Acquire Target in the city in Africa containing a Control Center, using 2 active teams at the same time.",
        kind: "bug-existing-control-center",
        status: "active",
        region: "africa",
        requiredTeamsPerCity: 2,
        debriefComplete: 171,
        debriefFail: 106,
      };
    case 68:
      return {
        id: "aug-1a",
        cardCode: "ops-68",
        title: "Quarantine an Exposed City in Asia",
        description: "Acquire Target in 1 Exposed city in Asia, using 2 active teams at the same time.",
        kind: "quarantine-exposed",
        status: "active",
        region: "asia",
        requiredTeamsPerCity: 2,
        debriefComplete: 233,
        debriefFail: 185,
      };
    case 69:
      return {
        id: "aug-3a",
        cardCode: "ops-69",
        title: "Bug Completed Control Center in North America",
        description: "Acquire Target in the city in North America containing a Control Center, using 2 active teams at the same time.",
        kind: "bug-existing-control-center",
        status: "active",
        region: "north-america",
        requiredTeamsPerCity: 2,
        debriefComplete: 216,
        debriefFail: 173,
      };
    case 83:
      return {
        id: "sep-1a",
        cardCode: "ops-83",
        title: "Quarantine an Exposed City in North America",
        description: "Acquire Target in 1 Exposed city in North America, using 2 active teams at the same time.",
        kind: "quarantine-exposed",
        status: "active",
        region: "north-america",
        requiredTeamsPerCity: 2,
        debriefComplete: 124,
        debriefFail: 152,
      };
    case 84:
      return {
        id: "sep-3a",
        cardCode: "ops-84",
        title: "Bug Completed Control Center in the Pacific Rim",
        description: "Acquire Target in the city in the Pacific Rim containing a Control Center, using 2 active teams at the same time.",
        kind: "bug-existing-control-center",
        status: "active",
        region: "pacific-rim",
        requiredTeamsPerCity: 2,
        debriefComplete: 103,
        debriefFail: 168,
      };
    case 85:
      return {
        id: "feb-1a",
        cardCode: "ops-85",
        title: "Quarantine an Exposed City in Africa",
        description: "Acquire Target in 1 Exposed city in Africa, using 2 active teams at the same time.",
        kind: "quarantine-exposed",
        status: "active",
        region: "africa",
        requiredTeamsPerCity: 2,
        debriefComplete: 175,
        debriefFail: 162,
      };
    case 86:
      return {
        id: "apr-1a",
        cardCode: "ops-86",
        title: "Quarantine an Exposed City in South America",
        description: "Acquire Target in 1 Exposed city in South America, using 2 active teams at the same time.",
        kind: "quarantine-exposed",
        status: "active",
        region: "south-america",
        requiredTeamsPerCity: 2,
        debriefComplete: 170,
        debriefFail: 115,
      };
    case 87:
      return {
        id: "apr-2a",
        cardCode: "ops-87",
        title: "Bug Completed Control Center in Europe",
        description: "Acquire Target in the city in Europe containing a Control Center, using 2 active teams at the same time.",
        kind: "bug-existing-control-center",
        status: "active",
        region: "europe",
        requiredTeamsPerCity: 2,
        debriefComplete: 208,
        debriefFail: 194,
      };
    case 88:
      return {
        id: "may-3a",
        cardCode: "ops-88",
        title: "Bug Completed Control Center in South America",
        description: "Acquire Target in the city in South America containing a Control Center, using 2 active teams at the same time.",
        kind: "bug-existing-control-center",
        status: "active",
        region: "south-america",
        requiredTeamsPerCity: 2,
        debriefComplete: 176,
        debriefFail: 118,
      };
    case 89:
      return {
        id: "jun-1a",
        cardCode: "ops-89",
        title: "Quarantine an Exposed City in Europe",
        description: "Acquire Target in 1 Exposed city in Europe, using 2 active teams at the same time.",
        kind: "quarantine-exposed",
        status: "active",
        region: "europe",
        requiredTeamsPerCity: 2,
        debriefComplete: 132,
        debriefFail: 211,
      };
    default:
      throw new Error(`Operations card ${num} is not a replacement objective`);
  }
}

export function exposeCity(world: World, city: CityId, intensity: number): void {
  const c = world.campaign;
  const cc = c.cities[city];
  cc.exposedIntensity = intensity;
  const infId = `inf-${city}-${c.infectionCards.length + 1}`;
  c.infectionCards.push({ id: infId, city, startingIntensity: intensity });
  if (world.game) {
    world.game.gameEndArea.push({
      id: infId,
      kind: "infection",
      infectionId: infId,
      city,
      startingIntensity: intensity,
    });
    log(world.game, {
      t: "note",
      text: `${cityDef(city).name} became an Exposed City (intensity ${intensity}); Infection card added to Game End area`,
    });
  }
}

function finalizeDisruptTrial(
  world: World,
  obj: ActiveObjective,
  disruptedCities: CityId[],
  intensity: number,
): void {
  const game = world.game!;
  const disruptedSet = new Set(disruptedCities);
  const discardedNames: string[] = [];
  let destroyedBlankInfectionCards = 0;
  for (const cardId of obj.trialCardIds) {
    const card = game.playerCards[cardId];
    if (card?.kind === "city") {
      if (!disruptedSet.has(card.city)) {
        exposeCity(world, card.city, intensity);
      } else {
        destroyedBlankInfectionCards += 1;
      }
      game.playerDiscard.push(cardId);
      discardedNames.push(cityDef(card.city).name);
    }
  }
  if (discardedNames.length > 0) {
    log(game, {
      t: "note",
      text: `Disrupt Trial cleanup: moved trial City cards (${discardedNames.join(", ")}) to Player discard${destroyedBlankInfectionCards > 0 ? `; destroyed ${destroyedBlankInfectionCards} unused blank Infection card(s)` : ""}`,
    });
  }
  obj.trialCardIds = [];
}

function finalizeUnknownTargetCard(world: World, obj: ActiveObjective, toSeat: SeatId | null): void {
  const game = world.game!;
  if (!obj.hiddenCardId) return;
  const cardId = obj.hiddenCardId;
  const revealed = cityOfCard(game, cardId);
  if (revealed) obj.revealedTargetCity = revealed;
  obj.hiddenCardId = null;
  obj.targetRevealed = true;
  if (toSeat) {
    game.players[toSeat].hand.push(cardId);
    log(game, {
      t: "note",
      text: `Added hidden target card ${revealed ? cityDef(revealed).name : cardId} to ${toSeat}'s hand`,
    });
    ensureHandLimitDecisions(world);
  } else {
    game.playerDiscard.push(cardId);
    log(game, {
      t: "note",
      text: `Moved hidden target card ${revealed ? cityDef(revealed).name : cardId} to Player discard`,
    });
  }
}

function clearPursuitAndCheckpoints(world: World, includePursuit: boolean): void {
  const game = world.game;
  if (!game) return;
  if (includePursuit) {
    for (const loc of Object.values(game.locations)) {
      if (loc.pursuit) {
        loc.pursuit = false;
        game.supplies.pursuitTokens += 1;
      }
    }
  }
  game.supplies.checkpointTokens += game.checkpoints.length;
  game.checkpoints = [];
}

function quarantineCity(world: World, city: CityId): void {
  const c = world.campaign;
  c.cities[city].exposedIntensity = null;
  const idx = c.infectionCards.findIndex((ic) => ic.city === city);
  if (idx !== -1) {
    const removed = c.infectionCards.splice(idx, 1)[0]!;
    if (world.game) {
      world.game.threatDeck = world.game.threatDeck.filter(
        (t) => !(t.kind === "infection" && t.infectionId === removed.id),
      );
      world.game.threatDiscard = world.game.threatDiscard.filter(
        (t) => !(t.kind === "infection" && t.infectionId === removed.id),
      );
      world.game.gameEndArea = world.game.gameEndArea.filter(
        (t) => !(t.kind === "infection" && t.infectionId === removed.id),
      );
      world.game.peekedThreatCards = world.game.peekedThreatCards.filter(
        (t) => !(t.kind === "infection" && t.infectionId === removed.id),
      );
    }
  }
  if (world.game) {
    log(world.game, {
      t: "note",
      text: `Quarantined ${cityDef(city).name}: Exposed City sticker removed and Infection card destroyed`,
    });
  }
}

function bugControlCenterInRegion(world: World, region: string): void {
  for (const city of pack.cities) {
    if (city.region === region && world.campaign.cities[city.id].controlCenter) {
      world.campaign.cities[city.id].bugged = true;
      if (world.game) {
        log(world.game, {
          t: "note",
          text: `Placed Bug sticker on Control Center in ${city.name}`,
        });
      }
      return;
    }
  }
}

export type DebriefContext = {
  seat?: SeatId;
  objective?: ActiveObjective;
  disruptedCities?: CityId[];
  targetCity?: CityId;
};

/** Reads Debrief entry `num`, logs its full verbatim text, and executes all its rules effects! */
export function readDebrief(world: World, num: number, ctx: DebriefContext = {}): void {
  const entry = pack.debriefArchive[num];
  if (!entry) throw new Error(`Missing debrief entry ${num}`);
  pushReading(world, "debrief", `debrief/${num}`, `Debrief ${num}`, entry.fullText);

  const c = world.campaign;
  const game = world.game;
  const obj = ctx.objective;
  const seat = ctx.seat ?? game?.active;

  switch (num) {
    // --- Prologue ---
    case 160: // Prologue Obj 1 complete: take unknown Europe card to hand
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 166: // Prologue Obj 1 failed
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 214:
    case 150:
      break;

    // --- January ---
    case 147:
    case 131:
      break;
    case 210: // Jan Obj 2 complete: take target card + choose Ops 60 or 61
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      readOperationsCard(world, 60);
      readOperationsCard(world, 61);
      if (game) {
        pushDecision(world, {
          t: "file-report",
          options: [60, 61],
          prompt: "Decide which January Sabik Field Report (Operations 60 or 61) to file with the CIA; the other is destroyed.",
        });
      }
      break;
    case 195: // Jan Obj 2 failed
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;

    // --- February ---
    case 174: // Feb Obj 1 complete (Disrupt 1st Trial)
    case 169: // Feb Obj 1 failed
      openDoor(world, "46");
      openDoor(world, "F");
      readLegacyPause(world, "legacy/02-05");
      if (obj) finalizeDisruptTrial(world, obj, ctx.disruptedCities ?? [], 0);
      break;
    case 191: // Feb Obj 2 complete: take card + Ops 77 to Intel
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      addIntelCard(world, 77);
      break;
    case 149: // Feb Obj 2 failed
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 163: // Feb attempt 1 FAILING -> replace Obj 1 with Ops 85
      readOperationsCard(world, 85);
      if (c.replayObjectives) {
        c.replayObjectives = c.replayObjectives.map((o) =>
          o.id === "feb-1" ? opsObjectiveTemplate(85) : o,
        );
      }
      break;
    case 175: // Feb Obj 1A complete: Quarantine Africa city
      if (ctx.targetCity) quarantineCity(world, ctx.targetCity);
      break;
    case 162:
      break;

    // --- March ---
    case 205: // Mar Obj 1 complete
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 161: // Mar Obj 1 failed
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 114: // Mar Obj 2 complete: completing player removes 1 agent from board
      if (game && seat && Object.values(game.locations).some((l) => l.agents > 0)) {
        pushDecision(world, {
          t: "remove-agents-board",
          seat,
          remaining: 1,
          source: "Debrief 114 (Prevent Sabik from Selling CIA Secrets)",
        });
      }
      break;
    case 225: // Mar Obj 2 failed: all players scratch 1 cover
      if (game) {
        for (const s of game.seats) queueCoverLoss(world, s, 1, "Debrief 225");
      }
      break;
    case 143:
      addRestriction(world, 50);
      break;
    case 207:
      addRestriction(world, 51);
      break;
    case 228:
      addRestriction(world, 52);
      break;

    // --- April ---
    case 224: // Apr Obj 1 complete: Ops 78 + expose undisrupted SA cities (intensity 0)
      addIntelCard(world, 78);
      if (obj) finalizeDisruptTrial(world, obj, ctx.disruptedCities ?? [], 0);
      break;
    case 156: // Apr Obj 1 failed
      if (obj) finalizeDisruptTrial(world, obj, [], 0);
      break;
    case 165: // Apr Obj 2 complete: Door 44, Control Center + Bug on target Europe city, card to hand
      openDoor(world, "44");
      if (ctx.targetCity) {
        c.cities[ctx.targetCity].controlCenter = true;
        c.cities[ctx.targetCity].bugged = true;
      }
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 193: // Apr Obj 2 failed: Door 44, Control Center (no bug) on target Europe city, card to discard
      openDoor(world, "44");
      if (ctx.targetCity) {
        c.cities[ctx.targetCity].controlCenter = true;
      }
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 227: // Apr attempt 1 FAILING -> replace both objectives with Ops 86 & 87
      readOperationsCard(world, 86);
      readOperationsCard(world, 87);
      c.replayObjectives = [opsObjectiveTemplate(86), opsObjectiveTemplate(87)];
      break;
    case 170: // Apr Obj 1A complete: Quarantine SA city
      if (ctx.targetCity) quarantineCity(world, ctx.targetCity);
      break;
    case 115:
      break;
    case 208: // Apr Obj 2A complete: Bug Europe Control Center
      bugControlCenterInRegion(world, "europe");
      break;
    case 194:
      break;

    // --- May ---
    case 121: // Animal Contact -> -1 funding
    case 135: // Saliva -> -1 funding
      adjustFunding(world, -1, `Debrief ${num}`);
      break;
    case 154: // Airborne -> +1 funding
      adjustFunding(world, 1, "Debrief 154 (Airborne confirmed)");
      break;
    case 213: // Waterborne -> 0
      break;
    case 146: // May Obj 1 complete (Pursuit)
      clearPursuitAndCheckpoints(world, false);
      break;
    case 202:
    case 148:
      clearPursuitAndCheckpoints(world, true);
      break;
    case 223: // May Obj 2 complete: give 1 Action token + file Ops 62 or 63
      if (game && game.supplies.actionTokens > 0) {
        pushDecision(world, {
          t: "distribute-action-tokens",
          remaining: 1,
          source: "Debrief 223 (Find Sabik's Operatives)",
        });
      }
      readOperationsCard(world, 62);
      readOperationsCard(world, 63);
      if (game) {
        pushDecision(world, {
          t: "file-report",
          options: [62, 63],
          prompt: "Decide which May Sabik Field Report (Operations 62 or 63) to file with the CIA; the other is destroyed.",
        });
      }
      break;
    case 159:
      break;
    case 167: // May Obj 3 complete: Control Center + Bug on SA target, card to hand
      if (ctx.targetCity) {
        c.cities[ctx.targetCity].controlCenter = true;
        c.cities[ctx.targetCity].bugged = true;
      }
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 136: // May Obj 3 failed: Control Center (no bug) on SA target, card to discard
      if (ctx.targetCity) c.cities[ctx.targetCity].controlCenter = true;
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 177: // May attempt 1 FAILING -> if Obj 3 failed, replace with Ops 88
      if (c.replayObjectives?.some((o) => o.id === "may-3" && o.status !== "completed")) {
        readOperationsCard(world, 88);
        c.replayObjectives = c.replayObjectives.map((o) =>
          o.id === "may-3" ? opsObjectiveTemplate(88) : o,
        );
      }
      break;
    case 176: // May Obj 3A complete: Bug SA Control Center
      bugControlCenterInRegion(world, "south-america");
      break;
    case 118:
      break;

    // --- June ---
    case 189: // Ops 62 in Intel -> gain Ops 81 Help from Sabik!
      readOperationsCard(world, 81);
      c.helpFromSabikBoxesLeft = 3;
      break;
    case 200: // Ops 63 in Intel -> +1 funding
      adjustFunding(world, 1, "Debrief 200");
      break;
    case 221:
      break;
    case 206: // Jun Obj 1 complete: 1 player returns 1 Symptom, open Doors 38, G, C, Pause 06-08, expose undisrupted (intensity 1)
      if (
        game &&
        game.seats.some((s) => game.players[s].hand.some((id) => game.playerCards[id]?.kind === "symptom"))
      ) {
        pushDecision(world, { t: "choose-return-symptom", source: "Debrief 206" });
      }
      openDoor(world, "38");
      openDoor(world, "G");
      openDoor(world, "C");
      readLegacyPause(world, "legacy/06-08");
      if (obj) finalizeDisruptTrial(world, obj, ctx.disruptedCities ?? [], 1);
      break;
    case 190: // Jun Obj 1 failed
      openDoor(world, "38");
      openDoor(world, "G");
      openDoor(world, "C");
      readLegacyPause(world, "legacy/06-08");
      if (obj) finalizeDisruptTrial(world, obj, [], 1);
      break;
    case 104: // Jun Obj 2 complete (Sabik's Safehouse): return pawn to Mexico City + Ops 79 to Intel
      if (game) {
        for (const s of game.seats) {
          if (game.players[s].infiltration?.site === "sabik-safehouse") {
            game.players[s].infiltration = null;
            game.players[s].location = "mexico-city";
          }
        }
      }
      addIntelCard(world, 79);
      break;
    case 183:
      break;
    case 192: // Jun Obj 2 failed attempt 2: all characters in current game scratch 1 cover from EACH alias
      if (game) {
        for (const s of game.seats) {
          const p = game.players[s];
          if (p.passport) {
            for (const aff of ["allied", "neutral", "soviet"] as const) {
              scratchAliasCoverDirect(world, p.passport, aff, "Debrief 192");
            }
          }
        }
      }
      break;
    case 229: // Jun Obj 3 complete: Control Center + Bug in Asia, card to hand
      if (ctx.targetCity) {
        c.cities[ctx.targetCity].controlCenter = true;
        c.cities[ctx.targetCity].bugged = true;
      }
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 111: // Jun Obj 3 failed: Control Center in Asia, card to discard
      if (ctx.targetCity) c.cities[ctx.targetCity].controlCenter = true;
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 122:
      addRestriction(world, 53);
      break;
    case 133:
      addRestriction(world, 54);
      break;
    case 197:
      addRestriction(world, 55);
      break;
    case 116: // Jun attempt 1 FAILING -> replace failed Obj 3 w/ 66, failed Obj 1 w/ 89
      if (c.replayObjectives) {
        c.replayObjectives = c.replayObjectives.map((o) => {
          if (o.id === "jun-3" && o.status !== "completed") {
            readOperationsCard(world, 66);
            return opsObjectiveTemplate(66);
          }
          if (o.id === "jun-1" && o.status !== "completed") {
            readOperationsCard(world, 89);
            return opsObjectiveTemplate(89);
          }
          return o;
        });
      }
      break;
    case 187:
      bugControlCenterInRegion(world, "asia");
      break;
    case 204:
      break;
    case 132:
      if (ctx.targetCity) quarantineCity(world, ctx.targetCity);
      break;
    case 211:
      break;

    // --- July ---
    case 141: // Jul Obj 1 complete: remove all Checkpoints + remove 2 agents from board
      clearPursuitAndCheckpoints(world, false);
      if (game && seat && Object.values(game.locations).some((l) => l.agents > 0)) {
        pushDecision(world, {
          t: "remove-agents-board",
          seat,
          remaining: 2,
          source: "Debrief 141 (Stop Defector)",
        });
      }
      break;
    case 112:
      clearPursuitAndCheckpoints(world, true);
      break;
    case 232:
      break;
    case 198:
    case 113:
      addIntelCard(world, 80);
      break;
    case 219:
      break;
    case 186: // Jul Obj 3 complete: Control Center + Bug in Africa, card to hand
      if (ctx.targetCity) {
        c.cities[ctx.targetCity].controlCenter = true;
        c.cities[ctx.targetCity].bugged = true;
      }
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 125: // Jul Obj 3 failed: Control Center in Africa, card to discard
      if (ctx.targetCity) c.cities[ctx.targetCity].controlCenter = true;
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 108: // Jul attempt 1 FAILING -> replace failed Obj 3 w/ Ops 67
      if (c.replayObjectives?.some((o) => o.id === "jul-3" && o.status !== "completed")) {
        readOperationsCard(world, 67);
        c.replayObjectives = c.replayObjectives.map((o) =>
          o.id === "jul-3" ? opsObjectiveTemplate(67) : o,
        );
      }
      break;
    case 171:
      bugControlCenterInRegion(world, "africa");
      break;
    case 106:
      break;

    // --- August ---
    case 203: // Aug Obj 1 complete: expose undisrupted Asia cities (intensity 2)
      if (obj) finalizeDisruptTrial(world, obj, ctx.disruptedCities ?? [], 2);
      break;
    case 100: // Aug Obj 1 failed
      if (obj) finalizeDisruptTrial(world, obj, [], 2);
      break;
    case 123: // Aug Obj 2 complete (Sabik's HQ): return pawn to Leningrad + file Ops 64 or 65
      if (game) {
        for (const s of game.seats) {
          if (game.players[s].infiltration?.site === "sabik-hq") {
            game.players[s].infiltration = null;
            game.players[s].location = "leningrad";
          }
        }
      }
      readOperationsCard(world, 64);
      readOperationsCard(world, 65);
      if (game) {
        pushDecision(world, {
          t: "file-report",
          options: [64, 65],
          prompt: "Decide which August Sabik's HQ Field Report (Operations 64 or 65) to file with the CIA; the other is destroyed.",
        });
      }
      break;
    case 142:
      if (game) {
        delete game.infiltrationSites["sabik-hq"];
        for (const s of game.seats) {
          if (game.players[s].infiltration?.site === "sabik-hq") {
            game.players[s].infiltration = null;
            game.players[s].location = "leningrad";
          }
        }
      }
      break;
    case 151: // Aug Obj 3 complete: Control Center + Bug in NA, card to hand, Ops 82 to Intel
      if (ctx.targetCity) {
        c.cities[ctx.targetCity].controlCenter = true;
        c.cities[ctx.targetCity].bugged = true;
      }
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      addIntelCard(world, 82);
      break;
    case 215: // Aug Obj 3 failed
      if (ctx.targetCity) c.cities[ctx.targetCity].controlCenter = true;
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 153:
      addRestriction(world, 56);
      break;
    case 127:
      addRestriction(world, 57);
      break;
    case 212: // Aug attempt 1 FAILING -> replace failed Obj 1 w/ 68, failed Obj 3 w/ 69
      if (c.replayObjectives) {
        c.replayObjectives = c.replayObjectives.map((o) => {
          if (o.id === "aug-1" && o.status !== "completed") {
            readOperationsCard(world, 68);
            return opsObjectiveTemplate(68);
          }
          if (o.id === "aug-3" && o.status !== "completed") {
            readOperationsCard(world, 69);
            return opsObjectiveTemplate(69);
          }
          return o;
        });
      }
      break;
    case 233:
      if (ctx.targetCity) quarantineCity(world, ctx.targetCity);
      break;
    case 185:
      break;
    case 216:
      bugControlCenterInRegion(world, "north-america");
      break;
    case 173:
      break;

    // --- September ---
    case 105: {
      // Loading Dock in PEARL
      openDoor(world, "43");
      if (game && seat) {
        const p = game.players[seat];
        if (p.passport && c.availableChronicInfections > 0) {
          c.passports[p.passport].chronicInfections += 1;
          c.availableChronicInfections -= 1;
          log(game, {
            t: "note",
            text: `${p.passport} passport gained a Chronic Infection sticker (total: ${c.passports[p.passport].chronicInfections})`,
          });
        }
        game.loadingDockVisitsThisGame += 1;
        const trialObj = game.objectives.find(
          (o) => o.kind === "disrupt-trial" && o.status === "active",
        );
        if (trialObj && trialObj.trialCardIds.length === 0) {
          trialObj.status = "completed";
          log(game, {
            t: "objective",
            objective: trialObj.id,
            status: "completed",
            detail: "Prevented all trials via PEARL Loading Dock",
          });
          readDebrief(world, trialObj.debriefComplete, { seat, objective: trialObj });
          pushEffect(world, { t: "check-objectives-resolved" });
        }
      }
      break;
    }
    case 230: // Sep Obj 1 complete: discard remaining trial cards + read Pause 09-10
      if (obj && game) {
        for (const cardId of obj.trialCardIds) game.playerDiscard.push(cardId);
        obj.trialCardIds = [];
      }
      readLegacyPause(world, "legacy/09-10");
      break;
    case 178: // Sep Obj 1 failed: expose remaining trial cities (intensity 3) + read Pause 09-10
      if (obj) finalizeDisruptTrial(world, obj, [], 3);
      readLegacyPause(world, "legacy/09-10");
      break;
    case 182: // Sep Obj 2 complete (PEARL Records Room): return pawn to Novosibirsk
      if (game && seat && game.players[seat].infiltration?.site === "pearl") {
        game.players[seat].infiltration = null;
        game.players[seat].location = "novosibirsk";
      }
      break;
    case 145:
      break;
    case 234: // Sep Obj 3 complete: Control Center + Bug in Pacific Rim, card to hand
      if (ctx.targetCity) {
        c.cities[ctx.targetCity].controlCenter = true;
        c.cities[ctx.targetCity].bugged = true;
      }
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 218: // Sep Obj 3 failed
      if (ctx.targetCity) c.cities[ctx.targetCity].controlCenter = true;
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 220: // Sep attempt 1 FAILING -> replace failed Obj 3 w/ 84, failed Obj 1 w/ 83
      if (c.replayObjectives) {
        c.replayObjectives = c.replayObjectives.map((o) => {
          if (o.id === "sep-3" && o.status !== "completed") {
            readOperationsCard(world, 84);
            return opsObjectiveTemplate(84);
          }
          if (o.id === "sep-1" && o.status !== "completed") {
            readOperationsCard(world, 83);
            return opsObjectiveTemplate(83);
          }
          return o;
        });
      }
      break;
    case 124:
      if (ctx.targetCity) quarantineCity(world, ctx.targetCity);
      break;
    case 152:
      break;
    case 103:
      bugControlCenterInRegion(world, "pacific-rim");
      break;
    case 168:
      break;

    // --- October ---
    case 180: // Oct Obj 1 complete (PEARL Medical Ward): if Pursuit incomplete, place 1 free Checkpoint + return pawn to Novosibirsk
      if (game && seat) {
        if (game.players[seat].infiltration?.site === "pearl") {
          game.players[seat].infiltration = null;
          game.players[seat].location = "novosibirsk";
        }
        const pursuitActive = game.objectives.some(
          (o) => o.kind === "pursuit" && o.status === "active",
        );
        if (pursuitActive) {
          pushDecision(world, {
            t: "place-free-checkpoint",
            seat,
            source: "Debrief 180 (Find the Soviets' Cure for MEDUSA)",
          });
        }
      }
      break;
    case 217:
      break;
    case 222: // Oct Obj 2 complete: give 1 Action token
      if (game && game.supplies.actionTokens > 0) {
        pushDecision(world, {
          t: "distribute-action-tokens",
          remaining: 1,
          source: "Debrief 222 (Interrogate the KGB Officer)",
        });
      }
      break;
    case 128:
      break;
    case 101: {
      // Oct Obj 3 complete (Pursuit): turn up to 2 Security tokens faceup in PEARL + remove all Checkpoints
      clearPursuitAndCheckpoints(world, false);
      const pearlSite = game?.infiltrationSites.pearl;
      const unrevealed = pearlSite?.tokens.filter((t) => !t.revealed).length ?? 0;
      if (game && seat && unrevealed > 0) {
        pushDecision(world, {
          t: "reveal-pearl-tokens",
          seat,
          remaining: Math.min(2, unrevealed),
          source: "Debrief 101 (Hunt Down the Soviet Exporter)",
        });
      }
      break;
    }
    case 172:
      clearPursuitAndCheckpoints(world, true);
      break;
    case 241:
      // Second-half Pursuit fail prints "No further information."
      break;
    case 199:
      addRestriction(world, 58);
      break;
    case 110:
      addRestriction(world, 59);
      break;

    // --- November ---
    case 139: // Decline Sabik's offer: cross out 1 contact + read Pause 11-02
      if (game && activeContactsList(c).length > 0) {
        pushDecision(world, { t: "kill-contact", source: "Debrief 139 (Declined Sabik's Offer)" });
      }
      readLegacyPause(world, "legacy/11-02");
      break;
    case 242: // Accept Sabik's offer: Open Box 0005!
      openBox(world, "0005");
      break;
    case 231: // Help from Sabik still in Operations Area on CIA path: scratch 1 cover from EVERY alias in EVERY passport!
      for (const color of PASSPORT_COLORS) {
        for (const aff of ["allied", "neutral", "soviet"] as const) {
          scratchAliasCoverDirect(world, color, aff, "Debrief 231 (Internal Inquiry)");
        }
      }
      break;
    case 102: // Nov Obj 1 complete (PEARL Manufacturing Facility): take 2 Action tokens and distribute
      if (game && game.supplies.actionTokens > 0) {
        pushDecision(world, {
          t: "distribute-action-tokens",
          remaining: Math.min(2, game.supplies.actionTokens),
          source: "Debrief 102 (Sabotage Manufacturing Facility)",
        });
      }
      break;
    case 235:
      break;
    case 201: // Nov Obj 2 CIA complete: take target card to hand
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      break;
    case 134: // Nov Obj 2 CIA failed
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 188: // Nov Pursuit complete: give 1 Action token + remove all Checkpoints
      clearPursuitAndCheckpoints(world, false);
      if (game && game.supplies.actionTokens > 0) {
        pushDecision(world, {
          t: "distribute-action-tokens",
          remaining: 1,
          source: "Debrief 188 (Learn About MEDUSA Deployment Plan)",
        });
      }
      break;
    case 137: // Nov Pursuit failed
      clearPursuitAndCheckpoints(world, true);
      break;
    case 226: // Nov Sabik Obj 3 complete (Langley Cold Storage): "No further information" (pawn exits manually or at Mop Up)
      break;
    case 130: // Nov Sabik Obj 3 failed attempt 1: cross out 1 contact
      if (game && activeContactsList(c).length > 0) {
        pushDecision(world, { t: "kill-contact", source: "Debrief 130 (Failed Recover COdA Sample)" });
      }
      break;
    case 119:
      break;

    // --- December ---
    case 140: // Pollen -> +2 funding
      adjustFunding(world, 2, "Debrief 140 (Pollen confirmed)");
      break;
    case 126: // Jellyfish -> -1 funding
    case 120: // We don't know -> -1 funding
      adjustFunding(world, -1, `Debrief ${num}`);
      break;
    case 209: // CIA branch Agent Sabik -> -2 funding
      adjustFunding(world, -2, "Debrief 209");
      break;
    case 109: // Sabik branch Agent Sabik -> 0
      break;
    case 107: {
      // Dec Obj 1 complete (Steal MEDUSA Genome): if Stop LION'S TOOTH incomplete, open Door 41 + return pawn to Novosibirsk
      if (game && seat && game.players[seat].infiltration?.site === "pearl") {
        game.players[seat].infiltration = null;
        game.players[seat].location = "novosibirsk";
      }
      const lionsToothIncomplete = game?.objectives.some(
        (o) => o.cardCode === "12-05" || o.cardCode === "sealed-12-04" ? o.status === "active" : false,
      );
      if (lionsToothIncomplete) openDoor(world, "41");
      break;
    }
    case 196:
      break;
    case 181: // Dec CIA Capture Sabik -> player chooses forceful (144) or talk (164)
      if (game && obj) {
        pushDecision(world, { t: "december-choice", variant: "cia-sabik", objectiveId: obj.id });
      }
      break;
    case 144: // Forcefully stop Sabik
      clearPursuitAndCheckpoints(world, true);
      break;
    case 164: {
      // Talk Sabik down -> if Steal MEDUSA Genome incomplete, reveal up to 4 PEARL security tokens + clear Pursuit/Checkpoints
      clearPursuitAndCheckpoints(world, true);
      const genomeIncomplete = game?.objectives.some(
        (o) => (o.cardCode === "12-03" || o.cardCode === "sealed-12-03") && o.status === "active",
      );
      const pearlSite = game?.infiltrationSites.pearl;
      const unrevealed = pearlSite?.tokens.filter((t) => !t.revealed).length ?? 0;
      if (game && seat && genomeIncomplete && unrevealed > 0) {
        pushDecision(world, {
          t: "reveal-pearl-tokens",
          seat,
          remaining: Math.min(4, unrevealed),
          source: "Debrief 164 (Talked Sabik Down)",
        });
      }
      break;
    }
    case 179:
      clearPursuitAndCheckpoints(world, true);
      break;
    case 155: {
      // Stop Operation LION'S TOOTH complete: if not all objectives complete, distribute 2 Action tokens; card to hand
      if (obj && seat) finalizeUnknownTargetCard(world, obj, seat);
      const allDone = game?.objectives.every((o) => o.status !== "active") ?? true;
      if (game && !allDone && game.supplies.actionTokens > 0) {
        pushDecision(world, {
          t: "distribute-action-tokens",
          remaining: Math.min(2, game.supplies.actionTokens),
          source: "Debrief 155 (Stop Operation LION'S TOOTH)",
        });
      }
      break;
    }
    case 117:
      if (obj) finalizeUnknownTargetCard(world, obj, null);
      break;
    case 184: // Dec Sabik Bring Cooper to Sabik -> choose allow (138) or stop (158)
      if (game && obj) {
        pushDecision(world, { t: "december-choice", variant: "sabik-cooper", objectiveId: obj.id });
      }
      break;
    case 138:
    case 158:
    case 129:
      break;

    // --- Endings (243..252) & Final Evaluations (236..240) ---
    case 243:
    case 245:
    case 247:
    case 252:
      c.endingDebriefs.push(num);
      readDebrief(world, 249);
      break;
    case 244:
    case 246:
    case 248:
    case 250:
      c.endingDebriefs.push(num);
      readDebrief(world, 251);
      break;
    case 249:
    case 251:
      c.endingDebriefs.push(num);
      break;
    case 236:
    case 237:
    case 238:
    case 239:
    case 240:
      c.finalEvaluationDebrief = num;
      break;

    default:
      break;
  }
}

function presentLegacyCard(world: World, cardId: string): void {
  const card = pack.legacyArchive[cardId];
  if (!card) throw new Error(`Unknown legacy card "${cardId}"`);
  const parts: string[] = [];
  if (card.front) parts.push(`[FRONT]\n${card.front}`);
  if (card.back) parts.push(`[BACK]\n${card.back}`);
  pushReading(world, "legacy", card.id, `Legacy Card ${card.code}`, parts.join("\n\n"));
}

/**
 * Advances and resolves the Legacy deck for the current month's setup (or when resuming from a PAUSE).
 * Adds newly revealed objectives onto `world.game.objectives` and queues any interactive setup decisions.
 */
export function readLegacySetup(world: World): void {
  const c = world.campaign;
  const game = world.game!;

  // Attempt 2 of a month: do NOT re-draw Legacy setup cards; restore replay objectives instead!
  if (c.attempt === 2 && c.replayObjectives) {
    game.objectives = c.replayObjectives.map(makeObjectiveFromTemplate);
    c.replayObjectives = null;
    // If Sabik's Safehouse or Sabik's HQ was in reserve, it stays available for attempt 2;
    // if an objective was already completed in attempt 1, it stays marked completed!
    return;
  }

  // Prologue replay after already having read 00-01..00-05: recreate prologue objectives
  if (c.month === 0 && c.legacyIndex >= 5) {
    game.objectives = [
      makeObjectiveFromTemplate(legacyObjectiveTemplate("legacy/00-03")),
      makeObjectiveFromTemplate(legacyObjectiveTemplate("legacy/00-04")),
    ];
    return;
  }

  // Destroy timed infiltration Ops cards at the start of July, September, December
  if (c.month === 7 && !c.destroyedOpsCards.includes(70)) {
    c.destroyedOpsCards.push(70, 71);
  }
  if (c.month === 9 && !c.destroyedOpsCards.includes(72)) {
    c.destroyedOpsCards.push(72, 73);
  }
  if (c.month === 12 && c.branch === "sabik" && !c.destroyedOpsCards.includes(74)) {
    c.destroyedOpsCards.push(74, 75);
  }

  while (c.legacyIndex < c.legacyOrder.length) {
    const cardId = c.legacyOrder[c.legacyIndex]!;
    if (cardId === "legacy/end-of-part-1" || cardId === "legacy/end-of-legacy-deck" || cardId === "legacy/sealed-end-of-legacy-deck") {
      presentLegacyCard(world, cardId);
      c.legacyIndex += 1;
      continue;
    }

    const card = pack.legacyArchive[cardId]!;
    const cardMonth = parseCardMonth(cardId);

    // Stop if the next card is a STOP card for a LATER month!
    if (card.marker === "STOP" && cardMonth > c.month) {
      break;
    }
    // Pause at a PAUSE card (drawn when triggered at game end / trial resolution / offer resolution)
    if (card.marker === "PAUSE") {
      c.legacyPause = cardId;
      break;
    }

    c.legacyIndex += 1;
    presentLegacyCard(world, cardId);
    const shouldBreak = applyLegacyCard(world, cardId);
    if (shouldBreak) break;
  }
}

/** Triggers a PAUSE card when its condition fires (trial end, game end step 3, decline Sabik offer). */
export function readLegacyPause(world: World, expectedCardId: string): void {
  const c = world.campaign;
  if (c.legacyIndex >= c.legacyOrder.length) return;
  const nextId = c.legacyOrder[c.legacyIndex]!;
  if (nextId !== expectedCardId) return;

  c.legacyPause = null;
  while (c.legacyIndex < c.legacyOrder.length) {
    const cardId = c.legacyOrder[c.legacyIndex]!;
    if (
      cardId === "legacy/end-of-part-1" ||
      cardId === "legacy/end-of-legacy-deck" ||
      cardId === "legacy/sealed-end-of-legacy-deck"
    ) {
      presentLegacyCard(world, cardId);
      c.legacyIndex += 1;
      continue;
    }
    const card = pack.legacyArchive[cardId]!;
    // Stop when reaching the next STOP or PAUSE card (except the expectedCardId we just triggered!)
    if (cardId !== expectedCardId && (card.marker === "STOP" || card.marker === "PAUSE")) {
      if (card.marker === "PAUSE") c.legacyPause = cardId;
      break;
    }
    c.legacyIndex += 1;
    presentLegacyCard(world, cardId);
    const shouldBreak = applyLegacyCard(world, cardId);
    if (shouldBreak) break;
  }
}

function parseCardMonth(cardId: string): number {
  const m = cardId.match(/(\d{2})-\d{2}$/);
  return m ? Number(m[1]) : 99;
}

function legacyObjectiveTemplate(cardId: string): ActiveObjectiveTemplate {
  switch (cardId) {
    case "legacy/00-03":
      return {
        id: "pro-1",
        cardCode: "00-03",
        title: "Retrieve Project MEDUSA Sample",
        description: "Acquire Target in 1 unknown city in Europe.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "europe",
        requiredTeamsPerCity: 1,
        debriefComplete: 160,
        debriefFail: 166,
      };
    case "legacy/00-04":
      return {
        id: "pro-2",
        cardCode: "00-04",
        title: "Search for Agent Sabik",
        description: "Acquire Target in Novosibirsk.",
        kind: "known-cities",
        status: "active",
        targetCities: ["novosibirsk"],
        requiredTeamsPerCity: 1,
        debriefComplete: 214,
        debriefFail: 150,
      };
    case "legacy/01-03":
      return {
        id: "jan-1",
        cardCode: "01-03",
        title: "Question Soviet Scientists",
        description: "Acquire Target in Santiago and São Paulo with the same action.",
        kind: "known-cities",
        status: "active",
        targetCities: ["santiago", "sao-paulo"],
        requiredTeamsPerCity: 1,
        debriefComplete: 147,
        debriefFail: 131,
      };
    case "legacy/01-04":
      return {
        id: "jan-2",
        cardCode: "01-04",
        title: "Find Agent Sabik",
        description: "Acquire Target in 1 unknown city in Asia.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "asia",
        requiredTeamsPerCity: 1,
        debriefComplete: 210,
        debriefFail: 195,
      };
    case "legacy/02-03":
      return {
        id: "feb-1",
        cardCode: "02-03",
        title: "Disrupt the First Trial",
        description: "Disrupt Trial in 1, 2, or 3 known cities in Africa at the same time.",
        kind: "disrupt-trial",
        status: "active",
        trialRegion: "africa",
        trialCount: 3,
        trialRequireAll: false,
        trialIntensity: 0,
        debriefComplete: 174,
        debriefFail: 169,
      };
    case "legacy/02-04":
      return {
        id: "feb-2",
        cardCode: "02-04",
        title: "Investigate Soviet Scientists",
        description: "Acquire Target in 1 unknown city in North America.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "north-america",
        requiredTeamsPerCity: 1,
        debriefComplete: 191,
        debriefFail: 149,
      };
    case "legacy/03-02":
      return {
        id: "mar-1",
        cardCode: "03-02",
        title: "Investigate Soviet Manufacturing",
        description: "Acquire Target in 1 unknown city in the Pacific Rim.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "pacific-rim",
        requiredTeamsPerCity: 1,
        debriefComplete: 205,
        debriefFail: 161,
      };
    case "legacy/03-03":
      return {
        id: "mar-2",
        cardCode: "03-03",
        title: "Prevent Sabik from Selling CIA Secrets",
        description: "Acquire Target in Prague, using 2 active teams at the same time.",
        kind: "known-cities",
        status: "active",
        targetCities: ["prague"],
        requiredTeamsPerCity: 2,
        debriefComplete: 114,
        debriefFail: 225,
      };
    case "legacy/04-19":
      return {
        id: "apr-1",
        cardCode: "04-19",
        title: "Disrupt the Second Trial",
        description: "Disrupt Trial in 1, 2, or 3 known cities in South America at the same time.",
        kind: "disrupt-trial",
        status: "active",
        trialRegion: "south-america",
        trialCount: 3,
        trialRequireAll: false,
        trialIntensity: 0,
        debriefComplete: 224,
        debriefFail: 156,
      };
    case "legacy/04-20":
      return {
        id: "apr-2",
        cardCode: "04-20",
        title: "Bug Control Center",
        description: "Acquire Target in 1 unknown city in Europe.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "europe",
        requiredTeamsPerCity: 1,
        debriefComplete: 165,
        debriefFail: 193,
      };
    case "legacy/05-03":
      return {
        id: "may-1",
        cardCode: "05-03",
        title: "Interrupt the Soviet Delivery",
        description: "Remove the last Pursuit token from the board (starts in Johannesburg).",
        kind: "pursuit",
        status: "active",
        pursuitStartCity: "johannesburg",
        debriefComplete: 146,
        debriefFail: 202,
        debriefFailAttempt2: 148,
      };
    case "legacy/05-04":
      return {
        id: "may-2",
        cardCode: "05-04",
        title: "Find Sabik's Operatives",
        description: "Acquire Target in Istanbul and Peking with the same action.",
        kind: "known-cities",
        status: "active",
        targetCities: ["istanbul", "peking"],
        requiredTeamsPerCity: 1,
        debriefComplete: 223,
        debriefFail: 159,
      };
    case "legacy/05-05":
      return {
        id: "may-3",
        cardCode: "05-05",
        title: "Bug Control Center",
        description: "Acquire Target in 1 unknown city in South America.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "south-america",
        requiredTeamsPerCity: 1,
        debriefComplete: 167,
        debriefFail: 136,
      };
    case "legacy/06-03":
      return {
        id: "jun-1",
        cardCode: "06-03",
        title: "Disrupt the Third Trial",
        description: "Disrupt Trial in 1, 2, 3, or 4 known cities in Europe at the same time.",
        kind: "disrupt-trial",
        status: "active",
        trialRegion: "europe",
        trialCount: 4,
        trialRequireAll: false,
        trialIntensity: 1,
        debriefComplete: 206,
        debriefFail: 190,
      };
    case "legacy/06-04":
      return {
        id: "jun-2",
        cardCode: "06-04",
        title: "Infiltrate Sabik's Safehouse",
        description: "While in the Basement of Sabik's Safehouse (Mexico City), spend an action and discard 3 Neutral City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "sabik-safehouse",
        infiltrationRoom: "ss-basement",
        infiltrationDiscardCount: 3,
        infiltrationDiscardAffiliation: "neutral",
        debriefComplete: 104,
        debriefFail: 183,
        debriefFailAttempt2: 192,
      };
    case "legacy/06-05":
      return {
        id: "jun-3",
        cardCode: "06-05",
        title: "Bug Control Center",
        description: "Acquire Target in 1 unknown city in Asia.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "asia",
        requiredTeamsPerCity: 1,
        debriefComplete: 229,
        debriefFail: 111,
      };
    case "legacy/07-02":
      return {
        id: "jul-1",
        cardCode: "07-02",
        title: "Stop Defector from Delivering Secrets",
        description: "Remove the last Pursuit token from the board (starts in Los Angeles).",
        kind: "pursuit",
        status: "active",
        pursuitStartCity: "los-angeles",
        debriefComplete: 141,
        debriefFail: 112,
        debriefFailAttempt2: 232,
      };
    case "legacy/07-03":
      return {
        id: "jul-2",
        cardCode: "07-03",
        title: "Stop Sabik Finding His Former Captors",
        description: "Acquire Target in Warsaw and Madrid with the same action.",
        kind: "known-cities",
        status: "active",
        targetCities: ["warsaw", "madrid"],
        requiredTeamsPerCity: 1,
        debriefComplete: 198,
        debriefFail: 219,
        debriefFailAttempt2: 113,
      };
    case "legacy/07-04":
      return {
        id: "jul-3",
        cardCode: "07-04",
        title: "Bug Control Center",
        description: "Acquire Target in 1 unknown city in Africa.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "africa",
        requiredTeamsPerCity: 1,
        debriefComplete: 186,
        debriefFail: 125,
      };
    case "legacy/08-02":
      return {
        id: "aug-1",
        cardCode: "08-02",
        title: "Disrupt the Fourth Trial",
        description: "Disrupt Trial in 1, 2, 3, or 4 known cities in Asia at the same time.",
        kind: "disrupt-trial",
        status: "active",
        trialRegion: "asia",
        trialCount: 4,
        trialRequireAll: false,
        trialIntensity: 2,
        debriefComplete: 203,
        debriefFail: 100,
      };
    case "legacy/08-03":
      return {
        id: "aug-2",
        cardCode: "08-03",
        title: "Infiltrate Sabik's HQ",
        description: "While in the Secret Annex of Sabik's HQ (Leningrad), spend an action and discard 3 Neutral City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "sabik-hq",
        infiltrationRoom: "hq-secret-annex",
        infiltrationDiscardCount: 3,
        infiltrationDiscardAffiliation: "neutral",
        debriefComplete: 123,
        debriefFail: 142,
      };
    case "legacy/08-04":
      return {
        id: "aug-3",
        cardCode: "08-04",
        title: "Bug Control Center",
        description: "Acquire Target in 1 unknown city in North America.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "north-america",
        requiredTeamsPerCity: 1,
        debriefComplete: 151,
        debriefFail: 215,
      };
    case "legacy/09-03":
      return {
        id: "sep-1",
        cardCode: "09-03",
        title: "Disrupt or Prevent All Trials",
        description: "Disrupt Trial in ALL remaining trial cities in North America at the same time (or prevent them via PEARL Loading Dock).",
        kind: "disrupt-trial",
        status: "active",
        trialRegion: "north-america",
        trialCount: 3,
        trialRequireAll: true,
        trialIntensity: 3,
        debriefComplete: 230,
        debriefFail: 178,
      };
    case "legacy/09-04":
      return {
        id: "sep-2",
        cardCode: "09-04",
        title: "Access Agent Sabik's Records",
        description: "While in the Records Room of PEARL Compound (Novosibirsk), spend an action and discard any 3 City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "pearl",
        infiltrationRoom: "pearl-records-room",
        infiltrationDiscardCount: 3,
        debriefComplete: 182,
        debriefFail: 145,
      };
    case "legacy/09-05":
      return {
        id: "sep-3",
        cardCode: "09-05",
        title: "Bug Control Center",
        description: "Acquire Target in 1 unknown city in the Pacific Rim.",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "pacific-rim",
        requiredTeamsPerCity: 1,
        debriefComplete: 234,
        debriefFail: 218,
      };
    case "legacy/10-02":
      return {
        id: "oct-1",
        cardCode: "10-02",
        title: "Find the Soviets' Cure for MEDUSA",
        description: "While in the Medical Ward of PEARL Compound (Novosibirsk), spend an action and discard any 3 City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "pearl",
        infiltrationRoom: "pearl-medical-ward",
        infiltrationDiscardCount: 3,
        debriefComplete: 180,
        debriefFail: 217,
      };
    case "legacy/10-03":
      return {
        id: "oct-2",
        cardCode: "10-03",
        title: "Interrogate the KGB Officer",
        description: "Acquire Target in Johannesburg, using 2 active teams at the same time.",
        kind: "known-cities",
        status: "active",
        targetCities: ["johannesburg"],
        requiredTeamsPerCity: 2,
        debriefComplete: 222,
        debriefFail: 128,
      };
    case "legacy/10-04":
      return {
        id: "oct-3",
        cardCode: "10-04",
        title: "Hunt Down the Soviet Exporter",
        description: "Remove the last Pursuit token from the board (starts in London).",
        kind: "pursuit",
        status: "active",
        pursuitStartCity: "london",
        debriefComplete: 101,
        debriefFail: 172,
        debriefFailAttempt2: 241,
      };
    case "legacy/11-04":
      return {
        id: "nov-1",
        cardCode: "11-04",
        title: "Sabotage the Manufacturing Facility",
        description: "While in the Manufacturing Facility of PEARL Compound (Novosibirsk), spend an action and discard any 4 City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "pearl",
        infiltrationRoom: "pearl-manufacturing-facility",
        infiltrationDiscardCount: 4,
        debriefComplete: 102,
        debriefFail: 235,
      };
    case "legacy/11-05":
      return {
        id: "nov-2",
        cardCode: "11-05",
        title: "Bribe Sabik's Ally",
        description: "Acquire Target in 1 unknown Allied city. You may NOT use the Identify Target City action.",
        kind: "unknown-city",
        status: "active",
        unknownAffiliation: "allied",
        noIdentifyAction: true,
        requiredTeamsPerCity: 1,
        debriefComplete: 201,
        debriefFail: 134,
      };
    case "legacy/11-06":
      return {
        id: "nov-3",
        cardCode: "11-06",
        title: "Learn About MEDUSA Deployment Plan",
        description: "Remove the last Pursuit token from the board (starts in Sydney).",
        kind: "pursuit",
        status: "active",
        pursuitStartCity: "sydney",
        debriefComplete: 188,
        debriefFail: 137,
      };
    case "legacy/12-03":
      return {
        id: "dec-1",
        cardCode: "12-03",
        title: "Steal the MEDUSA Genome",
        description: "While in the Laboratory of PEARL Compound (Novosibirsk), spend an action and discard any 5 City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "pearl",
        infiltrationRoom: "pearl-laboratory",
        infiltrationDiscardCount: 5,
        debriefComplete: 107,
        debriefFail: 196,
      };
    case "legacy/12-04":
      return {
        id: "dec-2",
        cardCode: "12-04",
        title: "Capture Sabik",
        description: "Remove the last Pursuit token from the board (starts in San Francisco).",
        kind: "pursuit",
        status: "active",
        pursuitStartCity: "san-francisco",
        debriefComplete: 181,
        debriefFail: 179,
      };
    case "legacy/12-05":
      return {
        id: "dec-3",
        cardCode: "12-05",
        title: "Stop Operation LION'S TOOTH",
        description: "Acquire Target in 1 unknown city with a Control Center. You may NOT use the Identify Target City action.",
        kind: "unknown-city",
        status: "active",
        unknownControlCentersOnly: true,
        noIdentifyAction: true,
        requiredTeamsPerCity: 1,
        debriefComplete: 155,
        debriefFail: 117,
      };
    // --- Sealed (Sabik branch) November & December ---
    case "legacy/sealed-11-03":
      return {
        id: "nov-s1",
        cardCode: "sealed-11-03",
        title: "Sabotage the Manufacturing Facility",
        description: "While in the Manufacturing Facility of PEARL Compound (Novosibirsk), spend an action and discard any 4 City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "pearl",
        infiltrationRoom: "pearl-manufacturing-facility",
        infiltrationDiscardCount: 4,
        debriefComplete: 102,
        debriefFail: 235,
      };
    case "legacy/sealed-11-04":
      return {
        id: "nov-s2",
        cardCode: "sealed-11-04",
        title: "Learn About MEDUSA Deployment Plan",
        description: "Remove the last Pursuit token from the board (starts in Sydney).",
        kind: "pursuit",
        status: "active",
        pursuitStartCity: "sydney",
        debriefComplete: 188,
        debriefFail: 137,
      };
    case "legacy/sealed-11-06":
      return {
        id: "nov-s3",
        cardCode: "sealed-11-06",
        title: "Recover the COdA Sample",
        description: "While in Cold Storage of Langley (Washington), spend an action and discard any 3 City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "langley",
        infiltrationRoom: "lg-cold-storage",
        infiltrationDiscardCount: 3,
        debriefComplete: 226,
        debriefFail: 130,
        debriefFailAttempt2: 119,
      };
    case "legacy/sealed-12-03":
      return {
        id: "dec-s1",
        cardCode: "sealed-12-03",
        title: "Steal the MEDUSA Genome",
        description: "While in the Laboratory of PEARL Compound (Novosibirsk), spend an action and discard any 5 City cards.",
        kind: "infiltration",
        status: "active",
        infiltrationSite: "pearl",
        infiltrationRoom: "pearl-laboratory",
        infiltrationDiscardCount: 5,
        debriefComplete: 107,
        debriefFail: 196,
        hint: "Sabik's tip: The Laboratory is in the southeast corner of PEARL Compound.",
      };
    case "legacy/sealed-12-04":
      return {
        id: "dec-s2",
        cardCode: "sealed-12-04",
        title: "Stop Operation LION'S TOOTH",
        description: "Acquire Target in 1 unknown city with a Control Center. You may NOT use the Identify Target City action.",
        kind: "unknown-city",
        status: "active",
        unknownControlCentersOnly: true,
        noIdentifyAction: true,
        requiredTeamsPerCity: 1,
        debriefComplete: 155,
        debriefFail: 117,
      };
    case "legacy/sealed-12-05":
      return {
        id: "dec-s3",
        cardCode: "sealed-12-05",
        title: "Bring Cooper to Sabik",
        description: "Acquire Target in San Francisco, using 2 active teams at the same time.",
        kind: "known-cities",
        status: "active",
        targetCities: ["san-francisco"],
        requiredTeamsPerCity: 2,
        debriefComplete: 184,
        debriefFail: 129,
      };
    default:
      throw new Error(`No objective template for legacy card ${cardId}`);
  }
}

/** Returns true if reading the deck should pause until an interactive choice resolves (e.g. Sabik's offer). */
function applyLegacyCard(world: World, cardId: string): boolean {
  const c = world.campaign;
  const game = world.game;

  switch (cardId) {
    // --- Prologue ---
    case "legacy/00-01":
    case "legacy/00-02":
      return false;
    case "legacy/00-03":
    case "legacy/00-04":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/00-05":
      c.intelFile.push({
        id: "legacy/00-05",
        title: "Coop's Notes",
        text: pack.legacyArchive["legacy/00-05"]!.back,
      });
      return false;

    // --- January ---
    case "legacy/01-01":
      if (game) pushDecision(world, { t: "create-aliases", affiliation: "allied" });
      return false;
    case "legacy/01-02":
      return false;
    case "legacy/01-03":
    case "legacy/01-04":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/01-05":
      if (game) {
        pushDecision(world, {
          t: "psych-questions",
          cardId,
          questions: [
            { number: 1, prompt: "We often consider the consequences before we take action.", kind: "agree-disagree" },
            { number: 2, prompt: "We tend to blame ourselves when something goes wrong.", kind: "agree-disagree" },
            { number: 3, prompt: "We are willing to manipulate people to get what we want.", kind: "agree-disagree" },
          ],
        });
      }
      return false;
    case "legacy/01-06":
      return false;
    case "legacy/01-07":
      addEvent(c, "bureaucratic-entanglements");
      return false;
    case "legacy/01-08":
      addEvent(c, "encoded-messages");
      return false;
    case "legacy/01-09":
      addEvent(c, "weekend-rendezvous");
      return false;
    case "legacy/01-10":
      addEvent(c, "scramble-teams");
      return false;

    // --- February ---
    case "legacy/02-01":
      return false;
    case "legacy/02-02":
      openDoor(world, "L");
      openDoor(world, "35");
      return false;
    case "legacy/02-03":
    case "legacy/02-04":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/02-05":
    case "legacy/02-06":
    case "legacy/02-07":
    case "legacy/02-08":
      return false;
    case "legacy/02-09":
      openDoor(world, "12");
      if (game?.outcome?.evaluation === "FAILING") readDebrief(world, 163);
      return false;
    case "legacy/02-10":
      addEvent(c, "diversion");
      return false;

    // --- March ---
    case "legacy/03-01":
      openBox(world, "0001");
      return false;
    case "legacy/03-02":
    case "legacy/03-03":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/03-04":
      if (game) {
        pushDecision(world, {
          t: "psych-questions",
          cardId,
          questions: [
            { number: 4, prompt: "We have emotional attachments to our friends.", kind: "agree-disagree" },
          ],
        });
      }
      return false;
    case "legacy/03-05":
      return false;
    case "legacy/03-06":
      // Scheduled on the stack right behind 03-04 so Q4 is answered before Evaluation 1 runs.
      if (game) pushEffect(world, { t: "eval-psych", which: 1 });
      else evaluatePsych1(world);
      return false;
    case "legacy/03-07":
      c.discretionaryBudgetBoxesLeft = 3;
      return false;
    case "legacy/03-08":
      openDoor(world, "A");
      openDoor(world, "13");
      return false;
    case "legacy/03-09":
      addEvent(c, "one-quiet-night");
      return false;

    // --- April ---
    case "legacy/04-01":
      if (game) pushDecision(world, { t: "transmission-report", cardId });
      return false;
    case "legacy/04-02":
      openBox(world, "0007");
      return false;
    case "legacy/04-03":
      openDoor(world, "H");
      openDoor(world, "29");
      openDoor(world, "J");
      openDoor(world, "40");
      if (game) game.supplies.symptoms = [...pack.symptomNames];
      return false;
    case "legacy/04-19":
    case "legacy/04-20":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/04-21":
      openDoor(world, "11");
      openDoor(world, "16");
      openDoor(world, "18");
      if (game?.outcome?.evaluation === "FAILING") readDebrief(world, 227);
      return false;
    case "legacy/04-22":
      addEvent(c, "undocumented-actions");
      return false;
    case "legacy/04-23":
      addEvent(c, "extended-time");
      return false;

    // --- May ---
    case "legacy/05-01":
      c.discretionaryBudgetBoxesLeft = null;
      return false;
    case "legacy/05-02":
      openBox(world, "0004");
      return false;
    case "legacy/05-03":
    case "legacy/05-04":
    case "legacy/05-05":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/05-06": {
      const ans = c.transmissionMethod ?? "airborne";
      const map = {
        "animal-contact": 121,
        airborne: 154,
        saliva: 135,
        waterborne: 213,
      } as const;
      readDebrief(world, map[ans]);
      return false;
    }
    case "legacy/05-07":
      if (game) {
        pushDecision(world, {
          t: "psych-questions",
          cardId,
          questions: [
            { number: 5, prompt: "We are superior to others who have the same role as us.", kind: "scale-1-5" },
            { number: 6, prompt: "We find it easy to motivate those reluctant to comply.", kind: "scale-1-5" },
            { number: 7, prompt: "We find it easy to complete multiple objectives at once.", kind: "scale-1-5" },
          ],
        });
      }
      return false;
    case "legacy/05-08":
      openDoor(world, "15");
      if (game?.outcome?.evaluation === "FAILING") readDebrief(world, 177);
      return false;
    case "legacy/05-09":
      addEvent(c, "border-security");
      return false;

    // --- June ---
    case "legacy/06-01": {
      const has62 = c.intelFile.some((x) => x.id === "operations/62");
      const has63 = c.intelFile.some((x) => x.id === "operations/63");
      if (has62) readDebrief(world, 189);
      else if (has63) readDebrief(world, 200);
      else readDebrief(world, 221);
      return false;
    }
    case "legacy/06-02":
      openBox(world, "0006");
      return false;
    case "legacy/06-03":
    case "legacy/06-04":
    case "legacy/06-05":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/06-06":
      if (game) {
        pushDecision(world, {
          t: "psych-questions",
          cardId,
          questions: [
            { number: 8, prompt: "Things never look bleak or hopeless.", kind: "scale-1-5" },
            { number: 9, prompt: "We tend to believe all human beings are worthy of respect.", kind: "scale-1-5" },
          ],
        });
      }
      return false;
    case "legacy/06-07":
      // Scheduled on the stack right behind 06-06 so Q8-Q9 are answered before Evaluation 2 runs.
      if (game) pushEffect(world, { t: "eval-psych", which: 2 });
      else evaluatePsych2(world);
      return false;
    case "legacy/06-08":
    case "legacy/06-09":
    case "legacy/06-10":
    case "legacy/06-11":
    case "legacy/06-12":
      return false;
    case "legacy/06-13":
      openDoor(world, "O");
      openDoor(world, "36");
      openDoor(world, "17");
      openDoor(world, "22");
      if (game?.outcome?.evaluation === "FAILING") readDebrief(world, 116);
      return false;
    case "legacy/06-14":
      addEvent(c, "trial-vaccine");
      return false;

    // --- July ---
    case "legacy/07-01":
      openBox(world, "0008");
      return false;
    case "legacy/07-02":
    case "legacy/07-03":
    case "legacy/07-04":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/07-05":
      if (game) {
        pushDecision(world, {
          t: "psych-questions",
          cardId,
          questions: [
            { number: 10, prompt: "In order for us to win, someone else must lose.", kind: "scale-1-5" },
            { number: 11, prompt: "We believe that [REDACTED] is in our best interest.", kind: "scale-1-5" },
          ],
        });
      }
      return false;
    case "legacy/07-06":
      openDoor(world, "T");
      openDoor(world, "37");
      openDoor(world, "25");
      openDoor(world, "30");
      if (game?.outcome?.evaluation === "FAILING") readDebrief(world, 108);
      return false;
    case "legacy/07-07":
      addEvent(c, "spectrum-interference");
      return false;

    // --- August ---
    case "legacy/08-01":
      openBox(world, "0002");
      return false;
    case "legacy/08-02":
    case "legacy/08-03":
    case "legacy/08-04":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/08-09":
      evaluatePsych3(world);
      return false;
    case "legacy/08-10":
      if (game) pushDecision(world, { t: "deployment-report", cardId });
      return false;
    case "legacy/08-11":
      openDoor(world, "20");
      openDoor(world, "21");
      openDoor(world, "26");
      if (game?.outcome?.evaluation === "FAILING") readDebrief(world, 212);
      return false;

    // --- September ---
    case "legacy/09-01":
      openBox(world, "0003");
      return false;
    case "legacy/09-02":
      return false;
    case "legacy/09-03":
    case "legacy/09-04":
    case "legacy/09-05":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/09-09":
      if (game) {
        pushDecision(world, {
          t: "psych-questions",
          cardId,
          questions: [
            { number: 12, prompt: "We believe the ends justify the means.", kind: "scale-1-5" },
          ],
        });
      }
      return false;
    case "legacy/09-10": {
      const anyChronic = PASSPORT_COLORS.some((color) => c.passports[color].chronicInfections > 0);
      if (anyChronic) {
        c.relapseInDeck = true;
        if (game) {
          const relapseId = "relapse-09-11";
          game.playerCards[relapseId] = { id: relapseId, kind: "relapse" };
          game.playerDiscard.push(relapseId);
          log(game, {
            t: "note",
            text: "Relapse (09-11) added to Player discard pile (and Player deck for all future games)",
          });
        }
      } else {
        if (c.legacyOrder[c.legacyIndex] === "legacy/09-11") {
          c.legacyIndex += 1;
        }
        if (game) {
          log(game, {
            t: "note",
            text: "Legacy 09-10: No passport has a Chronic Infection sticker — Relapse (09-11) destroyed",
          });
        }
      }
      return false;
    }
    case "legacy/09-11":
      return false;
    case "legacy/09-12":
      openDoor(world, "23");
      if (game?.outcome?.evaluation === "FAILING") readDebrief(world, 220);
      return false;
    case "legacy/09-13":
      addEvent(c, "decryption-book");
      return false;

    // --- October ---
    case "legacy/10-01":
      return false;
    case "legacy/10-02":
    case "legacy/10-03":
    case "legacy/10-04":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/10-05":
      evaluatePsych4(world);
      return false;
    case "legacy/10-06":
      openDoor(world, "27");
      if (game) pushDecision(world, { t: "free-infrared-goggles" });
      return false;

    // --- November (CIA Branch & Offer Fork!) ---
    case "legacy/11-01":
      readOperationsCard(world, 76);
      if (game) pushDecision(world, { t: "sabik-offer" });
      // Pause reading legacy deck until players choose accept or decline!
      return true;
    case "legacy/11-02":
      c.restrictions = [];
      if (game) game.activeRestrictions = [];
      adjustFunding(world, 2, "Legacy 11-02 (Full Agent Status)");
      return false;
    case "legacy/11-03":
      openDoor(world, "U");
      openDoor(world, "39");
      openDoor(world, "42");
      openDoor(world, "S");
      if (c.helpFromSabikBoxesLeft !== null && c.helpFromSabikBoxesLeft > 0) {
        readDebrief(world, 231);
      }
      return false;
    case "legacy/11-04":
    case "legacy/11-05":
    case "legacy/11-06":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/11-07":
      openDoor(world, "28");
      c.destroyedBox0005 = true;
      return false;

    // --- November (Sealed / Sabik Branch) ---
    case "legacy/sealed-11-01":
      c.restrictions = [];
      if (game) game.activeRestrictions = [];
      return false;
    case "legacy/sealed-11-02":
      openDoor(world, "U");
      openDoor(world, "39");
      openDoor(world, "42");
      openDoor(world, "S");
      return false;
    case "legacy/sealed-11-03":
    case "legacy/sealed-11-04":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/sealed-11-06":
      readOperationsCard(world, 74);
      readOperationsCard(world, 75);
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/sealed-11-05":
      return false;
    case "legacy/sealed-11-07":
      openDoor(world, "28");
      return false;

    // --- December (Both Branches) ---
    case "legacy/12-01":
    case "legacy/sealed-12-01": {
      const ans = c.deploymentReport ?? "unknown";
      const debriefNum =
        ans === "jellyfish"
          ? 126
          : ans === "pollen"
            ? 140
            : ans === "unknown"
              ? 120
              : c.branch === "cia"
                ? 209
                : 109;
      readDebrief(world, debriefNum);
      return false;
    }
    case "legacy/12-02":
    case "legacy/sealed-12-02":
      return false;
    case "legacy/12-03":
    case "legacy/12-04":
    case "legacy/12-05":
    case "legacy/sealed-12-03":
    case "legacy/sealed-12-04":
    case "legacy/sealed-12-05":
      game?.objectives.push(makeObjectiveFromTemplate(legacyObjectiveTemplate(cardId)));
      return false;
    case "legacy/12-06":
    case "legacy/sealed-12-06":
      return false;
    case "legacy/12-07":
    case "legacy/sealed-12-07": {
      const genomeDone =
        game?.objectives.some(
          (o) => (o.cardCode === "12-03" || o.cardCode === "sealed-12-03") && o.status === "completed",
        ) ?? false;
      const lionDone =
        game?.objectives.some(
          (o) => (o.cardCode === "12-05" || o.cardCode === "sealed-12-04") && o.status === "completed",
        ) ?? false;
      const ending =
        c.branch === "cia"
          ? genomeDone && lionDone
            ? 243
            : genomeDone
              ? 247
              : lionDone
                ? 245
                : 252
          : genomeDone && lionDone
            ? 246
            : genomeDone
              ? 244
              : lionDone
                ? 248
                : 250;
      readDebrief(world, ending);
      return false;
    }
    case "legacy/12-08":
    case "legacy/sealed-12-08": {
      const score = computeFinalScore(world);
      c.finalScore = score;
      const evalDebrief =
        score >= 800 ? 236 : score >= 650 ? 237 : score >= 450 ? 238 : score >= 300 ? 239 : 240;
      if (world.game) {
        log(world.game, {
          t: "note",
          text: `Annual Review Final Score: ${score} -> Debrief ${evalDebrief}`,
        });
      }
      readDebrief(world, evalDebrief);
      c.personnelFile.push({
        id: cardId,
        title: `Annual Review (Final Score: ${score})`,
        text: `${pack.legacyArchive[cardId]!.front}\n\nFinal Score: ${score} → Debrief ${evalDebrief}`,
      });
      return false;
    }
    default:
      return false;
  }
}

export function evaluatePsych1(world: World): void {
  const c = world.campaign;
  const q1 = c.psychAnswers[1] === "AGREE" ? 1 : 0;
  const q2 = c.psychAnswers[2] === "AGREE" ? 1 : 0;
  const q3 = c.psychAnswers[3] === "DISAGREE" ? 1 : 0;
  const q4 = c.psychAnswers[4] === "DISAGREE" ? 1 : 0;
  const bonus = c.intelFile.some((x) => x.id === "operations/61") ? 2 : 0;
  const total = q1 + q2 + q3 + q4 + bonus;
  const debrief = total <= 2 ? 143 : total <= 4 ? 207 : 228;
  c.personnelFile.push({
    id: "legacy/03-06",
    title: `Psychological Evaluation 1 (Total: ${total})`,
    text: `Q1=${c.psychAnswers[1]}, Q2=${c.psychAnswers[2]}, Q3=${c.psychAnswers[3]}, Q4=${c.psychAnswers[4]}, Ops61 bonus=${bonus} -> Total ${total} -> Debrief ${debrief}`,
  });
  if (world.game) {
    log(world.game, {
      t: "note",
      text: `Psych Eval 1 scored: Q1=${c.psychAnswers[1]}(${q1}), Q2=${c.psychAnswers[2]}(${q2}), Q3=${c.psychAnswers[3]}(${q3}), Q4=${c.psychAnswers[4]}(${q4}), Ops61=+${bonus} -> Total ${total} -> Debrief ${debrief}`,
    });
  }
  readDebrief(world, debrief);
}

export function evaluatePsych2(world: World): void {
  const c = world.campaign;
  const total =
    Number(c.psychAnswers[5] ?? 3) +
    Number(c.psychAnswers[6] ?? 3) +
    Number(c.psychAnswers[7] ?? 3) +
    Number(c.psychAnswers[8] ?? 3) +
    Number(c.psychAnswers[9] ?? 3);
  const debrief = total <= 8 ? 122 : total <= 16 ? 133 : 197;
  c.personnelFile.push({
    id: "legacy/06-07",
    title: `Psychological Evaluation 2 (Total: ${total})`,
    text: `Q5-Q9 sum = ${total} -> Debrief ${debrief}`,
  });
  if (world.game) {
    log(world.game, {
      t: "note",
      text: `Psych Eval 2 scored: Q5–Q9 sum = ${total} -> Debrief ${debrief}`,
    });
  }
  readDebrief(world, debrief);
}

export function evaluatePsych3(world: World): void {
  const c = world.campaign;
  const total = Number(c.psychAnswers[10] ?? 3) + Number(c.psychAnswers[11] ?? 3);
  const debrief = total <= 6 ? 153 : 127;
  c.personnelFile.push({
    id: "legacy/08-09",
    title: `Psychological Evaluation 3 (Total: ${total})`,
    text: `Q10-Q11 sum = ${total} -> Debrief ${debrief}`,
  });
  if (world.game) {
    log(world.game, {
      t: "note",
      text: `Psych Eval 3 scored: Q10–Q11 sum = ${total} -> Debrief ${debrief}`,
    });
  }
  readDebrief(world, debrief);
}

export function evaluatePsych4(world: World): void {
  const c = world.campaign;
  const base = Number(c.psychAnswers[12] ?? 3);
  const bonus = c.intelFile.some((x) => x.id === "operations/65") ? 1 : 0;
  const total = base + bonus;
  const debrief = total <= 3 ? 199 : 110;
  c.personnelFile.push({
    id: "legacy/10-05",
    title: `Psychological Evaluation 4 (Total: ${total})`,
    text: `Q12=${base} + Ops65 bonus ${bonus} = ${total} -> Debrief ${debrief}`,
  });
  if (world.game) {
    log(world.game, {
      t: "note",
      text: `Psych Eval 4 scored: Q12=${base} + Ops65(+${bonus}) = ${total} -> Debrief ${debrief}`,
    });
  }
  readDebrief(world, debrief);
}

export function computeFinalScore(world: World): number {
  const c = world.campaign;
  const game = world.game;
  let total = 0;
  for (const res of c.results) {
    if (res.month === 0) continue;
    if (res.evaluation === "SUCCEEDING") total += 85;
    else if (res.evaluation === "ADEQUATE") total += 55;
    else if (res.attempt === 1) total -= 40;
  }
  const genomeDone =
    game?.objectives.some(
      (o) => (o.cardCode === "12-03" || o.cardCode === "sealed-12-03") && o.status === "completed",
    ) ?? false;
  const lionDone =
    game?.objectives.some(
      (o) => (o.cardCode === "12-05" || o.cardCode === "sealed-12-04") && o.status === "completed",
    ) ?? false;
  if (genomeDone) total += 25;
  if (lionDone) total += 25;
  for (const city of Object.values(c.cities)) {
    if (city.exposedIntensity !== null) total -= 10;
    if (city.contaminated) total -= 10;
  }
  return total;
}

// ============================================================================
// After the Game (Steps 1–6) & Upkeep Purchases
// ============================================================================

export function resolveGameEndSteps(world: World): void {
  const c = world.campaign;
  const game = world.game!;

  // Step 1: Check Objectives — fail any still-active objectives and read their failure debriefs!
  for (const obj of game.objectives) {
    if (obj.status !== "active") continue;
    obj.status = "failed";
    const debriefNum =
      c.attempt === 2 && obj.debriefFailAttempt2 !== undefined
        ? obj.debriefFailAttempt2
        : obj.debriefFail;
    const targetCity =
      obj.hiddenCardId && game.playerCards[obj.hiddenCardId]?.kind === "city"
        ? (game.playerCards[obj.hiddenCardId] as { kind: "city"; city: CityId }).city
        : undefined;
    log(game, {
      t: "objective",
      objective: obj.id,
      status: "failed",
      detail: `${obj.title} failed at game end -> Debrief ${debriefNum}`,
    });
    readDebrief(world, debriefNum, { objective: obj, targetCity });
  }

  const completedCount = game.objectives.filter((o) => o.status === "completed").length;
  const failedCount = game.objectives.filter((o) => o.status === "failed").length;
  const evaluation: Evaluation =
    failedCount === 0 ? "SUCCEEDING" : failedCount === 1 ? "ADEQUATE" : "FAILING";
  game.outcome = {
    ended: true,
    reason: game.outcome?.reason ?? "All objectives resolved",
    evaluation,
  };

  // Prologue: Steps 1, 4, 6 only (no permanent changes, no surveillance, no budget!)
  if (c.month === 0) {
    const fundingNote =
      evaluation === "SUCCEEDING"
        ? "In a regular month, SUCCEEDING reduces Funding by 1."
        : evaluation === "ADEQUATE"
          ? "In a regular month, ADEQUATE increases Funding by 1."
          : "In a regular month, FAILING increases Funding by 2 and gives a second attempt.";
    log(game, { t: "end", reason: game.outcome.reason, evaluation });
    pushReading(
      world,
      "rule",
      "prologue-end",
      `Prologue Evaluation: ${evaluation}`,
      [
        `Step 1 (Check Objectives): ${completedCount} completed, ${failedCount} failed -> ${evaluation}.`,
        `${fundingNote} Because this is the Prologue (Rulebook p. 16), Steps 2 (Check Cities), 3 (Check Legacy Deck), and 5 (Prepare/Spend Budget) are skipped: no permanent changes are made, no Surveillance stickers are added, and January starts at Funding 5.`,
        `Step 4 (Check Game End Area): Returned ${game.gameEndArea.length} card(s) to the Threat deck.`,
        `Step 6 (Clean Up): Ready to play the Prologue again or advance to January.`,
      ].join("\n"),
    );
    c.results.push({
      month: 0,
      attempt: 1,
      evaluation,
      completedObjectives: completedCount,
      failedObjectives: failedCount,
      fundingBefore: c.funding,
      fundingAfter: c.funding,
      reason: game.outcome.reason,
      turns: game.turn,
      incidents: game.stats.incidents,
      outbreaks: game.stats.outbreaks,
      escalations: game.stats.escalations,
      seats: game.seats.map((seat) => {
        const p = game.players[seat];
        const alias = p.tempAlias ? pack.occupationById[p.tempAlias].name : "Temp";
        return { seat, passport: null, alias };
      }),
    });
    game.threatDiscard.push(...game.gameEndArea);
    game.gameEndArea = [];
    game.upkeep = null;
    return;
  }

  const fundingBefore = c.funding;
  const fundingDelta = evaluation === "SUCCEEDING" ? -1 : evaluation === "ADEQUATE" ? 1 : 2;
  log(game, {
    t: "end",
    reason: `Step 1 (Check Objectives): ${completedCount} completed, ${failedCount} failed -> ${evaluation}`,
    evaluation,
  });
  adjustFunding(world, fundingDelta, `${evaluation} in ${pack.monthNames[c.month]}`);

  // If FAILING attempt 1 (months 1..11), prepare replay objectives carrying over any completed objectives!
  if (evaluation === "FAILING" && c.attempt === 1 && c.month < 12) {
    c.replayObjectives = game.objectives.map((o) => ({
      id: o.id,
      cardCode: o.cardCode,
      title: o.title,
      description: o.description,
      kind: o.kind,
      status: o.status === "completed" ? "completed" : "active",
      targetCities: o.targetCities,
      requiredTeamsPerCity: o.requiredTeamsPerCity,
      unknownRegion: o.unknownRegion,
      unknownAffiliation: o.unknownAffiliation,
      unknownControlCentersOnly: o.unknownControlCentersOnly,
      noIdentifyAction: o.noIdentifyAction,
      trialRegion: o.trialRegion,
      trialCount: o.trialCount,
      trialRequireAll: o.trialRequireAll,
      trialIntensity: o.trialIntensity,
      pursuitStartCity: o.pursuitStartCity,
      infiltrationSite: o.infiltrationSite,
      infiltrationRoom: o.infiltrationRoom,
      infiltrationDiscardCount: o.infiltrationDiscardCount,
      infiltrationDiscardAffiliation: o.infiltrationDiscardAffiliation,
      region: o.region,
      debriefComplete: o.debriefComplete,
      debriefFail: o.debriefFail,
      debriefFailAttempt2: o.debriefFailAttempt2,
      hint: o.hint,
    }));
  }

  // Record game result BEFORE Step 3 so December scoring sees December's evaluation too!
  c.results.push({
    month: c.month,
    attempt: c.attempt,
    evaluation,
    completedObjectives: completedCount,
    failedObjectives: failedCount,
    fundingBefore,
    fundingAfter: c.funding,
    reason: game.outcome.reason,
    turns: game.turn,
    incidents: game.stats.incidents,
    outbreaks: game.stats.outbreaks,
    escalations: game.stats.escalations,
    seats: game.seats.map((seat) => {
      const p = game.players[seat];
      const alias =
        p.passport && p.activeAlias
          ? c.passports[p.passport].aliases[p.activeAlias].name || `${p.passport} ${p.activeAlias}`
          : p.tempAlias
            ? pack.occupationById[p.tempAlias].name
            : "Burned";
      return { seat, passport: p.passport, alias };
    }),
  });

  // Step 2: Check Cities — add 1 Surveillance to cities with >=1 Incident token (max 3),
  // and add Contamination sticker (Rule BB) to cities with >=1 Outbreak token (max 1)
  const surveillanceAdded: CityId[] = [];
  const contaminationAdded: CityId[] = [];
  for (const city of pack.cities) {
    const loc = game.locations[city.id];
    const cc = c.cities[city.id];
    if (loc.incidents > 0 && cc.surveillance < 3) {
      cc.surveillance += 1;
      surveillanceAdded.push(city.id);
    }
    if (
      hasRule(c, "BB") &&
      loc.outbreaks > 0 &&
      !cc.contaminated &&
      c.availableContaminationStickers > 0
    ) {
      cc.contaminated = true;
      c.availableContaminationStickers -= 1;
      contaminationAdded.push(city.id);
    }
  }

  log(game, {
    t: "note",
    text: `Step 2 (Check Cities): +1 Surveillance in ${surveillanceAdded.length ? surveillanceAdded.map((id) => cityDef(id).name).join(", ") : "none"}${hasRule(c, "BB") ? `; +Contamination in ${contaminationAdded.length ? contaminationAdded.map((id) => cityDef(id).name).join(", ") : "none"}` : ""}`,
  });

  // Step 3: Check Legacy Deck (PAUSE cards at end of attempt 1!)
  if (c.attempt === 1) {
    const endPauseByMonth: Partial<Record<number, string>> = {
      1: "legacy/01-06",
      2: "legacy/02-09",
      3: "legacy/03-07",
      4: "legacy/04-21",
      5: "legacy/05-08",
      6: "legacy/06-13",
      7: "legacy/07-06",
      8: "legacy/08-10",
      9: "legacy/09-12",
      10: "legacy/10-06",
      11: c.branch === "cia" ? "legacy/11-07" : "legacy/sealed-11-07",
      12: c.branch === "cia" ? "legacy/12-06" : "legacy/sealed-12-06",
    };
    const pauseId = endPauseByMonth[c.month];
    if (pauseId) readLegacyPause(world, pauseId);
  }

  // Step 4: Check Game End Area (return Threat cards; Infection cards stay in campaign.infectionCards for future games)
  const threatBack = game.gameEndArea.filter((t) => t.kind === "city");
  const infectionCount = game.gameEndArea.length - threatBack.length;
  game.threatDiscard.push(...threatBack);
  game.gameEndArea = [];
  log(game, {
    t: "note",
    text: `Step 4 (Check Game End Area): returned ${threatBack.length} Threat card(s) to Threat discard${infectionCount > 0 ? `; retained ${infectionCount} Infection card(s) for future games` : ""}`,
  });

  // Step 5: Prepare Budget (skipped in December!)
  if (c.month === 12) {
    game.upkeep = null;
    return;
  }

  const bonusAll = evaluation === "SUCCEEDING" ? 1 : 0;
  const bonusDoor19 = c.door19BonusPending ? 6 : 0;
  c.door19BonusPending = false;
  const budget = game.seats.length + bonusAll + bonusDoor19;
  const budgetParts = [`${game.seats.length} players`];
  if (bonusAll > 0) budgetParts.push(`+${bonusAll} SUCCEEDING`);
  if (bonusDoor19 > 0) budgetParts.push(`+${bonusDoor19} Door 19`);
  log(game, {
    t: "note",
    text: `Step 5 (Prepare Budget): ${budget} budgetary units (${budgetParts.join(" ")})`,
  });

  const safehouseCities = pack.cities
    .filter((ct) => game.locations[ct.id].safehouse && !c.cities[ct.id].permanentSafehouse)
    .map((ct) => ct.id);

  game.upkeep = {
    budget,
    spent: 0,
    bought: [],
    safehouseCities,
    surveillanceAdded,
    contaminationAdded,
    done: [],
  };
}

export function purchaseCost(purchase: Purchase): number {
  if (purchase.t === "permanent-safehouse") return 3;
  if (purchase.t === "counter-surveillance") return 1;
  return pack.assetById[purchase.asset].cost;
}

export function checkPurchase(world: World, purchase: Purchase): string | null {
  const c = world.campaign;
  const upkeep = world.game?.upkeep;
  if (!upkeep) return "Not in Spend Budget step";
  const cost = purchaseCost(purchase);
  if (upkeep.spent + cost > upkeep.budget) {
    return `Costs ${cost} budget, only ${upkeep.budget - upkeep.spent} remaining`;
  }
  switch (purchase.t) {
    case "permanent-safehouse":
      if (c.availablePermanentSafehouses <= 0) return "No Permanent Safehouse stickers left";
      if (!upkeep.safehouseCities.includes(purchase.city)) {
        return `${cityDef(purchase.city).name} did not have a non-permanent safehouse this game`;
      }
      if (c.cities[purchase.city].permanentSafehouse) return "Already has a permanent safehouse";
      return null;
    case "counter-surveillance":
      if (c.availableCounterSurveillance <= 0) return "No Counter Surveillance stickers left";
      if (c.cities[purchase.city].surveillance <= 0) {
        return `${cityDef(purchase.city).name} has no surveillance to remove`;
      }
      return null;
    case "asset": {
      if (!c.availableAssets.includes(purchase.asset)) return "That asset is not available";
      const def = pack.assetById[purchase.asset];
      const alias = c.passports[purchase.passport]?.aliases[purchase.affiliation];
      if (!alias || !alias.created) return "That alias has not been created yet";
      if (alias.burned) return "Cannot add assets to a burned alias";
      if (alias.assets.length >= 3) return "That alias has no empty Asset slots";
      if (def.needsCity) {
        if (!purchase.city) return `${def.name} requires a city`;
        if (def.sovietOnly && cityDef(purchase.city).affiliation !== "soviet") {
          return `${def.name} must be placed in a Soviet city`;
        }
      }
      return null;
    }
  }
}

export function applyPurchase(world: World, purchase: Purchase): void {
  const c = world.campaign;
  const upkeep = world.game!.upkeep!;
  const cost = purchaseCost(purchase);
  upkeep.spent += cost;
  upkeep.bought.push({ purchase, cost });
  upkeep.done = [];

  switch (purchase.t) {
    case "permanent-safehouse":
      c.cities[purchase.city].permanentSafehouse = true;
      c.availablePermanentSafehouses -= 1;
      log(world.game!, {
        t: "note",
        text: `Spend Budget: bought Permanent Safehouse in ${cityDef(purchase.city).name} (-${cost}b, ${upkeep.budget - upkeep.spent}b left)`,
      });
      break;
    case "counter-surveillance":
      c.cities[purchase.city].surveillance -= 1;
      c.availableCounterSurveillance -= 1;
      log(world.game!, {
        t: "note",
        text: `Spend Budget: bought Counter-Surveillance in ${cityDef(purchase.city).name} (sticker surv ${c.cities[purchase.city].surveillance + 1} -> ${c.cities[purchase.city].surveillance}, -${cost}b, ${upkeep.budget - upkeep.spent}b left)`,
      });
      break;
    case "asset": {
      const idx = c.availableAssets.indexOf(purchase.asset);
      c.availableAssets.splice(idx, 1);
      const alias = c.passports[purchase.passport].aliases[purchase.affiliation];
      alias.assets.push({
        id: purchase.asset,
        city: purchase.city ?? null,
        dead: false,
        boxesChecked: 0,
      });
      log(world.game!, {
        t: "note",
        text: `Spend Budget: bought ${pack.assetById[purchase.asset].name}${purchase.city ? ` (${cityDef(purchase.city).name})` : ""} for ${purchase.passport}/${purchase.affiliation} (-${cost}b, ${upkeep.budget - upkeep.spent}b left)`,
      });
      break;
    }
  }
}

export function checkRefund(world: World, index: number): string | null {
  const upkeep = world.game?.upkeep;
  if (!upkeep) return "Not in Spend Budget step";
  if (!Number.isInteger(index) || index < 0 || index >= upkeep.bought.length) {
    return "No purchase at that index";
  }
  return null;
}

export function refundPurchase(world: World, index: number): void {
  const c = world.campaign;
  const upkeep = world.game!.upkeep!;
  const [{ purchase, cost }] = upkeep.bought.splice(index, 1) as [
    { purchase: Purchase; cost: number },
  ];
  upkeep.spent -= cost;
  upkeep.done = [];

  switch (purchase.t) {
    case "permanent-safehouse":
      c.cities[purchase.city].permanentSafehouse = false;
      c.availablePermanentSafehouses += 1;
      log(world.game!, {
        t: "note",
        text: `Spend Budget: refunded Permanent Safehouse in ${cityDef(purchase.city).name} (+${cost}b, ${upkeep.budget - upkeep.spent}b left)`,
      });
      break;
    case "counter-surveillance":
      c.cities[purchase.city].surveillance += 1;
      c.availableCounterSurveillance += 1;
      log(world.game!, {
        t: "note",
        text: `Spend Budget: refunded Counter-Surveillance in ${cityDef(purchase.city).name} (+${cost}b, ${upkeep.budget - upkeep.spent}b left)`,
      });
      break;
    case "asset": {
      c.availableAssets.push(purchase.asset);
      const alias = c.passports[purchase.passport].aliases[purchase.affiliation];
      const idx = alias.assets.findIndex(
        (a) => a.id === purchase.asset && a.city === (purchase.city ?? null),
      );
      if (idx !== -1) alias.assets.splice(idx, 1);
      log(world.game!, {
        t: "note",
        text: `Spend Budget: refunded ${pack.assetById[purchase.asset].name}${purchase.city ? ` (${cityDef(purchase.city).name})` : ""} on ${purchase.passport}/${purchase.affiliation} (+${cost}b, ${upkeep.budget - upkeep.spent}b left)`,
      });
      break;
    }
  }
}

export function closeGame(world: World): void {
  const game = world.game!;
  const c = world.campaign;

  // Prologue rollback: preserve RNG, readings, results, and Coop's Notes (00-05), restore clean pre-prologue state
  if (c.month === 0 && game.prologueRestore) {
    const rng = c.rng;
    const readings = c.readings;
    const nextReadingId = c.nextReadingId;
    const intelFile = c.intelFile;
    const legacyIndex = c.legacyIndex;
    const seating = c.seating;
    const results = c.results;
    world.campaign = {
      ...(JSON.parse(JSON.stringify(game.prologueRestore)) as Campaign),
      rng,
      readings,
      nextReadingId,
      intelFile,
      legacyIndex,
      seating,
      results,
    };
    world.game = null;
    return;
  }

  const evaluation = game.outcome?.evaluation ?? "FAILING";
  if (c.month < 12) {
    if (evaluation === "FAILING" && c.attempt === 1) {
      c.attempt = 2;
    } else {
      c.month += 1;
      c.attempt = 1;
      c.replayObjectives = null;
    }
  }

  world.game = null;
}

export function assignFreeAsset(
  world: World,
  passport: PassportColor,
  affiliation: Affiliation,
  asset: AssetId,
  city?: CityId,
): void {
  const c = world.campaign;
  const idx = c.availableAssets.indexOf(asset);
  if (idx !== -1) c.availableAssets.splice(idx, 1);
  c.passports[passport].aliases[affiliation].assets.push({
    id: asset,
    city: city ?? null,
    dead: false,
    boxesChecked: 0,
  });
}
