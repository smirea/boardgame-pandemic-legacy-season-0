import { produce } from "immer";
import { assign, createActor, setup } from "xstate";
import type { Action } from "./actions";
import { actionReveals, applyAction, checkAction } from "./actions";
import { pack } from "./content/pack";
import {
  allAliasesChosen,
  chooseStartingAlias,
  createGame,
  drawOneThreatCard,
  drawTwoPlayerCards,
  finishTurn,
  flipOpeningThreat,
  isOver,
  prepareThreatAndBoardSetup,
  runCheckSurveillance,
  runMopUp,
  setupPlayerDeck,
  startThreatStep,
} from "./flow";
import { createdUnburnedAliases, pushReading } from "./helpers";
import type { Affiliation, EventId, PassportColor, PlayerId, SeatId } from "./ids";
import { PASSPORT_COLORS, SEAT_IDS } from "./ids";
import {
  applyPurchase,
  checkPurchase,
  checkRefund,
  closeGame,
  newCampaign,
  refundPurchase,
  resolveGameEndSteps,
} from "./legacy";
import type { Answer, Play } from "./plays";
import {
  applyDecide,
  applyPlay,
  autoResolve,
  checkDecide,
  checkPlay,
  resolveIgnoredDoor14,
} from "./plays";
import type { Purchase, World } from "./state";

export type Phase =
  | "lobby"
  | "setup.legacy"
  | "setup.threat"
  | "setup.events"
  | "setup.aliases"
  | "playing.surveillance"
  | "playing.actions"
  | "playing.draw"
  | "playing.threat"
  | "over"
  | "postgame"
  | "upkeep"
  | "finished";

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

export type MachineContext = {
  world: World;
  undo: World[];
};

export type Save = {
  version: 1;
  phase: Phase;
  world: World;
};

export function createInitialWorld(seed = 1): World {
  const world: World = {
    campaign: newCampaign(seed),
    game: null,
    table: { seats: [], ready: {} },
  };
  // Push rulebook quick overview as Reading #1 so fresh campaigns have context
  pushReading(
    world,
    "system",
    "campaign/intro",
    "Pandemic Legacy: Season 0 — Briefing",
    "1962. You are medical graduates recruited by the CIA to investigate a dangerous new Soviet bioweapon codenamed Project MEDUSA. Prologue starts first (non-permanent training mission), followed by January through December.",
  );
  return world;
}

export function seatOfPlayer(world: World, player: PlayerId): SeatId | null {
  return world.table.seats.find((s) => s.player === player)?.seat ?? null;
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
export function reject(world: World, phase: Phase, cmd: Command, undoDepth = 0): string | null {
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
      if (c.door14State !== "ignored") return "Door 14 briefcase is not waiting to be resolved";
      if (cmd.choice !== "open" && cmd.choice !== "blow-up") return "Choose open or blow-up";
      return null;
    }

    case "FLIP_OPENING_THREAT": {
      if (phase !== "setup.threat") return "Not in setup.threat phase";
      if (!seat || !game) return "Must be seated";
      if (game.pending.length > 0) return "Resolve the pending setup choice first";
      if (game.openingThreatsLeft <= 0) return "All 9 opening Threat cards already flipped";
      return null;
    }

    case "PICK_EVENTS": {
      if (phase !== "setup.events") return "Not in setup.events phase";
      if (!seat || !game) return "Must be seated";
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
      if (game.surveillanceChecked) return "Surveillance already checked";
      if (game.pending.length > 0) return "Resolve pending choice first";
      return null;
    }

    case "ACTION": {
      if (phase !== "playing.actions") return "Actions can only be performed during Do Actions step";
      if (!seat) return "Must be seated";
      return checkAction(world, seat, cmd.action);
    }

    case "PLAY": {
      if (!seat) return "Must be seated";
      return checkPlay(world, seat, phase, cmd.play);
    }

    case "DECIDE": {
      if (
        phase !== "setup.legacy" &&
        phase !== "setup.threat" &&
        phase !== "playing.surveillance" &&
        phase !== "playing.actions" &&
        phase !== "playing.draw" &&
        phase !== "playing.threat" &&
        phase !== "postgame" &&
        phase !== "upkeep"
      ) {
        return "No decisions in this phase";
      }
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
      if (game.pending.length > 0 || game.coverQueue.length > 0) {
        return "Resolve pending choices before ending Do Actions";
      }
      return null;
    }

    case "DRAW_PLAYER_CARDS": {
      if (phase !== "playing.draw") return "Not in Draw Player Cards step";
      if (!seat || !game) return "Must be seated";
      if (seat !== game.active) return "Only the active player may draw Player cards";
      if (game.cardsDrawn) return "Player cards already drawn this turn";
      if (game.pending.length > 0 || game.coverQueue.length > 0) {
        return "Resolve pending choices before drawing";
      }
      return null;
    }

    case "DRAW_THREAT": {
      if (phase !== "playing.threat") return "Not in Draw Threat Cards step";
      if (!seat || !game) return "Must be seated";
      if (seat !== game.active) return "Only the active player may draw Threat cards";
      if (game.pending.length > 0 || game.coverQueue.length > 0) {
        return "Resolve pending choices before drawing next Threat card";
      }
      if (game.threatsLeft <= 0) return "No Threat cards left to draw this turn";
      return null;
    }

    case "CONTINUE": {
      if (phase !== "over") return "Game is not awaiting game-end resolution";
      if (!seat || !game) return "Must be seated";
      return null;
    }

    case "PURCHASE": {
      if (phase !== "upkeep") return "Purchases are only allowed in Spend Budget (upkeep)";
      if (!seat || !game) return "Must be seated";
      if (game.pending.length > 0) return "Resolve pending choice first";
      return checkPurchase(world, cmd.purchase);
    }

    case "REFUND": {
      if (phase !== "upkeep") return "Refunds are only allowed in upkeep";
      if (!seat || !game) return "Must be seated";
      if (game.pending.length > 0) return "Resolve pending choice first";
      return checkRefund(world, cmd.index);
    }

    case "FINISH_UPKEEP": {
      if (phase !== "upkeep") return "Not in upkeep";
      if (!seat || !game || !game.upkeep) return "Must be seated";
      if (game.pending.length > 0) return "Resolve pending choice first";
      if (game.upkeep.done.includes(cmd.player)) return "Already confirmed upkeep";
      return null;
    }
  }
}

function mutateWorld(world: World, fn: (draft: World) => void): World {
  return produce(world, fn);
}

export const gameMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as Command,
    input: {} as { seed?: number; world?: World },
  },
  guards: {
    legal: ({ context, event }, params: { phase: Phase }) =>
      reject(context.world, params.phase, event, context.undo.length) === null,
    legacyReady: ({ context }) =>
      context.world.game !== null &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0,
    openingThreatsDone: ({ context }) =>
      context.world.game !== null &&
      context.world.game.openingThreatsLeft <= 0 &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0,
    aliasesDone: ({ context }) => allAliasesChosen(context.world),
    aliasesNeeded: ({ context }) => !allAliasesChosen(context.world),
    isOver: ({ context }) => isOver(context.world),
    surveillanceDone: ({ context }) =>
      context.world.game !== null &&
      !isOver(context.world) &&
      context.world.game.surveillanceChecked &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0,
    drawStepDone: ({ context }) =>
      context.world.game !== null &&
      !isOver(context.world) &&
      context.world.game.cardsDrawn &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0,
    threatStepDone: ({ context }) =>
      context.world.game !== null &&
      !isOver(context.world) &&
      context.world.game.threatsLeft <= 0 &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0,
    postgameToFinished: ({ context }) =>
      context.world.game !== null &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0 &&
      context.world.campaign.month === 12,
    postgameToLobby: ({ context }) =>
      context.world.game !== null &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0 &&
      context.world.campaign.month === 0,
    postgameToUpkeep: ({ context }) =>
      context.world.game !== null &&
      context.world.game.pending.length === 0 &&
      context.world.game.coverQueue.length === 0 &&
      context.world.campaign.month > 0 &&
      context.world.campaign.month < 12,
    upkeepDone: ({ context }) => {
      const game = context.world.game;
      if (!game?.upkeep) return false;
      if (game.pending.length > 0 || game.coverQueue.length > 0) return false;
      const seatedPlayers = context.world.table.seats.map((s) => s.player);
      return seatedPlayers.every((pid) => game.upkeep!.done.includes(pid));
    },
  },
  actions: {
    doJoin: assign(({ context, event }) => {
      if (event.type !== "JOIN") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          const seat =
            event.seat ?? SEAT_IDS.find((s) => !w.table.seats.some((ts) => ts.seat === s))!;
          w.table.seats.push({ player: event.player, name: event.name.trim(), seat });
          if (!w.campaign.seating.some((s) => s.seat === seat)) {
            w.campaign.seating.push({ seat, passport: defaultPassportForSeat(w, seat) });
          }
        }),
      };
    }),
    doLeave: assign(({ context, event }) => {
      if (event.type !== "LEAVE") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          w.table.seats = w.table.seats.filter((s) => s.player !== event.player);
          delete w.table.ready[event.player];
        }),
      };
    }),
    doSeat: assign(({ context, event }) => {
      if (event.type !== "SEAT") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          const entry = w.table.seats.find((s) => s.player === event.player);
          if (entry) entry.seat = event.seat;
          if (!w.campaign.seating.some((s) => s.seat === event.seat)) {
            w.campaign.seating.push({
              seat: event.seat,
              passport: defaultPassportForSeat(w, event.seat),
            });
          }
        }),
      };
    }),
    doAssignPassport: assign(({ context, event }) => {
      if (event.type !== "ASSIGN_PASSPORT") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          const existing = w.campaign.seating.find((s) => s.seat === event.seat);
          if (existing) existing.passport = event.passport;
          else w.campaign.seating.push({ seat: event.seat, passport: event.passport });
        }),
      };
    }),
    doBeginJanuary: assign(({ context }) => ({
      ...context,
      world: mutateWorld(context.world, (w) => {
        const c = w.campaign;
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
      }),
    })),
    doStartGame: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        const seating = buildGameSeating(w);
        w.campaign.seating = seating.map((s) => ({
          seat: s.seat,
          passport: s.passport ?? defaultPassportForSeat(w, s.seat),
        }));
        createGame(w, seating);
      }),
    })),
    doResolveDoor14: assign(({ context, event }) => {
      if (event.type !== "RESOLVE_DOOR_14") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          resolveIgnoredDoor14(w, event.choice);
        }),
      };
    }),
    doPrepareThreat: assign(({ context }) => ({
      ...context,
      world: mutateWorld(context.world, (w) => {
        prepareThreatAndBoardSetup(w);
      }),
    })),
    doFlipOpeningThreat: assign(({ context }) => ({
      ...context,
      world: mutateWorld(context.world, (w) => {
        flipOpeningThreat(w);
      }),
    })),
    doPickEvents: assign(({ context, event }) => {
      if (event.type !== "PICK_EVENTS") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          w.game!.pickedEvents = [...event.events];
          w.game!.discretionaryCheckedThisGame = event.discretionaryBoxes ?? 0;
        }),
      };
    }),
    doConfirmEvents: assign(({ context }) => ({
      ...context,
      world: mutateWorld(context.world, (w) => {
        setupPlayerDeck(w);
      }),
    })),
    doChooseAlias: assign(({ context, event }) => {
      if (event.type !== "CHOOSE_ALIAS") return context;
      const seat = seatOfPlayer(context.world, event.player)!;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          chooseStartingAlias(w, seat, event.affiliation);
        }),
      };
    }),
    doBeginTurn: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        runCheckSurveillance(w);
      }),
    })),
    doAction: assign(({ context, event }) => {
      if (event.type !== "ACTION") return context;
      const seat = seatOfPlayer(context.world, event.player)!;
      const reveals = actionReveals(context.world, event.action);
      const nextUndo = reveals ? [] : [...context.undo, context.world];
      const nextWorld = mutateWorld(context.world, (w) => {
        applyAction(w, seat, event.action);
        autoResolve(w);
      });
      return { world: nextWorld, undo: nextUndo };
    }),
    doPlay: assign(({ context, event }, params: { phase: Phase }) => {
      if (event.type !== "PLAY") return context;
      const seat = seatOfPlayer(context.world, event.player)!;
      return {
        undo: [],
        world: mutateWorld(context.world, (w) => {
          applyPlay(w, seat, params.phase, event.play);
        }),
      };
    }),
    doDecide: assign(({ context, event }) => {
      if (event.type !== "DECIDE") return context;
      return {
        undo: [],
        world: mutateWorld(context.world, (w) => {
          applyDecide(w, event.answer);
        }),
      };
    }),
    doUndo: assign(({ context }) => {
      if (context.undo.length === 0) return context;
      const nextUndo = context.undo.slice(0, -1);
      const prev = context.undo[context.undo.length - 1]!;
      return { world: prev, undo: nextUndo };
    }),
    doEndActions: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        runMopUp(w);
        autoResolve(w);
      }),
    })),
    doDrawPlayerCards: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        drawTwoPlayerCards(w);
        autoResolve(w);
      }),
    })),
    doStartThreatStep: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        startThreatStep(w);
      }),
    })),
    doDrawThreat: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        drawOneThreatCard(w);
        autoResolve(w);
      }),
    })),
    doFinishTurn: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        finishTurn(w);
      }),
    })),
    doResolvePostgame: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        resolveGameEndSteps(w);
        autoResolve(w);
      }),
    })),
    doPurchase: assign(({ context, event }) => {
      if (event.type !== "PURCHASE") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          applyPurchase(w, event.purchase);
        }),
      };
    }),
    doRefund: assign(({ context, event }) => {
      if (event.type !== "REFUND") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          refundPurchase(w, event.index);
        }),
      };
    }),
    doMarkUpkeepDone: assign(({ context, event }) => {
      if (event.type !== "FINISH_UPKEEP") return context;
      return {
        ...context,
        world: mutateWorld(context.world, (w) => {
          if (w.game?.upkeep && !w.game.upkeep.done.includes(event.player)) {
            w.game.upkeep.done.push(event.player);
          }
        }),
      };
    }),
    doCloseGame: assign(({ context }) => ({
      undo: [],
      world: mutateWorld(context.world, (w) => {
        closeGame(w);
      }),
    })),
  },
}).createMachine({
  id: "pandemicSeason0",
  context: ({ input }) => ({
    world: input.world ?? createInitialWorld(input.seed ?? 1),
    undo: [],
  }),
  initial: "lobby",
  states: {
    lobby: {
      on: {
        JOIN: { guard: { type: "legal", params: { phase: "lobby" } }, actions: "doJoin" },
        LEAVE: { guard: { type: "legal", params: { phase: "lobby" } }, actions: "doLeave" },
        SEAT: { guard: { type: "legal", params: { phase: "lobby" } }, actions: "doSeat" },
        ASSIGN_PASSPORT: {
          guard: { type: "legal", params: { phase: "lobby" } },
          actions: "doAssignPassport",
        },
        BEGIN_JANUARY: {
          guard: { type: "legal", params: { phase: "lobby" } },
          actions: "doBeginJanuary",
        },
        RESOLVE_DOOR_14: {
          guard: { type: "legal", params: { phase: "lobby" } },
          actions: "doResolveDoor14",
        },
        START_GAME: {
          guard: { type: "legal", params: { phase: "lobby" } },
          actions: "doStartGame",
          target: "setup",
        },
      },
    },
    setup: {
      initial: "legacy",
      always: {
        guard: "isOver",
        target: "over",
      },
      states: {
        legacy: {
          always: {
            guard: "legacyReady",
            actions: "doPrepareThreat",
            target: "threat",
          },
          on: {
            DECIDE: {
              guard: { type: "legal", params: { phase: "setup.legacy" } },
              actions: "doDecide",
            },
          },
        },
        threat: {
          always: {
            guard: "openingThreatsDone",
            target: "events",
          },
          on: {
            FLIP_OPENING_THREAT: {
              guard: { type: "legal", params: { phase: "setup.threat" } },
              actions: "doFlipOpeningThreat",
            },
            DECIDE: {
              guard: { type: "legal", params: { phase: "setup.threat" } },
              actions: "doDecide",
            },
          },
        },
        events: {
          on: {
            PICK_EVENTS: {
              guard: { type: "legal", params: { phase: "setup.events" } },
              actions: "doPickEvents",
            },
            CONFIRM_EVENTS: {
              guard: { type: "legal", params: { phase: "setup.events" } },
              actions: "doConfirmEvents",
              target: "aliases",
            },
          },
        },
        aliases: {
          always: {
            guard: "aliasesDone",
            target: "#pandemicSeason0.playing",
          },
          on: {
            CHOOSE_ALIAS: {
              guard: { type: "legal", params: { phase: "setup.aliases" } },
              actions: "doChooseAlias",
            },
          },
        },
      },
    },
    playing: {
      initial: "surveillance",
      always: {
        guard: "isOver",
        target: "over",
      },
      states: {
        surveillance: {
          always: {
            guard: "surveillanceDone",
            target: "actions",
          },
          on: {
            BEGIN_TURN: {
              guard: { type: "legal", params: { phase: "playing.surveillance" } },
              actions: "doBeginTurn",
            },
            PLAY: {
              guard: { type: "legal", params: { phase: "playing.surveillance" } },
              actions: { type: "doPlay", params: { phase: "playing.surveillance" } },
            },
            DECIDE: {
              guard: { type: "legal", params: { phase: "playing.surveillance" } },
              actions: "doDecide",
            },
          },
        },
        actions: {
          on: {
            ACTION: {
              guard: { type: "legal", params: { phase: "playing.actions" } },
              actions: "doAction",
            },
            PLAY: {
              guard: { type: "legal", params: { phase: "playing.actions" } },
              actions: { type: "doPlay", params: { phase: "playing.actions" } },
            },
            DECIDE: {
              guard: { type: "legal", params: { phase: "playing.actions" } },
              actions: "doDecide",
            },
            UNDO: {
              guard: { type: "legal", params: { phase: "playing.actions" } },
              actions: "doUndo",
            },
            END_ACTIONS: {
              guard: { type: "legal", params: { phase: "playing.actions" } },
              actions: "doEndActions",
              target: "draw",
            },
          },
        },
        draw: {
          always: {
            guard: "drawStepDone",
            actions: "doStartThreatStep",
            target: "threat",
          },
          on: {
            DRAW_PLAYER_CARDS: {
              guard: { type: "legal", params: { phase: "playing.draw" } },
              actions: "doDrawPlayerCards",
            },
            PLAY: {
              guard: { type: "legal", params: { phase: "playing.draw" } },
              actions: { type: "doPlay", params: { phase: "playing.draw" } },
            },
            DECIDE: {
              guard: { type: "legal", params: { phase: "playing.draw" } },
              actions: "doDecide",
            },
          },
        },
        threat: {
          always: {
            guard: "threatStepDone",
            actions: "doFinishTurn",
            target: "surveillance",
          },
          on: {
            DRAW_THREAT: {
              guard: { type: "legal", params: { phase: "playing.threat" } },
              actions: "doDrawThreat",
            },
            PLAY: {
              guard: { type: "legal", params: { phase: "playing.threat" } },
              actions: { type: "doPlay", params: { phase: "playing.threat" } },
            },
            DECIDE: {
              guard: { type: "legal", params: { phase: "playing.threat" } },
              actions: "doDecide",
            },
          },
        },
      },
    },
    over: {
      on: {
        CONTINUE: {
          guard: { type: "legal", params: { phase: "over" } },
          actions: "doResolvePostgame",
          target: "postgame",
        },
      },
    },
    postgame: {
      always: [
        { guard: "postgameToFinished", target: "finished" },
        { guard: "postgameToLobby", actions: "doCloseGame", target: "lobby" },
        { guard: "postgameToUpkeep", target: "upkeep" },
      ],
      on: {
        DECIDE: {
          guard: { type: "legal", params: { phase: "postgame" } },
          actions: "doDecide",
        },
      },
    },
    upkeep: {
      always: {
        guard: "upkeepDone",
        actions: "doCloseGame",
        target: "lobby",
      },
      on: {
        PURCHASE: {
          guard: { type: "legal", params: { phase: "upkeep" } },
          actions: "doPurchase",
        },
        REFUND: {
          guard: { type: "legal", params: { phase: "upkeep" } },
          actions: "doRefund",
        },
        RESOLVE_DOOR_14: {
          guard: { type: "legal", params: { phase: "upkeep" } },
          actions: "doResolveDoor14",
        },
        DECIDE: {
          guard: { type: "legal", params: { phase: "upkeep" } },
          actions: "doDecide",
        },
        FINISH_UPKEEP: {
          guard: { type: "legal", params: { phase: "upkeep" } },
          actions: "doMarkUpkeepDone",
        },
      },
    },
    finished: {
      type: "final",
    },
  },
});

export type GameActor = ReturnType<typeof createActor<typeof gameMachine>>;

export function phaseOf(value: unknown): Phase {
  if (typeof value === "string") return value as Phase;
  if (value && typeof value === "object") {
    const [parent, child] = Object.entries(value)[0] as [string, string];
    return `${parent}.${child}` as Phase;
  }
  return "lobby";
}

function stateValueFromPhase(phase: Phase): string | Record<string, string> {
  if (!phase.includes(".")) return phase;
  const [parent, child] = phase.split(".") as [string, string];
  return { [parent]: child };
}

export function createGameActor(options: { seed?: number; save?: Save } = {}): GameActor {
  if (options.save) {
    const resolved = gameMachine.resolveState({
      value: stateValueFromPhase(options.save.phase),
      context: { world: structuredClone(options.save.world), undo: [] },
    });
    const actor = createActor(gameMachine, { snapshot: resolved, input: {} });
    actor.start();
    return actor;
  }
  const actor = createActor(gameMachine, { input: { seed: options.seed ?? 1 } });
  actor.start();
  return actor;
}

export function toSave(actor: GameActor): Save {
  const snap = actor.getSnapshot();
  return {
    version: 1,
    phase: phaseOf(snap.value),
    world: structuredClone(snap.context.world),
  };
}

export function parseSave(raw: unknown): Save {
  if (!raw || typeof raw !== "object") throw new Error("Invalid save: expected object");
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) throw new Error(`Unsupported save version: ${String(obj.version)}`);
  if (typeof obj.phase !== "string") throw new Error("Invalid save: missing phase");
  if (!obj.world || typeof obj.world !== "object") throw new Error("Invalid save: missing world");
  return obj as Save;
}

export function describeMonth(month: number, attempt: 1 | 2): string {
  const name = pack.monthNames[month] ?? `Month ${month}`;
  return month === 0 ? name : `${name} (Attempt ${attempt})`;
}
