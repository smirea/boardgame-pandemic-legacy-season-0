import type { GameActor, Phase } from "./machine";
import { createGameActor, phaseOf } from "./machine";
import { optionsFor } from "./options";
import type { PlayerId } from "./ids";

export type AutoSetupOptions = {
  seed?: number;
  players?: { id: PlayerId; name: string }[];
  sabikChoice?: "accept" | "decline";
};

/**
 * Helper that runs any actor forward across setup / legacy / postgame / upkeep using legal options.
 * Useful for staged testing of specific months, player counts (2p/3p/4p), and CIA vs Sabik branches.
 */
export function advanceThroughMonth(
  actor: GameActor,
  options: {
    sabikChoice?: "accept" | "decline";
    forceLose?: boolean;
    maxSteps?: number;
  } = {},
): Phase {
  const maxSteps = options.maxSteps ?? 4000;
  let steps = 0;
  let started = false;

  while (steps++ < maxSteps) {
    const snap = actor.getSnapshot();
    const phase = phaseOf(snap.value);
    const world = snap.context.world;
    if (phase === "finished") return phase;
    if (started && phase === "lobby") return "lobby";

    const lead = world.table.seats[0]?.player;
    if (!lead) throw new Error("No players joined");

    if (phase === "lobby") {
      started = true;
      actor.send({ type: "START_GAME", player: lead });
      continue;
    }

    if (phase === "over") {
      actor.send({ type: "CONTINUE", player: lead });
      continue;
    }

    if (phase === "upkeep") {
      for (const s of world.table.seats) {
        const opts = optionsFor(world, phase, s.player, snap.context.undo.length);
        const dec = opts.find((o) => o.category === "decision");
        if (dec) {
          actor.send(dec.command);
          break;
        }
        const fin = opts.find((o) => o.key === "finish-upkeep");
        if (fin) {
          actor.send(fin.command);
          break;
        }
      }
      if (phaseOf(actor.getSnapshot().value) === "lobby") return "lobby";
      continue;
    }

    if (phase === "postgame") {
      let acted = false;
      for (const ts of world.table.seats) {
        const opts = optionsFor(world, phase, ts.player, snap.context.undo.length);
        if (opts[0]) {
          actor.send(opts[0].command);
          acted = true;
          break;
        }
      }
      if (acted) continue;
      throw new Error(`Stuck in postgame: pending=${JSON.stringify(world.game?.pending[0])}, coverQueue=${world.game?.coverQueue.length}`);
    }

    if (phase === "setup.legacy") {
      const opts = optionsFor(world, phase, lead, snap.context.undo.length);
      const sabik =
        options.sabikChoice &&
        opts.find((o) => o.key === `sabik-offer:${options.sabikChoice}`);
      const pick = sabik ?? opts[0];
      if (!pick) throw new Error(`Stuck in setup.legacy with no options`);
      actor.send(pick.command);
      continue;
    }

    if (phase === "setup.threat") {
      const opts = optionsFor(world, phase, lead, snap.context.undo.length);
      const pick = opts.find((o) => o.category === "decision") ?? opts[0];
      if (!pick) throw new Error("Stuck in setup.threat");
      actor.send(pick.command);
      continue;
    }

    if (phase === "setup.events") {
      actor.send({ type: "CONFIRM_EVENTS", player: lead });
      continue;
    }

    if (phase === "setup.aliases") {
      for (const ts of world.table.seats) {
        const opts = optionsFor(world, phase, ts.player, snap.context.undo.length);
        if (opts[0]) {
          actor.send(opts[0].command);
          break;
        }
      }
      continue;
    }

    if (phase.startsWith("playing.")) {
      const g = world.game!;
      // Check if any player owns a pending decision first
      let acted = false;
      for (const ts of world.table.seats) {
        const opts = optionsFor(world, phase, ts.player, snap.context.undo.length);
        const dec = opts.find((o) => o.category === "decision");
        if (dec) {
          actor.send(dec.command);
          acted = true;
          break;
        }
      }
      if (acted) continue;

      const activePlayer = world.table.seats.find((s) => s.seat === g.active)!.player;
      if (phase === "playing.surveillance") {
        actor.send({ type: "BEGIN_TURN", player: activePlayer });
        continue;
      }
      if (phase === "playing.actions") {
        actor.send({ type: "END_ACTIONS", player: activePlayer });
        continue;
      }
      if (phase === "playing.draw") {
        actor.send({ type: "DRAW_PLAYER_CARDS", player: activePlayer });
        continue;
      }
      if (phase === "playing.threat") {
        actor.send({ type: "DRAW_THREAT", player: activePlayer });
        continue;
      }
    }
  }
  throw new Error(`advanceThroughMonth exceeded ${maxSteps} steps`);
}

/** Creates a fresh campaign with `playerCount` (2..4) players already seated in lobby. */
export function createSeatedCampaign(playerCount: 2 | 3 | 4 = 3, seed = 1): GameActor {
  const actor = createGameActor({ seed });
  for (let i = 1; i <= playerCount; i++) {
    actor.send({ type: "JOIN", player: `p${i}`, name: `Agent ${i}` });
  }
  return actor;
}
