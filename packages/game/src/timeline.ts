import type {
  Affiliation,
  CityId,
  InfiltrationSiteId,
  PassportColor,
  RegionId,
  RoomId,
  SeatId,
  TeamId,
} from "./ids";
import type { Phase } from "./machine";
import type { LogEntry, ReadingKind, World } from "./state";

/**
 * Ordered UI/animation cues derived from a single XState transition.
 * Consumed by future UI/animation layers without reverse-engineering raw state diffs.
 */
export type AnimationCue =
  | { cue: "phase-change"; from: Phase; to: Phase }
  | { cue: "reading-modal"; readingId: number; kind: ReadingKind; ref: string; title: string }
  | { cue: "pawn-move"; seat: SeatId; from: CityId; to: CityId; by: string }
  | { cue: "team-move"; team: TeamId; from: CityId | null; to: CityId; by: string }
  | { cue: "agents-changed"; city: CityId; from: number; to: number }
  | { cue: "cubes-changed"; city: CityId; from: number; to: number }
  | { cue: "safehouse-changed"; city: CityId; present: boolean }
  | { cue: "incident"; city: CityId; bottomCard: string; title: string; detail: string }
  | { cue: "outbreak"; city: CityId; chain: boolean }
  | { cue: "escalation"; step: string; detail: string }
  | { cue: "satellite"; region: RegionId; action: "launched" | "disabled" | "removed" | "destroyed" }
  | { cue: "cover-scratch"; seat: SeatId; result: string; source: string }
  | { cue: "alias-burned"; seat: SeatId; passport: PassportColor; alias: Affiliation }
  | { cue: "infiltration-step"; seat: SeatId; site: InfiltrationSiteId; room: RoomId; detail: string }
  | { cue: "objective-resolved"; objective: string; status: "completed" | "failed"; detail: string }
  | { cue: "game-ended"; reason: string };

/** Computes ordered UI animation cues for a transition from `(before, phaseBefore)` to `(after, phaseAfter)`. */
export function buildAnimationCues(
  before: World,
  phaseBefore: Phase,
  after: World,
  phaseAfter: Phase,
): AnimationCue[] {
  const cues: AnimationCue[] = [];

  if (phaseBefore !== phaseAfter) {
    cues.push({ cue: "phase-change", from: phaseBefore, to: phaseAfter });
  }

  const prevLogLen = before.game?.log.length ?? 0;
  const newLogs: LogEntry[] = after.game ? after.game.log.slice(prevLogLen) : [];

  for (const entry of newLogs) {
    switch (entry.t) {
      case "reading":
        cues.push({
          cue: "reading-modal",
          readingId: entry.readingId,
          kind: entry.kind,
          ref: entry.ref,
          title: entry.title,
        });
        break;
      case "move":
        cues.push({
          cue: "pawn-move",
          seat: entry.seat,
          from: entry.from,
          to: entry.to,
          by: entry.by,
        });
        break;
      case "team-move":
        cues.push({
          cue: "team-move",
          team: entry.team,
          from: entry.from,
          to: entry.to,
          by: entry.by,
        });
        break;
      case "incident":
        cues.push({
          cue: "incident",
          city: entry.city,
          bottomCard: entry.bottomCard,
          title: entry.title,
          detail: entry.detail,
        });
        break;
      case "outbreak":
        cues.push({ cue: "outbreak", city: entry.city, chain: entry.chain });
        break;
      case "escalation":
        cues.push({ cue: "escalation", step: entry.step, detail: entry.detail });
        break;
      case "satellite":
        cues.push({ cue: "satellite", region: entry.region, action: entry.action });
        break;
      case "cover":
        cues.push({
          cue: "cover-scratch",
          seat: entry.seat,
          result: entry.result,
          source: entry.source,
        });
        break;
      case "burned":
        cues.push({
          cue: "alias-burned",
          seat: entry.seat,
          passport: entry.passport,
          alias: entry.alias,
        });
        break;
      case "infiltration":
        cues.push({
          cue: "infiltration-step",
          seat: entry.seat,
          site: entry.site,
          room: entry.room,
          detail: entry.detail,
        });
        break;
      case "objective":
        cues.push({
          cue: "objective-resolved",
          objective: entry.objective,
          status: entry.status,
          detail: entry.detail,
        });
        break;
      case "end":
        cues.push({ cue: "game-ended", reason: entry.reason });
        break;
      default:
        break;
    }
  }

  // Board piece deltas for animating counters (agents, cubes, safehouses)
  if (before.game && after.game) {
    for (const city of Object.keys(after.game.locations) as CityId[]) {
      const prev = before.game.locations[city];
      const next = after.game.locations[city];
      if (prev.agents !== next.agents) {
        cues.push({ cue: "agents-changed", city, from: prev.agents, to: next.agents });
      }
      if (prev.diseaseCubes !== next.diseaseCubes) {
        cues.push({ cue: "cubes-changed", city, from: prev.diseaseCubes, to: next.diseaseCubes });
      }
      if (prev.safehouse !== next.safehouse) {
        cues.push({ cue: "safehouse-changed", city, present: next.safehouse });
      }
    }
  }

  return cues;
}
