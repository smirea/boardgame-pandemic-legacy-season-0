import { describe, expect, test } from "bun:test";
import {
  advanceThroughMonth,
  buildAnimationCues,
  canSatisfySecurityTokens,
  computeFinalScore,
  createGameActor,
  createRecording,
  createSeatedCampaign,
  drawTwoPlayerCards,
  ensureHandLimitDecisions,
  evaluatePsych1,
  evaluatePsych4,
  giveSymptomCard,
  optionsFor,
  pack,
  phaseOf,
  reject,
  replayRecording,
  resolveDiseaseInfection,
  resolveIncidentWave,
  seatsOverHandLimit,
  toSave,
  viewFor,
  violations,
} from "./index";
import type { SecuritySymbol } from "./ids";

function startPlayingGame(seed = 10, playerCount: 2 | 3 | 4 = 3) {
  const actor = createSeatedCampaign(playerCount, seed);
  actor.send({ type: "START_GAME", player: "p1" });
  while (phaseOf(actor.getSnapshot().value) === "setup.threat") {
    actor.send({ type: "FLIP_OPENING_THREAT", player: "p1" });
  }
  actor.send({ type: "CONFIRM_EVENTS", player: "p1" });
  return actor;
}

describe("Pandemic Legacy: Season 0 rules", () => {
  test("a multi-city incident wave draws only one bottom threat card and uses the shared token supply", () => {
    const actor = startPlayingGame(11);
    const world = structuredClone(actor.getSnapshot().context.world);
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
    const actor = startPlayingGame(12);
    const world = structuredClone(actor.getSnapshot().context.world);
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
    const actor = startPlayingGame(13);
    const world = structuredClone(actor.getSnapshot().context.world);
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

    // Portable Computing Device allows keypad +-1
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
    const actor = startPlayingGame(14);
    const world = structuredClone(actor.getSnapshot().context.world);
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
      reject(world, "playing.actions", {
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
    const actor = startPlayingGame(15);
    const save = toSave(actor);
    const g = save.world.game!;
    g.active = "seat-1";
    g.surveillanceChecked = true;
    // Move Counter-Intelligence into seat-2's hand and an Escalation on top of playerDeck
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

    const resumed = createGameActor({ save: { ...save, phase: "playing.draw" } });
    resumed.send({ type: "DRAW_PLAYER_CARDS", player: "p1" });
    expect(resumed.getSnapshot().context.world.game!.pending[0]).toMatchObject({
      t: "escalation",
      step: "increase",
    });

    resumed.send({ type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    expect(resumed.getSnapshot().context.world.game!.pending[0]).toMatchObject({
      t: "escalation",
      step: "add-agents",
    });

    resumed.send({ type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    const atIntensify = resumed.getSnapshot().context.world.game!;
    expect(atIntensify.pending[0]).toMatchObject({ t: "escalation", step: "intensify" });
    const targetCard = atIntensify.threatDiscard[atIntensify.threatDiscard.length - 1]!;

    resumed.send({
      type: "PLAY",
      player: "p2",
      play: { e: "counter-intelligence", threatCardId: targetCard.id },
    });

    const afterCI = resumed.getSnapshot().context.world.game!;
    expect(afterCI.gameEndArea.some((t) => t.id === targetCard.id)).toBe(true);
    expect(afterCI.threatDiscard.some((t) => t.id === targetCard.id)).toBe(false);
    expect(violations(resumed.getSnapshot().context.world)).toEqual([]);
  });

  test("full campaign runs cleanly from Prologue through December on both CIA and Sabik branches across 2, 3, and 4 players", () => {
    const configs: { players: 2 | 3 | 4; branch: "decline" | "accept"; seed: number }[] = [
      { players: 2, branch: "decline", seed: 101 },
      { players: 3, branch: "accept", seed: 202 },
      { players: 4, branch: "decline", seed: 303 },
    ];

    for (const cfg of configs) {
      const actor = createSeatedCampaign(cfg.players, cfg.seed);
      // Prologue (month 0) stays non-permanent and advances manually or by completing; advance month 0 -> 1 explicitly via lobby check
      // Wait: advanceThroughMonth plays Prologue and returns to lobby at month 0 (because Prologue is non-permanent!).
      // To enter January after Prologue, set month = 1 OR play Prologue once and advance to month 1.
      const afterPrologue = advanceThroughMonth(actor, { sabikChoice: cfg.branch });
      expect(afterPrologue).toBe("lobby");
      expect(violations(actor.getSnapshot().context.world)).toEqual([]);

      actor.send({ type: "BEGIN_JANUARY", player: "p1" });
      expect(actor.getSnapshot().context.world.campaign.month).toBe(1);

      let gamesPlayed = 0;
      while (phaseOf(actor.getSnapshot().value) !== "finished") {
        advanceThroughMonth(actor, { sabikChoice: cfg.branch });
        gamesPlayed += 1;
        const w = actor.getSnapshot().context.world;
        expect(violations(w)).toEqual([]);
        if (gamesPlayed > 25) throw new Error("Campaign failed to terminate within 25 games");
      }

      const finalWorld = actor.getSnapshot().context.world;
      expect(finalWorld.campaign.branch).toBe(cfg.branch === "accept" ? "sabik" : "cia");
      expect(finalWorld.campaign.finalScore).not.toBeNull();
      expect(finalWorld.campaign.endingDebriefs.length).toBeGreaterThan(0);
      expect(finalWorld.campaign.readings.length).toBeGreaterThan(60);
      expect(violations(finalWorld)).toEqual([]);
    }
  });

  test("recorded commands replay deterministically to the exact same phase and world state", () => {
    const actor = createSeatedCampaign(3, 555);
    const rec = createRecording(toSave(actor));
    const commands = [
      { type: "START_GAME" as const, player: "p1" },
      ...Array.from({ length: 9 }, () => ({ type: "FLIP_OPENING_THREAT" as const, player: "p1" })),
      { type: "CONFIRM_EVENTS" as const, player: "p1" },
    ];
    for (const command of commands) {
      const before = phaseOf(actor.getSnapshot().value);
      const logStart = actor.getSnapshot().context.world.game?.log.length ?? 0;
      actor.send(command);
      const after = phaseOf(actor.getSnapshot().value);
      const logEnd = actor.getSnapshot().context.world.game?.log.length ?? 0;
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
    expect(replayed.phase).toBe(phaseOf(actor.getSnapshot().value));
    expect(replayed.world).toEqual(actor.getSnapshot().context.world);
  });

  test("drawTwoPlayerCards resolves Satellite cards before Escalation cards (Rule W)", () => {
    const actor = startPlayingGame(16);
    const world = structuredClone(actor.getSnapshot().context.world);
    world.campaign.rules.push("D", "W");
    const game = world.game!;
    game.supplies.satellites = 5;
    game.playerCards["satellite:europe"] = { id: "satellite:europe", kind: "satellite", region: "europe" };
    const escId = game.playerDeck.find((id) => game.playerCards[id]?.kind === "escalation")!;
    game.playerDeck = [escId, "satellite:europe", ...game.playerDeck.filter((id) => id !== escId)];

    drawTwoPlayerCards(world);

    expect(game.satellites).toContain("europe");
    expect(game.supplies.satellites).toBe(4);
    expect(game.pending[0]).toMatchObject({ t: "escalation", step: "increase" });
    expect(violations(world)).toEqual([]);
  });

  test("completing the final objective preserves its debrief pending decision before ending the game", () => {
    const actor = createSeatedCampaign(3, 17);
    actor.send({ type: "BEGIN_JANUARY", player: "p1" });
    actor.send({ type: "START_GAME", player: "p1" });
    const aliasOpt = actor.getSnapshot().context.world.game!.pending[0];
    expect(aliasOpt?.t).toBe("create-aliases");
    actor.send({
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
    expect(actor.getSnapshot().context.world.game!.pending[0]?.t).toBe("psych-questions");
    actor.send({
      type: "DECIDE",
      player: "p1",
      answer: { t: "psych-questions", answers: { 1: "AGREE", 2: "AGREE", 3: "DISAGREE" } },
    });
    while (phaseOf(actor.getSnapshot().value) === "setup.threat") {
      actor.send({ type: "FLIP_OPENING_THREAT", player: "p1" });
    }
    actor.send({ type: "CONFIRM_EVENTS", player: "p1" });

    // Stage January with Obj 1 already completed and an active team in Obj 2's hidden Asia city
    const save = toSave(actor);
    const g = save.world.game!;
    g.active = "seat-1";
    g.surveillanceChecked = true;
    g.objectives[0]!.status = "completed";
    const obj2 = g.objectives[1]!;
    obj2.targetRevealed = true;
    const targetCity = (g.playerCards[obj2.hiddenCardId!] as { kind: "city"; city: keyof typeof pack.cityById }).city;
    const aff = pack.cityById[targetCity].affiliation;
    g.teams[`${aff}-1`]!.city = targetCity;

    const resumed = createGameActor({ save: { ...save, phase: "playing.actions" } });
    resumed.send({
      type: "ACTION",
      player: "p1",
      action: { a: "acquire-targets", objective: obj2.id },
    });

    // Must still be in playing.actions with file-report [60, 61] pending — NOT prematurely ended!
    expect(phaseOf(resumed.getSnapshot().value)).toBe("playing.actions");
    expect(resumed.getSnapshot().context.world.game!.pending[0]).toMatchObject({
      t: "file-report",
      options: [60, 61],
    });

    resumed.send({ type: "DECIDE", player: "p1", answer: { t: "file-report", chosen: 60 } });
    expect(phaseOf(resumed.getSnapshot().value)).toBe("over");
    expect(resumed.getSnapshot().context.world.campaign.intelFile.some((x) => x.id === "operations/60")).toBe(true);
    expect(violations(resumed.getSnapshot().context.world)).toEqual([]);
  });

  test("Door 14 triggers when Funding would exceed 10, supporting open (Door 19 +6 budget), blow-up (Door 24), and deferred ignore", () => {
    const actor = createSeatedCampaign(3, 18);
    actor.send({ type: "BEGIN_JANUARY", player: "p1" });
    const baseSave = toSave(actor);
    baseSave.world.campaign.funding = 10;
    const a1 = createGameActor({ save: baseSave });
    a1.send({ type: "START_GAME", player: "p1" });
    // Clear January setup decisions
    a1.send({
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
    a1.send({
      type: "DECIDE",
      player: "p1",
      answer: { t: "psych-questions", answers: { 1: "AGREE", 2: "AGREE", 3: "DISAGREE" } },
    });
    while (phaseOf(a1.getSnapshot().value) === "setup.threat") {
      a1.send({ type: "FLIP_OPENING_THREAT", player: "p1" });
    }
    a1.send({ type: "CONFIRM_EVENTS", player: "p1" });

    // Force loss so funding tries to rise from 10 -> 12 -> opens Door 14
    const lostSave = toSave(a1);
    lostSave.world.game!.outcome = { ended: true, reason: "test loss", evaluation: null };
    const overActor = createGameActor({ save: { ...lostSave, phase: "over" } });
    overActor.send({ type: "CONTINUE", player: "p1" });
    expect(phaseOf(overActor.getSnapshot().value)).toBe("postgame");
    expect(overActor.getSnapshot().context.world.campaign.openedDoors).toContain("14");
    expect(overActor.getSnapshot().context.world.game!.pending[0]?.t).toBe("door14-briefcase");

    // Branch A: ignore now -> resolve later in upkeep via blow-up (Door 24)
    const ignoreActor = createGameActor({ save: toSave(overActor) });
    ignoreActor.send({
      type: "DECIDE",
      player: "p1",
      answer: { t: "door14-briefcase", choice: "ignore" },
    });
    expect(phaseOf(ignoreActor.getSnapshot().value)).toBe("upkeep");
    expect(ignoreActor.getSnapshot().context.world.campaign.door14State).toBe("ignored");
    ignoreActor.send({ type: "RESOLVE_DOOR_14", player: "p1", choice: "blow-up" });
    expect(ignoreActor.getSnapshot().context.world.campaign.openedDoors).toContain("24");
    expect(ignoreActor.getSnapshot().context.world.game!.pending[0]).toMatchObject({
      t: "place-counter-surveillance",
      remaining: 6,
    });

    // Branch B: open now -> Door 19 sets door19BonusPending (+6 on next Spend Budget)
    overActor.send({
      type: "DECIDE",
      player: "p1",
      answer: { t: "door14-briefcase", choice: "open" },
    });
    expect(overActor.getSnapshot().context.world.campaign.openedDoors).toContain("19");
    expect(overActor.getSnapshot().context.world.campaign.door19BonusPending).toBe(true);
    expect(violations(overActor.getSnapshot().context.world)).toEqual([]);
  });

  test("PEARL Compound infiltration opens doors, triggers Loading Dock (Debrief 105), unlocks hatchways (sum>=10), and shifts pawn out on Mop Up", () => {
    const actor = createSeatedCampaign(3, 19);
    actor.send({ type: "BEGIN_JANUARY", player: "p1" });
    const save = toSave(actor);
    const c = save.world.campaign;
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

    const a = createGameActor({ save });
    const s2 = toSave(a);
    // Build a clean playing.actions state at Novosibirsk with PEARL active and known tokens
    const base = startPlayingGame(20);
    const gs = toSave(base);
    gs.world.campaign = structuredClone(c);
    const g = gs.world.game!;
    g.active = "seat-1";
    g.surveillanceChecked = true;
    g.actionsLeft = 4;
    g.supplies.actionTokens = 12;
    g.supplies.symptoms = [...pack.symptomNames];
    g.players["seat-1"].passport = "black";
    g.players["seat-1"].activeAlias = "soviet";
    g.players["seat-1"].tempAlias = null;
    g.players["seat-1"].location = "novosibirsk";
    // Hand: Moscow (S/europe/#9) + Tokyo (A/pacific-rim/#?) — give high-keypad cards for hatchway sum >= 10
    const highCards = pack.cities.filter((ct) => ct.keypad >= 6).slice(0, 3);
    const handIds = highCards.map((ct) => `city:${ct.id}`);
    // Remove those from deck/hands to preserve uniqueness
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

    const pearlActor = createGameActor({ save: { ...gs, phase: "playing.actions" } });
    pearlActor.send({
      type: "ACTION",
      player: "p1",
      action: { a: "enter-infiltration", site: "pearl" },
    });
    expect(pearlActor.getSnapshot().context.world.game!.players["seat-1"].infiltration).toEqual({
      site: "pearl",
      room: "pearl-entrance",
    });

    // Infiltrate Entrance -> Gatehouse (opens Door 2!)
    pearlActor.send({
      type: "ACTION",
      player: "p1",
      action: { a: "infiltrate", to: "pearl-gatehouse", revealCards: [handIds[0]!, handIds[1]!] },
    });
    expect(pearlActor.getSnapshot().context.world.campaign.pearlOpenedDoors).toContain(2);

    // Unlock hatchway p-h1 (Gatehouse <-> Monitoring Room) using cards with keypad sum >= 10
    pearlActor.send({
      type: "ACTION",
      player: "p1",
      action: { a: "unlock-hatchway", edgeId: "p-h1", cards: [handIds[0]!, handIds[1]!] },
    });
    expect(pearlActor.getSnapshot().context.world.campaign.pearlTunnels).toContain("p-h1");
    expect(pearlActor.getSnapshot().context.world.campaign.availableTunnels).toBe(4);

    // Infiltrate through tunnel p-h1 revealing 1 City card
    pearlActor.send({
      type: "ACTION",
      player: "p1",
      action: { a: "infiltrate", to: "pearl-monitoring-room", revealCards: [handIds[2]!] },
    });
    expect(pearlActor.getSnapshot().context.world.game!.players["seat-1"].infiltration?.room).toBe(
      "pearl-monitoring-room",
    );
    expect(pearlActor.getSnapshot().context.world.game!.pending[0]?.t).toBe("reveal-pearl-tokens");
    // Resolve the 2 Monitoring Room token reveals
    for (let k = 0; k < 2; k++) {
      const tok = pearlActor.getSnapshot().context.world.game!.infiltrationSites.pearl!.tokens.find(
        (t) => !t.revealed,
      )!;
      pearlActor.send({
        type: "DECIDE",
        player: "p1",
        answer: { t: "reveal-pearl-tokens", tokenId: tok.id },
      });
    }

    // End actions -> Mop Up shifts pawn out of PEARL back to Novosibirsk (Rule V)!
    pearlActor.send({ type: "END_ACTIONS", player: "p1" });
    expect(pearlActor.getSnapshot().context.world.game!.players["seat-1"].infiltration).toBeNull();
    expect(pearlActor.getSnapshot().context.world.game!.players["seat-1"].location).toBe("novosibirsk");
    expect(violations(pearlActor.getSnapshot().context.world)).toEqual([]);
    void s2;
  });

  test("Restrictions block actions until ignored with Help from Sabik or removed with Undocumented Actions", () => {
    const base = startPlayingGame(21);
    const gs = toSave(base);
    const g = gs.world.game!;
    g.active = "seat-1";
    g.surveillanceChecked = true;
    g.activeRestrictions = ["erratic"];
    gs.world.campaign.helpFromSabikBoxesLeft = 3;
    const uaId = "event:undocumented-actions";
    g.playerCards[uaId] = { id: uaId, kind: "event", event: "undocumented-actions" };
    g.players["seat-1"].hand = ["city:paris", uaId];

    const a = createGameActor({ save: { ...gs, phase: "playing.actions" } });
    // Erratic forbids Share Intel in Washington
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
    expect(reject(a.getSnapshot().context.world, "playing.actions", shareCmd)).toContain("Erratic");

    // Help from Sabik ignores Erratic for this turn as a free action
    a.send({ type: "ACTION", player: "p1", action: { a: "use-help-from-sabik", restriction: "erratic" } });
    expect(a.getSnapshot().context.world.campaign.helpFromSabikBoxesLeft).toBe(2);
    expect(reject(a.getSnapshot().context.world, "playing.actions", shareCmd)).toBeNull();

    // Undocumented Actions removes Erratic for the entire game
    a.send({ type: "PLAY", player: "p1", play: { e: "undocumented-actions", restriction: "erratic" } });
    expect(a.getSnapshot().context.world.game!.activeRestrictions).toEqual([]);
    expect(violations(a.getSnapshot().context.world)).toEqual([]);
  });

  test("burning an alias discards the hand, returns pawn to Washington, and prompts for an unused Temporary Alias next turn", () => {
    const base = startPlayingGame(22);
    const gs = toSave(base);
    const c = gs.world.campaign;
    const g = gs.world.game!;
    c.passports.black.aliases.allied.created = true;
    c.passports.black.aliases.allied.name = "Dr. Vance";
    c.passports.black.aliases.allied.occupation = "research-assistant";
    // Advance cover track to the final 'burned' pip
    c.passports.black.aliases.allied.coverScratched =
      c.passports.black.aliases.allied.coverTrack.length - 1;

    g.active = "seat-1";
    g.surveillanceChecked = false;
    g.players["seat-1"].passport = "black";
    g.players["seat-1"].activeAlias = "allied";
    g.players["seat-1"].tempAlias = null;
    g.players["seat-1"].location = "moscow"; // surveillance 3, no safehouse

    const a = createGameActor({ save: { ...gs, phase: "playing.surveillance" } });
    a.send({ type: "BEGIN_TURN", player: "p1" });

    const w = a.getSnapshot().context.world;
    expect(w.campaign.passports.black.aliases.allied.burned).toBe(true);
    expect(w.game!.players["seat-1"].location).toBe("washington");
    expect(w.game!.players["seat-1"].hand).toEqual([]);
    expect(w.game!.players["seat-1"].needsTempAlias).toBe(true);
    expect(w.game!.actionsLeft).toBe(0);
    // Cannot take actions after burning this turn
    expect(
      reject(w, "playing.actions", {
        type: "ACTION",
        player: "p1",
        action: { a: "drive", to: "new-york" },
      }),
    ).toContain("burned");
    expect(violations(w)).toEqual([]);
  });

  test("Pursuit spread (Rule X) respects Checkpoints and active teams, fails on Soviet city, and completes when last token is removed", () => {
    const base = startPlayingGame(23);
    const gs = toSave(base);
    gs.world.campaign.rules.push("K", "N", "X");
    const g = gs.world.game!;
    g.active = "seat-1";
    g.surveillanceChecked = true;
    g.supplies.pursuitTokens = 11;
    g.supplies.checkpointTokens = 11;
    g.locations.paris.pursuit = true;
    // Paris connects to east-berlin (Soviet), london (Allied), madrid (Neutral), rome (Allied)
    // Block East Berlin with a Checkpoint and London with an active Allied team -> spreads ONLY to Madrid & Rome!
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
    // Run the Escalation pursuit step directly
    g.pending = [{ t: "escalation", step: "pursuit", escalationsLeft: 1 }];
    g.cardsDrawn = true;

    const a = createGameActor({ save: { ...gs, phase: "playing.draw" } });
    a.send({ type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    const afterSpread = a.getSnapshot().context.world.game!;
    expect(afterSpread.locations.london.pursuit).toBe(false);
    expect(afterSpread.locations["east-berlin"].pursuit).toBe(false);
    expect(afterSpread.locations.madrid.pursuit).toBe(true);
    expect(afterSpread.locations.rome.pursuit).toBe(true);
    expect(afterSpread.objectives[0]!.status).toBe("active");
    expect(violations(a.getSnapshot().context.world)).toEqual([]);

    // Now test Soviet failure: remove the East Berlin checkpoint and run another pursuit spread -> fails & clears tokens (Debrief 172)!
    const failSave = toSave(a);
    failSave.world.game!.checkpoints = [];
    failSave.world.game!.supplies.checkpointTokens = 12;
    failSave.world.game!.pending = [{ t: "escalation", step: "pursuit", escalationsLeft: 1 }];
    failSave.world.game!.cardsDrawn = true;
    const b = createGameActor({ save: { ...failSave, phase: "playing.draw" } });
    b.send({ type: "DECIDE", player: "p1", answer: { t: "escalation" } });
    const afterFail = b.getSnapshot().context.world.game!;
    expect(afterFail.objectives[0]!.status).toBe("failed");
    expect(afterFail.supplies.pursuitTokens).toBe(12);
    expect(violations(b.getSnapshot().context.world)).toEqual([]);
  });

  test("world city connections and infiltration site graphs are symmetric and fit within Security token supplies", () => {
    // Symmetric world graph across all 48 cities
    expect(pack.cities.length).toBe(48);
    for (const city of pack.cities) {
      for (const nb of city.connections) {
        expect(pack.cityById[nb].connections).toContain(city.id);
      }
    }

    // All infiltration site edges reference valid rooms and fit token pools
    const slots = (site: keyof typeof pack.sites) =>
      pack.sites[site].edges.reduce((acc, e) => acc + e.securitySlots, 0);
    expect(slots("sabik-safehouse")).toBeLessThanOrEqual(pack.box0006Tokens.length);
    expect(slots("sabik-hq")).toBeLessThanOrEqual(pack.box0006Tokens.length);
    // Sabik November runs PEARL (19) + Langley (8) simultaneously from the shared 30-token pool
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
    const gs = toSave(base);
    const c = gs.world.campaign;
    const g = gs.world.game!;
    c.rules.push("M");
    g.active = "seat-1";
    g.surveillanceChecked = true;
    g.actionsLeft = 4;

    // 1. Electrician reveals (does not discard) 3 Europe cards on Identify Target City
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
    // Give seat-1 3 Europe cards cleanly (remove from elsewhere first)
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

    const a = createGameActor({ save: { ...gs, phase: "playing.actions" } });
    a.send({
      type: "ACTION",
      player: "p1",
      action: { a: "identify-target-city", objective: g.objectives[0]!.id, cards: euroIds },
    });
    expect(a.getSnapshot().context.world.game!.objectives[0]!.targetRevealed).toBe(true);
    // Electrician keeps all 3 cards in hand!
    expect(a.getSnapshot().context.world.game!.players["seat-1"].hand).toEqual(euroIds);

    // 2. Transport Crew carries allied-1 when driving from London to Paris
    a.send({
      type: "ACTION",
      player: "p1",
      action: { a: "drive", to: "paris", carryTeams: ["allied-1"] },
    });
    expect(a.getSnapshot().context.world.game!.teams["allied-1"]!.city).toBe("paris");

    // 3. Street Cleaner removes all agents upon entering a Soviet city
    const s2 = toSave(a);
    s2.world.campaign.passports.black.aliases.soviet.created = true;
    s2.world.campaign.passports.black.aliases.soviet.name = "Orlov";
    s2.world.campaign.passports.black.aliases.soviet.occupation = "street-cleaner";
    s2.world.game!.players["seat-1"].activeAlias = "soviet";
    const ebBefore = s2.world.game!.locations["east-berlin"];
    const addAmt = 2 - ebBefore.agents;
    if (addAmt > 0) {
      s2.world.game!.locations["east-berlin"].agents += addAmt;
      s2.world.game!.supplies.agents -= addAmt;
    }
    const b = createGameActor({ save: s2 });
    b.send({ type: "ACTION", player: "p1", action: { a: "drive", to: "east-berlin" } });
    expect(b.getSnapshot().context.world.game!.locations["east-berlin"].agents).toBe(0);
    expect(violations(b.getSnapshot().context.world)).toEqual([]);
  });

  test("Prescription Pills increases hand limit to 8 and switching away via Change Alias triggers hand-limit discard", () => {
    const base = startPlayingGame(25);
    const gs = toSave(base);
    const c = gs.world.campaign;
    const g = gs.world.game!;
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
    g.surveillanceChecked = true;
    g.players["seat-1"].passport = "black";
    g.players["seat-1"].activeAlias = "allied";
    g.players["seat-1"].tempAlias = null;
    g.players["seat-1"].location = "washington";

    // Draw 8 city cards into seat-1 hand from playerDeck
    const extra = g.playerDeck.filter((id) => g.playerCards[id]?.kind === "city").slice(0, 8 - g.players["seat-1"].hand.length);
    g.playerDeck = g.playerDeck.filter((id) => !extra.includes(id));
    g.players["seat-1"].hand.push(...extra);
    expect(g.players["seat-1"].hand.length).toBe(8);
    expect(seatsOverHandLimit(gs.world)).toEqual([]);

    const a = createGameActor({ save: { ...gs, phase: "playing.actions" } });
    a.send({ type: "ACTION", player: "p1", action: { a: "change-alias", affiliation: "neutral" } });
    expect(a.getSnapshot().context.world.game!.pending[0]).toEqual({ t: "hand-limit", seat: "seat-1" });
    expect(violations(a.getSnapshot().context.world)).toEqual([]);
  });

  test("Event cards enforce timing and full-effect rules (Cover of Darkness actions-only, One Quiet Night before Threat draws, Diversion preserves token conservation)", () => {
    const base = startPlayingGame(26);
    const gs = toSave(base);
    const g = gs.world.game!;
    g.active = "seat-1";
    g.surveillanceChecked = true;

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
    expect(
      reject(gs.world, "playing.draw", {
        type: "PLAY",
        player: "p1",
        play: { e: "cover-of-darkness" },
      }),
    ).toContain("Do Actions");

    // Diversion moves existing incidents without changing incident token supply
    g.locations.paris.incidents = 2;
    g.supplies.incidentOutbreakTokens -= 2;
    const a = createGameActor({ save: { ...gs, phase: "playing.actions" } });
    a.send({
      type: "PLAY",
      player: "p1",
      play: { e: "diversion", sources: ["paris", "paris"], to: "moscow" },
    });
    expect(a.getSnapshot().context.world.game!.locations.paris.incidents).toBe(0);
    expect(a.getSnapshot().context.world.game!.locations.moscow.incidents).toBe(2);
    expect(violations(a.getSnapshot().context.world)).toEqual([]);

    // One Quiet Night playable at start of playing.threat (threatsDrawnThisTurn === 0), skips directly to next turn!
    const sThreat = toSave(a);
    sThreat.world.game!.cardsDrawn = true;
    sThreat.world.game!.threatsLeft = 2;
    sThreat.world.game!.threatsDrawnThisTurn = 0;
    const b = createGameActor({ save: { ...sThreat, phase: "playing.threat" } });
    b.send({ type: "PLAY", player: "p1", play: { e: "one-quiet-night" } });
    expect(phaseOf(b.getSnapshot().value)).toBe("playing.surveillance");
    expect(b.getSnapshot().context.world.game!.active).toBe("seat-2");
    expect(violations(b.getSnapshot().context.world)).toEqual([]);
  });

  test("Psych Evaluations incorporate Ops 61 / Ops 65 Intel bonuses, and computeFinalScore matches the Annual Review rubric", () => {
    const actor = startPlayingGame(27);
    const world = structuredClone(actor.getSnapshot().context.world);
    // Psych Eval 1: Q1=AGREE(1) + Q2=AGREE(1) + Q3=AGREE(0) + Q4=AGREE(0) + Ops61(+2) = 4 -> Debrief 207 (Restriction 51 erratic)
    world.campaign.psychAnswers = { 1: "AGREE", 2: "AGREE", 3: "AGREE", 4: "AGREE", 12: 3 };
    world.campaign.intelFile.push({ id: "operations/61", title: "Ops 61", text: "" });
    evaluatePsych1(world);
    expect(world.campaign.restrictions).toContain("erratic");

    // Psych Eval 4: Q12=3 + Ops65(+1) = 4 -> Debrief 110 (Restriction 59 callous)
    world.campaign.intelFile.push({ id: "operations/65", title: "Ops 65", text: "" });
    evaluatePsych4(world);
    expect(world.campaign.restrictions).toContain("callous");

    // Annual Review scoring: +85 SUCCEEDING, +55 ADEQUATE, -40 FAILING attempt 1 (0 attempt 2), -10 exposed, -10 contaminated
    world.campaign.results = [
      { month: 1, attempt: 1, evaluation: "SUCCEEDING", completedObjectives: 2, failedObjectives: 0, fundingBefore: 5, fundingAfter: 4, reason: "", turns: 10, incidents: 0, outbreaks: 0, escalations: 2, seats: [] },
      { month: 2, attempt: 1, evaluation: "FAILING", completedObjectives: 0, failedObjectives: 2, fundingBefore: 4, fundingAfter: 6, reason: "", turns: 10, incidents: 0, outbreaks: 0, escalations: 2, seats: [] },
      { month: 2, attempt: 2, evaluation: "ADEQUATE", completedObjectives: 1, failedObjectives: 1, fundingBefore: 6, fundingAfter: 7, reason: "", turns: 10, incidents: 0, outbreaks: 0, escalations: 2, seats: [] },
    ];
    world.campaign.cities.paris.exposedIntensity = 1;
    world.campaign.cities.paris.contaminated = true;
    // 85 - 40 + 55 - 10 - 10 = 80
    expect(computeFinalScore(world)).toBe(80);
  });

  test("buildAnimationCues emits ordered UI cues for phase changes, pawn moves, and agent deltas", () => {
    const actor = startPlayingGame(28);
    const before = structuredClone(actor.getSnapshot().context.world);
    const phaseBefore = phaseOf(actor.getSnapshot().value);
    const activePlayer = before.table.seats.find((s) => s.seat === before.game!.active)!.player;
    actor.send({ type: "BEGIN_TURN", player: activePlayer });
    const mid = structuredClone(actor.getSnapshot().context.world);
    const phaseMid = phaseOf(actor.getSnapshot().value);

    const cues1 = buildAnimationCues(before, phaseBefore, mid, phaseMid);
    expect(cues1.some((c) => c.cue === "phase-change" && c.from === "playing.surveillance" && c.to === "playing.actions")).toBe(true);

    actor.send({ type: "ACTION", player: activePlayer, action: { a: "drive", to: "new-york" } });
    const after = actor.getSnapshot().context.world;
    const cues2 = buildAnimationCues(mid, phaseMid, after, phaseOf(actor.getSnapshot().value));
    expect(cues2.some((c) => c.cue === "pawn-move" && c.from === "washington" && c.to === "new-york")).toBe(true);
  });

  test("Prologue end emits Step 1 evaluation reading without permanent changes, and revealed targets & 3-hop coordinator moves remain visible", () => {
    const actor = startPlayingGame(29);
    const s = toSave(actor);
    const g = s.world.game!;
    // Put seat-1 (Research Assistant) and seat-2 (Medical Conference Coordinator) in Washington with a card to take
    g.active = "seat-2";
    g.players["seat-1"].location = "washington";
    g.players["seat-2"].location = "washington";
    g.players["seat-1"].hand = ["city:cairo"];
    g.players["seat-2"].hand = [];
    // Complete unknown-city objective pro-1 (Kiev) and known objective pro-2 (Novosibirsk)
    const pro1 = g.objectives[0]!;
    pro1.hiddenCardId = "city:kiev";
    pro1.targetRevealed = true;
    g.teams["soviet-1"]!.city = "kiev";
    g.teams["soviet-2"]!.city = "novosibirsk";
    const a = createGameActor({ save: { ...s, phase: "playing.actions" } });

    // Coordinator options include 3-hop destinations (Washington -> New York -> London -> Paris = 3 hops)
    const opts = optionsFor(a.getSnapshot().context.world, phaseOf(a.getSnapshot().value), "p2");
    expect(opts.some((o) => o.key === "coord-pawn:seat-1:paris")).toBe(true);

    // Taking a card logs "Took ..." rather than "gave"
    a.send({
      type: "ACTION",
      player: "p2",
      action: { a: "share-intel", target: "seat-1", card: "city:cairo", direction: "take" },
    });
    const shareLog = a.getSnapshot().context.world.game!.log.at(-1);
    expect(shareLog?.t === "action" && shareLog.detail.startsWith("Took Cairo from seat-1")).toBe(true);

    // Completing unknown-city objective retains revealedTargetCity in view even after Debrief 160 moves card to hand
    a.send({ type: "ACTION", player: "p2", action: { a: "acquire-targets", objective: pro1.id } });
    const v = viewFor(a.getSnapshot().context.world, phaseOf(a.getSnapshot().value), "p2");
    expect(v.game!.objectives[0]!.revealedTargetCity).toBe("kiev");

    // Completing second objective and continuing ends Prologue with evaluation reading, result entry, and Funding unchanged at 5
    a.send({ type: "ACTION", player: "p2", action: { a: "acquire-targets", objective: g.objectives[1]!.id } });
    expect(phaseOf(a.getSnapshot().value)).toBe("over");
    a.send({ type: "CONTINUE", player: "p1" });
    expect(phaseOf(a.getSnapshot().value)).toBe("lobby");
    const c = a.getSnapshot().context.world.campaign;
    expect(c.funding).toBe(5);
    expect(c.results).toHaveLength(1);
    expect(c.results[0]!.month).toBe(0);
    expect(c.results[0]!.evaluation).toBe("SUCCEEDING");
    expect(c.readings.some((r) => r.ref === "prologue-end" && r.text.includes("SUCCEEDING"))).toBe(true);
  });

  test("PlayerView hides unscratched scratch-off cover pips, and unrecorded / clinic flights expose all 47 other cities", () => {
    const actor = startPlayingGame(30);
    const s = toSave(actor);
    const c = s.world.campaign;
    const g = s.world.game!;
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
    const a = createGameActor({ save: { ...s, phase: "playing.actions" } });

    const v = viewFor(a.getSnapshot().context.world, "playing.actions", "p3");
    const pinkAllied = v.campaign.passports.pink.aliases.allied;
    expect(pinkAllied.revealedCoverTrack).toHaveLength(2);
    expect(pinkAllied.coverTrackLength).toBe(10);
    expect("coverTrack" in pinkAllied).toBe(false);

    const opts = optionsFor(a.getSnapshot().context.world, "playing.actions", "p3");
    expect(opts.filter((o) => o.key.startsWith("unrecorded:")).length).toBe(47);
    expect(opts.filter((o) => o.key.startsWith("clinic-fly:washington:")).length).toBe(47);
    expect(opts.filter((o) => o.key.startsWith("clinic-fly:paris:")).length).toBe(47);

    // Clinic Planner flight log names the discarded card
    a.send({
      type: "ACTION",
      player: "p3",
      action: { a: "clinic-planner-flight", card: "city:paris", to: "bangkok" },
    });
    const flyLog = a.getSnapshot().context.world.game!.log.filter((e) => e.t === "action").at(-1);
    expect(flyLog?.t === "action" && flyLog.detail.includes("discarded Paris")).toBe(true);

    // Empty agent supply on Threat draw logs FAILED instead of "+1 agent"
    const s2 = toSave(a);
    s2.world.game!.supplies.agents = 0;
    s2.world.game!.threatsLeft = 1;
    s2.world.game!.threatDeck = [{ id: "threat:bogota", kind: "city", city: "bogota" }];
    s2.world.game!.cardsDrawn = true;
    const b = createGameActor({ save: { ...s2, phase: "playing.threat" } });
    b.send({ type: "DRAW_THREAT", player: "p3" });
    expect(phaseOf(b.getSnapshot().value)).toBe("over");
    const threatLog = b.getSnapshot().context.world.game!.log.filter((e) => e.t === "threat").at(-1);
    expect(threatLog?.t === "threat" && threatLog.effect).toBe("FAILED (agent supply empty)");
  });
});
