import { describe, expect, test } from "bun:test";
import {
  advanceThroughMonth,
  canSatisfySecurityTokens,
  createGameActor,
  createRecording,
  createSeatedCampaign,
  drawTwoPlayerCards,
  ensureHandLimitDecisions,
  giveSymptomCard,
  pack,
  phaseOf,
  reject,
  replayRecording,
  resolveDiseaseInfection,
  resolveIncidentWave,
  seatsOverHandLimit,
  toSave,
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
});
