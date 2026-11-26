import type {
  Affiliation,
  AssetId,
  CardId,
  CityId,
  Command,
  EventId,
  OccupationId,
  PassportColor,
  Phase,
  PlayerId,
  RegionId,
  RoomId,
  SeatId,
  TeamId,
  World,
} from "@repo/game";
import { cityOfCard, optionsFor, pack, PASSPORT_COLORS, seatOfPlayer } from "@repo/game";

export type ParsedDo =
  | { kind: "single"; command: Command }
  | { kind: "batch"; batch: "flip-all-threats" | "draw-all-threats" | "resolve-escalation" }
  | { kind: "error"; message: string };

function findCityCardInHand(world: World, seat: SeatId, cityOrId: string): CardId | null {
  const g = world.game;
  if (!g) return null;
  const hand = g.players[seat].hand;
  if (hand.includes(cityOrId)) return cityOrId;
  const byCity = hand.find((id) => cityOfCard(g, id) === cityOrId);
  return byCity ?? null;
}

function findCardInHand(world: World, seat: SeatId, token: string): CardId | null {
  const g = world.game;
  if (!g) return null;
  const hand = g.players[seat].hand;
  if (hand.includes(token)) return token;
  if (hand.includes(`city:${token}`)) return `city:${token}`;
  if (hand.includes(`event:${token}`)) return `event:${token}`;
  return null;
}

function findCityCardInDiscard(world: World, cityOrId: string): CardId | null {
  const g = world.game;
  if (!g) return null;
  if (g.playerDiscard.includes(cityOrId)) return cityOrId;
  return g.playerDiscard.find((id) => cityOfCard(g, id) === cityOrId) ?? null;
}

/** Parses a CLI `do <args...>` expression into a concrete @repo/game Command (or batch helper). */
export function parseDoCommand(
  world: World,
  phase: Phase,
  player: PlayerId,
  undoDepth: number,
  rawArgs: string[],
): ParsedDo {
  // Strip optional `why: ...` suffix
  const whyIdx = rawArgs.findIndex((a) => a === "why:" || a.startsWith("why:"));
  const args = whyIdx === -1 ? rawArgs : rawArgs.slice(0, whyIdx);
  if (args.length === 0) return { kind: "error", message: "Missing command after 'do'" };

  const head = args[0]!;

  // 1. Batch convenience commands (still execute every individual XState transition!)
  if (head === "flip-all-threats") return { kind: "batch", batch: "flip-all-threats" };
  if (head === "draw-all-threats") return { kind: "batch", batch: "draw-all-threats" };
  if (head === "resolve-escalation") return { kind: "batch", batch: "resolve-escalation" };

  // 2. Raw JSON escape hatch
  if (head === "raw") {
    const jsonStr = args.slice(1).join(" ");
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      return { kind: "single", command: { player, ...parsed } as Command };
    } catch (err) {
      return { kind: "error", message: `Invalid raw JSON: ${String(err)}` };
    }
  }

  // 3. Exact match against enumerated optionsFor keys!
  if (args.length === 1) {
    const opts = optionsFor(world, phase, player, undoDepth);
    const exact = opts.find((o) => o.key === head);
    if (exact) return { kind: "single", command: exact.command };
  }

  const seat = seatOfPlayer(world, player);
  const g = world.game;

  // 4. Custom parameterized commands for full flexibility across all cities/cards/events/choices
  if (head === "pick-events") {
    const evList = (args[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as EventId[];
    let discretionaryBoxes = 0;
    for (const tok of args.slice(2)) {
      if (tok.startsWith("disc=")) discretionaryBoxes = Number(tok.slice(5));
    }
    return {
      kind: "single",
      command: { type: "PICK_EVENTS", player, events: evList, discretionaryBoxes },
    };
  }

  if (head === "psych") {
    const answers: Record<number, "AGREE" | "DISAGREE" | 1 | 2 | 3 | 4 | 5> = {};
    // Accept either `psych legacy/01-05 1=AGREE 2=DISAGREE` or `psych 1=AGREE 2=DISAGREE`
    const tokens = args.slice(1).filter((t) => t.includes("="));
    for (const tok of tokens) {
      const [k, v] = tok.split("=");
      const qNum = Number(k);
      if (!Number.isInteger(qNum) || !v) continue;
      const upper = v.toUpperCase();
      if (upper === "AGREE" || upper === "DISAGREE") {
        answers[qNum] = upper;
      } else {
        answers[qNum] = Number(v) as 1 | 2 | 3 | 4 | 5;
      }
    }
    return {
      kind: "single",
      command: { type: "DECIDE", player, answer: { t: "psych-questions", answers } },
    };
  }

  if (head === "create-aliases") {
    // Format: create-aliases <aff> black=<name>:<occ> green=<name>:<occ> pink=<name>:<occ> white=<name>:<occ>
    const entries = {} as Record<PassportColor, { name: string; occupation: OccupationId }>;
    for (const tok of args.slice(1)) {
      if (!tok.includes("=")) continue;
      const [color, rest] = tok.split("=") as [PassportColor, string];
      if (!PASSPORT_COLORS.includes(color) || !rest) continue;
      const [name, occ] = rest.split(":");
      if (name && occ) entries[color] = { name, occupation: occ as OccupationId };
    }
    return {
      kind: "single",
      command: { type: "DECIDE", player, answer: { t: "create-aliases", entries } },
    };
  }

  if (head === "assign-passport" && args.length >= 3) {
    return {
      kind: "single",
      command: {
        type: "ASSIGN_PASSPORT",
        player,
        seat: args[1] as SeatId,
        passport: args[2] as PassportColor,
      },
    };
  }

  if (!g || !seat) {
    return { kind: "error", message: `Unknown or currently unavailable option '${head}'` };
  }

  // Action shortcuts with custom parameters
  if (head.startsWith("drive-carry:")) {
    const [, to, teamsRaw] = head.split(":");
    const carryTeams = (teamsRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as TeamId[];
    return {
      kind: "single",
      command: { type: "ACTION", player, action: { a: "drive", to: to as CityId, carryTeams } },
    };
  }

  if (head.startsWith("unrecorded:")) {
    const to = head.slice("unrecorded:".length) as CityId;
    const ownCard = findCityCardInHand(world, seat, g.players[seat].location);
    if (!ownCard) return { kind: "error", message: "You do not hold your current city's card" };
    return {
      kind: "single",
      command: { type: "ACTION", player, action: { a: "unrecorded-flight", card: ownCard, to } },
    };
  }

  if (head.startsWith("fly:")) {
    const to = head.slice("fly:".length) as CityId;
    const card = findCityCardInHand(world, seat, to);
    if (!card) return { kind: "error", message: `You do not hold the City card for ${to}` };
    const extraTok = args.find((a) => a.startsWith("extra:"));
    const extraCard = extraTok ? findCardInHand(world, seat, extraTok.slice(6)) ?? undefined : undefined;
    return {
      kind: "single",
      command: { type: "ACTION", player, action: { a: "commercial-flight", card, extraCard } },
    };
  }

  if (head.startsWith("identify:")) {
    const [, objId, cardsRaw] = head.split(":");
    const cards = (cardsRaw ?? "")
      .split(",")
      .map((c) => findCityCardInHand(world, seat, c.trim()))
      .filter((x): x is CardId => x !== null);
    return {
      kind: "single",
      command: {
        type: "ACTION",
        player,
        action: { a: "identify-target-city", objective: objId!, cards },
      },
    };
  }

  if (head.startsWith("assemble-team:")) {
    const cardsRaw = head.slice("assemble-team:".length);
    const cards = cardsRaw
      .split(",")
      .map((c) => findCityCardInHand(world, seat, c.trim()))
      .filter((x): x is CardId => x !== null);
    const relTok = args.find((a) => a.startsWith("relocate:"));
    const relocateTeam = relTok ? (relTok.slice(9) as TeamId) : undefined;
    return {
      kind: "single",
      command: { type: "ACTION", player, action: { a: "assemble-team", cards, relocateTeam } },
    };
  }

  if (head.startsWith("complete-infiltration:")) {
    const [, objId, cardsRaw] = head.split(":");
    const cards = (cardsRaw ?? "")
      .split(",")
      .map((c) => findCityCardInHand(world, seat, c.trim()))
      .filter((x): x is CardId => x !== null);
    return {
      kind: "single",
      command: {
        type: "ACTION",
        player,
        action: { a: "complete-infiltration-objective", objective: objId!, cards },
      },
    };
  }

  if (head.startsWith("unlock-hatchway:")) {
    const [, edgeId, cardsRaw] = head.split(":");
    const cards = (cardsRaw ?? "")
      .split(",")
      .map((c) => findCityCardInHand(world, seat, c.trim()))
      .filter((x): x is CardId => x !== null);
    return {
      kind: "single",
      command: { type: "ACTION", player, action: { a: "unlock-hatchway", edgeId: edgeId!, cards } },
    };
  }

  if (head.startsWith("infiltrate:")) {
    const [, to, cardsRaw] = head.split(":");
    const revealCards = (cardsRaw ?? "")
      .split(",")
      .filter(Boolean)
      .map((c) => findCityCardInHand(world, seat, c.trim()))
      .filter((x): x is CardId => x !== null);
    return {
      kind: "single",
      command: {
        type: "ACTION",
        player,
        action: { a: "infiltrate", to: to as RoomId, revealCards },
      },
    };
  }

  if (head.startsWith("coord-team:")) {
    const [, team, to] = head.split(":");
    return {
      kind: "single",
      command: {
        type: "ACTION",
        player,
        action: { a: "coordinator-move", target: { kind: "team", team: team! }, to: to as CityId },
      },
    };
  }

  if (head.startsWith("coord-pawn:")) {
    const [, targetSeat, to] = head.split(":");
    return {
      kind: "single",
      command: {
        type: "ACTION",
        player,
        action: {
          a: "coordinator-move",
          target: { kind: "pawn", seat: targetSeat as SeatId },
          to: to as CityId,
        },
      },
    };
  }

  if (head.startsWith("clinic-fly:")) {
    const [, cardCity, to] = head.split(":");
    const card = findCityCardInHand(world, seat, cardCity!);
    if (!card) return { kind: "error", message: `Card ${cardCity} not in hand` };
    return {
      kind: "single",
      command: { type: "ACTION", player, action: { a: "clinic-planner-flight", card, to: to as CityId } },
    };
  }

  if (head.startsWith("buy:asset:")) {
    const [, , asset, passport, affiliation, city] = head.split(":");
    return {
      kind: "single",
      command: {
        type: "PURCHASE",
        player,
        purchase: {
          t: "asset",
          asset: asset as AssetId,
          passport: passport as PassportColor,
          affiliation: affiliation as Affiliation,
          city: city as CityId | undefined,
        },
      },
    };
  }

  // Event cards with custom targets
  if (head.startsWith("play:holdover:")) {
    const city = head.slice("play:holdover:".length) as CityId;
    const relTok = args.find((a) => a.startsWith("relocate:"));
    const relocateFrom = relTok ? (relTok.slice(9) as CityId) : undefined;
    return {
      kind: "single",
      command: { type: "PLAY", player, play: { e: "a-holdover-from-the-war", city, relocateFrom } },
    };
  }

  if (head.startsWith("play:airlift:")) {
    const [, , targetId, to] = head.split(":");
    const isSeat = targetId?.startsWith("seat-");
    return {
      kind: "single",
      command: {
        type: "PLAY",
        player,
        play: {
          e: "airlift",
          target: isSeat
            ? { kind: "pawn", seat: targetId as SeatId }
            : { kind: "team", team: targetId! },
          to: to as CityId,
        },
      },
    };
  }

  if (head.startsWith("play:bureaucratic:")) {
    const targets = head
      .slice("play:bureaucratic:".length)
      .split(/[,+]/)
      .filter(Boolean) as CityId[];
    return {
      kind: "single",
      command: { type: "PLAY", player, play: { e: "bureaucratic-entanglements", targets } },
    };
  }

  if (head.startsWith("play:trial-vaccine:")) {
    const targets = head
      .slice("play:trial-vaccine:".length)
      .split(/[,+]/)
      .filter(Boolean) as CityId[];
    return {
      kind: "single",
      command: { type: "PLAY", player, play: { e: "trial-vaccine", targets } },
    };
  }

  if (head.startsWith("play:spectrum-interference:")) {
    const regions = head
      .slice("play:spectrum-interference:".length)
      .split(/[,+]/)
      .filter(Boolean) as RegionId[];
    return {
      kind: "single",
      command: { type: "PLAY", player, play: { e: "spectrum-interference", regions } },
    };
  }

  if (head.startsWith("play:diversion:")) {
    const body = head.slice("play:diversion:".length);
    const [srcPart, destPart] = body.split("->");
    const sources = (srcPart ?? "").split(/[,+]/).filter(Boolean) as CityId[];
    return {
      kind: "single",
      command: { type: "PLAY", player, play: { e: "diversion", sources, to: destPart as CityId } },
    };
  }

  if (head.startsWith("play:scramble-teams:")) {
    const moves = head
      .slice("play:scramble-teams:".length)
      .split(",")
      .filter(Boolean)
      .map((pair) => {
        const [team, to] = pair.split("=");
        return { team: team!, to: to as CityId };
      });
    return {
      kind: "single",
      command: { type: "PLAY", player, play: { e: "scramble-teams", moves } },
    };
  }

  if (head.startsWith("play:encoded-messages:")) {
    const [, , seatA, cA, seatB, cB] = head.split(":");
    const cardA = findCardInHand(world, seatA as SeatId, cA!);
    const cardB = findCardInHand(world, seatB as SeatId, cB!);
    if (!cardA || !cardB) return { kind: "error", message: "Could not find specified cards in hands" };
    return {
      kind: "single",
      command: {
        type: "PLAY",
        player,
        play: {
          e: "encoded-messages",
          seatA: seatA as SeatId,
          cardA,
          seatB: seatB as SeatId,
          cardB,
        },
      },
    };
  }

  if (head.startsWith("play:weekend-rendezvous:")) {
    const [, , to, seatsRaw] = head.split(":");
    const seats = (seatsRaw ?? "").split(/[,+]/).filter(Boolean) as SeatId[];
    return {
      kind: "single",
      command: {
        type: "PLAY",
        player,
        play: { e: "weekend-rendezvous", to: to as CityId, seats },
      },
    };
  }

  if (head.startsWith("forecast:")) {
    const order = head
      .slice("forecast:".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      kind: "single",
      command: { type: "DECIDE", player, answer: { t: "forecast", order } },
    };
  }

  if (head.startsWith("room:armory:")) {
    const [, , asset, city] = head.split(":");
    return {
      kind: "single",
      command: {
        type: "DECIDE",
        player,
        answer: {
          t: "room-choice",
          choice: {
            room: "lg-armory",
            skip: false,
            asset: asset as AssetId,
            city: city as CityId | undefined,
          },
        },
      },
    };
  }

  if (head.startsWith("room:directors-office:")) {
    const cards = head
      .slice("room:directors-office:".length)
      .split(/[,+]/)
      .map((c) => findCityCardInDiscard(world, c.trim()))
      .filter((x): x is CardId => x !== null);
    return {
      kind: "single",
      command: {
        type: "DECIDE",
        player,
        answer: {
          t: "room-choice",
          choice: { room: "pearl-directors-office", skip: false, cards },
        },
      },
    };
  }

  if (head.startsWith("room:swap:")) {
    const [, , tokenA, tokenB] = head.split(":");
    return {
      kind: "single",
      command: {
        type: "DECIDE",
        player,
        answer: {
          t: "room-choice",
          choice: { room: "pearl-access-panel", skip: false, tokenA: tokenA!, tokenB: tokenB! },
        },
      },
    };
  }

  // Fallback check if user tried a city name without checking pack
  void pack;
  return {
    kind: "error",
    message: `Could not parse '${args.join(" ")}'. Run 'status' to see exact legal option keys or check GUIDE.md.`,
  };
}
