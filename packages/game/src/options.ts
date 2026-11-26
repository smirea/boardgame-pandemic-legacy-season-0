import type { Action } from "./actions";
import { pack } from "./content/pack";
import { activeEventsInReserve } from "./flow";
import {
  activeContactsList,
  activeTeamsInCity,
  availableTempAliases,
  canMitigateCover,
  canSatisfySecurityTokens,
  citiesWithin,
  cityDef,
  cityOfCard,
  createdUnburnedAliases,
  currentOccupation,
  currentSpecialization,
  discardableHandCards,
  edgesOfRoom,
  findAsset,
  hasAsset,
  hasCheckpoint,
  hasRule,
  isRestrictionActive,
  isSymptomCard,
  otherRoom,
} from "./helpers";
import type {
  Affiliation,
  AssetId,
  CardId,
  CityId,
  InfiltrationSiteId,
  OccupationId,
  PassportColor,
  PlayerId,
  SeatId,
} from "./ids";
import { PASSPORT_COLORS } from "./ids";
import type { Command, Phase } from "./machine";
import { reject, seatOfPlayer } from "./machine";
import type { Answer, Play } from "./plays";
import { decisionOwner } from "./plays";
import type { Purchase, World } from "./state";

export type OptionItem = {
  key: string;
  label: string;
  category: "setup" | "turn" | "action" | "event" | "decision" | "upkeep" | "lobby";
  command: Command;
};

function addIfLegal(
  out: OptionItem[],
  world: World,
  phase: Phase,
  undoDepth: number,
  item: OptionItem,
): void {
  if (reject(world, phase, item.command, undoDepth) === null) {
    out.push(item);
  }
}

/** Finds minimal valid subset of cards from `handCityCards` satisfying `required` security symbols. */
function findSatisfyingCardSubset(
  world: World,
  seat: SeatId,
  required: readonly import("./ids").SecuritySymbol[],
  handCityCards: CardId[],
): CardId[] | null {
  if (required.length === 0) return [];
  const maxLen = Math.min(required.length, handCityCards.length);
  for (let size = 1; size <= maxLen; size++) {
    const chosen: CardId[] = [];
    const search = (start: number): boolean => {
      if (chosen.length === size) {
        return canSatisfySecurityTokens(world, seat, required, chosen);
      }
      for (let i = start; i <= handCityCards.length - (size - chosen.length); i++) {
        chosen.push(handCityCards[i]!);
        if (search(i + 1)) return true;
        chosen.pop();
      }
      return false;
    };
    if (search(0)) return [...chosen];
  }
  return null;
}

/** Finds a minimal subset of `handCityCards` whose keypad numbers sum to >= 10. */
function findHatchwayCards(world: World, handCityCards: CardId[]): CardId[] | null {
  const game = world.game!;
  const sorted = [...handCityCards].sort(
    (a, b) => cityDef(cityOfCard(game, b)!).keypad - cityDef(cityOfCard(game, a)!).keypad,
  );
  const chosen: CardId[] = [];
  let sum = 0;
  for (const id of sorted) {
    chosen.push(id);
    sum += cityDef(cityOfCard(game, id)!).keypad;
    if (sum >= 10) return chosen;
  }
  return null;
}

function defaultAliasEntries(affiliation: Affiliation): Record<PassportColor, { name: string; occupation: OccupationId }> {
  const occs = pack.occupations.filter((o) => o.affiliation === affiliation).map((o) => o.id);
  const codenames: Record<Affiliation, readonly string[]> = {
    allied: ["Dr. Carter", "Dr. Bennett", "Dr. Mercer", "Dr. Hayes"],
    neutral: ["Alex Novak", "Sasha Lind", "Robin Cruz", "Morgan Sato"],
    soviet: ["Viktor Orlov", "Elena Morozova", "Dmitri Volkov", "Nadia Petrova"],
  };
  return Object.fromEntries(
    PASSPORT_COLORS.map((color, idx) => [
      color,
      { name: codenames[affiliation][idx]!, occupation: occs[idx]! },
    ]),
  ) as Record<PassportColor, { name: string; occupation: OccupationId }>;
}

function cityCardShort(world: World, cardId: CardId): string {
  const card = world.game?.playerCards[cardId];
  if (!card) return cardId;
  if (card.kind === "city") return card.city;
  if (card.kind === "event") return card.event;
  if (card.kind === "symptom") return card.id;
  return card.kind;
}

function addDecisionOptions(
  out: OptionItem[],
  world: World,
  phase: Phase,
  player: PlayerId,
  seat: SeatId,
  undoDepth: number,
): void {
  const game = world.game;
  if (!game || game.pending.length === 0) return;
  const top = game.pending[0]!;
  const owner = decisionOwner(world);
  if (owner !== null && owner !== seat) return;

  const push = (key: string, label: string, answer: Answer) =>
    addIfLegal(out, world, phase, undoDepth, {
      key,
      label,
      category: "decision",
      command: { type: "DECIDE", player, answer },
    });

  const c = world.campaign;

  switch (top.t) {
    case "create-aliases": {
      const defaults = defaultAliasEntries(top.affiliation);
      push(
        `create-aliases:${top.affiliation}`,
        `Create ${top.affiliation} aliases (default names/occupations; or customize via JSON)`,
        { t: "create-aliases", entries: defaults },
      );
      break;
    }

    case "psych-questions": {
      const sample: Record<number, "AGREE" | "DISAGREE" | 1 | 2 | 3 | 4 | 5> = {};
      const alt: Record<number, "AGREE" | "DISAGREE" | 1 | 2 | 3 | 4 | 5> = {};
      for (const q of top.questions) {
        sample[q.number] = q.kind === "agree-disagree" ? "AGREE" : 3;
        alt[q.number] = q.kind === "agree-disagree" ? "DISAGREE" : 5;
      }
      push(
        `psych:${top.cardId}:a`,
        `Answer Psych Questions (${top.questions.map((q) => `Q${q.number}=${sample[q.number]}`).join(", ")})`,
        { t: "psych-questions", answers: sample },
      );
      push(
        `psych:${top.cardId}:b`,
        `Answer Psych Questions (${top.questions.map((q) => `Q${q.number}=${alt[q.number]}`).join(", ")})`,
        { t: "psych-questions", answers: alt },
      );
      break;
    }

    case "transmission-report":
      for (const method of ["airborne", "animal-contact", "saliva", "waterborne"] as const) {
        push(`report-transmission:${method}`, `Report MEDUSA transmission: ${method}`, {
          t: "transmission-report",
          method,
        });
      }
      break;

    case "deployment-report":
      for (const answer of ["jellyfish", "agent-sabik", "pollen", "unknown"] as const) {
        push(`report-deployment:${answer}`, `Report MEDUSA deployment: ${answer}`, {
          t: "deployment-report",
          answer,
        });
      }
      break;

    case "sabik-offer":
      push("sabik-offer:decline", "Decline Sabik's offer (stay with CIA -> Debrief 139)", {
        t: "sabik-offer",
        choice: "decline",
      });
      push("sabik-offer:accept", "Accept Sabik's offer (Open Box 0005 -> Debrief 242)", {
        t: "sabik-offer",
        choice: "accept",
      });
      break;

    case "file-report":
      for (const chosen of top.options) {
        push(`file-report:${chosen}`, `File Operations Card ${chosen} in Intelligence File`, {
          t: "file-report",
          chosen,
        });
      }
      break;

    case "door14-briefcase":
      push("door14:open", "Open the briefcase (Open Door 19)", {
        t: "door14-briefcase",
        choice: "open",
      });
      push("door14:blow-up", "Blow up the briefcase (Open Door 24)", {
        t: "door14-briefcase",
        choice: "blow-up",
      });
      push("door14:ignore", "Ignore the briefcase for now", {
        t: "door14-briefcase",
        choice: "ignore",
      });
      break;

    case "place-counter-surveillance":
      for (const ct of pack.cities) {
        if (c.cities[ct.id].surveillance > 0) {
          push(
            `counter-surv:${ct.id}`,
            `Remove 1 Surveillance from ${ct.name} (currently ${c.cities[ct.id].surveillance})`,
            { t: "place-counter-surveillance", city: ct.id },
          );
        }
      }
      break;

    case "kill-contact":
      for (const item of activeContactsList(c)) {
        const name = pack.assetById[item.asset.id].name;
        push(
          `kill-contact:${item.passport}:${item.affiliation}:${item.assetIndex}`,
          `Cross out ${name} on ${item.passport} (${item.affiliation})`,
          {
            t: "kill-contact",
            passport: item.passport,
            affiliation: item.affiliation,
            assetIndex: item.assetIndex,
          },
        );
      }
      break;

    case "free-infrared-goggles": {
      let any = false;
      for (const color of PASSPORT_COLORS) {
        for (const aff of ["allied", "neutral", "soviet"] as const) {
          const al = c.passports[color].aliases[aff];
          if (al.created && !al.burned && al.assets.length < 3) {
            any = true;
            push(
              `free-goggles:${color}:${aff}`,
              `Attach free Infrared Goggles to ${color} (${aff})`,
              { t: "free-infrared-goggles", passport: color, affiliation: aff },
            );
          }
        }
      }
      if (!any) {
        push("free-goggles:skip", "Skip Infrared Goggles (no empty Asset slots)", {
          t: "free-infrared-goggles",
          skip: true,
        });
      }
      break;
    }

    case "december-choice":
      if (top.variant === "cia-sabik") {
        push("december-choice:a", "Forcefully stop Sabik (Debrief 144)", {
          t: "december-choice",
          choice: "a",
        });
        push("december-choice:b", "Try to talk Sabik down (Debrief 164)", {
          t: "december-choice",
          choice: "b",
        });
      } else {
        push("december-choice:a", "Turn Cooper in to Sabik (Debrief 138)", {
          t: "december-choice",
          choice: "a",
        });
        push("december-choice:b", "Let Cooper go (Debrief 158)", {
          t: "december-choice",
          choice: "b",
        });
      }
      break;

    case "distribute-action-tokens":
      for (const s of game.seats) {
        push(`give-action-token:${s}`, `Give 1 Action token to ${s}`, {
          t: "distribute-action-tokens",
          seat: s,
        });
      }
      break;

    case "choose-return-symptom":
      for (const s of game.seats) {
        for (const id of game.players[s].hand) {
          if (isSymptomCard(game, id)) {
            push(`return-symptom:${s}:${id}`, `Return Symptom ${id} from ${s}`, {
              t: "choose-return-symptom",
              seat: s,
              card: id,
            });
          }
        }
      }
      break;

    case "remove-agents-board":
      for (const ct of pack.cities) {
        if (game.locations[ct.id].agents > 0) {
          push(
            `remove-agent:${ct.id}`,
            `Remove 1 agent from ${ct.name} (${game.locations[ct.id].agents} there)`,
            { t: "remove-agents-board", city: ct.id },
          );
        }
      }
      break;

    case "reveal-pearl-tokens":
      for (const tok of game.infiltrationSites.pearl?.tokens ?? []) {
        if (!tok.revealed) {
          const edge = pack.sites.pearl.edges.find((e) => e.id === tok.edgeId);
          const desc = edge
            ? `${pack.roomById[edge.a].name}<->${pack.roomById[edge.b].name}`
            : tok.edgeId;
          push(`reveal-pearl:${tok.id}`, `Reveal PEARL token on ${desc} (${tok.id})`, {
            t: "reveal-pearl-tokens",
            tokenId: tok.id,
          });
        }
      }
      break;

    case "place-free-checkpoint": {
      const relocate = game.supplies.checkpointTokens <= 0 ? game.checkpoints[0] : undefined;
      for (const ct of pack.cities) {
        for (const nb of ct.connections) {
          if (ct.id < nb && !hasCheckpoint(game, ct.id, nb)) {
            push(
              `free-checkpoint:${ct.id}:${nb}`,
              `Place Checkpoint between ${ct.name} and ${cityDef(nb).name}`,
              { t: "place-free-checkpoint", a: ct.id, b: nb, relocateFrom: relocate },
            );
          }
        }
      }
      break;
    }

    case "pick-temp-alias":
      for (const occ of availableTempAliases(game)) {
        push(`temp-alias:${occ}`, `Take Temporary Alias: ${pack.occupationById[occ].name}`, {
          t: "pick-temp-alias",
          occupation: occ,
        });
      }
      break;

    case "hand-limit":
      for (const id of discardableHandCards(game, top.seat)) {
        push(`discard:${cityCardShort(world, id)}`, `Discard ${cityCardShort(world, id)} (hand limit)`, {
          t: "hand-limit",
          card: id,
        });
      }
      break;

    case "discard-card":
      for (const id of discardableHandCards(game, top.seat)) {
        push(`discard:${cityCardShort(world, id)}`, `Discard ${cityCardShort(world, id)} (${top.source})`, {
          t: "discard-card",
          card: id,
        });
      }
      break;

    case "cover-mitigation": {
      push("cover:scratch", `Scratch 1 cover (${top.source})`, {
        t: "cover-mitigation",
        choice: "scratch",
      });
      const mit = canMitigateCover(world, top.seat);
      if (mit.suitcase) {
        push("cover:suitcase", "Prevent cover scratch with Suitcase Full of Money", {
          t: "cover-mitigation",
          choice: "suitcase",
        });
      }
      if (mit.collectiveManager) {
        for (const id of game.players[top.seat].hand) {
          if (cityOfCard(game, id)) {
            push(
              `cover:cm:${cityCardShort(world, id)}`,
              `Prevent cover scratch via Collective Manager (discard ${cityCardShort(world, id)})`,
              { t: "cover-mitigation", choice: "collective-manager", card: id },
            );
          }
        }
      }
      break;
    }

    case "choose-liability":
      for (const lib of c.availableLiabilities) {
        const def = pack.liabilityById[lib];
        const regNote = def.needsRegion ? ` [stamps region: ${pack.regionNames[top.region]}]` : "";
        push(`liability:${lib}`, `Take Liability: ${def.name}${regNote} — ${def.text}`, {
          t: "choose-liability",
          liability: lib,
        });
      }
      break;

    case "escalation":
      push(`escalation:${top.step}`, `Resolve Escalation step: ${top.step}`, { t: "escalation" });
      break;

    case "remove-safehouse":
      for (const ct of pack.cities) {
        if (ct.region === top.region && game.locations[ct.id].safehouse) {
          push(`remove-safehouse:${ct.id}`, `Remove safehouse from ${ct.name}`, {
            t: "remove-safehouse",
            city: ct.id,
          });
        }
      }
      break;

    case "forecast": {
      const keep = top.cards.map((card) => card.id);
      const reverse = [...keep].reverse();
      push(
        "forecast:keep",
        `Keep Threat order (${top.cards.map((x) => x.city).join(" -> ")}; or 'forecast:<id1>,<id2>,...' for any custom order)`,
        {
          t: "forecast",
          order: keep,
        },
      );
      if (keep.length > 1) {
        push(
          "forecast:reverse",
          `Reverse Threat order (${[...top.cards].reverse().map((x) => x.city).join(" -> ")})`,
          { t: "forecast", order: reverse },
        );
      }
      break;
    }

    case "border-security": {
      const curSeat = top.seatsLeft[0]!;
      const loc = game.players[curSeat].location;
      const relocate = game.supplies.checkpointTokens <= 0 ? game.checkpoints[0] : undefined;
      for (const nb of cityDef(loc).connections) {
        if (!hasCheckpoint(game, loc, nb)) {
          push(
            `border-checkpoint:${nb}`,
            `Place Checkpoint ${cityDef(loc).name} <-> ${cityDef(nb).name}`,
            { t: "border-security", neighbor: nb, relocateFrom: relocate },
          );
        }
      }
      push("border-checkpoint:done", "Done placing Border Security Checkpoints", {
        t: "border-security",
        done: true,
      });
      break;
    }

    case "room-choice": {
      const p = game.players[top.seat];
      switch (top.room) {
        case "pearl-loading-dock": {
          push("room:skip", "Skip Loading Dock", {
            t: "room-choice",
            choice: { room: "pearl-loading-dock", skip: true },
          });
          const trialObj = game.objectives.find(
            (o) => o.kind === "disrupt-trial" && o.status === "active",
          );
          for (const id of trialObj?.trialCardIds ?? []) {
            const ct = cityOfCard(game, id);
            if (ct) {
              push(
                `room:loading-dock:${ct}`,
                `Take ${cityDef(ct).name} trial card to hand (+ Debrief 105)`,
                { t: "room-choice", choice: { room: "pearl-loading-dock", skip: false, trialCity: ct } },
              );
            }
          }
          break;
        }
        case "pearl-control-room": {
          push("room:skip", "Skip Control Room", {
            t: "room-choice",
            choice: { room: "pearl-control-room", skip: true },
          });
          for (const id of p.hand) {
            const ct = cityOfCard(game, id);
            if (ct && game.satellites.includes(cityDef(ct).region)) {
              push(
                `room:control-room:${ct}`,
                `Discard ${cityDef(ct).name} to destroy ${pack.regionNames[cityDef(ct).region]} Satellite`,
                { t: "room-choice", choice: { room: "pearl-control-room", skip: false, card: id } },
              );
            }
          }
          break;
        }
        case "pearl-courtyard":
          push("room:courtyard:skip", "Skip Courtyard", {
            t: "room-choice",
            choice: { room: "pearl-courtyard", take: false },
          });
          push("room:courtyard:take", "Scratch 1 cover to take 2 Action tokens", {
            t: "room-choice",
            choice: { room: "pearl-courtyard", take: true },
          });
          break;
        case "pearl-archives":
          for (const id of game.playerDiscard) {
            const ct = cityOfCard(game, id);
            if (ct) {
              push(`room:archives:${ct}`, `Take ${cityDef(ct).name} from Player discard`, {
                t: "room-choice",
                choice: { room: "pearl-archives", card: id },
              });
            }
          }
          break;
        case "pearl-directors-office": {
          push("room:skip", "Skip Director's Office", {
            t: "room-choice",
            choice: { room: "pearl-directors-office", skip: true },
          });
          const cityDiscards = game.playerDiscard.filter((id) => cityOfCard(game, id) !== null);
          if (cityDiscards.length >= 1) {
            const take = cityDiscards.slice(-2);
            push(
              `room:directors-office:${take.map((id) => cityOfCard(game, id)).join("+")}`,
              `Scratch 1 cover to draw ${take.map((id) => cityDef(cityOfCard(game, id)!).name).join(" + ")}`,
              { t: "room-choice", choice: { room: "pearl-directors-office", skip: false, cards: take } },
            );
          }
          break;
        }
        case "pearl-access-panel": {
          push("room:skip", "Skip Access Panel", {
            t: "room-choice",
            choice: { room: "pearl-access-panel", skip: true },
          });
          const faceup = (game.infiltrationSites.pearl?.tokens ?? []).filter((t) => t.revealed);
          const symLabel = (sym: (typeof faceup)[number]["symbol"]) =>
            sym.kind === "keypad"
              ? `#${sym.value}`
              : sym.kind === "region"
                ? pack.regionNames[sym.region]
                : sym.affiliation.toUpperCase();
          let pushed = 0;
          for (let i = 0; i < faceup.length && pushed < 30; i++) {
            for (let j = i + 1; j < faceup.length && pushed < 30; j++) {
              const a = faceup[i]!;
              const b = faceup[j]!;
              if (a.edgeId === b.edgeId) continue;
              push(
                `room:swap:${a.id}|${b.id}`,
                `Swap ${a.id} (${symLabel(a.symbol)}) <-> ${b.id} (${symLabel(b.symbol)})`,
                {
                  t: "room-choice",
                  choice: {
                    room: "pearl-access-panel",
                    skip: false,
                    tokenA: a.id,
                    tokenB: b.id,
                  },
                },
              );
              pushed += 1;
            }
          }
          if (pushed === 0 && faceup.length >= 2) {
            const a = faceup[0]!;
            const b = faceup[1]!;
            push(
              `room:swap:${a.id}|${b.id}`,
              `Swap ${a.id} (${symLabel(a.symbol)}) <-> ${b.id} (${symLabel(b.symbol)})`,
              {
                t: "room-choice",
                choice: { room: "pearl-access-panel", skip: false, tokenA: a.id, tokenB: b.id },
              },
            );
          }
          break;
        }
        case "lg-briefing-room":
          push("room:skip", "Skip Langley Briefing Room", {
            t: "room-choice",
            choice: { room: "lg-briefing-room", skip: true },
          });
          for (const ev of activeEventsInReserve(world)) {
            push(
              `room:briefing:${ev}`,
              `Scratch 2 cover to take Event ${pack.eventById[ev].name}`,
              { t: "room-choice", choice: { room: "lg-briefing-room", skip: false, event: ev } },
            );
          }
          break;
        case "lg-armory":
          push("room:skip", "Skip Langley Armory", {
            t: "room-choice",
            choice: { room: "lg-armory", skip: true },
          });
          for (const assetId of c.availableAssets) {
            const def = pack.assetById[assetId];
            if (!def.needsCity) {
              push(`room:armory:${assetId}`, `Add free ${def.name} to Allied alias`, {
                t: "room-choice",
                choice: { room: "lg-armory", skip: false, asset: assetId },
              });
            } else {
              const sampleCity: CityId = def.sovietOnly ? "moscow" : "washington";
              push(
                `room:armory:${assetId}:${sampleCity}`,
                `Add free ${def.name} in ${cityDef(sampleCity).name} (or specify any valid city)`,
                { t: "room-choice", choice: { room: "lg-armory", skip: false, asset: assetId, city: sampleCity } },
              );
            }
          }
          break;
      }
      break;
    }
  }
}

function addEventOptions(
  out: OptionItem[],
  world: World,
  phase: Phase,
  player: PlayerId,
  seat: SeatId,
  undoDepth: number,
): void {
  const game = world.game;
  if (!game) return;
  const p = game.players[seat];

  const pushPlay = (key: string, label: string, play: Play) =>
    addIfLegal(out, world, phase, undoDepth, {
      key,
      label,
      category: "event",
      command: { type: "PLAY", player, play },
    });

  for (const id of p.hand) {
    const card = game.playerCards[id];
    if (card?.kind !== "event") continue;
    const ev = card.event;
    switch (ev) {
      case "cover-of-darkness":
        pushPlay("play:cover-of-darkness", "Play Cover of Darkness", { e: "cover-of-darkness" });
        break;
      case "forecast":
        pushPlay("play:forecast", "Play Forecast (look at & reorder top 6 Threat cards)", {
          e: "forecast",
        });
        break;
      case "one-quiet-night":
        pushPlay("play:one-quiet-night", "Play One Quiet Night (skip Threat step this turn)", {
          e: "one-quiet-night",
        });
        break;
      case "extended-time":
        pushPlay("play:extended-time", "Play Extended Time (+2 Action tokens to active player)", {
          e: "extended-time",
        });
        break;
      case "border-security":
        pushPlay("play:border-security", "Play Border Security (each player places up to 2 Checkpoints)", {
          e: "border-security",
        });
        break;
      case "decryption-book":
        pushPlay("play:decryption-book", "Play Decryption Book (reveal 4 PEARL Security tokens)", {
          e: "decryption-book",
        });
        break;
      case "counter-intelligence":
        for (const tc of game.threatDiscard) {
          pushPlay(
            `play:counter-intelligence:${tc.id}`,
            `Play Counter-Intelligence on ${cityDef(tc.city).name} (${tc.id})`,
            { e: "counter-intelligence", threatCardId: tc.id },
          );
        }
        break;
      case "undocumented-actions":
        for (const res of game.activeRestrictions) {
          pushPlay(
            `play:undocumented-actions:${res}`,
            `Play Undocumented Actions to remove ${pack.restrictionById[res].name}`,
            { e: "undocumented-actions", restriction: res },
          );
        }
        break;
      case "a-holdover-from-the-war": {
        const rel = game.supplies.safehouses <= 0
          ? pack.cities.find((ct) => game.locations[ct.id].safehouse)?.id
          : undefined;
        // Prioritize objective/exposed/control-center cities, then pawns/teams, then high-agent cities (all 48 cities remain legal via CLI)
        const highlights = new Set<CityId>();
        const addIfEligible = (cid: CityId) => {
          if (!game.locations[cid].safehouse) highlights.add(cid);
        };
        for (const obj of game.objectives) {
          if (obj.status !== "active") continue;
          for (const tc of obj.targetCities ?? []) addIfEligible(tc);
          for (const tc of obj.trialCardIds ?? []) {
            const c = cityOfCard(game, tc);
            if (c) addIfEligible(c);
          }
          if (obj.targetRevealed && obj.hiddenCardId) {
            const c = cityOfCard(game, obj.hiddenCardId);
            if (c) addIfEligible(c);
          }
          if (obj.kind === "quarantine-exposed") {
            for (const ct of pack.cities) {
              if (ct.region === obj.region && world.campaign.cities[ct.id].exposedIntensity !== null) {
                addIfEligible(ct.id);
              }
            }
          }
          if (obj.kind === "bug-existing-control-center") {
            for (const ct of pack.cities) {
              if (ct.region === obj.region && world.campaign.cities[ct.id].controlCenter) {
                addIfEligible(ct.id);
              }
            }
          }
        }
        addIfEligible(p.location);
        for (const s of game.seats) addIfEligible(game.players[s].location);
        for (const t of Object.values(game.teams)) {
          if (t.city) addIfEligible(t.city);
        }
        for (const ct of [...pack.cities].sort(
          (a, b) => game.locations[b.id].agents - game.locations[a.id].agents,
        )) {
          if (game.locations[ct.id].agents > 0) addIfEligible(ct.id);
        }
        for (const city of [...highlights].slice(0, 16)) {
          pushPlay(
            `play:holdover:${city}`,
            `Play A Holdover from the War -> safehouse in ${cityDef(city).name} (or 'play:holdover:<city>' for any city)`,
            { e: "a-holdover-from-the-war", city, relocateFrom: rel },
          );
        }
        break;
      }
      case "airlift": {
        // Show sample pawn & team airlifts; CLI accepts any seat/team and any city
        const targetCities = new Set<CityId>();
        for (const obj of game.objectives) {
          if (obj.status !== "active") continue;
          for (const tc of obj.targetCities ?? []) targetCities.add(tc);
          if (obj.targetRevealed && obj.hiddenCardId) {
            const c = cityOfCard(game, obj.hiddenCardId);
            if (c) targetCities.add(c);
          }
        }
        for (const ct of pack.cities) {
          if (game.locations[ct.id].pursuit || game.locations[ct.id].safehouse) {
            targetCities.add(ct.id);
          }
        }
        for (const ct of pack.cities) {
          if (game.locations[ct.id].agents >= 3 || game.locations[ct.id].diseaseCubes >= 2) {
            targetCities.add(ct.id);
          }
        }
        const cityList = [...targetCities].slice(0, 8);
        for (const s of game.seats) {
          for (const to of cityList) {
            pushPlay(
              `play:airlift:${s}:${to}`,
              `Play Airlift: move ${s} to ${cityDef(to).name} (or 'play:airlift:<seat|team>:<any-city>')`,
              {
                e: "airlift",
                target: { kind: "pawn", seat: s },
                to,
              },
            );
          }
        }
        for (const team of Object.values(game.teams)) {
          if (!team.city) continue;
          for (const to of cityList) {
            pushPlay(
              `play:airlift:${team.id}:${to}`,
              `Play Airlift: move ${team.id} to ${cityDef(to).name} (or 'play:airlift:<seat|team>:<any-city>')`,
              { e: "airlift", target: { kind: "team", team: team.id }, to },
            );
          }
        }
        break;
      }
      case "bureaucratic-entanglements": {
        const hot = pack.cities
          .filter((ct) => game.locations[ct.id].agents > 0)
          .sort((a, b) => game.locations[b.id].agents - game.locations[a.id].agents);
        if (hot.length > 0) {
          const first = hot[0]!.id;
          const secondSame = game.locations[first].agents >= 2 ? first : hot[1]?.id;
          const targets = secondSame ? [first, secondSame] : [first];
          const desc =
            targets.length === 2 && targets[0] === targets[1]
              ? `2 agents from ${cityDef(first).name}`
              : targets.map((c) => cityDef(c).name).join(", ");
          pushPlay(
            `play:bureaucratic:${targets.join("+")}`,
            `Play Bureaucratic Entanglements (remove ${desc})`,
            { e: "bureaucratic-entanglements", targets },
          );
          if (hot.length >= 2 && secondSame === first) {
            const split: CityId[] = [first, hot[1]!.id];
            pushPlay(
              `play:bureaucratic:${split.join("+")}`,
              `Play Bureaucratic Entanglements (split: ${split.map((c) => cityDef(c).name).join(", ")}; or 'play:bureaucratic:<c1>,<c2>' for any cities with agents)`,
              { e: "bureaucratic-entanglements", targets: split },
            );
          }
        }
        break;
      }
      case "encoded-messages": {
        for (let i = 0; i < game.seats.length; i++) {
          for (let j = i + 1; j < game.seats.length; j++) {
            const sa = game.seats[i]!;
            const sb = game.seats[j]!;
            const ca = game.players[sa].hand.find(
              (cid) => !isSymptomCard(game, cid) && !(sa === seat && cid === id),
            );
            const cb = game.players[sb].hand.find(
              (cid) => !isSymptomCard(game, cid) && !(sb === seat && cid === id),
            );
            if (ca && cb) {
              pushPlay(
                `play:encoded-messages:${sa}:${cityCardShort(world, ca)}:${sb}:${cityCardShort(world, cb)}`,
                `Play Encoded Messages: swap ${sa}'s ${cityCardShort(world, ca)} <-> ${sb}'s ${cityCardShort(world, cb)} (or 'play:encoded-messages:<seatA>:<cardA>:<seatB>:<cardB>' for any non-Symptom pair)`,
                { e: "encoded-messages", seatA: sa, cardA: ca, seatB: sb, cardB: cb },
              );
            }
          }
        }
        break;
      }
      case "weekend-rendezvous": {
        const seenAnchorCities = new Set<CityId>();
        for (const anchor of game.seats) {
          const ap = game.players[anchor];
          if (ap.infiltration || seenAnchorCities.has(ap.location)) continue;
          seenAnchorCities.add(ap.location);
          const movers = game.seats.filter(
            (s) => s !== anchor && !game.players[s].infiltration && game.players[s].location !== ap.location,
          );
          if (movers.length > 0) {
            pushPlay(
              `play:weekend-rendezvous:${ap.location}:${movers.join("+")}`,
              `Play Weekend Rendezvous: move ${movers.join(", ")} to ${cityDef(ap.location).name}`,
              { e: "weekend-rendezvous", to: ap.location, seats: movers },
            );
            if (movers.length > 1) {
              for (const m of movers) {
                pushPlay(
                  `play:weekend-rendezvous:${ap.location}:${m}`,
                  `Play Weekend Rendezvous: move only ${m} to ${cityDef(ap.location).name}`,
                  { e: "weekend-rendezvous", to: ap.location, seats: [m] },
                );
              }
            }
          }
        }
        break;
      }
      case "scramble-teams": {
        const activeTeams = Object.values(game.teams).filter((t) => t.city !== null);
        if (activeTeams.length > 0) {
          const t = activeTeams[0]!;
          const nb = cityDef(t.city!).connections[0]!;
          pushPlay(
            `play:scramble-teams:${t.id}=${nb}`,
            `Play Scramble Teams (example: ${t.id}=${nb}; use 'play:scramble-teams:<team>=<city>,...' to move any teams up to 3 hops)`,
            { e: "scramble-teams", moves: [{ team: t.id, to: nb }] },
          );
        }
        break;
      }
      case "diversion": {
        const incCities = pack.cities.filter((ct) => game.locations[ct.id].incidents > 0);
        if (incCities.length > 0) {
          const src = incCities[0]!.id;
          // Prefer a destination already at max surveillance (3) with lowest agent count, else lowest-agent city
          const candidates = pack.cities
            .filter((ct) => ct.id !== src)
            .sort((a, b) => {
              const aMax = world.campaign.cities[a.id].surveillance === 3 ? 0 : 1;
              const bMax = world.campaign.cities[b.id].surveillance === 3 ? 0 : 1;
              if (aMax !== bMax) return aMax - bMax;
              return game.locations[a.id].agents - game.locations[b.id].agents;
            });
          const dest = candidates[0]!.id;
          pushPlay(
            `play:diversion:${src}->${dest}`,
            `Play Diversion: move Incident from ${cityDef(src).name} to ${cityDef(dest).name} (or 'play:diversion:<src1>,<src2>-><dest>' for any cities)`,
            { e: "diversion", sources: [src], to: dest },
          );
        }
        break;
      }
      case "trial-vaccine": {
        const cubeCities: CityId[] = [];
        for (const ct of pack.cities) {
          for (let k = 0; k < game.locations[ct.id].diseaseCubes; k++) {
            cubeCities.push(ct.id);
          }
        }
        if (cubeCities.length > 0) {
          const pick = cubeCities.slice(0, 2);
          pushPlay(
            `play:trial-vaccine:${pick.join("+")}`,
            `Play Trial Vaccine (remove cubes: ${pick.map((c) => cityDef(c).name).join(", ")})`,
            { e: "trial-vaccine", targets: pick },
          );
        }
        break;
      }
      case "spectrum-interference": {
        if (game.satellites.length > 0) {
          const pick = game.satellites.slice(0, 2);
          pushPlay(
            `play:spectrum-interference:${pick.join("+")}`,
            `Play Spectrum Interference (remove Satellite: ${pick.map((r) => pack.regionNames[r]).join(", ")})`,
            { e: "spectrum-interference", regions: pick },
          );
        }
        break;
      }
    }
  }
}

function addActionOptions(
  out: OptionItem[],
  world: World,
  phase: Phase,
  player: PlayerId,
  seat: SeatId,
  undoDepth: number,
): void {
  const game = world.game;
  if (!game || phase !== "playing.actions" || game.active !== seat || game.pending.length > 0) {
    return;
  }

  const p = game.players[seat];
  const loc = p.location;
  const locDef = cityDef(loc);
  const handCityCards = p.hand.filter((id) => cityOfCard(game, id) !== null);
  const pushAct = (key: string, label: string, action: Action) =>
    addIfLegal(out, world, phase, undoDepth, {
      key,
      label,
      category: "action",
      command: { type: "ACTION", player, action },
    });

  // Free actions
  pushAct("spend-action-token", "Spend 1 Action token (+1 action, free)", {
    a: "spend-action-token",
  });
  pushAct("tracking-device", "Use Tracking Device: peek top 2 Threat cards (free)", {
    a: "tracking-device-peek",
  });
  for (const res of game.activeRestrictions) {
    pushAct(
      `help-from-sabik:${res}`,
      `Use Help from Sabik: ignore ${pack.restrictionById[res].name} this turn (free)`,
      { a: "use-help-from-sabik", restriction: res },
    );
  }

  // If inside infiltration site
  if (p.infiltration) {
    const { site, room } = p.infiltration;
    pushAct("exit-infiltration", `Exit ${pack.sites[site].name}`, { a: "exit-infiltration" });
    for (const edge of edgesOfRoom(site, room)) {
      const dest = otherRoom(edge, room);
      if (edge.hatchway) {
        if (world.campaign.pearlTunnels.includes(edge.id) && handCityCards.length > 0) {
          pushAct(
            `infiltrate:${dest}`,
            `Infiltrate through tunnel to ${pack.roomById[dest].name} (reveal ${cityCardShort(world, handCityCards[0]!)})`,
            { a: "infiltrate", to: dest, revealCards: [handCityCards[0]!] },
          );
        } else if (hasRule(world.campaign, "U") && world.campaign.availableTunnels > 0) {
          const cards = findHatchwayCards(world, handCityCards);
          if (cards) {
            pushAct(
              `unlock-hatchway:${edge.id}`,
              `Unlock Hatchway ${edge.id} -> ${pack.roomById[dest].name} (discard ${cards.map((id) => cityCardShort(world, id)).join("+")})`,
              { a: "unlock-hatchway", edgeId: edge.id, cards },
            );
          }
        }
      } else {
        const tokens = game.infiltrationSites[site]!.tokens.filter((t) => t.edgeId === edge.id);
        if (tokens.every((t) => t.revealed)) {
          const subset = findSatisfyingCardSubset(
            world,
            seat,
            tokens.map((t) => t.symbol),
            handCityCards,
          );
          if (subset) {
            pushAct(
              `infiltrate:${dest}`,
              `Infiltrate to ${pack.roomById[dest].name} (reveal ${subset.map((id) => cityCardShort(world, id)).join("+") || "none"})`,
              { a: "infiltrate", to: dest, revealCards: subset },
            );
          }
        }
      }
    }
    for (const obj of game.objectives) {
      if (
        obj.kind === "infiltration" &&
        obj.status === "active" &&
        obj.infiltrationSite === site &&
        obj.infiltrationRoom === room
      ) {
        const need = obj.infiltrationDiscardCount ?? 3;
        const matching = handCityCards.filter(
          (id) =>
            !obj.infiltrationDiscardAffiliation ||
            cityDef(cityOfCard(game, id)!).affiliation === obj.infiltrationDiscardAffiliation,
        );
        if (matching.length >= need) {
          const cards = matching.slice(0, need);
          pushAct(
            `complete-infiltration:${obj.id}`,
            `Complete ${obj.title} (discard ${cards.map((id) => cityCardShort(world, id)).join("+")})`,
            { a: "complete-infiltration-objective", objective: obj.id, cards },
          );
        }
      }
    }
    return;
  }

  // Regular map actions
  const carryAll =
    currentSpecialization(world, seat) === "transport-crew"
      ? Object.values(game.teams)
          .filter((t) => t.city === loc)
          .map((t) => t.id)
      : undefined;

  for (const nb of locDef.connections) {
    pushAct(`drive:${nb}`, `Drive/Ferry to ${cityDef(nb).name}`, { a: "drive", to: nb });
    if (carryAll && carryAll.length > 0) {
      pushAct(
        `drive-carry:${nb}`,
        `Drive/Ferry to ${cityDef(nb).name} carrying ${carryAll.join("+")}`,
        { a: "drive", to: nb, carryTeams: carryAll },
      );
    }
  }

  for (const id of handCityCards) {
    const dest = cityOfCard(game, id)!;
    if (dest === loc) continue;
    const extraNeeded =
      cityDef(dest).affiliation === "neutral" && isRestrictionActive(game, "hesitant");
    const extraCard = extraNeeded
      ? p.hand.find((cid) => cid !== id && !isSymptomCard(game, cid))
      : undefined;
    const hesitantNote = extraCard
      ? ` (Hesitant: also discards ${cityCardShort(world, extraCard)}; or 'fly:${dest} extra:<card>')`
      : "";
    pushAct(`fly:${dest}`, `Commercial Flight to ${cityDef(dest).name}${hesitantNote}`, {
      a: "commercial-flight",
      card: id,
      extraCard,
    });
    if (carryAll && carryAll.length > 0) {
      pushAct(
        `fly-carry:${dest}`,
        `Commercial Flight to ${cityDef(dest).name} carrying ${carryAll.join("+")}${hesitantNote}`,
        { a: "commercial-flight", card: id, extraCard, carryTeams: carryAll },
      );
    }
  }

  const ownCityCard = handCityCards.find((id) => cityOfCard(game, id) === loc);
  if (ownCityCard) {
    for (const ct of pack.cities) {
      if (ct.id === loc) continue;
      pushAct(`unrecorded:${ct.id}`, `Unrecorded Flight to ${ct.name} (discard ${loc})`, {
        a: "unrecorded-flight",
        card: ownCityCard,
        to: ct.id,
      });
      if (carryAll && carryAll.length > 0) {
        pushAct(
          `unrecorded-carry:${ct.id}`,
          `Unrecorded Flight to ${ct.name} carrying ${carryAll.join("+")} (discard ${loc})`,
          { a: "unrecorded-flight", card: ownCityCard, to: ct.id, carryTeams: carryAll },
        );
      }
    }
  }

  if (game.locations[loc].agents > 0) {
    const removeCount =
      currentSpecialization(world, seat) === "deep-cover"
        ? game.locations[loc].agents
        : hasAsset(world, seat, "gunbrella")
          ? Math.min(2, game.locations[loc].agents)
          : 1;
    pushAct(
      "neutralize",
      `Neutralize Agent in ${locDef.name} (remove ${removeCount})`,
      { a: "neutralize-agent" },
    );
  }

  // Share Intel
  for (const otherSeat of game.seats) {
    if (otherSeat === seat) continue;
    const other = game.players[otherSeat];
    if (other.infiltration || other.location !== loc) continue;
    const soft = isRestrictionActive(game, "soft");
    for (const id of handCityCards) {
      const extraDiscard = soft ? handCityCards.find((cid) => cid !== id) : undefined;
      const cityId = cityOfCard(game, id)!;
      const softNote = extraDiscard
        ? ` (Soft: also discards ${cityCardShort(world, extraDiscard)}; or 'share-give:${otherSeat}:${cityId} extra:<card>')`
        : "";
      pushAct(
        `share-give:${otherSeat}:${cityId}`,
        `Give ${cityDef(cityId).name} to ${otherSeat}${softNote}`,
        { a: "share-intel", target: otherSeat, card: id, direction: "give", extraDiscard },
      );
    }
    for (const id of other.hand) {
      const ct = cityOfCard(game, id);
      if (!ct) continue;
      const extraDiscard = soft ? handCityCards[0] : undefined;
      const softNote = extraDiscard
        ? ` (Soft: also discards ${cityCardShort(world, extraDiscard)}; or 'share-take:${otherSeat}:${ct} extra:<card>')`
        : "";
      pushAct(
        `share-take:${otherSeat}:${ct}`,
        `Take ${cityDef(ct).name} from ${otherSeat}${softNote}`,
        { a: "share-intel", target: otherSeat, card: id, direction: "take", extraDiscard },
      );
    }
  }

  // Build Safehouse
  const relSafehouse =
    game.supplies.safehouses <= 0
      ? pack.cities.find((ct) => game.locations[ct.id].safehouse && !world.campaign.cities[ct.id].permanentSafehouse)?.id ??
        pack.cities.find((ct) => game.locations[ct.id].safehouse)?.id
      : undefined;
  const passiveCard = isRestrictionActive(game, "passive")
    ? handCityCards.find((id) => id !== ownCityCard)
    : undefined;
  const passiveNote = passiveCard ? ` (Passive: also discards ${cityCardShort(world, passiveCard)})` : "";
  pushAct("build-safehouse", `Build Safehouse in ${locDef.name}${passiveNote}`, {
    a: "build-safehouse",
    card: currentOccupation(world, seat) === "clinic-planner" ? undefined : ownCityCard,
    extraCard: passiveCard,
    relocateFrom: relSafehouse,
  });

  // Identify Target City
  for (const obj of game.objectives) {
    if (obj.kind === "unknown-city" && obj.status === "active" && !obj.targetRevealed && obj.unknownRegion) {
      const baseNeed = hasAsset(world, seat, "code-book") ? 2 : 3;
      const evasive = isRestrictionActive(game, "evasive") ? 1 : 0;
      const matching = handCityCards.filter(
        (id) => cityDef(cityOfCard(game, id)!).region === obj.unknownRegion,
      );
      if (matching.length >= baseNeed) {
        const picked = matching.slice(0, baseNeed);
        if (evasive > 0) {
          const extra = handCityCards.find((id) => !picked.includes(id));
          if (extra) picked.push(extra);
        }
        if (picked.length === baseNeed + evasive) {
          pushAct(
            `identify:${obj.id}`,
            `Identify Target City for ${obj.title} (${picked.map((id) => cityCardShort(world, id)).join("+")})`,
            { a: "identify-target-city", objective: obj.id, cards: picked },
          );
        }
      }
    }
  }

  // Assemble Team
  {
    const baseNeed = currentOccupation(world, seat) === "hospital-administrator" ? 4 : 5;
    const arrogant = isRestrictionActive(game, "arrogant") ? 1 : 0;
    const matching = handCityCards.filter(
      (id) => cityDef(cityOfCard(game, id)!).affiliation === locDef.affiliation,
    );
    if (matching.length >= baseNeed) {
      const picked = matching.slice(0, baseNeed);
      if (arrogant > 0) {
        const extra = handCityCards.find((id) => !picked.includes(id));
        if (extra) picked.push(extra);
      }
      if (picked.length === baseNeed + arrogant) {
        const unused = Object.values(game.teams).find(
          (t) => t.affiliation === locDef.affiliation && t.city === null,
        );
        const relTeam = unused
          ? undefined
          : Object.values(game.teams).find(
              (t) => t.affiliation === locDef.affiliation && t.city !== null && t.city !== loc,
            )?.id;
        pushAct(
          `assemble-team:${locDef.affiliation}`,
          `Assemble ${locDef.affiliation} Team in ${locDef.name} (${picked.map((id) => cityCardShort(world, id)).join("+")})`,
          { a: "assemble-team", cards: picked, relocateTeam: relTeam },
        );
      }
    }
  }

  // Drive/Ferry Team
  for (const team of Object.values(game.teams)) {
    if (!team.city) continue;
    for (const nb of cityDef(team.city).connections) {
      pushAct(
        `drive-team:${team.id}:${nb}`,
        `Drive/Ferry ${team.id} (${cityDef(team.city).name} -> ${cityDef(nb).name})`,
        { a: "drive-team", team: team.id, to: nb },
      );
    }
  }

  // Acquire Targets & Disrupt Trial
  for (const obj of game.objectives) {
    if (obj.status !== "active") continue;
    if (obj.kind === "disrupt-trial") {
      pushAct(`disrupt-trial:${obj.id}`, `Disrupt Trial: ${obj.title}`, {
        a: "disrupt-trial",
        objective: obj.id,
      });
    } else if (obj.kind === "quarantine-exposed") {
      for (const ct of pack.cities) {
        if (ct.region === obj.region && world.campaign.cities[ct.id].exposedIntensity !== null) {
          pushAct(
            `acquire:${obj.id}:${ct.id}`,
            `Acquire Targets (${obj.title}) in ${ct.name}`,
            { a: "acquire-targets", objective: obj.id, targetCity: ct.id },
          );
        }
      }
    } else if (
      obj.kind === "known-cities" ||
      obj.kind === "unknown-city" ||
      obj.kind === "bug-existing-control-center"
    ) {
      const blindWarn =
        obj.kind === "unknown-city" && !obj.targetRevealed
          ? " (BLIND GUESS — fails if active team is not in hidden target!)"
          : "";
      pushAct(`acquire:${obj.id}`, `Acquire Targets${blindWarn}: ${obj.title}`, {
        a: "acquire-targets",
        objective: obj.id,
      });
    }
  }

  // Unlocked actions
  pushAct("treat", `Treat 1 Disease cube in ${locDef.name}`, { a: "treat" });
  for (const aff of ["allied", "neutral", "soviet"] as const) {
    pushAct(`change-alias:${aff}`, `Change Alias to ${aff}`, { a: "change-alias", affiliation: aff });
  }
  const matchingAffCards = handCityCards.filter(
    (id) => cityDef(cityOfCard(game, id)!).affiliation === locDef.affiliation,
  );
  if (matchingAffCards.length > 0) {
    const relCp = game.supplies.checkpointTokens <= 0 ? game.checkpoints[0] : undefined;
    for (const nb of locDef.connections) {
      for (const cardId of matchingAffCards) {
        const short = cityCardShort(world, cardId);
        pushAct(
          `checkpoint:${nb}:${short}`,
          `Create Checkpoint ${locDef.name} <-> ${cityDef(nb).name} (discard ${short})`,
          { a: "create-checkpoint", card: cardId, neighbor: nb, relocateFrom: relCp },
        );
      }
    }
  }
  for (const id of p.hand) {
    if (isSymptomCard(game, id)) {
      pushAct(`get-treatment:${id}`, `Get Treatment: return ${id}`, {
        a: "get-treatment",
        card: id,
      });
    }
  }
  pushAct("disable-satellite", `Disable Satellite in ${pack.regionNames[locDef.region]}`, {
    a: "disable-satellite",
  });
  for (const siteId of Object.keys(game.infiltrationSites) as InfiltrationSiteId[]) {
    pushAct(`enter-infiltration:${siteId}`, `Enter ${pack.sites[siteId].name}`, {
      a: "enter-infiltration",
      site: siteId,
    });
  }

  // Occupation actions
  if (currentOccupation(world, seat) === "medical-conference-coordinator") {
    for (const team of Object.values(game.teams)) {
      if (!team.city) continue;
      for (const dest of citiesWithin(team.city, 3)) {
        pushAct(
          `coord-team:${team.id}:${dest}`,
          `Coordinator: move ${team.id} to ${cityDef(dest).name}`,
          { a: "coordinator-move", target: { kind: "team", team: team.id }, to: dest },
        );
      }
    }
    for (const otherSeat of game.seats) {
      if (otherSeat === seat || game.players[otherSeat].infiltration) continue;
      for (const dest of citiesWithin(game.players[otherSeat].location, 3)) {
        pushAct(
          `coord-pawn:${otherSeat}:${dest}`,
          `Coordinator: move ${otherSeat} to ${cityDef(dest).name}`,
          { a: "coordinator-move", target: { kind: "pawn", seat: otherSeat }, to: dest },
        );
      }
    }
  }
  if (currentOccupation(world, seat) === "clinic-planner" && handCityCards.length > 0 && game.locations[loc].safehouse) {
    for (const cardId of handCityCards) {
      const cardCity = cityOfCard(game, cardId)!;
      for (const ct of pack.cities) {
        if (ct.id === loc) continue;
        pushAct(
          `clinic-fly:${cardCity}:${ct.id}`,
          `Clinic Planner Flight to ${ct.name} (discard ${cityCardShort(world, cardId)})`,
          { a: "clinic-planner-flight", card: cardId, to: ct.id },
        );
      }
    }
  }
  if (currentOccupation(world, seat) === "aluminum-salesperson") {
    for (const otherSeat of game.seats) {
      if (otherSeat === seat) continue;
      for (const id of game.players[otherSeat].hand) {
        const ct = cityOfCard(game, id);
        if (ct) {
          pushAct(
            `aluminum-take:${otherSeat}:${ct}`,
            `Aluminum Salesperson: take ${cityDef(ct).name} from ${otherSeat}`,
            { a: "aluminum-take", from: otherSeat, card: id },
          );
        }
      }
    }
  }
  if (currentOccupation(world, seat) === "cargo-pilot") {
    for (const ct of pack.cities) {
      if (ct.id !== loc && game.locations[ct.id].safehouse) {
        pushAct(`cargo-fly:${ct.id}`, `Cargo Pilot: fly to safehouse in ${ct.name}`, {
          a: "cargo-pilot-flight",
          to: ct.id,
        });
        if (carryAll && carryAll.length > 0) {
          pushAct(
            `cargo-fly-carry:${ct.id}`,
            `Cargo Pilot: fly to safehouse in ${ct.name} carrying ${carryAll.join("+")}`,
            { a: "cargo-pilot-flight", to: ct.id, carryTeams: carryAll },
          );
        }
      }
    }
  }
  if (currentOccupation(world, seat) === "first-assistant") {
    for (const id of game.playerDiscard) {
      const ct = cityOfCard(game, id);
      if (ct && cityDef(ct).affiliation === "soviet") {
        pushAct(
          `first-assistant:${ct}`,
          `First Assistant: draw ${cityDef(ct).name} from discard`,
          { a: "first-assistant-draw", card: id },
        );
      }
    }
  }

  // Asset actions
  for (const visaId of ["visa-1", "visa-2", "visa-3", "visa-4", "visa-5", "visa-6", "visa-7"] as AssetId[]) {
    const v = findAsset(world, seat, visaId);
    if (v?.city) {
      pushAct(`visa:${visaId}`, `Use Visa to move to ${cityDef(v.city).name}`, {
        a: "visa-move",
        asset: visaId,
      });
      if (carryAll && carryAll.length > 0) {
        pushAct(
          `visa-carry:${visaId}`,
          `Use Visa to move to ${cityDef(v.city).name} carrying ${carryAll.join("+")}`,
          { a: "visa-move", asset: visaId, carryTeams: carryAll },
        );
      }
    }
  }
  if (findAsset(world, seat, "shop-owner") && handCityCards.length >= 2) {
    const pair: [CardId, CardId] = [handCityCards[0]!, handCityCards[1]!];
    const pairNames = `${cityCardShort(world, pair[0])}+${cityCardShort(world, pair[1])}`;
    for (const id of game.playerDiscard) {
      const ct = cityOfCard(game, id);
      if (ct) {
        pushAct(
          `shop-owner:${ct}`,
          `Shop Owner: discard ${pairNames} for ${cityDef(ct).name} (or 'shop-owner:<c1>,<c2>-><discardCity>')`,
          { a: "shop-owner-swap", discardCards: pair, takeCard: id },
        );
      }
    }
  }
  const crimeBoss = findAsset(world, seat, "crime-boss");
  if (crimeBoss?.city) {
    for (const ct of [crimeBoss.city, ...cityDef(crimeBoss.city).connections]) {
      pushAct(`crime-boss:${ct}`, `Crime Boss: remove 1 agent from ${cityDef(ct).name}`, {
        a: "crime-boss-remove",
        city: ct,
      });
    }
  }
  if (findAsset(world, seat, "politician")) {
    for (const otherSeat of game.seats) {
      if (otherSeat === seat) continue;
      for (const id of handCityCards) {
        pushAct(
          `politician:${otherSeat}:${cityOfCard(game, id)}`,
          `Politician: give ${cityDef(cityOfCard(game, id)!).name} to ${otherSeat}`,
          { a: "politician-give", to: otherSeat, card: id },
        );
      }
    }
  }
  const fieldMedic = findAsset(world, seat, "field-medic");
  if (fieldMedic?.city) {
    for (const ct of [fieldMedic.city, ...cityDef(fieldMedic.city).connections]) {
      pushAct(`field-medic:${ct}`, `Field Medic: treat 1 Disease cube in ${cityDef(ct).name}`, {
        a: "field-medic-treat",
        city: ct,
      });
    }
  }
  const cobbler = findAsset(world, seat, "cobbler");
  if (cobbler?.city) {
    for (const team of Object.values(game.teams)) {
      if (team.city !== cobbler.city) continue;
      for (const aff of ["allied", "neutral", "soviet"] as const) {
        if (team.affiliation === aff) continue;
        const cards = handCityCards
          .filter((id) => cityDef(cityOfCard(game, id)!).affiliation === aff)
          .slice(0, 3);
        if (cards.length === 3) {
          pushAct(
            `cobbler:${team.id}:${aff}`,
            `Cobbler: convert ${team.id} to ${aff}`,
            { a: "cobbler-convert", cards, team: team.id },
          );
        }
      }
    }
  }
  if (findAsset(world, seat, "test-pilot")) {
    for (const r of game.satellites) {
      pushAct(`test-pilot:${r}`, `Test Pilot: remove ${pack.regionNames[r]} Satellite`, {
        a: "test-pilot-remove-satellite",
        region: r,
      });
    }
  }
  pushAct("spy-camera", `Spy Camera: draw ${locDef.name} from discard`, { a: "spy-camera-draw" });
  for (const nb of locDef.connections) {
    pushAct(`auth-424:${nb}`, `Auth Code 424: remove 1 agent from ${cityDef(nb).name}`, {
      a: "auth-424-remove",
      city: nb,
    });
  }
  for (const ct of pack.cities) {
    if (game.locations[ct.id].agents > 0 && activeTeamsInCity(game, ct.id).length > 0) {
      pushAct(`auth-715:${ct.id}`, `Auth Code 715: remove all agents from ${ct.name}`, {
        a: "auth-715-clear",
        city: ct.id,
      });
    }
  }
  if (hasAsset(world, seat, "auth-405")) {
    for (const team of Object.values(game.teams)) {
      if (!team.city) continue;
      for (const id of handCityCards) {
        pushAct(
          `auth-405:${team.id}:${cityOfCard(game, id)}`,
          `Auth Code 405: move ${team.id} to ${cityDef(cityOfCard(game, id)!).name}`,
          { a: "auth-405-move-team", card: id, team: team.id },
        );
      }
    }
  }
  if (hasAsset(world, seat, "black-book")) {
    for (const id of handCityCards) {
      pushAct(
        `black-book:${cityOfCard(game, id)}`,
        `Black Book: place safehouse in ${cityDef(cityOfCard(game, id)!).name}`,
        { a: "black-book-safehouse", card: id, relocateFrom: relSafehouse },
      );
    }
  }
  pushAct("exp-medicine", `Experimental Medicine: remove all Disease cubes in ${locDef.name}`, {
    a: "experimental-medicine-treat",
  });
  for (const nb of locDef.connections) {
    pushAct(
      `supplements:${nb}`,
      `Unapproved Supplements: remove 1 Disease cube in ${cityDef(nb).name}`,
      { a: "unapproved-supplements-treat", city: nb },
    );
  }
}

function addUpkeepOptions(
  out: OptionItem[],
  world: World,
  phase: Phase,
  player: PlayerId,
  undoDepth: number,
): void {
  const game = world.game;
  const c = world.campaign;
  if (!game?.upkeep) return;
  const pushBuy = (key: string, label: string, purchase: Purchase) =>
    addIfLegal(out, world, phase, undoDepth, {
      key,
      label,
      category: "upkeep",
      command: { type: "PURCHASE", player, purchase },
    });

  const rem = game.upkeep.budget - game.upkeep.spent;
  if (rem >= 3 && c.availablePermanentSafehouses > 0) {
    for (const city of game.upkeep.safehouseCities) {
      pushBuy(
        `buy:safehouse:${city}`,
        `Buy Permanent Safehouse in ${cityDef(city).name} (3 budget)`,
        { t: "permanent-safehouse", city },
      );
    }
  }
  if (rem >= 1 && c.availableCounterSurveillance > 0) {
    for (const ct of pack.cities) {
      if (c.cities[ct.id].surveillance > 0) {
        pushBuy(
          `buy:counter-surv:${ct.id}`,
          `Buy Counter Surveillance in ${ct.name} (1 budget; sticker surv ${c.cities[ct.id].surveillance} -> ${c.cities[ct.id].surveillance - 1})`,
          { t: "counter-surveillance", city: ct.id },
        );
      }
    }
  }
  for (const assetId of c.availableAssets) {
    const def = pack.assetById[assetId];
    if (def.cost > rem) continue;
    for (const color of PASSPORT_COLORS) {
      for (const aff of ["allied", "neutral", "soviet"] as const) {
        const al = c.passports[color].aliases[aff];
        if (!al.created || al.burned || al.assets.length >= 3) continue;
        if (!def.needsCity) {
          pushBuy(
            `buy:asset:${assetId}:${color}:${aff}`,
            `Buy ${def.name} (${def.cost}b) for ${color} ${aff}`,
            { t: "asset", passport: color, affiliation: aff, asset: assetId },
          );
        } else {
          const sampleCity: CityId = def.sovietOnly
            ? (pack.cities.find((ct) => ct.affiliation === "soviet" && c.cities[ct.id].permanentSafehouse)?.id ?? "moscow")
            : "washington";
          pushBuy(
            `buy:asset:${assetId}:${color}:${aff}:${sampleCity}`,
            `Buy ${def.name} (${def.cost}b) for ${color} ${aff} in ${cityDef(sampleCity).name} (or 'buy:asset:${assetId}:${color}:${aff}:<city>' for any valid${def.sovietOnly ? " Soviet" : ""} city)`,
            { t: "asset", passport: color, affiliation: aff, asset: assetId, city: sampleCity },
          );
        }
      }
    }
  }
  game.upkeep.bought.forEach((b, idx) => {
    const p = b.purchase;
    const desc =
      p.t === "permanent-safehouse"
        ? `Permanent Safehouse in ${cityDef(p.city).name}`
        : p.t === "counter-surveillance"
          ? `Counter-Surveillance in ${cityDef(p.city).name}`
          : `${pack.assetById[p.asset].name}${p.city ? ` (${cityDef(p.city).name})` : ""} on ${p.passport}/${p.affiliation}`;
    addIfLegal(out, world, phase, undoDepth, {
      key: `refund:${idx}`,
      label: `Refund #${idx}: ${desc} (${b.cost}b)`,
      category: "upkeep",
      command: { type: "REFUND", player, index: idx },
    });
  });
  addIfLegal(out, world, phase, undoDepth, {
    key: "finish-upkeep",
    label: "Finish Spend Budget (confirm upkeep)",
    category: "upkeep",
    command: { type: "FINISH_UPKEEP", player },
  });
}

/** Enumerates legal options for `player` in the current phase. Every returned command passes `reject(...) === null`. */
export function optionsFor(
  world: World,
  phase: Phase,
  player: PlayerId,
  undoDepth = 0,
): OptionItem[] {
  const out: OptionItem[] = [];
  const seat = seatOfPlayer(world, player);
  if (!seat) {
    if (phase === "lobby") {
      addIfLegal(out, world, phase, undoDepth, {
        key: "join",
        label: "Join the table",
        category: "lobby",
        command: { type: "JOIN", player, name: player },
      });
    }
    return out;
  }

  switch (phase) {
    case "lobby":
      addIfLegal(out, world, phase, undoDepth, {
        key: "start-game",
        label: `Start ${pack.monthNames[world.campaign.month]}`,
        category: "lobby",
        command: { type: "START_GAME", player },
      });
      if (world.campaign.month === 0) {
        addIfLegal(out, world, phase, undoDepth, {
          key: "begin-january",
          label: "Advance from Prologue to January (start permanent campaign)",
          category: "lobby",
          command: { type: "BEGIN_JANUARY", player },
        });
      }
      if (world.campaign.month >= 1) {
        for (const ts of world.table.seats) {
          const cur = world.campaign.seating.find((s) => s.seat === ts.seat)?.passport ?? null;
          for (const color of PASSPORT_COLORS) {
            if (color === cur) continue;
            addIfLegal(out, world, phase, undoDepth, {
              key: `assign-passport:${ts.seat}:${color}`,
              label: `Assign ${color} passport to ${ts.seat} (${ts.player})`,
              category: "lobby",
              command: { type: "ASSIGN_PASSPORT", player, seat: ts.seat, passport: color },
            });
          }
        }
      }
      if (world.campaign.door14State === "ignored") {
        addIfLegal(out, world, phase, undoDepth, {
          key: "resolve-door14:open",
          label: "Open ignored Door 14 briefcase (Door 19)",
          category: "lobby",
          command: { type: "RESOLVE_DOOR_14", player, choice: "open" },
        });
        addIfLegal(out, world, phase, undoDepth, {
          key: "resolve-door14:blow-up",
          label: "Blow up ignored Door 14 briefcase (Door 24)",
          category: "lobby",
          command: { type: "RESOLVE_DOOR_14", player, choice: "blow-up" },
        });
      }
      break;

    case "setup.legacy":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      break;

    case "setup.threat":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      addIfLegal(out, world, phase, undoDepth, {
        key: "flip-threat",
        label: `Flip opening Threat card (${world.game?.openingThreatsLeft ?? 0} remaining)`,
        category: "setup",
        command: { type: "FLIP_OPENING_THREAT", player },
      });
      break;

    case "setup.events": {
      const c = world.campaign;
      const g = world.game!;
      addIfLegal(out, world, phase, undoDepth, {
        key: "confirm-events",
        label: `Confirm ${g.pickedEvents.length} Event card(s): ${g.pickedEvents.join(", ") || "none"}`,
        category: "setup",
        command: { type: "CONFIRM_EVENTS", player },
      });
      if (c.discretionaryBudgetBoxesLeft && c.discretionaryBudgetBoxesLeft > 0) {
        const extraPick = c.unlockedEvents.slice(0, Math.min(c.unlockedEvents.length, c.funding + 1));
        addIfLegal(out, world, phase, undoDepth, {
          key: "pick-events:discretionary+1",
          label: `Use 1 Discretionary Budget box (+1 Event card: ${extraPick.length} total)`,
          category: "setup",
          command: { type: "PICK_EVENTS", player, events: extraPick, discretionaryBoxes: 1 },
        });
      }
      break;
    }

    case "setup.aliases": {
      const p = world.game?.players[seat];
      if (p?.passport) {
        for (const aff of createdUnburnedAliases(world.campaign, p.passport)) {
          const al = world.campaign.passports[p.passport].aliases[aff];
          addIfLegal(out, world, phase, undoDepth, {
            key: `choose-alias:${aff}`,
            label: `Use ${aff} alias: ${al.name} (${al.occupation ? pack.occupationById[al.occupation].name : "?"})`,
            category: "setup",
            command: { type: "CHOOSE_ALIAS", player, affiliation: aff },
          });
        }
      }
      break;
    }

    case "playing.surveillance":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      addEventOptions(out, world, phase, player, seat, undoDepth);
      addIfLegal(out, world, phase, undoDepth, {
        key: "begin-turn",
        label: "Begin Turn (Check Surveillance)",
        category: "turn",
        command: { type: "BEGIN_TURN", player },
      });
      break;

    case "playing.actions":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      addActionOptions(out, world, phase, player, seat, undoDepth);
      addEventOptions(out, world, phase, player, seat, undoDepth);
      addIfLegal(out, world, phase, undoDepth, {
        key: "undo",
        label: "Undo last action",
        category: "turn",
        command: { type: "UNDO", player },
      });
      addIfLegal(out, world, phase, undoDepth, {
        key: "end-actions",
        label: `End Do Actions (${world.game?.actionsLeft ?? 0} actions left) -> Mop Up & Draw`,
        category: "turn",
        command: { type: "END_ACTIONS", player },
      });
      break;

    case "playing.draw":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      addEventOptions(out, world, phase, player, seat, undoDepth);
      addIfLegal(out, world, phase, undoDepth, {
        key: "draw-cards",
        label: "Draw 2 Player Cards",
        category: "turn",
        command: { type: "DRAW_PLAYER_CARDS", player },
      });
      break;

    case "playing.threat":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      addEventOptions(out, world, phase, player, seat, undoDepth);
      addIfLegal(out, world, phase, undoDepth, {
        key: "draw-threat",
        label: `Draw 1 Threat Card (${world.game?.threatsLeft ?? 0} left)`,
        category: "turn",
        command: { type: "DRAW_THREAT", player },
      });
      break;

    case "over":
      addIfLegal(out, world, phase, undoDepth, {
        key: "continue",
        label: "Resolve Game End Steps (Evaluation, Cities, Legacy, Budget)",
        category: "turn",
        command: { type: "CONTINUE", player },
      });
      break;

    case "postgame":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      break;

    case "upkeep":
      addDecisionOptions(out, world, phase, player, seat, undoDepth);
      if (world.campaign.door14State === "ignored") {
        addIfLegal(out, world, phase, undoDepth, {
          key: "resolve-door14:open",
          label: "Open ignored Door 14 briefcase (Door 19)",
          category: "upkeep",
          command: { type: "RESOLVE_DOOR_14", player, choice: "open" },
        });
        addIfLegal(out, world, phase, undoDepth, {
          key: "resolve-door14:blow-up",
          label: "Blow up ignored Door 14 briefcase (Door 24)",
          category: "upkeep",
          command: { type: "RESOLVE_DOOR_14", player, choice: "blow-up" },
        });
      }
      addUpkeepOptions(out, world, phase, player, undoDepth);
      break;

    case "finished":
      break;
  }

  return out;
}
