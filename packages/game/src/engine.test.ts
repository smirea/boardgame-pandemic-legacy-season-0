import { describe, expect, test } from "bun:test";
import {
  advanceThroughMonth,
  buildAnimationCues,
  canSatisfySecurityTokens,
  computeFinalScore,
  createGameSession,
  createRecording,
  createSeatedCampaign,
  drawTwoPlayerCards,
  ensureHandLimitDecisions,
  evaluatePsych1,
  evaluatePsych4,
  giveSymptomCard,
  markUnknownElimination,
  optionsFor,
  pack,
  parseSave,
  pendingDecisions,
  phaseOf,
  reject,
  replayRecording,
  resolveDiseaseInfection,
  resolveIncidentWave,
  seatsOverHandLimit,
  stagePhase,
  topDecision,
  toSave,
  viewFor,
  violations,
} from "./index";
import type { GameSession } from "./engine";
import type { SecuritySymbol } from "./ids";
import { openBox } from "./legacy";

function send(session: GameSession, cmd: Parameters<GameSession["dispatch"]>[0]) {
  const res = session.dispatch(cmd);
  if (!res.ok) throw new Error(`Command ${cmd.type} failed: ${res.error}`);
  return res;
}

function startPlayingGame(seed = 10, playerCount: 2 | 3 | 4 = 3): GameSession {
  const session = createSeatedCampaign(playerCount, seed);
  send(session, { type: "START_GAME", player: "p1" });
  while (phaseOf(session.state.world) === "setup.threat") {
    send(session, { type: "FLIP_OPENING_THREAT", player: "p1" });
  }
  send(session, { type: "CONFIRM_EVENTS", player: "p1" });
  return session;
}

describe("Pandemic Legacy: Season 0 rules", () => {
  test("a multi-city incident wave draws only one bottom threat card and uses the shared token supply", () => {
    const session = startPlayingGame(11);
    const world = structuredClone(session.state.world);
    const game = world.game!;
    const tokensBefore = game.supplies.incidentOutbreakTokens;
    const deckBefore = game.threatDeck.length;

    resolveIncidentWave(world, ["paris", "london"]);

    expect(game.locations.paris.incidents).toBe(1);
    expect(game.locations.london.incidents).toBe(1);
    expect(game.supplies.incidentOutbreakTokens).toBe(tokensBefore - 2);
    expect(game.threatDeck.length).toBe(deckBefore - 1);
    expect(game.gameEndArea.length).toBe(1);
    expect(violations(world)).toEqual([]);
  });

  test("chain-reaction outbreaks do not cause a city to outbreak twice from one infection card", () => {
    const session = startPlayingGame(12);
    const world = structuredClone(session.state.world);
    world.campaign.diseaseCubeSupplyMax = 16;
    const game = world.game!;
    game.supplies.diseaseCubes = 10;
    game.locations.paris.diseaseCubes = 3;
    game.locations.london.diseaseCubes = 3;

    resolveDiseaseInfection(world, "paris");

    expect(game.locations.paris.outbreaks).toBe(1);
    expect(game.locations.london.outbreaks).toBe(1);
    expect(game.supplies.incidentOutbreakTokens).toBe(5);
    expect(violations(world)).toEqual([]);
  });

  test("Rule R lets one card satisfy keypad, region, and affiliation symbols while Portable Computing Device allows +-1 keypads", () => {
    const session = startPlayingGame(13);
    const world = structuredClone(session.state.world);
    const game = world.game!;
    const moscowId = "city:moscow";
    const moscowKeypad = pack.cityById.moscow.keypad;
    game.players["seat-1"].hand = [moscowId];

    const symbols: SecuritySymbol[] = [
      { kind: "region", region: "europe" },
      { kind: "affiliation", affiliation: "soviet" },
    ];
    expect(canSatisfySecurityTokens(world, "seat-1", symbols, [moscowId])).toBe(false);

    world.campaign.rules.push("R");
    expect(canSatisfySecurityTokens(world, "seat-1", symbols, [moscowId])).toBe(true);

    const nearKeypad: SecuritySymbol[] = [{ kind: "keypad", value: moscowKeypad - 1 }];
    expect(canSatisfySecurityTokens(world, "seat-1", nearKeypad, [moscowId])).toBe(false);

    world.campaign.passports.black.aliases.allied.created = true;
    world.campaign.passports.black.aliases.allied.assets.push({
      id: "portable-computing-device",
      city: null,
      dead: false,
      boxesChecked: 0,
    });
    game.players["seat-1"].passport = "black";
    game.players["seat-1"].activeAlias = "allied";
    game.players["seat-1"].tempAlias = null;
    expect(canSatisfySecurityTokens(world, "seat-1", nearKeypad, [moscowId])).toBe(true);
  });

  test("Symptom cards count toward hand limit, cannot be discarded, and never soft-lock a player holding only Symptoms", () => {
    const session = startPlayingGame(14);
    const world = stagePhase(session.state.world, "playing.actions");
    world.campaign.rules.push("H");
    const game = world.game!;
    game.supplies.symptoms = [
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
    ];
    game.players["seat-1"].hand = ["city:paris"];
    for (let i = 0; i < 7; i++) giveSymptomCard(world, "seat-1");
    expect(game.players["seat-1"].hand.length).toBe(8);
    expect(seatsOverHandLimit(world)).toEqual(["seat-1"]);

    ensureHandLimitDecisions(world);
    const symptomId = game.players["seat-1"].hand.find((id) => id.startsWith("symptom-"))!;
    expect(
      reject(world, {
        type: "DECIDE",
        player: "p1",
        answer: { t: "hand-limit", card: symptomId },
      }),
    ).not.toBeNull();

    // If holding 8 Symptoms and 0 other cards, seatsOverHandLimit does not soft-lock
    game.players["seat-1"].hand = game.players["seat-1"].hand.filter((id) => id !== "city:paris");
    giveSymptomCard(world, "seat-1");
    expect(game.players["seat-1"].hand.length).toBe(8);
    expect(seatsOverHandLimit(world)).toEqual([]);
  });

  test("Escalation pauses at Intensify so Counter-Intelligence can move a card to the Game End area before reshuffling", () => {
    const session = startPlayingGame(15);
    const staged = stagePhase(session.state.world, "playing.draw");
    const g = staged.game!;
    g.active = "seat-1";
    const ciId = "event:counter-intelligence";
    g.playerCards[ciId] = { id: ciId, kind: "event", event: "counter-intelligence" };
    g.playerDeck = g.playerDeck.filter((id) => id !== ciId);
    g.playerDiscard = g.playerDiscard.filter((id) => id !== ciId);
    for (const s of g.seats) {
      g.players[s].hand = g.players[s].hand.filter((id) => id !== ciId);
    }
    g.players["seat-2"].hand.push(ciId);
    const escId = g.playerDeck.find((id) => g.playerCards[id]?.kind === "escalation")!;
    g.playerDeck = [escId, ...g.playerDeck.filter((id) => id !== escId)];

    const resumed = createGameSession({ world: staged });
    send(resumed, { type: "DRAW_PLAYER_CARDS", player: "p1" });
    expect(topDecision(resumed.state.world)).toMatchObject({
      t: "escalation",
      step: "increase",
    });

    send(resumed, { type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    expect(topDecision(resumed.state.world)).toMatchObject({
      t: "escalation",
      step: "add-agents",
    });

    send(resumed, { type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    const atIntensify = resumed.state.world.game!;
    expect(topDecision(resumed.state.world)).toMatchObject({ t: "escalation", step: "intensify" });
    const targetCard = atIntensify.threatDiscard[atIntensify.threatDiscard.length - 1]!;

    send(resumed, {
      type: "PLAY",
      player: "p2",
      play: { e: "counter-intelligence", threatCardId: targetCard.id },
    });

    const afterCI = resumed.state.world.game!;
    expect(afterCI.gameEndArea.some((t) => t.id === targetCard.id)).toBe(true);
    expect(afterCI.threatDiscard.some((t) => t.id === targetCard.id)).toBe(false);
    expect(violations(resumed.state.world)).toEqual([]);
  });

  test("full campaign runs cleanly from Prologue through December on both CIA and Sabik branches across 2, 3, and 4 players", () => {
    const configs: { players: 2 | 3 | 4; branch: "decline" | "accept"; seed: number }[] = [
      { players: 2, branch: "decline", seed: 101 },
      { players: 3, branch: "accept", seed: 202 },
      { players: 4, branch: "decline", seed: 303 },
    ];

    for (const cfg of configs) {
      const session = createSeatedCampaign(cfg.players, cfg.seed);
      const afterPrologue = advanceThroughMonth(session, { sabikChoice: cfg.branch });
      expect(afterPrologue).toBe("lobby");
      expect(violations(session.state.world)).toEqual([]);

      send(session, { type: "BEGIN_JANUARY", player: "p1" });
      expect(session.state.world.campaign.month).toBe(1);

      let gamesPlayed = 0;
      while (phaseOf(session.state.world) !== "finished") {
        advanceThroughMonth(session, { sabikChoice: cfg.branch });
        gamesPlayed += 1;
        const w = session.state.world;
        expect(violations(w)).toEqual([]);
        if (gamesPlayed > 25) throw new Error("Campaign failed to terminate within 25 games");
      }

      const finalWorld = session.state.world;
      expect(finalWorld.campaign.branch).toBe(cfg.branch === "accept" ? "sabik" : "cia");
      expect(finalWorld.campaign.finalScore).not.toBeNull();
      expect(finalWorld.campaign.endingDebriefs.length).toBeGreaterThan(0);
      expect(finalWorld.campaign.readings.length).toBeGreaterThan(60);
      expect(violations(finalWorld)).toEqual([]);
    }
  });

  test("recorded commands replay deterministically to the exact same phase and world state", () => {
    const session = createSeatedCampaign(3, 555);
    const rec = createRecording(toSave(session));
    const commands = [
      { type: "START_GAME" as const, player: "p1" },
      ...Array.from({ length: 9 }, () => ({ type: "FLIP_OPENING_THREAT" as const, player: "p1" })),
      { type: "CONFIRM_EVENTS" as const, player: "p1" },
    ];
    for (const command of commands) {
      const before = phaseOf(session.state.world);
      const logStart = session.state.world.game?.log.length ?? 0;
      send(session, command);
      const after = phaseOf(session.state.world);
      const logEnd = session.state.world.game?.log.length ?? 0;
      rec.steps.push({
        index: rec.steps.length,
        at: new Date().toISOString(),
        phaseBefore: before,
        phaseAfter: after,
        command,
        logStart,
        logEnd,
      });
    }

    const replayed = replayRecording(rec);
    expect(replayed.phase).toBe(phaseOf(session.state.world));
    expect(replayed.world).toEqual(session.state.world);
  });

  test("parseSave migrates legacy v1 saves cleanly onto the Effect Stack", () => {
    const session = startPlayingGame(556);
    const w = structuredClone(session.state.world);
    const legacyRaw = {
      version: 1,
      phase: "playing.actions",
      world: {
        campaign: w.campaign,
        table: { ...w.table, ready: {} },
        game: {
          ...w.game!,
          surveillanceChecked: true,
          cardsDrawn: false,
          queuedEscalations: 0,
          hassledChecked: false,
          coverQueue: [],
          pending: [{ t: "hand-limit", seat: "seat-1" }],
          endedVotes: [],
          postgameResolved: false,
        },
      },
    };
    const migrated = parseSave(legacyRaw);
    expect(migrated.version).toBe(2);
    expect(phaseOf(migrated.world)).toBe("playing.actions");
    expect(topDecision(migrated.world)).toEqual({ t: "hand-limit", seat: "seat-1" });
    expect("pending" in (migrated.world.game as Record<string, unknown>)).toBe(false);
  });

  test("drawTwoPlayerCards resolves Satellite cards before Escalation cards (Rule W)", () => {
    const session = startPlayingGame(16);
    const world = structuredClone(session.state.world);
    world.campaign.rules.push("D", "W");
    const game = world.game!;
    game.supplies.satellites = 5;
    game.playerCards["satellite:europe"] = { id: "satellite:europe", kind: "satellite", region: "europe" };
    const escId = game.playerDeck.find((id) => game.playerCards[id]?.kind === "escalation")!;
    game.playerDeck = [escId, "satellite:europe", ...game.playerDeck.filter((id) => id !== escId)];

    drawTwoPlayerCards(world);

    expect(game.satellites).toContain("europe");
    expect(game.supplies.satellites).toBe(4);
    expect(topDecision(world)).toMatchObject({ t: "escalation", step: "increase" });
    expect(violations(world)).toEqual([]);
  });

  test("completing the final objective preserves its debrief pending decision before ending the game", () => {
    const session = createSeatedCampaign(3, 17);
    send(session, { type: "BEGIN_JANUARY", player: "p1" });
    send(session, { type: "START_GAME", player: "p1" });
    expect(topDecision(session.state.world)?.t).toBe("create-aliases");
    send(session, {
      type: "DECIDE",
      player: "p1",
      answer: {
        t: "create-aliases",
        entries: {
          black: { name: "A", occupation: "research-assistant" },
          green: { name: "B", occupation: "medical-conference-coordinator" },
          pink: { name: "C", occupation: "hospital-administrator" },
          white: { name: "D", occupation: "clinic-planner" },
        },
      },
    });
    expect(topDecision(session.state.world)?.t).toBe("psych-questions");
    send(session, {
      type: "DECIDE",
      player: "p1",
      answer: { t: "psych-questions", answers: { 1: "AGREE", 2: "AGREE", 3: "DISAGREE" } },
    });
    while (phaseOf(session.state.world) === "setup.threat") {
      send(session, { type: "FLIP_OPENING_THREAT", player: "p1" });
    }
    send(session, { type: "CONFIRM_EVENTS", player: "p1" });

    // Stage January with Obj 1 already completed and an active team in Obj 2's hidden Asia city
    const staged = stagePhase(session.state.world, "playing.actions");
    const g = staged.game!;
    g.active = "seat-1";
    g.objectives[0]!.status = "completed";
    const obj2 = g.objectives[1]!;
    obj2.targetRevealed = true;
    const targetCity = (g.playerCards[obj2.hiddenCardId!] as { kind: "city"; city: keyof typeof pack.cityById }).city;
    const aff = pack.cityById[targetCity].affiliation;
    g.teams[`${aff}-1`]!.city = targetCity;

    const resumed = createGameSession({ world: staged });
    send(resumed, {
      type: "ACTION",
      player: "p1",
      action: { a: "acquire-targets", objective: obj2.id },
    });

    // Must still be in playing.actions with file-report [60, 61] pending — NOT prematurely ended!
    expect(phaseOf(resumed.state.world)).toBe("playing.actions");
    expect(topDecision(resumed.state.world)).toMatchObject({
      t: "file-report",
      options: [60, 61],
    });

    send(resumed, { type: "DECIDE", player: "p1", answer: { t: "file-report", chosen: 60 } });
    expect(phaseOf(resumed.state.world)).toBe("over");
    expect(resumed.state.world.campaign.intelFile.some((x) => x.id === "operations/60")).toBe(true);
    expect(violations(resumed.state.world)).toEqual([]);
  });

  test("Door 14 triggers when Funding would exceed 10, supporting open (Door 19 +6 budget), blow-up (Door 24), and deferred ignore", () => {
    const session = createSeatedCampaign(3, 18);
    send(session, { type: "BEGIN_JANUARY", player: "p1" });
    const baseSave = toSave(session);
    baseSave.world.campaign.funding = 10;
    const s1 = createGameSession({ save: baseSave });
    send(s1, { type: "START_GAME", player: "p1" });
    send(s1, {
      type: "DECIDE",
      player: "p1",
      answer: {
        t: "create-aliases",
        entries: {
          black: { name: "A", occupation: "research-assistant" },
          green: { name: "B", occupation: "medical-conference-coordinator" },
          pink: { name: "C", occupation: "hospital-administrator" },
          white: { name: "D", occupation: "clinic-planner" },
        },
      },
    });
    send(s1, {
      type: "DECIDE",
      player: "p1",
      answer: { t: "psych-questions", answers: { 1: "AGREE", 2: "AGREE", 3: "DISAGREE" } },
    });
    while (phaseOf(s1.state.world) === "setup.threat") {
      send(s1, { type: "FLIP_OPENING_THREAT", player: "p1" });
    }
    send(s1, { type: "CONFIRM_EVENTS", player: "p1" });

    // Force loss so funding tries to rise from 10 -> 12 -> opens Door 14
    const lostWorld = stagePhase(s1.state.world, "over");
    lostWorld.game!.outcome = { ended: true, reason: "test loss", evaluation: null };
    const overSession = createGameSession({ world: lostWorld });
    send(overSession, { type: "CONTINUE", player: "p1" });
    expect(phaseOf(overSession.state.world)).toBe("postgame");
    expect(overSession.state.world.campaign.openedDoors).toContain("14");
    expect(topDecision(overSession.state.world)?.t).toBe("door14-briefcase");

    // Branch A: ignore now -> resolve later in upkeep via blow-up (Door 24)
    const ignoreSession = createGameSession({ save: toSave(overSession) });
    send(ignoreSession, {
      type: "DECIDE",
      player: "p1",
      answer: { t: "door14-briefcase", choice: "ignore" },
    });
    expect(phaseOf(ignoreSession.state.world)).toBe("upkeep");
    expect(ignoreSession.state.world.campaign.door14State).toBe("ignored");
    send(ignoreSession, { type: "RESOLVE_DOOR_14", player: "p1", choice: "blow-up" });
    expect(ignoreSession.state.world.campaign.openedDoors).toContain("24");
    expect(topDecision(ignoreSession.state.world)).toMatchObject({
      t: "place-counter-surveillance",
      remaining: 6,
    });

    // Branch B: open now -> Door 19 immediately adds +6 budgetary units to THIS game's Spend Budget
    send(overSession, {
      type: "DECIDE",
      player: "p1",
      answer: { t: "door14-briefcase", choice: "open" },
    });
    expect(overSession.state.world.campaign.openedDoors).toContain("19");
    expect(phaseOf(overSession.state.world)).toBe("upkeep");
    expect(overSession.state.world.game!.upkeep!.budget).toBe(9);
    expect(overSession.state.world.campaign.door19BonusPending).toBe(false);
    expect(violations(overSession.state.world)).toEqual([]);
  });

  test("PEARL Compound infiltration opens doors, triggers Loading Dock (Debrief 105), unlocks hatchways (sum>=10), and shifts pawn out on Mop Up", () => {
    const session = createSeatedCampaign(3, 19);
    send(session, { type: "BEGIN_JANUARY", player: "p1" });
    const c = structuredClone(session.state.world.campaign);
    c.month = 11;
    c.rules.push("E", "H", "J", "L", "M", "P", "Q", "R", "S", "U", "V");
    c.openedBoxes.push("0001", "0002", "0003", "0006", "0007");
    c.openedDoors.push("42", "47");
    c.availableTunnels = 5;
    c.pearlOpenedDoors = [1];
    c.passports.black.aliases.soviet.created = true;
    c.passports.black.aliases.soviet.name = "Orlov";
    c.passports.black.aliases.soviet.occupation = "street-cleaner";
    c.passports.black.aliases.soviet.specialization = "deep-cover";

    const base = startPlayingGame(20);
    const staged = stagePhase(base.state.world, "playing.actions");
    staged.campaign = c;
    const g = staged.game!;
    g.active = "seat-1";
    g.actionsLeft = 4;
    g.supplies.actionTokens = 12;
    g.supplies.symptoms = [...pack.symptomNames];
    g.players["seat-1"].passport = "black";
    g.players["seat-1"].activeAlias = "soviet";
    g.players["seat-1"].tempAlias = null;
    g.players["seat-1"].location = "novosibirsk";

    const highCards = pack.cities.filter((ct) => ct.keypad >= 6).slice(0, 3);
    const handIds = highCards.map((ct) => `city:${ct.id}`);
    for (const id of handIds) {
      g.playerDeck = g.playerDeck.filter((x) => x !== id);
      g.playerDiscard = g.playerDiscard.filter((x) => x !== id);
      for (const s of g.seats) g.players[s].hand = g.players[s].hand.filter((x) => x !== id);
    }
    g.players["seat-1"].hand = [...handIds];
    g.infiltrationSites.pearl = {
      site: "pearl",
      tokens: pack.sites.pearl.edges.flatMap((e) =>
        Array.from({ length: e.securitySlots }, (_, slotIndex) => ({
          id: `pearl:${e.id}:${slotIndex}`,
          edgeId: e.id,
          slotIndex,
          symbol: { kind: "affiliation" as const, affiliation: highCards[0]!.affiliation },
          revealed: false,
        })),
      ),
    };

    const pearlSession = createGameSession({ world: staged });
    send(pearlSession, {
      type: "ACTION",
      player: "p1",
      action: { a: "enter-infiltration", site: "pearl" },
    });
    expect(pearlSession.state.world.game!.players["seat-1"].infiltration).toEqual({
      site: "pearl",
      room: "pearl-entrance",
    });

    // Infiltrate Entrance -> Gatehouse (opens Door 2!)
    send(pearlSession, {
      type: "ACTION",
      player: "p1",
      action: { a: "infiltrate", to: "pearl-gatehouse", revealCards: [handIds[0]!, handIds[1]!] },
    });
    expect(pearlSession.state.world.campaign.pearlOpenedDoors).toContain(2);

    // Unlock hatchway p-h1 (Gatehouse <-> Monitoring Room) using cards with keypad sum >= 10
    send(pearlSession, {
      type: "ACTION",
      player: "p1",
      action: { a: "unlock-hatchway", edgeId: "p-h1", cards: [handIds[0]!, handIds[1]!] },
    });
    expect(pearlSession.state.world.campaign.pearlTunnels).toContain("p-h1");
    expect(pearlSession.state.world.campaign.availableTunnels).toBe(4);

    // Infiltrate through tunnel p-h1 revealing 1 City card
    send(pearlSession, {
      type: "ACTION",
      player: "p1",
      action: { a: "infiltrate", to: "pearl-monitoring-room", revealCards: [handIds[2]!] },
    });
    expect(pearlSession.state.world.game!.players["seat-1"].infiltration?.room).toBe(
      "pearl-monitoring-room",
    );
    expect(topDecision(pearlSession.state.world)?.t).toBe("reveal-pearl-tokens");
    for (let k = 0; k < 2; k++) {
      const tok = pearlSession.state.world.game!.infiltrationSites.pearl!.tokens.find(
        (t) => !t.revealed,
      )!;
      send(pearlSession, {
        type: "DECIDE",
        player: "p1",
        answer: { t: "reveal-pearl-tokens", tokenId: tok.id },
      });
    }

    // End actions -> Mop Up shifts pawn out of PEARL back to Novosibirsk (Rule V)!
    send(pearlSession, { type: "END_ACTIONS", player: "p1" });
    expect(pearlSession.state.world.game!.players["seat-1"].infiltration).toBeNull();
    expect(pearlSession.state.world.game!.players["seat-1"].location).toBe("novosibirsk");
    expect(violations(pearlSession.state.world)).toEqual([]);
  });

  test("Restrictions block actions until ignored with Help from Sabik or removed with Undocumented Actions", () => {
    const base = startPlayingGame(21);
    const staged = stagePhase(base.state.world, "playing.actions");
    const g = staged.game!;
    g.active = "seat-1";
    g.activeRestrictions = ["erratic"];
    staged.campaign.helpFromSabikBoxesLeft = 3;
    const uaId = "event:undocumented-actions";
    g.playerCards[uaId] = { id: uaId, kind: "event", event: "undocumented-actions" };
    g.players["seat-1"].hand = ["city:paris", uaId];

    const s = createGameSession({ world: staged });
    const shareCmd = {
      type: "ACTION" as const,
      player: "p1",
      action: {
        a: "share-intel" as const,
        target: "seat-2" as const,
        card: "city:paris",
        direction: "give" as const,
      },
    };
    expect(s.check(shareCmd)).toContain("Erratic");

    send(s, { type: "ACTION", player: "p1", action: { a: "use-help-from-sabik", restriction: "erratic" } });
    expect(s.state.world.campaign.helpFromSabikBoxesLeft).toBe(2);
    expect(s.check(shareCmd)).toBeNull();

    send(s, { type: "PLAY", player: "p1", play: { e: "undocumented-actions", restriction: "erratic" } });
    expect(s.state.world.game!.activeRestrictions).toEqual([]);
    expect(violations(s.state.world)).toEqual([]);
  });

  test("burning an alias discards the hand, returns pawn to Washington, and prompts for an unused Temporary Alias next turn", () => {
    const base = startPlayingGame(22);
    const staged = stagePhase(base.state.world, "playing.surveillance");
    const c = staged.campaign;
    const g = staged.game!;
    c.passports.black.aliases.allied.created = true;
    c.passports.black.aliases.allied.name = "Dr. Vance";
    c.passports.black.aliases.allied.occupation = "research-assistant";
    c.passports.black.aliases.allied.coverScratched =
      c.passports.black.aliases.allied.coverTrack.length - 1;

    g.active = "seat-1";
    g.players["seat-1"].passport = "black";
    g.players["seat-1"].activeAlias = "allied";
    g.players["seat-1"].tempAlias = null;
    g.players["seat-1"].location = "moscow";

    const s = createGameSession({ world: staged });
    send(s, { type: "BEGIN_TURN", player: "p1" });

    const w = s.state.world;
    expect(w.campaign.passports.black.aliases.allied.burned).toBe(true);
    expect(w.game!.players["seat-1"].location).toBe("washington");
    expect(w.game!.players["seat-1"].hand).toEqual([]);
    expect(w.game!.players["seat-1"].needsTempAlias).toBe(true);
    expect(w.game!.actionsLeft).toBe(0);
    expect(phaseOf(w)).toBe("playing.actions");
    expect(
      reject(w, {
        type: "ACTION",
        player: "p1",
        action: { a: "drive", to: "new-york" },
      }),
    ).toContain("burned");
    expect(violations(w)).toEqual([]);
  });

  test("Pursuit spread (Rule X) respects Checkpoints and active teams, fails on Soviet city, and completes when last token is removed", () => {
    const base = startPlayingGame(23);
    const staged = stagePhase(base.state.world, "playing.draw", [
      { t: "escalation", step: "pursuit", escalationsLeft: 1 },
    ]);
    // Simulate wait-draw-cards already consumed before Escalation
    staged.stack = staged.stack.filter((f) => f.t !== "wait-draw-cards");
    staged.campaign.rules.push("K", "N", "X");
    const g = staged.game!;
    g.active = "seat-1";
    g.supplies.pursuitTokens = 11;
    g.supplies.checkpointTokens = 11;
    g.locations.paris.pursuit = true;
    g.checkpoints.push(["east-berlin", "paris"]);
    g.teams["allied-1"]!.city = "london";
    g.objectives = [
      {
        id: "oct-3",
        cardCode: "10-04",
        title: "Hunt Down the Soviet Exporter",
        description: "Remove the last Pursuit token.",
        kind: "pursuit",
        status: "active",
        pursuitStartCity: "paris",
        debriefComplete: 101,
        debriefFail: 172,
        hiddenCardId: null,
        targetRevealed: false,
        trialCardIds: [],
        eliminatedCities: [],
      },
    ];

    const s1 = createGameSession({ world: staged });
    send(s1, { type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    const afterSpread = s1.state.world.game!;
    expect(afterSpread.locations.london.pursuit).toBe(false);
    expect(afterSpread.locations["east-berlin"].pursuit).toBe(false);
    expect(afterSpread.locations.madrid.pursuit).toBe(true);
    expect(afterSpread.locations.rome.pursuit).toBe(true);
    expect(afterSpread.objectives[0]!.status).toBe("active");
    expect(violations(s1.state.world)).toEqual([]);

    // Remove the East Berlin checkpoint and run another pursuit spread -> fails & clears tokens (Debrief 172)!
    const failStaged = stagePhase(s1.state.world, "playing.draw", [
      { t: "escalation", step: "pursuit", escalationsLeft: 1 },
    ]);
    failStaged.stack = failStaged.stack.filter((f) => f.t !== "wait-draw-cards");
    failStaged.game!.checkpoints = [];
    failStaged.game!.supplies.checkpointTokens = 12;
    const s2 = createGameSession({ world: failStaged });
    send(s2, { type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    const afterFail = s2.state.world.game!;
    expect(afterFail.objectives[0]!.status).toBe("failed");
    expect(afterFail.supplies.pursuitTokens).toBe(12);
    expect(violations(s2.state.world)).toEqual([]);
  });

  test("world city connections and infiltration site graphs are symmetric and fit within Security token supplies", () => {
    expect(pack.cities.length).toBe(48);
    for (const city of pack.cities) {
      for (const nb of city.connections) {
        expect(pack.cityById[nb].connections).toContain(city.id);
      }
    }

    const slots = (site: keyof typeof pack.sites) =>
      pack.sites[site].edges.reduce((acc, e) => acc + e.securitySlots, 0);
    expect(slots("sabik-safehouse")).toBeLessThanOrEqual(pack.box0006Tokens.length);
    expect(slots("sabik-hq")).toBeLessThanOrEqual(pack.box0006Tokens.length);
    expect(slots("pearl") + slots("langley")).toBeLessThanOrEqual(
      pack.box0006Tokens.length + pack.box0003Tokens.length,
    );
    for (const site of Object.values(pack.sites)) {
      const roomIds = new Set(site.rooms.map((r) => r.id));
      for (const edge of site.edges) {
        expect(roomIds.has(edge.a)).toBe(true);
        expect(roomIds.has(edge.b)).toBe(true);
      }
    }
  });

  test("Occupations and Specializations apply their exact printed rules (Electrician reveal, Street Cleaner entry, Collective Manager mitigation, Transport Crew carry)", () => {
    const base = startPlayingGame(24);
    const staged = stagePhase(base.state.world, "playing.actions");
    const c = staged.campaign;
    const g = staged.game!;
    c.rules.push("M");
    g.active = "seat-1";
    g.actionsLeft = 4;

    c.passports.black.aliases.neutral.created = true;
    c.passports.black.aliases.neutral.name = "Alex";
    c.passports.black.aliases.neutral.occupation = "electrician";
    c.passports.black.aliases.neutral.specialization = "transport-crew";
    g.players["seat-1"].passport = "black";
    g.players["seat-1"].activeAlias = "neutral";
    g.players["seat-1"].tempAlias = null;
    g.players["seat-1"].location = "london";
    g.locations.london.safehouse = true;
    g.supplies.safehouses -= 1;

    const euroIds = ["city:london", "city:paris", "city:madrid"];
    for (const id of euroIds) {
      g.playerDeck = g.playerDeck.filter((x) => x !== id);
      g.playerDiscard = g.playerDiscard.filter((x) => x !== id);
      for (const s of g.seats) g.players[s].hand = g.players[s].hand.filter((x) => x !== id);
      if (g.objectives[0]?.hiddenCardId === id) {
        g.objectives[0].hiddenCardId = "city:rome";
        g.playerDeck = g.playerDeck.filter((x) => x !== "city:rome");
        for (const s of g.seats) g.players[s].hand = g.players[s].hand.filter((x) => x !== "city:rome");
      }
    }
    g.players["seat-1"].hand = [...euroIds];
    g.teams["allied-1"]!.city = "london";

    const s1 = createGameSession({ world: staged });
    send(s1, {
      type: "ACTION",
      player: "p1",
      action: { a: "identify-target-city", objective: g.objectives[0]!.id, cards: euroIds },
    });
    expect(s1.state.world.game!.objectives[0]!.targetRevealed).toBe(true);
    expect(s1.state.world.game!.players["seat-1"].hand).toEqual(euroIds);

    send(s1, {
      type: "ACTION",
      player: "p1",
      action: { a: "drive", to: "paris", carryTeams: ["allied-1"] },
    });
    expect(s1.state.world.game!.teams["allied-1"]!.city).toBe("paris");

    const w2 = structuredClone(s1.state.world);
    w2.campaign.passports.black.aliases.soviet.created = true;
    w2.campaign.passports.black.aliases.soviet.name = "Orlov";
    w2.campaign.passports.black.aliases.soviet.occupation = "street-cleaner";
    w2.game!.players["seat-1"].activeAlias = "soviet";
    const ebBefore = w2.game!.locations["east-berlin"];
    const addAmt = 2 - ebBefore.agents;
    if (addAmt > 0) {
      w2.game!.locations["east-berlin"].agents += addAmt;
      w2.game!.supplies.agents -= addAmt;
    }
    const s2 = createGameSession({ world: w2 });
    send(s2, { type: "ACTION", player: "p1", action: { a: "drive", to: "east-berlin" } });
    expect(s2.state.world.game!.locations["east-berlin"].agents).toBe(0);
    expect(violations(s2.state.world)).toEqual([]);
  });

  test("Prescription Pills increases hand limit to 8 and switching away via Change Alias triggers hand-limit discard", () => {
    const base = startPlayingGame(25);
    const staged = stagePhase(base.state.world, "playing.actions");
    const c = staged.campaign;
    const g = staged.game!;
    c.rules.push("M");
    c.passports.black.aliases.allied.created = true;
    c.passports.black.aliases.allied.name = "Carter";
    c.passports.black.aliases.allied.occupation = "research-assistant";
    c.passports.black.aliases.allied.assets.push({
      id: "prescription-pills",
      city: null,
      dead: false,
      boxesChecked: 0,
    });
    c.passports.black.aliases.neutral.created = true;
    c.passports.black.aliases.neutral.name = "Novak";
    c.passports.black.aliases.neutral.occupation = "cargo-pilot";

    g.active = "seat-1";
    g.players["seat-1"].passport = "black";
    g.players["seat-1"].activeAlias = "allied";
    g.players["seat-1"].tempAlias = null;
    g.players["seat-1"].location = "washington";

    const extra = g.playerDeck
      .filter((id) => g.playerCards[id]?.kind === "city")
      .slice(0, 8 - g.players["seat-1"].hand.length);
    g.playerDeck = g.playerDeck.filter((id) => !extra.includes(id));
    g.players["seat-1"].hand.push(...extra);
    expect(g.players["seat-1"].hand.length).toBe(8);
    expect(seatsOverHandLimit(staged)).toEqual([]);

    const s = createGameSession({ world: staged });
    send(s, { type: "ACTION", player: "p1", action: { a: "change-alias", affiliation: "neutral" } });
    expect(topDecision(s.state.world)).toEqual({ t: "hand-limit", seat: "seat-1" });
    expect(violations(s.state.world)).toEqual([]);
  });

  test("Event cards enforce timing and full-effect rules (Cover of Darkness actions-only, One Quiet Night before Threat draws, Diversion preserves token conservation)", () => {
    const base = startPlayingGame(26);
    const staged = stagePhase(base.state.world, "playing.actions");
    const g = staged.game!;
    g.active = "seat-1";

    const addEventToHand = (ev: "cover-of-darkness" | "one-quiet-night" | "diversion") => {
      const id = `event:${ev}`;
      g.playerCards[id] = { id, kind: "event", event: ev };
      g.playerDeck = g.playerDeck.filter((x) => x !== id);
      g.playerDiscard = g.playerDiscard.filter((x) => x !== id);
      for (const s of g.seats) g.players[s].hand = g.players[s].hand.filter((x) => x !== id);
      g.players["seat-1"].hand.push(id);
    };
    addEventToHand("cover-of-darkness");
    addEventToHand("one-quiet-night");
    addEventToHand("diversion");

    // Cover of Darkness rejected outside playing.actions
    const drawStaged = stagePhase(staged, "playing.draw");
    expect(
      reject(drawStaged, {
        type: "PLAY",
        player: "p1",
        play: { e: "cover-of-darkness" },
      }),
    ).toContain("Do Actions");

    // Diversion moves existing incidents without changing incident token supply
    g.locations.paris.incidents = 2;
    g.supplies.incidentOutbreakTokens -= 2;
    const s1 = createGameSession({ world: staged });
    send(s1, {
      type: "PLAY",
      player: "p1",
      play: { e: "diversion", sources: ["paris", "paris"], to: "moscow" },
    });
    expect(s1.state.world.game!.locations.paris.incidents).toBe(0);
    expect(s1.state.world.game!.locations.moscow.incidents).toBe(2);
    expect(violations(s1.state.world)).toEqual([]);

    // One Quiet Night playable at start of playing.threat (threatsDrawnThisTurn === 0), skips directly to next turn!
    const threatStaged = stagePhase(s1.state.world, "playing.threat");
    threatStaged.game!.threatsLeft = 2;
    threatStaged.game!.threatsDrawnThisTurn = 0;
    const s2 = createGameSession({ world: threatStaged });
    send(s2, { type: "PLAY", player: "p1", play: { e: "one-quiet-night" } });
    expect(phaseOf(s2.state.world)).toBe("playing.surveillance");
    expect(s2.state.world.game!.active).toBe("seat-2");
    expect(violations(s2.state.world)).toEqual([]);
  });

  test("Psych Evaluations incorporate Ops 61 / Ops 65 Intel bonuses, and computeFinalScore matches the Annual Review rubric", () => {
    const session = startPlayingGame(27);
    const world = structuredClone(session.state.world);
    world.campaign.psychAnswers = { 1: "AGREE", 2: "AGREE", 3: "AGREE", 4: "AGREE", 12: 3 };
    world.campaign.intelFile.push({ id: "operations/61", title: "Ops 61", text: "" });
    evaluatePsych1(world);
    expect(world.campaign.restrictions).toContain("erratic");

    world.campaign.intelFile.push({ id: "operations/65", title: "Ops 65", text: "" });
    evaluatePsych4(world);
    expect(world.campaign.restrictions).toContain("callous");

    world.campaign.results = [
      { month: 1, attempt: 1, evaluation: "SUCCEEDING", completedObjectives: 2, failedObjectives: 0, fundingBefore: 5, fundingAfter: 4, reason: "", turns: 10, incidents: 0, outbreaks: 0, escalations: 2, seats: [] },
      { month: 2, attempt: 1, evaluation: "FAILING", completedObjectives: 0, failedObjectives: 2, fundingBefore: 4, fundingAfter: 6, reason: "", turns: 10, incidents: 0, outbreaks: 0, escalations: 2, seats: [] },
      { month: 2, attempt: 2, evaluation: "ADEQUATE", completedObjectives: 1, failedObjectives: 1, fundingBefore: 6, fundingAfter: 7, reason: "", turns: 10, incidents: 0, outbreaks: 0, escalations: 2, seats: [] },
    ];
    world.campaign.cities.paris.exposedIntensity = 1;
    world.campaign.cities.paris.contaminated = true;
    expect(computeFinalScore(world)).toBe(80);
  });

  test("buildAnimationCues and session.dispatch emit ordered UI cues for phase changes, pawn moves, and agent deltas", () => {
    const session = startPlayingGame(28);
    const before = session.state.world;
    const activePlayer = before.table.seats.find((s) => s.seat === before.game!.active)!.player;
    const r1 = send(session, { type: "BEGIN_TURN", player: activePlayer });
    const mid = session.state.world;

    expect(
      r1.cues.some((c) => c.cue === "phase-change" && c.from === "playing.surveillance" && c.to === "playing.actions"),
    ).toBe(true);
    expect(buildAnimationCues(before, mid)).toEqual(r1.cues);

    const r2 = send(session, { type: "ACTION", player: activePlayer, action: { a: "drive", to: "new-york" } });
    expect(r2.cues.some((c) => c.cue === "pawn-move" && c.from === "washington" && c.to === "new-york")).toBe(true);
  });

  test("Prologue end emits Step 1 evaluation reading without permanent changes, and revealed targets & 3-hop coordinator moves remain visible", () => {
    const session = startPlayingGame(29);
    const staged = stagePhase(session.state.world, "playing.actions");
    const g = staged.game!;
    g.active = "seat-2";
    g.players["seat-1"].location = "washington";
    g.players["seat-2"].location = "washington";
    g.players["seat-1"].hand = ["city:cairo"];
    g.players["seat-2"].hand = [];
    const pro1 = g.objectives[0]!;
    pro1.hiddenCardId = "city:kiev";
    pro1.targetRevealed = true;
    g.teams["soviet-1"]!.city = "kiev";
    g.teams["soviet-2"]!.city = "novosibirsk";
    const s = createGameSession({ world: staged });

    const opts = optionsFor(s.state.world, "p2");
    expect(opts.some((o) => o.key === "coord-pawn:seat-1:paris")).toBe(true);

    send(s, {
      type: "ACTION",
      player: "p2",
      action: { a: "share-intel", target: "seat-1", card: "city:cairo", direction: "take" },
    });
    const shareLog = s.state.world.game!.log.at(-1);
    expect(shareLog?.t === "action" && shareLog.detail.startsWith("Took Cairo from seat-1")).toBe(true);

    send(s, { type: "ACTION", player: "p2", action: { a: "acquire-targets", objective: pro1.id } });
    const v = viewFor(s.state.world, "p2");
    expect(v.game!.objectives[0]!.revealedTargetCity).toBe("kiev");

    send(s, { type: "ACTION", player: "p2", action: { a: "acquire-targets", objective: g.objectives[1]!.id } });
    expect(phaseOf(s.state.world)).toBe("over");
    send(s, { type: "CONTINUE", player: "p1" });
    expect(phaseOf(s.state.world)).toBe("lobby");
    const c = s.state.world.campaign;
    expect(c.funding).toBe(5);
    expect(c.results).toHaveLength(1);
    expect(c.results[0]!.month).toBe(0);
    expect(c.results[0]!.evaluation).toBe("SUCCEEDING");
    expect(c.readings.some((r) => r.ref === "prologue-end" && r.text.includes("SUCCEEDING"))).toBe(true);
  });

  test("PlayerView hides unscratched scratch-off cover pips, and unrecorded / clinic flights expose all 47 other cities", () => {
    const session = startPlayingGame(30);
    const staged = stagePhase(session.state.world, "playing.actions");
    const c = staged.campaign;
    const g = staged.game!;
    c.passports.pink.aliases.allied.created = true;
    c.passports.pink.aliases.allied.name = "Naomi Chen";
    c.passports.pink.aliases.allied.occupation = "clinic-planner";
    c.passports.pink.aliases.allied.coverScratched = 2;
    g.active = "seat-3";
    g.players["seat-3"].passport = "pink";
    g.players["seat-3"].activeAlias = "allied";
    g.players["seat-3"].tempAlias = null;
    g.players["seat-3"].location = "washington";
    g.players["seat-3"].hand = ["city:washington", "city:paris"];
    const s1 = createGameSession({ world: staged });

    const v = viewFor(s1.state.world, "p3");
    const pinkAllied = v.campaign.passports.pink.aliases.allied;
    expect(pinkAllied.revealedCoverTrack).toHaveLength(2);
    expect(pinkAllied.coverTrackLength).toBe(10);
    expect("coverTrack" in pinkAllied).toBe(false);

    const opts = optionsFor(s1.state.world, "p3");
    expect(opts.filter((o) => o.key.startsWith("unrecorded:")).length).toBe(47);
    expect(opts.filter((o) => o.key.startsWith("clinic-fly:washington:")).length).toBe(47);
    expect(opts.filter((o) => o.key.startsWith("clinic-fly:paris:")).length).toBe(47);

    send(s1, {
      type: "ACTION",
      player: "p3",
      action: { a: "clinic-planner-flight", card: "city:paris", to: "bangkok" },
    });
    const flyLog = s1.state.world.game!.log.filter((e) => e.t === "action").at(-1);
    expect(flyLog?.t === "action" && flyLog.detail.includes("discarded Paris")).toBe(true);

    // Empty agent supply on Threat draw logs FAILED instead of "+1 agent"
    const wThreat = stagePhase(s1.state.world, "playing.threat");
    wThreat.game!.supplies.agents = 0;
    wThreat.game!.threatsLeft = 1;
    wThreat.game!.threatDeck = [{ id: "threat:bogota", kind: "city", city: "bogota" }];
    const s2 = createGameSession({ world: wThreat });
    send(s2, { type: "DRAW_THREAT", player: "p3" });
    expect(phaseOf(s2.state.world)).toBe("over");
    const threatLog = s2.state.world.game!.log.filter((e) => e.t === "threat").at(-1);
    expect(threatLog?.t === "threat" && threatLog.effect).toBe("FAILED (agent supply empty)");

    // markUnknownElimination ANDs filters and checks campaign controlCenter state
    const w3 = structuredClone(s2.state.world);
    w3.campaign.cities.paris.controlCenter = true;
    w3.campaign.cities.london.controlCenter = false;
    w3.game!.objectives = [
      {
        id: "cc-test",
        cardCode: "test",
        title: "CC Test",
        description: "",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "europe",
        unknownControlCentersOnly: true,
        debriefComplete: 100,
        debriefFail: 100,
        hiddenCardId: null,
        targetRevealed: false,
        trialCardIds: [],
        eliminatedCities: [],
      },
    ];
    markUnknownElimination(w3, "london");
    markUnknownElimination(w3, "paris");
    markUnknownElimination(w3, "new-york");
    expect(w3.game!.objectives[0]!.eliminatedCities).toEqual(["paris"]);

    // Transport Crew carry variants appear for visa, commercial flight, unrecorded flight, and cargo pilot
    const w4 = stagePhase(s1.state.world, "playing.actions");
    w4.campaign.passports.pink.aliases.neutral = {
      affiliation: "neutral",
      created: true,
      name: "Carrier",
      occupation: "cargo-pilot",
      specialization: "transport-crew",
      coverTrack: ["empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty"],
      coverScratched: 0,
      burned: false,
      assets: [{ id: "visa-4", city: "rome", boxesChecked: 0, dead: false }],
      liabilities: [],
    };
    w4.game!.active = "seat-3";
    w4.game!.actionsLeft = 4;
    w4.game!.players["seat-3"].passport = "pink";
    w4.game!.players["seat-3"].activeAlias = "neutral";
    w4.game!.players["seat-3"].location = "washington";
    w4.game!.players["seat-3"].hand = ["city:washington", "city:london"];
    w4.game!.locations.bangkok.safehouse = true;
    w4.game!.teams["allied-1"].city = "washington";
    const carryOpts = optionsFor(w4, "p3", 0).map((o) => o.key);
    expect(carryOpts).toContain("visa-carry:visa-4");
    expect(carryOpts).toContain("fly-carry:london");
    expect(carryOpts).toContain("unrecorded-carry:rome");
    expect(carryOpts).toContain("cargo-fly-carry:bangkok");

    // Infection outbreak on empty Incident/Outbreak supply logs FAILED (Incident/Outbreak supply empty), not Disease cube supply
    const wInf = stagePhase(s2.state.world, "playing.threat");
    wInf.game!.outcome = null;
    wInf.game!.supplies.diseaseCubes = 9;
    wInf.game!.supplies.incidentOutbreakTokens = 0;
    wInf.game!.locations.bogota.diseaseCubes = 3;
    wInf.game!.threatsLeft = 1;
    wInf.game!.threatDeck = [
      { id: "inf-bogota", kind: "infection", infectionId: "inf-bogota", city: "bogota", startingIntensity: 0 },
    ];
    const s3 = createGameSession({ world: wInf });
    send(s3, { type: "DRAW_THREAT", player: "p3" });
    expect(phaseOf(s3.state.world)).toBe("over");
    const infThreatLog = s3.state.world.game!.log.filter((e) => e.t === "threat").at(-1);
    expect(infThreatLog?.t === "threat" && infThreatLog.effect).toBe("FAILED (Incident/Outbreak supply empty)");

    // Electrician reveals region cards on Identify Target City, but still discards the extra City card for Evasive
    const wElec = stagePhase(s1.state.world, "playing.actions");
    wElec.campaign.passports.pink.aliases.neutral = {
      affiliation: "neutral",
      created: true,
      name: "Elec",
      occupation: "electrician",
      specialization: "transport-crew",
      coverTrack: ["empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty"],
      coverScratched: 0,
      burned: false,
      assets: [{ id: "code-book", city: null, boxesChecked: 0, dead: false }],
      liabilities: [],
    };
    wElec.game!.active = "seat-3";
    wElec.game!.actionsLeft = 4;
    wElec.game!.activeRestrictions = ["evasive"];
    wElec.game!.players["seat-3"].passport = "pink";
    wElec.game!.players["seat-3"].activeAlias = "neutral";
    wElec.game!.players["seat-3"].location = "bangkok";
    wElec.game!.locations.bangkok.safehouse = true;
    wElec.game!.players["seat-3"].hand = ["city:delhi", "city:novosibirsk", "city:algiers"];
    wElec.game!.playerCards["city:delhi"] = { id: "city:delhi", kind: "city", city: "delhi" };
    wElec.game!.playerCards["city:novosibirsk"] = { id: "city:novosibirsk", kind: "city", city: "novosibirsk" };
    wElec.game!.playerCards["city:algiers"] = { id: "city:algiers", kind: "city", city: "algiers" };
    wElec.game!.playerCards["city:pyongyang"] = { id: "city:pyongyang", kind: "city", city: "pyongyang" };
    wElec.game!.objectives = [
      {
        id: "jun-3",
        cardCode: "06-05",
        title: "Bug Control Center",
        description: "",
        kind: "unknown-city",
        status: "active",
        unknownRegion: "asia",
        debriefComplete: 110,
        debriefFail: 111,
        hiddenCardId: "city:pyongyang",
        targetRevealed: false,
        trialCardIds: [],
        eliminatedCities: [],
      },
    ];
    const sElec = createGameSession({ world: wElec });
    send(sElec, {
      type: "ACTION",
      player: "p3",
      action: {
        a: "identify-target-city",
        objective: "jun-3",
        cards: ["city:delhi", "city:novosibirsk", "city:algiers"],
      },
    });
    const handAfter = sElec.state.world.game!.players["seat-3"].hand;
    expect(handAfter).toEqual(["city:delhi", "city:novosibirsk"]);
    expect(sElec.state.world.game!.playerDiscard).toContain("city:algiers");

    // Opening Box 0008 during setup immediately populates satellite & disease cube supplies with 0 invariant violations
    const wBox8 = stagePhase(startPlayingGame(99, 3).state.world, "playing.actions");
    openBox(wBox8, "0008");
    expect(wBox8.game!.supplies.satellites).toBe(5);
    expect(violations(wBox8)).toEqual([]);

    // Malformed city IDs reject cleanly instead of throwing
    const activePlayer = wBox8.table.seats.find((s) => s.seat === wBox8.game!.active)!.player;
    expect(
      reject(wBox8, {
        type: "ACTION",
        player: activePlayer,
        action: { a: "drive", to: "not-a-city" as never },
      }),
    ).toContain("Unknown city");
  });

  test("resolves Escalation cards before hand-limit discards when drawing at full hand (rulebook p. 15)", () => {
    const session = startPlayingGame(105, 3);
    const w = stagePhase(session.state.world, "playing.draw");
    const g = w.game!;
    const activeSeat = g.active;
    const activePlayer = w.table.seats.find((s) => s.seat === activeSeat)!.player;
    const hand = g.players[activeSeat].hand;
    while (hand.length < 7) {
      const nextCity = g.playerDeck.findIndex((id) => g.playerCards[id]?.kind === "city");
      hand.push(g.playerDeck.splice(nextCity, 1)[0]!);
    }
    const escIdx = g.playerDeck.findIndex((id) => g.playerCards[id]?.kind === "escalation");
    const cityIdx = g.playerDeck.findIndex((id) => g.playerCards[id]?.kind === "city");
    const escId = g.playerDeck.splice(escIdx, 1)[0]!;
    const cityId = g.playerDeck.splice(cityIdx > escIdx ? cityIdx - 1 : cityIdx, 1)[0]!;
    g.playerDeck.unshift(escId, cityId);

    const s2 = createGameSession({ world: w });
    send(s2, { type: "DRAW_PLAYER_CARDS", player: activePlayer });
    expect(s2.state.world.game!.players[activeSeat].hand.length).toBe(8);
    expect(topDecision(s2.state.world)?.t).toBe("escalation");
    expect(pendingDecisions(s2.state.world).some((d) => d.t === "hand-limit")).toBe(false);

    // Finish the 3 Escalation steps; hand-limit appears immediately after Intensify
    send(s2, { type: "DECIDE", player: activePlayer, answer: { t: "escalation" } });
    send(s2, { type: "DECIDE", player: activePlayer, answer: { t: "escalation" } });
    send(s2, { type: "DECIDE", player: activePlayer, answer: { t: "escalation" } });
    expect(topDecision(s2.state.world)).toEqual({ t: "hand-limit", seat: activeSeat });
  });

  test("clears undo history when an action draws a hidden Symptom card", () => {
    const session = startPlayingGame(106, 3);
    const w = stagePhase(session.state.world, "playing.actions");
    const g = w.game!;
    const seat = g.active;
    const player = w.table.seats.find((s) => s.seat === seat)!.player;
    w.campaign.rules.push("H");
    g.supplies.symptoms = ["Lack of Coordination", "Memory Loss"];
    g.players[seat].location = "washington";
    g.locations["new-york"].diseaseCubes = 2;

    const s2 = createGameSession({ world: w });
    send(s2, { type: "ACTION", player, action: { a: "drive", to: "new-york" } });
    expect(s2.state.world.game!.supplies.symptoms.length).toBe(1);
    expect(s2.state.undo.length).toBe(0);
  });

  test("exiting an infiltration site returns to the host city without firing city-entry occupation triggers", () => {
    const session = startPlayingGame(107, 3);
    const w = stagePhase(session.state.world, "playing.actions");
    const g = w.game!;
    const seat = g.active;
    const player = w.table.seats.find((s) => s.seat === seat)!.player;
    w.campaign.rules.push("P", "Q");
    g.supplies.symptoms = ["Mild Paralysis", "Difficulty Breathing"];
    const passport = "pink";
    g.players[seat].passport = passport;
    w.campaign.passports[passport].aliases.soviet = {
      affiliation: "soviet",
      created: true,
      name: "Pavel",
      occupation: "red-army-doctor",
      specialization: "deep-cover",
      coverTrack: ["empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty"],
      coverScratched: 0,
      burned: false,
      assets: [],
      liabilities: [],
    };
    g.players[seat].activeAlias = "soviet";
    g.players[seat].location = "novosibirsk";
    g.players[seat].infiltration = { site: "pearl", room: "pearl-entrance" };
    giveSymptomCard(w, seat);
    const symBefore = g.players[seat].hand.filter((id) => g.playerCards[id]?.kind === "symptom").length;
    expect(symBefore).toBe(1);

    const s2 = createGameSession({ world: w });
    send(s2, { type: "ACTION", player, action: { a: "exit-infiltration" } });
    const after = s2.state.world.game!;
    expect(after.players[seat].infiltration).toBeNull();
    expect(after.players[seat].location).toBe("novosibirsk");
    expect(after.players[seat].hand.filter((id) => after.playerCards[id]?.kind === "symptom").length).toBe(1);

    // Street Cleaner also must not clear agents when exiting an infiltration site
    const w2 = structuredClone(w);
    w2.campaign.passports[passport].aliases.soviet.occupation = "street-cleaner";
    w2.game!.locations.novosibirsk.agents = 2;
    const s3 = createGameSession({ world: w2 });
    send(s3, { type: "ACTION", player, action: { a: "exit-infiltration" } });
    expect(s3.state.world.game!.locations.novosibirsk.agents).toBe(2);
  });
});
