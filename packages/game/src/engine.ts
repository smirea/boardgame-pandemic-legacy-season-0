import type { Action } from "./actions";
import { actionReveals, applyAction, checkAction } from "./actions";
import { pack } from "./content/pack";
import {
  allAliasesChosen,
  chooseStartingAlias,
  createGame,
  drawOneThreatCard,
  drawTwoPlayerCards,
  evaluateObjectivesResolved,
  finishTurn,
  flipOpeningThreat,
  prepareThreatAndBoardSetup,
  runCheckSurveillance,
  runHassledCheck,
  runLegacySetupStep,
  runMopUp,
  setupPlayerDeck,
  startThreatStep,
} from "./flow";
import {
  createdUnburnedAliases,
  discardableHandCards,
  ensureHandLimitDecisions,
  handLimit,
  hasPendingWork,
  phaseOf,
  pushEffect,
  pushReading,
  resolveOneCoverScratch,
  seatOfPlayer,
  topFrame,
} from "./helpers";
import type { Affiliation, EventId, PassportColor, PlayerId, SeatId } from "./ids";
import { PASSPORT_COLORS, SEAT_IDS } from "./ids";
import {
  applyPurchase,
  checkPurchase,
  checkRefund,
  closeGame,
  evaluatePsych1,
  evaluatePsych2,
  newCampaign,
  refundPurchase,
  resolveGameEndSteps,
} from "./legacy";
import type { Answer, Play } from "./plays";
import {
  applyDecide,
  applyPlay,
  checkDecide,
  checkPlay,
  resolveIgnoredDoor14,
} from "./plays";
import type { StackSession, StackStepResult, StackTransition } from "./stack";
import { createStackEngine, hasFrame, popFrame, pushSequence, stackFromSequence } from "./stack";
import type { Decision, EffectFrame, LogEntry, Phase, Purchase, World } from "./state";
import type { AnimationCue } from "./timeline";
import { buildAnimationCues } from "./timeline";

export type Command =
  | { type: "JOIN"; player: PlayerId; name: string; seat?: SeatId }
  | { type: "LEAVE"; player: PlayerId }
  | { type: "SEAT"; player: PlayerId; seat: SeatId }
  | { type: "ASSIGN_PASSPORT"; player: PlayerId; seat: SeatId; passport: PassportColor }
  | { type: "BEGIN_JANUARY"; player: PlayerId }
  | { type: "START_GAME"; player: PlayerId }
  | { type: "RESOLVE_DOOR_14"; player: PlayerId; choice: "open" | "blow-up" }
  | { type: "FLIP_OPENING_THREAT"; player: PlayerId }
  | { type: "PICK_EVENTS"; player: PlayerId; events: EventId[]; discretionaryBoxes?: number }
  | { type: "CONFIRM_EVENTS"; player: PlayerId }
  | { type: "CHOOSE_ALIAS"; player: PlayerId; affiliation: Affiliation }
  | { type: "BEGIN_TURN"; player: PlayerId }
  | { type: "ACTION"; player: PlayerId; action: Action }
  | { type: "PLAY"; player: PlayerId; play: Play }
  | { type: "DECIDE"; player: PlayerId; answer: Answer }
  | { type: "UNDO"; player: PlayerId }
  | { type: "END_ACTIONS"; player: PlayerId }
  | { type: "DRAW_PLAYER_CARDS"; player: PlayerId }
  | { type: "DRAW_THREAT"; player: PlayerId }
  | { type: "CONTINUE"; player: PlayerId }
  | { type: "PURCHASE"; player: PlayerId; purchase: Purchase }
  | { type: "REFUND"; player: PlayerId; index: number }
  | { type: "FINISH_UPKEEP"; player: PlayerId };

export type EngineState = {
  world: World;
  undo: World[];
};

export type Save = {
  version: 2;
  world: World;
};

export type GameStepResult = StackStepResult<EngineState, EffectFrame, LogEntry, AnimationCue>;
export type GameTransition = StackTransition<
  EngineState,
  EffectFrame,
  Command,
  LogEntry,
  AnimationCue
>;
export type GameSession = StackSession<
  EngineState,
  EffectFrame,
  Command,
  LogEntry,
  AnimationCue
>;

const WAIT_FRAMES = new Set<EffectFrame["t"]>([
  "lobby",
  "wait-opening-threats",
  "wait-events",
  "wait-aliases",
  "wait-begin-turn",
  "wait-actions",
  "wait-draw-cards",
  "wait-draw-threat",
  "decide",
  "wait-continue",
  "wait-upkeep",
  "finished",
]);

const POST_END_FRAMES = new Set<EffectFrame["t"]>([
  "wait-continue",
  "resolve-postgame",
  "route-after-postgame",
  "wait-upkeep",
  "close-game",
  "finished",
]);

export function isWaitFrame(frame: EffectFrame): boolean {
  return WAIT_FRAMES.has(frame.t);
}

function hasPostEndFrame(stack: readonly EffectFrame[]): boolean {
  return hasFrame(stack, (f) => POST_END_FRAMES.has(f.t));
}

export function createInitialWorld(seed = 1): World {
  const world: World = {
    campaign: newCampaign(seed),
    game: null,
    table: { seats: [] },
    stack: [{ t: "lobby" }],
  };
  pushReading(
    world,
    "system",
    "campaign/intro",
    "Pandemic Legacy: Season 0 — Briefing",
    "1962. You are medical graduates recruited by the CIA to investigate a dangerous new Soviet bioweapon codenamed Project MEDUSA. Prologue starts first (non-permanent training mission), followed by January through December.",
  );
  return world;
}

/** Builds the canonical Effect Stack for a given coarse phase (used for v1 save migration and test staging). */
export function stackForPhase(phase: Phase): EffectFrame[] {
  switch (phase) {
    case "lobby":
      return stackFromSequence({ t: "lobby" });
    case "setup.legacy":
      return stackFromSequence(
        { t: "prepare-threat-board" },
        { t: "wait-opening-threats" },
        { t: "wait-events" },
        { t: "setup-player-deck" },
        { t: "wait-aliases" },
        { t: "start-turn" },
      );
    case "setup.threat":
      return stackFromSequence(
        { t: "wait-opening-threats" },
        { t: "wait-events" },
        { t: "setup-player-deck" },
        { t: "wait-aliases" },
        { t: "start-turn" },
      );
    case "setup.events":
      return stackFromSequence(
        { t: "wait-events" },
        { t: "setup-player-deck" },
        { t: "wait-aliases" },
        { t: "start-turn" },
      );
    case "setup.aliases":
      return stackFromSequence({ t: "wait-aliases" }, { t: "start-turn" });
    case "playing.surveillance":
      return stackFromSequence(
        { t: "wait-begin-turn" },
        { t: "finish-surveillance" },
        { t: "wait-actions" },
        { t: "mop-up" },
        { t: "wait-draw-cards" },
        { t: "check-hand-limit" },
        { t: "check-hassled" },
        { t: "start-threat-step" },
        { t: "wait-draw-threat" },
        { t: "finish-turn" },
      );
    case "playing.actions":
      return stackFromSequence(
        { t: "wait-actions" },
        { t: "mop-up" },
        { t: "wait-draw-cards" },
        { t: "check-hand-limit" },
        { t: "check-hassled" },
        { t: "start-threat-step" },
        { t: "wait-draw-threat" },
        { t: "finish-turn" },
      );
    case "playing.draw":
      return stackFromSequence(
        { t: "wait-draw-cards" },
        { t: "check-hand-limit" },
        { t: "check-hassled" },
        { t: "start-threat-step" },
        { t: "wait-draw-threat" },
        { t: "finish-turn" },
      );
    case "playing.threat":
      return stackFromSequence({ t: "wait-draw-threat" }, { t: "finish-turn" });
    case "over":
      return stackFromSequence(
        { t: "wait-continue" },
        { t: "resolve-postgame" },
        { t: "route-after-postgame" },
      );
    case "postgame":
      return stackFromSequence({ t: "route-after-postgame" });
    case "upkeep":
      return stackFromSequence({ t: "wait-upkeep" }, { t: "close-game" });
    case "finished":
      return stackFromSequence({ t: "finished" });
  }
}

/** Clones `world` with its Effect Stack staged at `phase` (plus optional top decisions). */
export function stagePhase(world: World, phase: Phase, topDecisions: Decision[] = []): World {
  const cloned = structuredClone(world);
  cloned.stack = stackForPhase(phase);
  if (topDecisions.length > 0) {
    pushSequence(
      cloned.stack,
      topDecisions.map((decision): EffectFrame => ({ t: "decide", decision })),
    );
  }
  return cloned;
}

/** Human-readable top-to-bottom stack breadcrumbs for UI, CLI, and debugging. */
export function stackSummary(world: World): string[] {
  const out: string[] = [];
  for (let i = world.stack.length - 1; i >= 0; i--) {
    const frame = world.stack[i]!;
    if (frame.t === "decide") {
      const d = frame.decision;
      if (d.t === "escalation") out.push(`decide:escalation(${d.step})`);
      else if ("seat" in d) out.push(`decide:${d.t}(${d.seat})`);
      else out.push(`decide:${d.t}`);
    } else if (frame.t === "scratch-cover") {
      out.push(`scratch-cover(${frame.seat})`);
    } else {
      out.push(frame.t);
    }
  }
  return out;
}

function defaultPassportForSeat(world: World, seat: SeatId): PassportColor {
  const existing = world.campaign.seating.find((s) => s.seat === seat)?.passport;
  if (existing) return existing;
  const taken = new Set(
    world.campaign.seating.map((s) => s.passport).filter((p): p is PassportColor => p !== null),
  );
  const idx = SEAT_IDS.indexOf(seat);
  const preferred = PASSPORT_COLORS[idx]!;
  if (!taken.has(preferred)) return preferred;
  return PASSPORT_COLORS.find((c) => !taken.has(c)) ?? preferred;
}

function buildGameSeating(world: World): { seat: SeatId; passport: PassportColor | null }[] {
  const seatOrder = SEAT_IDS.filter((s) => world.table.seats.some((ts) => ts.seat === s));
  return seatOrder.map((seat) => {
    const existing = world.campaign.seating.find((s) => s.seat === seat);
    const passport =
      world.campaign.month === 0 ? null : (existing?.passport ?? defaultPassportForSeat(world, seat));
    return { seat, passport };
  });
}

function maxPickableEvents(world: World, discretionaryBoxes: number): number {
  const c = world.campaign;
  return Math.min(c.unlockedEvents.length, c.funding + discretionaryBoxes);
}

/** Single legality truth for every command in every phase. Returns null if legal, else error reason. */
export function reject(world: World, cmd: Command, undoDepth = 0): string | null {
  const phase = phaseOf(world);
  const top = topFrame(world);
  const seat = seatOfPlayer(world, cmd.player);
  const game = world.game;
  const c = world.campaign;

  switch (cmd.type) {
    case "JOIN": {
      if (phase !== "lobby") return "Players can only join in the lobby";
      if (!cmd.name.trim()) return "Player name cannot be empty";
      if (world.table.seats.some((s) => s.player === cmd.player)) return "Already joined";
      if (world.table.seats.length >= 4) return "Table is full (max 4 players)";
      if (cmd.seat) {
        if (!SEAT_IDS.includes(cmd.seat)) return "Invalid seat";
        if (world.table.seats.some((s) => s.seat === cmd.seat)) return `${cmd.seat} is already taken`;
      }
      return null;
    }

    case "LEAVE": {
      if (phase !== "lobby") return "Players can only leave in the lobby";
      if (!seat) return "Not at the table";
      return null;
    }

    case "SEAT": {
      if (phase !== "lobby") return "Can only change seats in the lobby";
      if (!seat) return "Join the table first";
      if (!SEAT_IDS.includes(cmd.seat)) return "Invalid seat";
      if (world.table.seats.some((s) => s.seat === cmd.seat && s.player !== cmd.player)) {
        return `${cmd.seat} is taken`;
      }
      return null;
    }

    case "ASSIGN_PASSPORT": {
      if (phase !== "lobby") return "Can only assign passports in the lobby";
      if (!seat) return "Join the table first";
      if (!SEAT_IDS.includes(cmd.seat)) return "Invalid seat";
      if (!PASSPORT_COLORS.includes(cmd.passport)) return "Invalid passport color";
      const usedByOther = c.seating.some(
        (s) => s.seat !== cmd.seat && s.passport === cmd.passport,
      );
      if (usedByOther) return `${cmd.passport} passport is already assigned to another seat`;
      return null;
    }

    case "BEGIN_JANUARY": {
      if (phase !== "lobby") return "Can only advance to January from the lobby";
      if (!seat) return "Join the table first";
      if (c.month !== 0) return "Already past the Prologue";
      return null;
    }

    case "START_GAME": {
      if (phase !== "lobby") return "Game already in progress";
      if (!seat) return "Join the table first";
      if (world.table.seats.length < 2 || world.table.seats.length > 4) {
        return "Need 2 to 4 players seated to start";
      }
      if (c.month > 12) return "Campaign is already finished";
      return null;
    }

    case "RESOLVE_DOOR_14": {
      if (phase !== "lobby" && phase !== "upkeep") {
        return "Ignored Door 14 briefcase can only be resolved in lobby or upkeep";
      }
      if (!seat) return "Must be seated";
      if (phase === "upkeep" && top?.t !== "wait-upkeep") return "Resolve pending choice first";
      if (c.door14State !== "ignored") return "Door 14 briefcase is not waiting to be resolved";
      if (cmd.choice !== "open" && cmd.choice !== "blow-up") return "Choose open or blow-up";
      return null;
    }

    case "FLIP_OPENING_THREAT": {
      if (phase !== "setup.threat") return "Not in setup.threat phase";
      if (!seat || !game) return "Must be seated";
      if (top?.t !== "wait-opening-threats") return "Resolve the pending setup choice first";
      if (game.openingThreatsLeft <= 0) return "All 9 opening Threat cards already flipped";
      return null;
    }

    case "PICK_EVENTS": {
      if (phase !== "setup.events") return "Not in setup.events phase";
      if (!seat || !game) return "Must be seated";
      if (top?.t !== "wait-events") return "Resolve the pending setup choice first";
      const disc = cmd.discretionaryBoxes ?? 0;
      if (!Number.isInteger(disc) || disc < 0) return "Invalid discretionaryBoxes";
      if (disc > 0) {
        if (c.discretionaryBudgetBoxesLeft === null || disc > c.discretionaryBudgetBoxesLeft) {
          return `Only ${c.discretionaryBudgetBoxesLeft ?? 0} Discretionary Budget box(es) remaining`;
        }
      }
      const allowedMax = maxPickableEvents(world, disc);
      if (cmd.events.length > allowedMax) {
        return `Can select at most ${allowedMax} Event cards (Funding ${c.funding}${disc > 0 ? ` + ${disc} Discretionary` : ""})`;
      }
      if (new Set(cmd.events).size !== cmd.events.length) return "Duplicate events";
      for (const ev of cmd.events) {
        if (!c.unlockedEvents.includes(ev)) return `Event ${ev} is not unlocked`;
      }
      return null;
    }

    case "CONFIRM_EVENTS": {
      if (phase !== "setup.events") return "Not in setup.events phase";
      if (!seat || !game) return "Must be seated";
      if (top?.t !== "wait-events") return "Resolve the pending setup choice first";
      const disc = game.discretionaryCheckedThisGame;
      const expected = maxPickableEvents(world, disc);
      if (game.pickedEvents.length > expected) {
        return `Selected too many events (${game.pickedEvents.length}/${expected})`;
      }
      return null;
    }

    case "CHOOSE_ALIAS": {
      if (phase !== "setup.aliases") return "Not in setup.aliases phase";
      if (!seat || !game) return "Must be seated";
      if (top?.t !== "wait-aliases") return "Resolve the pending setup choice first";
      const player = game.players[seat];
      if (!player.passport) return "You do not have a passport to choose an alias from";
      if (game.aliasesChosen.includes(seat)) return "You already chose your starting alias";
      const valid = createdUnburnedAliases(c, player.passport);
      if (!valid.includes(cmd.affiliation)) {
        return `Valid aliases for ${player.passport}: ${valid.join(", ")}`;
      }
      return null;
    }

    case "BEGIN_TURN": {
      if (phase !== "playing.surveillance") return "Not in Check Surveillance step";
      if (!seat || !game) return "Must be seated";
      if (seat !== game.active) return `Waiting for ${game.active} to begin their turn`;
      if (top?.t !== "wait-begin-turn") {
        return hasPendingWork(world) ? "Resolve pending choice first" : "Surveillance already checked";
      }
      return null;
    }

    case "ACTION": {
      if (phase !== "playing.actions") return "Actions can only be performed during Do Actions step";
      if (!seat) return "Must be seated";
      return checkAction(world, seat, cmd.action);
    }

    case "PLAY": {
      if (!seat) return "Must be seated";
      return checkPlay(world, seat, cmd.play);
    }

    case "DECIDE": {
      if (!seat) return "Must be seated";
      return checkDecide(world, seat, cmd.answer);
    }

    case "UNDO": {
      if (phase !== "playing.actions") return "Undo is only available during Do Actions";
      if (!seat || !game) return "Must be seated";
      if (seat !== game.active) return "Only the active player may undo";
      if (undoDepth <= 0) return "Nothing to undo";
      return null;
    }

    case "END_ACTIONS": {
      if (phase !== "playing.actions") return "Not in Do Actions step";
      if (!seat || !game) return "Must be seated";
      if (seat !== game.active) return "Only the active player may end Do Actions";
      if (top?.t !== "wait-actions") return "Resolve pending choices before ending Do Actions";
      return null;
    }

    case "DRAW_PLAYER_CARDS": {
      if (phase !== "playing.draw") return "Not in Draw Player Cards step";
      if (!seat || !game) return "Must be seated";
      if (seat !== game.active) return "Only the active player may draw Player cards";
      if (top?.t !== "wait-draw-cards") {
        return hasPendingWork(world)
          ? "Resolve pending choices before drawing"
          : "Player cards already drawn this turn";
      }
      return null;
    }

    case "DRAW_THREAT": {
      if (phase !== "playing.threat") return "Not in Draw Threat Cards step";
      if (!seat || !game) return "Must be seated";
      if (seat !== game.active) return "Only the active player may draw Threat cards";
      if (top?.t !== "wait-draw-threat") {
        return "Resolve pending choices before drawing next Threat card";
      }
      if (game.threatsLeft <= 0) return "No Threat cards left to draw this turn";
      return null;
    }

    case "CONTINUE": {
      if (phase !== "over") return "Game is not awaiting game-end resolution";
      if (!seat || !game) return "Must be seated";
      if (top?.t !== "wait-continue") return "Resolve pending choice first";
      return null;
    }

    case "PURCHASE": {
      if (phase !== "upkeep") return "Purchases are only allowed in Spend Budget (upkeep)";
      if (!seat || !game) return "Must be seated";
      if (top?.t !== "wait-upkeep") return "Resolve pending choice first";
      return checkPurchase(world, cmd.purchase);
    }

    case "REFUND": {
      if (phase !== "upkeep") return "Refunds are only allowed in upkeep";
      if (!seat || !game) return "Must be seated";
      if (top?.t !== "wait-upkeep") return "Resolve pending choice first";
      return checkRefund(world, cmd.index);
    }

    case "FINISH_UPKEEP": {
      if (phase !== "upkeep") return "Not in upkeep";
      if (!seat || !game || !game.upkeep) return "Must be seated";
      if (top?.t !== "wait-upkeep") return "Resolve pending choice first";
      if (game.upkeep.done.includes(cmd.player)) return "Already confirmed upkeep";
      return null;
    }
  }
}

function runAutoFrame(draft: EngineState, frame: EffectFrame): void {
  const world = draft.world;
  switch (frame.t) {
    case "read-legacy-setup":
      runLegacySetupStep(world);
      break;
    case "prepare-threat-board":
      prepareThreatAndBoardSetup(world);
      break;
    case "setup-player-deck":
      setupPlayerDeck(world);
      break;
    case "start-turn":
      pushEffect(
        world,
        { t: "wait-begin-turn" },
        { t: "finish-surveillance" },
        { t: "wait-actions" },
        { t: "mop-up" },
        { t: "wait-draw-cards" },
        { t: "check-hand-limit" },
        { t: "check-hassled" },
        { t: "start-threat-step" },
        { t: "wait-draw-threat" },
        { t: "finish-turn" },
      );
      break;
    case "finish-surveillance":
      break;
    case "mop-up":
      runMopUp(world);
      break;
    case "check-hand-limit":
      ensureHandLimitDecisions(world);
      break;
    case "check-hassled":
      runHassledCheck(world);
      break;
    case "start-threat-step":
      startThreatStep(world);
      break;
    case "finish-turn":
      finishTurn(world);
      if (!world.game?.outcome) {
        pushEffect(world, { t: "start-turn" });
      }
      break;
    case "scratch-cover":
      resolveOneCoverScratch(world, frame.seat, frame.source, frame.more);
      break;
    case "check-objectives-resolved":
      evaluateObjectivesResolved(world);
      break;
    case "eval-psych":
      if (frame.which === 1) evaluatePsych1(world);
      else evaluatePsych2(world);
      break;
    case "resolve-postgame":
      resolveGameEndSteps(world);
      break;
    case "route-after-postgame":
      if (world.campaign.month === 12) {
        pushEffect(world, { t: "finished" });
      } else if (world.campaign.month === 0) {
        pushEffect(world, { t: "close-game" });
      } else {
        pushEffect(world, { t: "wait-upkeep" }, { t: "close-game" });
      }
      break;
    case "close-game":
      closeGame(world);
      pushEffect(world, { t: "lobby" });
      break;
    default:
      throw new Error(`Unexpected auto frame '${frame.t}'`);
  }
}

function applyCommand(draft: EngineState, cmd: Command): void {
  const world = draft.world;
  const seat = seatOfPlayer(world, cmd.player);

  switch (cmd.type) {
    case "JOIN": {
      const assignedSeat =
        cmd.seat ?? SEAT_IDS.find((s) => !world.table.seats.some((ts) => ts.seat === s))!;
      world.table.seats.push({ player: cmd.player, name: cmd.name.trim(), seat: assignedSeat });
      if (!world.campaign.seating.some((s) => s.seat === assignedSeat)) {
        world.campaign.seating.push({
          seat: assignedSeat,
          passport: defaultPassportForSeat(world, assignedSeat),
        });
      }
      break;
    }

    case "LEAVE":
      world.table.seats = world.table.seats.filter((s) => s.player !== cmd.player);
      break;

    case "SEAT": {
      const entry = world.table.seats.find((s) => s.player === cmd.player);
      if (entry) entry.seat = cmd.seat;
      if (!world.campaign.seating.some((s) => s.seat === cmd.seat)) {
        world.campaign.seating.push({
          seat: cmd.seat,
          passport: defaultPassportForSeat(world, cmd.seat),
        });
      }
      break;
    }

    case "ASSIGN_PASSPORT": {
      const existing = world.campaign.seating.find((s) => s.seat === cmd.seat);
      if (existing) existing.passport = cmd.passport;
      else world.campaign.seating.push({ seat: cmd.seat, passport: cmd.passport });
      break;
    }

    case "BEGIN_JANUARY": {
      const c = world.campaign;
      c.month = 1;
      c.attempt = 1;
      if (c.legacyIndex < 5) {
        c.legacyIndex = 5;
        if (!c.intelFile.some((x) => x.id === "legacy/00-05")) {
          c.intelFile.push({
            id: "legacy/00-05",
            title: "Coop's Notes",
            text: pack.legacyArchive["legacy/00-05"]!.back,
          });
        }
      }
      break;
    }

    case "START_GAME": {
      const seating = buildGameSeating(world);
      world.campaign.seating = seating.map((s) => ({
        seat: s.seat,
        passport: s.passport ?? defaultPassportForSeat(world, s.seat),
      }));
      createGame(world, seating);
      world.stack.length = 0;
      pushEffect(
        world,
        { t: "read-legacy-setup" },
        { t: "prepare-threat-board" },
        { t: "wait-opening-threats" },
        { t: "wait-events" },
        { t: "setup-player-deck" },
        { t: "wait-aliases" },
        { t: "start-turn" },
      );
      break;
    }

    case "RESOLVE_DOOR_14":
      resolveIgnoredDoor14(world, cmd.choice);
      break;

    case "FLIP_OPENING_THREAT":
      flipOpeningThreat(world);
      break;

    case "PICK_EVENTS":
      world.game!.pickedEvents = [...cmd.events];
      world.game!.discretionaryCheckedThisGame = cmd.discretionaryBoxes ?? 0;
      break;

    case "CONFIRM_EVENTS":
      popFrame(world.stack);
      break;

    case "CHOOSE_ALIAS":
      chooseStartingAlias(world, seat!, cmd.affiliation);
      break;

    case "BEGIN_TURN":
      popFrame(world.stack);
      runCheckSurveillance(world);
      break;

    case "ACTION":
      applyAction(world, seat!, cmd.action);
      break;

    case "PLAY":
      applyPlay(world, seat!, cmd.play);
      break;

    case "DECIDE":
      applyDecide(world, cmd.answer);
      break;

    case "UNDO": {
      const prev = draft.undo.pop();
      if (prev) draft.world = prev;
      break;
    }

    case "END_ACTIONS":
      popFrame(world.stack);
      break;

    case "DRAW_PLAYER_CARDS":
      popFrame(world.stack);
      drawTwoPlayerCards(world);
      break;

    case "DRAW_THREAT":
      drawOneThreatCard(world);
      break;

    case "CONTINUE":
      popFrame(world.stack);
      break;

    case "PURCHASE":
      applyPurchase(world, cmd.purchase);
      break;

    case "REFUND":
      refundPurchase(world, cmd.index);
      break;

    case "FINISH_UPKEEP":
      if (world.game?.upkeep && !world.game.upkeep.done.includes(cmd.player)) {
        world.game.upkeep.done.push(cmd.player);
      }
      break;
  }
}

export const gameEngine = createStackEngine<
  EngineState,
  EffectFrame,
  Command,
  LogEntry,
  AnimationCue
>({
  getStack: (state) => state.world.stack,
  isWait: isWaitFrame,
  interrupt: (draft) => {
    if (draft.world.game?.outcome && !hasPostEndFrame(draft.world.stack)) {
      draft.world.stack = stackFromSequence(
        { t: "wait-continue" },
        { t: "resolve-postgame" },
        { t: "route-after-postgame" },
      );
      return true;
    }
    return false;
  },
  pruneWait: (draft, frame) => {
    const game = draft.world.game;
    switch (frame.t) {
      case "wait-opening-threats":
        return (game?.openingThreatsLeft ?? 0) <= 0;
      case "wait-aliases":
        return allAliasesChosen(draft.world);
      case "wait-draw-threat":
        return (game?.threatsLeft ?? 0) <= 0;
      case "wait-upkeep": {
        const upkeep = game?.upkeep;
        if (!upkeep) return false;
        return draft.world.table.seats.every((s) => upkeep.done.includes(s.player));
      }
      case "decide": {
        if (frame.decision.t !== "hand-limit") return false;
        if (!game || game.outcome) return true;
        const seat = frame.decision.seat;
        return (
          game.players[seat].hand.length <= handLimit(draft.world, seat) ||
          discardableHandCards(game, seat).length === 0
        );
      }
      default:
        return false;
    }
  },
  runAuto: runAutoFrame,
  check: (state, cmd) => reject(state.world, cmd, state.undo.length),
  apply: applyCommand,
  afterStep: (before, after, cmd) => {
    if (cmd.type === "ACTION") {
      const reveals = actionReveals(before.world, cmd.action);
      const prevLogLen = before.world.game?.log.length ?? 0;
      const drewSymptom =
        after.world.game?.log
          .slice(prevLogLen)
          .some((e) => e.t === "symptom" && e.action === "gained") ?? false;
      return {
        world: after.world,
        undo: reveals || drewSymptom ? [] : [...before.undo, before.world],
      };
    }
    if (
      cmd.type === "UNDO" ||
      cmd.type === "JOIN" ||
      cmd.type === "LEAVE" ||
      cmd.type === "SEAT" ||
      cmd.type === "ASSIGN_PASSPORT" ||
      cmd.type === "BEGIN_JANUARY" ||
      cmd.type === "PICK_EVENTS" ||
      cmd.type === "PURCHASE" ||
      cmd.type === "REFUND" ||
      cmd.type === "FINISH_UPKEEP"
    ) {
      return after;
    }
    return after.undo.length === 0 ? after : { world: after.world, undo: [] };
  },
  deriveEvents: (before, after) => {
    if (!after.world.game) return [];
    const prevLen = before.world.game ? before.world.game.log.length : 0;
    return after.world.game.log.slice(prevLen);
  },
  deriveCues: (before, after) => buildAnimationCues(before.world, after.world),
});

export function step(state: EngineState, cmd: Command): GameStepResult {
  return gameEngine.step(state, cmd);
}

export function createEngineState(
  options: { seed?: number; save?: Save; world?: World } = {},
): EngineState {
  if (options.save) {
    return { world: structuredClone(options.save.world), undo: [] };
  }
  if (options.world) {
    return { world: structuredClone(options.world), undo: [] };
  }
  return { world: createInitialWorld(options.seed ?? 1), undo: [] };
}

export function createGameSession(
  options: { seed?: number; save?: Save; world?: World } = {},
): GameSession {
  return gameEngine.createSession(createEngineState(options));
}

export function toSave(source: GameSession | EngineState | World): Save {
  const world =
    "state" in source ? source.state.world : "world" in source ? source.world : source;
  return {
    version: 2,
    world: structuredClone(world),
  };
}

/** Parses v2 saves natively and upgrades legacy v1 saves into the Effect Stack format. */
export function parseSave(raw: unknown): Save {
  if (!raw || typeof raw !== "object") throw new Error("Invalid save: expected object");
  const obj = raw as Record<string, unknown>;

  if (obj.version === 2) {
    const world = obj.world as Record<string, unknown> | undefined;
    if (!world || typeof world !== "object") throw new Error("Invalid save: missing world");
    if (!Array.isArray(world.stack)) throw new Error("Invalid save: missing world.stack");
    return obj as Save;
  }

  if (obj.version === 1) {
    if (typeof obj.phase !== "string") throw new Error("Invalid v1 save: missing phase");
    if (!obj.world || typeof obj.world !== "object") throw new Error("Invalid v1 save: missing world");
    const cloned = structuredClone(obj.world) as Record<string, unknown>;
    const legacyTable = cloned.table as Record<string, unknown> | undefined;
    if (legacyTable && "ready" in legacyTable) delete legacyTable.ready;

    const phase = obj.phase as Phase;
    const baseStack = stackForPhase(phase);
    const legacyGame = cloned.game as Record<string, unknown> | null | undefined;
    const extraFrames: EffectFrame[] = [];

    if (legacyGame) {
      if (phase === "playing.surveillance" && legacyGame.surveillanceChecked === true) {
        if (baseStack[baseStack.length - 1]?.t === "wait-begin-turn") baseStack.pop();
      }
      if (phase === "playing.draw" && legacyGame.cardsDrawn === true) {
        if (baseStack[baseStack.length - 1]?.t === "wait-draw-cards") baseStack.pop();
      }
      const pending = Array.isArray(legacyGame.pending) ? (legacyGame.pending as Decision[]) : [];
      for (const dec of pending) {
        extraFrames.push({ t: "decide", decision: dec });
      }
      const coverQueue = Array.isArray(legacyGame.coverQueue)
        ? (legacyGame.coverQueue as { seat: SeatId; remaining: number; source: string }[])
        : [];
      for (const item of coverQueue) {
        for (let i = 0; i < item.remaining; i++) {
          extraFrames.push({
            t: "scratch-cover",
            seat: item.seat,
            source: item.source,
            more: item.remaining - 1 - i,
          });
        }
      }
      for (const obsolete of [
        "surveillanceChecked",
        "cardsDrawn",
        "queuedEscalations",
        "hassledChecked",
        "coverQueue",
        "pending",
        "endedVotes",
        "postgameResolved",
      ]) {
        delete legacyGame[obsolete];
      }
    }

    if (extraFrames.length > 0) pushSequence(baseStack, extraFrames);
    cloned.stack = baseStack;
    return { version: 2, world: cloned as unknown as World };
  }

  throw new Error(`Unsupported save version: ${String(obj.version)}`);
}

export function describeMonth(month: number, attempt: 1 | 2): string {
  const name = pack.monthNames[month] ?? `Month ${month}`;
  return month === 0 ? name : `${name} (Attempt ${attempt})`;
}
