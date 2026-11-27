import type { GameSession } from "./engine";
import { createGameSession, stackSummary } from "./engine";
import { phaseOf } from "./helpers";
import type { PlayerId } from "./ids";
import { optionsFor } from "./options";
import type { Phase } from "./state";

export type AutoSetupOptions = {
  seed?: number;
  players?: { id: PlayerId; name: string }[];
  sabikChoice?: "accept" | "decline";
};

/**
 * Helper that runs any session forward across setup / legacy / postgame / upkeep using legal options.
 * Useful for staged testing of specific months, player counts (2p/3p/4p), and CIA vs Sabik branches.
 */
export function advanceThroughMonth(
  session: GameSession,
  options: {
    sabikChoice?: "accept" | "decline";
    forceLose?: boolean;
    maxSteps?: number;
  } = {},
): Phase {
  const maxSteps = options.maxSteps ?? 4000;
  let steps = 0;
  let started = false;

  const dispatchOrThrow = (cmd: Parameters<GameSession["dispatch"]>[0]) => {
    const res = session.dispatch(cmd);
    if (!res.ok) {
      throw new Error(
        `advanceThroughMonth rejected ${cmd.type} in ${phaseOf(session.state.world)}: ${res.error}`,
      );
    }
  };

  while (steps++ < maxSteps) {
    const { world, undo } = session.state;
    const phase = phaseOf(world);
    if (phase === "finished") return phase;
    if (started && phase === "lobby") return "lobby";

    const lead = world.table.seats[0]?.player;
    if (!lead) throw new Error("No players joined");

    if (phase === "lobby") {
      started = true;
      dispatchOrThrow({ type: "START_GAME", player: lead });
      continue;
    }

    if (phase === "over") {
      dispatchOrThrow({ type: "CONTINUE", player: lead });
      continue;
    }

    if (phase === "upkeep") {
      for (const s of world.table.seats) {
        const opts = optionsFor(world, s.player, undo.length);
        const dec = opts.find((o) => o.category === "decision");
        if (dec) {
          dispatchOrThrow(dec.command);
          break;
        }
        const fin = opts.find((o) => o.key === "finish-upkeep");
        if (fin) {
          dispatchOrThrow(fin.command);
          break;
        }
      }
      if (phaseOf(session.state.world) === "lobby") return "lobby";
      continue;
    }

    if (phase === "postgame") {
      let acted = false;
      for (const ts of world.table.seats) {
        const opts = optionsFor(world, ts.player, undo.length);
        if (opts[0]) {
          dispatchOrThrow(opts[0].command);
          acted = true;
          break;
        }
      }
      if (acted) continue;
      throw new Error(`Stuck in postgame: stack=${JSON.stringify(stackSummary(world))}`);
    }

    if (phase === "setup.legacy") {
      const opts = optionsFor(world, lead, undo.length);
      const sabik =
        options.sabikChoice &&
        opts.find((o) => o.key === `sabik-offer:${options.sabikChoice}`);
      const pick = sabik ?? opts[0];
      if (!pick) throw new Error("Stuck in setup.legacy with no options");
      dispatchOrThrow(pick.command);
      continue;
    }

    if (phase === "setup.threat") {
      const opts = optionsFor(world, lead, undo.length);
      const pick = opts.find((o) => o.category === "decision") ?? opts[0];
      if (!pick) throw new Error("Stuck in setup.threat");
      dispatchOrThrow(pick.command);
      continue;
    }

    if (phase === "setup.events") {
      dispatchOrThrow({ type: "CONFIRM_EVENTS", player: lead });
      continue;
    }

    if (phase === "setup.aliases") {
      for (const ts of world.table.seats) {
        const opts = optionsFor(world, ts.player, undo.length);
        if (opts[0]) {
          dispatchOrThrow(opts[0].command);
          break;
        }
      }
      continue;
    }

    if (phase.startsWith("playing.")) {
      const g = world.game!;
      let acted = false;
      for (const ts of world.table.seats) {
        const opts = optionsFor(world, ts.player, undo.length);
        const dec = opts.find((o) => o.category === "decision");
        if (dec) {
          dispatchOrThrow(dec.command);
          acted = true;
          break;
        }
      }
      if (acted) continue;

      const activePlayer = world.table.seats.find((s) => s.seat === g.active)!.player;
      if (phase === "playing.surveillance") {
        dispatchOrThrow({ type: "BEGIN_TURN", player: activePlayer });
        continue;
      }
      if (phase === "playing.actions") {
        dispatchOrThrow({ type: "END_ACTIONS", player: activePlayer });
        continue;
      }
      if (phase === "playing.draw") {
        dispatchOrThrow({ type: "DRAW_PLAYER_CARDS", player: activePlayer });
        continue;
      }
      if (phase === "playing.threat") {
        dispatchOrThrow({ type: "DRAW_THREAT", player: activePlayer });
        continue;
      }
    }
  }
  throw new Error(`advanceThroughMonth exceeded ${maxSteps} steps`);
}

/** Creates a fresh campaign with `playerCount` (2..4) players already seated in lobby. */
export function createSeatedCampaign(playerCount: 2 | 3 | 4 = 3, seed = 1): GameSession {
  const session = createGameSession({ seed });
  for (let i = 1; i <= playerCount; i++) {
    const res = session.dispatch({ type: "JOIN", player: `p${i}`, name: `Agent ${i}` });
    if (!res.ok) throw new Error(`Failed to join p${i}: ${res.error}`);
  }
  return session;
}
