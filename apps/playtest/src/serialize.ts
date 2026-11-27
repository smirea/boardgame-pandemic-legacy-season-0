import type {
  Affiliation,
  AssetId,
  InfiltrationSiteId,
  LogEntry,
  OptionItem,
  PlayerCard,
  PlayerId,
  PlayerView,
  ReadingEntry,
  World,
} from "@repo/game";
import {
  decisionOwner,
  optionsFor,
  pack,
  PASSPORT_COLORS,
  phaseOf,
  readingsSince,
  topDecision,
  viewFor,
} from "@repo/game";
import type { ChatMessage } from "./render";
import { formatLogLine } from "./render";

export type CompactStateContext = {
  unreadReadings: ReadingEntry[];
  unreadChat: ChatMessage[];
  deltaLog: LogEntry[];
  inspectResults?: { query: string; content: string }[];
  strategyUpdate?: string | null;
  actionFeedback?: string | null;
  waitingFor: string;
  sessionGameFinished: boolean;
  notice?: string | null;
};

export type SerializedOptionGroup =
  | { kind: "exact"; key: string; label: string; category: OptionItem["category"] }
  | { kind: "template"; template: string; summary: string; count: number; category: OptionItem["category"] };

export type CompactStatePacket = {
  phase: PlayerView["phase"];
  month: number;
  monthName: string;
  attempt: 1 | 2;
  branch: "cia" | "sabik";
  funding: number;
  viewer: PlayerId;
  viewerSeat: PlayerView["viewerSeat"];
  waitingFor: string;
  sessionGameFinished: boolean;
  turn: number | null;
  activeSeat: PlayerView["viewerSeat"];
  actionsLeft: number | null;
  pendingTop: NonNullable<PlayerView["game"]>["pendingTop"];
  unreadReadings: ReadingEntry[];
  unreadChat: ChatMessage[];
  deltaLog: string[];
  options: SerializedOptionGroup[];
  compactText: string;
};

function shortCard(card: PlayerCard): string {
  if (card.kind === "city") {
    const ct = pack.cityById[card.city];
    return `${ct.id}(${ct.affiliation[0]!.toUpperCase()}/${ct.region.slice(0, 2).toUpperCase()}/#${ct.keypad})`;
  }
  if (card.kind === "event") return `EV:${card.event}`;
  if (card.kind === "symptom") return `SYMP:${card.name}[${card.id}]`;
  if (card.kind === "satellite") return `SAT:${card.region}`;
  return card.kind.toUpperCase();
}

export function compactOptions(
  view: PlayerView,
  options: OptionItem[],
): { groups: SerializedOptionGroup[]; lines: string[] } {
  const groups: SerializedOptionGroup[] = [];
  const lines: string[] = [];

  if (options.length === 0) {
    return { groups, lines: ["(none — reply in chat or pass with commands: [])"] };
  }

  const coordGroups = new Map<string, string[]>();
  const clinicCards = new Set<string>();
  const clinicDests = new Set<string>();
  const unrecordedDests: string[] = [];
  const unrecordedCarryDests: string[] = [];
  const buyAssets = new Map<AssetId, { cost: number; targets: string[]; needsCity: boolean; sovietOnly: boolean }>();
  const freeCheckpoints: string[] = [];
  const standalone: OptionItem[] = [];

  for (const o of options) {
    const mCoord = /^(coord-pawn:[^:]+|coord-team:[^:]+):(.+)$/.exec(o.key);
    if (mCoord) {
      const list = coordGroups.get(mCoord[1]!) ?? [];
      list.push(mCoord[2]!);
      coordGroups.set(mCoord[1]!, list);
      continue;
    }
    const mUnrec = /^unrecorded:(.+)$/.exec(o.key);
    if (mUnrec) {
      unrecordedDests.push(mUnrec[1]!);
      continue;
    }
    const mUnrecCarry = /^unrecorded-carry:(.+)$/.exec(o.key);
    if (mUnrecCarry) {
      unrecordedCarryDests.push(mUnrecCarry[1]!);
      continue;
    }
    const mClinic = /^clinic-fly:([^:]+):(.+)$/.exec(o.key);
    if (mClinic) {
      clinicCards.add(mClinic[1]!);
      clinicDests.add(mClinic[2]!);
      continue;
    }
    const mBuyAsset = /^buy:asset:([^:]+):([^:]+):([^:]+)(?::(.+))?$/.exec(o.key);
    if (mBuyAsset) {
      const assetId = mBuyAsset[1]! as AssetId;
      const passport = mBuyAsset[2]!;
      const aff = mBuyAsset[3]!;
      const def = pack.assetById[assetId];
      if (def) {
        const entry = buyAssets.get(assetId) ?? {
          cost: def.cost,
          targets: [],
          needsCity: Boolean(def.needsCity),
          sovietOnly: Boolean(def.sovietOnly),
        };
        const slot = `${passport}:${aff}`;
        if (!entry.targets.includes(slot)) entry.targets.push(slot);
        buyAssets.set(assetId, entry);
        continue;
      }
    }
    const mFreeCp = /^free-checkpoint:(.+)$/.exec(o.key);
    if (mFreeCp) {
      freeCheckpoints.push(mFreeCp[1]!);
      continue;
    }
    standalone.push(o);
  }

  for (const o of standalone) {
    groups.push({ kind: "exact", key: o.key, label: o.label, category: o.category });
    lines.push(`- ${o.key} | ${o.label}`);
  }

  if (unrecordedDests.length > 0) {
    const summary = `Discard current city card to fly to ANY other city (${unrecordedDests.length} legal)`;
    groups.push({ kind: "template", template: "unrecorded:<city>", summary, count: unrecordedDests.length, category: "action" });
    lines.push(`- unrecorded:<city> | ${summary}`);
  }
  if (unrecordedCarryDests.length > 0) {
    const summary = `Unrecorded flight carrying teams to ANY city (${unrecordedCarryDests.length} legal)`;
    groups.push({ kind: "template", template: "unrecorded-carry:<city>", summary, count: unrecordedCarryDests.length, category: "action" });
    lines.push(`- unrecorded-carry:<city> | ${summary}`);
  }
  if (clinicDests.size > 0) {
    const summary = `Discard any City card (${[...clinicCards].join(",")}) to fly to ANY city`;
    groups.push({ kind: "template", template: "clinic-fly:<cardCity>:<destCity>", summary, count: clinicDests.size, category: "action" });
    lines.push(`- clinic-fly:<cardCity>:<destCity> | ${summary}`);
  }
  for (const [prefix, dests] of coordGroups.entries()) {
    const summary = `${dests.length} cities: ${dests.join(",")}`;
    groups.push({ kind: "template", template: `${prefix}:<city>`, summary, count: dests.length, category: "action" });
    lines.push(`- ${prefix}:<city> | ${summary}`);
  }
  if (freeCheckpoints.length > 0) {
    const preview = freeCheckpoints.slice(0, 12).join(", ");
    const summary = `Any unconnected adjacent pair (${freeCheckpoints.length} legal; e.g. ${preview})`;
    groups.push({ kind: "template", template: "free-checkpoint:<cityA>:<cityB>", summary, count: freeCheckpoints.length, category: "decision" });
    lines.push(`- free-checkpoint:<cityA>:<cityB> | ${summary}`);
  }
  if (buyAssets.size > 0) {
    for (const [assetId, info] of buyAssets.entries()) {
      const def = pack.assetById[assetId];
      const tpl = info.needsCity
        ? `buy:asset:${assetId}:<passport>:<aff>:<city>`
        : `buy:asset:${assetId}:<passport>:<aff>`;
      const cityNote = info.needsCity ? (info.sovietOnly ? " [Soviet city]" : " [any city]") : "";
      const summary = `${def.name} (${info.cost}b${cityNote}) -> [${info.targets.join(", ")}] — ${def.text}`;
      groups.push({ kind: "template", template: tpl, summary, count: info.targets.length, category: "upkeep" });
      lines.push(`- ${tpl} | ${summary}`);
    }
  }

  // Contextual batch/parameterized helpers only when relevant
  const g = view.game;
  if (view.phase === "setup.threat" && (g?.openingThreatsLeft ?? 0) > 0 && !g?.pendingTop) {
    lines.push(`- flip-all-threats | Shortcut: flip all ${g!.openingThreatsLeft} opening Threat cards`);
  }
  if (view.phase === "playing.threat" && (g?.threatsLeft ?? 0) > 0 && !g?.pendingTop) {
    lines.push(`- draw-all-threats | Shortcut: draw all ${g!.threatsLeft} Threat cards (pauses on decisions)`);
  }
  if (g?.pendingTop?.t === "escalation") {
    lines.push(`- resolve-escalation | Shortcut: step through Escalation (pauses at intensify if someone holds Counter-Intelligence)`);
  }
  if (view.phase === "setup.events") {
    lines.push(`- pick-events <ev1,ev2,...> [disc=N] | Choose specific unlocked Event cards before confirm-events`);
  }
  if (g?.pendingTop?.t === "psych-questions") {
    lines.push(`- psych <q=val> ... | Custom answers (e.g. psych 1=AGREE 2=DISAGREE 3=AGREE or psych 5=3 6=4)`);
  }
  if (g?.pendingTop?.t === "create-aliases") {
    const aff = g.pendingTop.affiliation;
    lines.push(`- create-aliases ${aff} black=<name>:<occ> green=<name>:<occ> pink=<name>:<occ> white=<name>:<occ> | Custom names/occupations (or use create-aliases:${aff})`);
  }

  return { groups, lines };
}

export function renderCompactState(
  world: World,
  player: PlayerId,
  undoDepth: number,
  ctx: CompactStateContext,
): CompactStatePacket {
  const view = viewFor(world, player, 30);
  const options = ctx.sessionGameFinished ? [] : optionsFor(world, player, undoDepth);
  const { groups, lines: optionLines } = compactOptions(view, options);

  const c = view.campaign;
  const g = view.game;
  const out: string[] = [];

  if (ctx.actionFeedback) out.push(`RESULT: ${ctx.actionFeedback}`);
  if (ctx.notice) out.push(`NOTICE: ${ctx.notice}`);

  if (ctx.sessionGameFinished) {
    out.push(
      `=== GAME COMPLETE (${view.phase === "finished" ? `CAMPAIGN FINISHED, SCORE=${c.finalScore ?? "?"}` : "RETURNED TO LOBBY"}) ===`,
    );
  }

  if (ctx.inspectResults && ctx.inspectResults.length > 0) {
    for (const item of ctx.inspectResults) {
      out.push(`\n[INSPECT: ${item.query}]\n${item.content}`);
    }
  }

  if (ctx.unreadReadings.length > 0) {
    for (const r of ctx.unreadReadings) {
      out.push(`\n=== VERBATIM #${r.id} [${r.kind.toUpperCase()} ${r.ref}] ${r.title} ===`);
      out.push(r.text);
    }
  }

  if (ctx.strategyUpdate) {
    out.push(`\n--- TEAM STRATEGY (UPDATED) ---\n${ctx.strategyUpdate}`);
  }

  if (ctx.unreadChat.length > 0) {
    out.push(`\n--- NEW CHAT ---`);
    for (const m of ctx.unreadChat) {
      out.push(`#${m.seq} ${m.name}(${m.player}): ${m.text}`);
    }
  }

  const mTag = c.month === 0 ? "Prologue" : `M${c.month}A${c.attempt} ${c.monthName}`;
  out.push(
    `\n=== ${mTag} | ${view.phase} | ${c.branch.toUpperCase()} | Fund:${c.funding} | You:${view.viewer}(${view.viewerSeat ?? "-"}) ===`,
  );
  out.push(`Waiting: ${ctx.waitingFor}`);

  if (!g) {
    out.push(
      `Table: ${view.table.seats
        .map((s) => {
          const pp = world.campaign.seating.find((x) => x.seat === s.seat)?.passport ?? "none";
          return `${s.player}=${s.name}[${s.seat}/passport:${pp}]`;
        })
        .join(", ")}`,
    );
    if (c.results.length > 0) {
      const last = c.results[c.results.length - 1]!;
      out.push(
        `Last: ${pack.monthNames[last.month]} A${last.attempt} -> ${last.evaluation} (ok:${last.completedObjectives} fail:${last.failedObjectives} fund:${last.fundingBefore}->${last.fundingAfter})`,
      );
    }
  } else {
    out.push(
      `T${g.turn} | Active:${g.active} | Acts:${g.actionsLeft} | Threat:${g.threatLevel}(${g.threatLevelIndex + 1}/6) | Decks P:${g.playerDeckCount} T:${g.threatDeckCount}/disc:${g.threatDiscard.length}/end:${g.gameEndArea.length}`,
    );

    const effects: string[] = [];
    if (g.coverOfDarknessActive) effects.push("CoverOfDarkness");
    if (g.skipThreat) effects.push("OneQuietNight(skipThreat)");
    if (g.ignoredRestrictionThisTurn) effects.push(`Ignoring:${g.ignoredRestrictionThisTurn}`);
    if (effects.length > 0) out.push(`Effects: ${effects.join(", ")}`);
    if (g.peekedThreatCards.length > 0) {
      out.push(
        `PeekedThreat: ${g.peekedThreatCards.map((t) => (t.kind === "infection" ? `INF:${t.city}` : t.city)).join(" -> ")}`,
      );
    }

    const sup = g.supplies;
    const supParts = [`ag:${sup.agents}/36`, `inc:${sup.incidentOutbreakTokens}/7`, `sh:${sup.safehouses}/8`];
    if (c.diseaseCubeSupplyMax > 0) supParts.push(`cubes:${sup.diseaseCubes}/${c.diseaseCubeSupplyMax}`);
    if (c.rules.includes("E")) supParts.push(`actTok:${sup.actionTokens}/12`);
    if (c.rules.includes("K")) supParts.push(`pursuit:${sup.pursuitTokens}/12`);
    if (c.rules.includes("N")) supParts.push(`cp:${sup.checkpointTokens}/12`);
    if (c.rules.includes("D")) supParts.push(`sat:${sup.satellites}/5[${g.satellites.join(",")}]`);
    if (c.rules.includes("H")) supParts.push(`symp:${sup.symptoms.length}/12`);
    out.push(`Sup: ${supParts.join(" | ")}`);

    if (g.activeRestrictions.length > 0) {
      out.push(
        `Restrictions: ${g.activeRestrictions.map((r) => `${r}(${pack.restrictionById[r].text})`).join(" ; ")}`,
      );
    }

    if (g.pendingTop) {
      const owner = decisionOwner(world);
      out.push(`\n! DECISION [${g.pendingTop.t}] owner=${owner ?? "team"} (${g.pendingCount} queued)`);
      if (g.pendingTop.t === "psych-questions") {
        for (const q of g.pendingTop.questions) {
          out.push(`  Q${q.number}(${q.kind}): ${q.prompt}`);
        }
      } else if (g.pendingTop.t === "create-aliases") {
        const aff = g.pendingTop.affiliation;
        out.push(`  Create ${aff} aliases (1 unique occupation per passport black/green/pink/white):`);
        for (const o of pack.occupations.filter((x) => x.affiliation === aff)) {
          out.push(`  - ${o.id} (${o.name}): ${o.text}`);
        }
      } else if (g.pendingTop.t === "room-choice") {
        const r = pack.roomById[g.pendingTop.room];
        out.push(`  Room ${r.name}: ${r.text}`);
      } else if (g.pendingTop.t === "forecast") {
        out.push(
          `  Top->Bottom: ${g.pendingTop.cards.map((t) => `${t.id}(${t.kind === "infection" ? "INF:" : ""}${t.city})`).join(", ")}`,
        );
      } else if (g.pendingTop.t === "escalation") {
        const discardTop = g.threatDiscard.slice(-4).map((t) => `${t.id}(${t.city})`).join(", ");
        out.push(
          `  Step=${g.pendingTop.step} left=${g.pendingTop.escalationsLeft}${g.pendingTop.drawnBottomCity ? ` drawn=${g.pendingTop.drawnBottomCity}` : ""} | recentThreatDiscard=[${discardTop}]`,
        );
      } else {
        out.push(`  ${JSON.stringify(g.pendingTop)}`);
      }
    }

    if (view.phase === "setup.events") {
      out.push(
        `\nEVENTS (max ${c.funding}${c.discretionaryBudgetBoxesLeft ? ` + up to ${c.discretionaryBudgetBoxesLeft} disc` : ""}, selected=[${g.pickedEvents.join(",")}]):`,
      );
      for (const evId of c.unlockedEvents) {
        const ev = pack.eventById[evId];
        const mark = g.pickedEvents.includes(evId) ? "*" : " ";
        out.push(`  ${mark} ${ev.id}: ${ev.text}`);
      }
    }

    if (g.objectives.length > 0) {
      out.push(`\nOBJECTIVES:`);
      for (const o of g.objectives) {
        const bits: string[] = [];
        if (o.targetCities) bits.push(`targets=[${o.targetCities.join(",")}]`);
        if (o.requiredTeamsPerCity && o.requiredTeamsPerCity > 1) bits.push(`teams=${o.requiredTeamsPerCity}`);
        if (o.kind === "unknown-city") {
          bits.push(
            o.targetRevealed
              ? `TARGET=${o.revealedTargetCity}`
              : `unknown(${o.unknownRegion ?? o.unknownAffiliation ?? "cc"}; elim=${o.eliminatedCities.join(",") || "none"})`,
          );
        }
        if (o.trialCities.length > 0) bits.push(`trials=[${o.trialCities.join(",")}]`);
        if (o.infiltrationSite) {
          bits.push(`site=${o.infiltrationSite}/${o.infiltrationRoom} disc=${o.infiltrationDiscardCount}${o.infiltrationDiscardAffiliation ? ` ${o.infiltrationDiscardAffiliation}` : ""}`);
        }
        if (o.hint) bits.push(`hint:${o.hint}`);
        out.push(
          `  [${o.status.toUpperCase()}] ${o.id}: ${o.title} — ${o.description}${bits.length ? ` | ${bits.join(" | ")}` : ""}`,
        );
      }
    }

    out.push(`\nPLAYERS:`);
    for (const seat of g.seats) {
      const p = g.players[seat];
      const ts = view.table.seats.find((s) => s.seat === seat);
      const star = g.active === seat ? "*" : " ";
      let alias = "Prologue";
      if (p.tempAlias) {
        alias = `Temp:${pack.occupationById[p.tempAlias].name}`;
      } else if (p.passport && p.activeAlias) {
        const al = c.passports[p.passport].aliases[p.activeAlias];
        const occ = al.occupation ? pack.occupationById[al.occupation].name : "?";
        const spec = al.specialization ? `+${al.specialization}` : "";
        const cov = `${al.coverTrackLength - al.coverScratched}/${al.coverTrackLength}`;
        const assets = al.assets
          .filter((a) => !a.dead)
          .map((a) => `${a.id}${a.city ? `@${a.city}` : ""}${a.id === "suitcase-full-of-money" ? `(${a.boxesChecked}/3)` : ""}`)
          .join(",");
        const libs = al.liabilities.map((l) => `${l.id}${l.region ? `@${l.region}` : ""}`).join(",");
        alias = `${p.passport}/${p.activeAlias} "${al.name}" [${occ}${spec}] cov:${cov}${assets ? ` A:[${assets}]` : ""}${libs ? ` L:[${libs}]` : ""}`;
      } else if (p.needsTempAlias) {
        alias = "BURNED";
      }
      const loc = p.infiltration ? `${p.infiltration.site}/${p.infiltration.room}@${p.location}` : p.location;
      const tok = p.actionTokens > 0 ? ` tok:${p.actionTokens}` : "";
      out.push(`${star} ${ts?.player ?? seat}[${seat}] @ ${loc} | ${alias}${tok}`);
      out.push(`    H(${p.hand.length}/${p.handLimit}): ${p.hand.map((h) => shortCard(h.card)).join(", ") || "(empty)"}`);
    }

    const deployedTeams = g.teams.filter((t) => t.city !== null);
    if (deployedTeams.length > 0 || g.checkpoints.length > 0) {
      const tStr = deployedTeams
        .map((t) => `${t.id}@${t.city}${pack.cityById[t.city!].affiliation === t.affiliation ? "*" : ""}`)
        .join(", ");
      const cpStr = g.checkpoints.length > 0 ? ` | CP: ${g.checkpoints.map(([a, b]) => `${a}-${b}`).join(",")}` : "";
      out.push(`Teams(${deployedTeams.length}/9, *=active): ${tStr || "none"}${cpStr}`);
    }

    const pawnCities = new Set(g.seats.map((s) => g.players[s].location));
    const teamCities = new Set(deployedTeams.map((t) => t.city!));
    const hotspots: string[] = [];
    for (const ct of pack.cities) {
      const st = g.cities[ct.id];
      const active =
        st.agents > 0 ||
        st.diseaseCubes > 0 ||
        st.effectiveSurveillance > 0 ||
        st.incidents > 0 ||
        st.outbreaks > 0 ||
        st.safehouse ||
        st.pursuit ||
        st.exposedIntensity !== null ||
        st.contaminated ||
        st.controlCenter ||
        pawnCities.has(ct.id) ||
        teamCities.has(ct.id);
      if (!active) continue;
      const tags: string[] = [];
      if (st.agents > 0) tags.push(`ag:${st.agents}`);
      if (st.diseaseCubes > 0) tags.push(`dis:${st.diseaseCubes}`);
      if (st.safehouse) tags.push(st.permanentSafehouse ? "SH*" : "SH");
      if (st.effectiveSurveillance > 0) tags.push(`surv:${st.effectiveSurveillance}`);
      if (st.incidents > 0) tags.push(`INC:${st.incidents}`);
      if (st.outbreaks > 0) tags.push(`OUT:${st.outbreaks}`);
      if (st.pursuit) tags.push("PURS");
      if (st.exposedIntensity !== null) tags.push(`EXP${st.exposedIntensity}`);
      if (st.contaminated) tags.push("CONT");
      if (st.controlCenter) tags.push(st.bugged ? "CC*" : "CC");
      hotspots.push(tags.length > 0 ? `${ct.id}[${ct.affiliation[0]!.toUpperCase()}](${tags.join(",")})` : `${ct.id}[${ct.affiliation[0]!.toUpperCase()}]`);
    }
    out.push(`Board(${hotspots.length}): ${hotspots.join(" | ")}`);

    const siteIds = Object.keys(g.infiltrationSites) as InfiltrationSiteId[];
    if (siteIds.length > 0) {
      out.push(
        `Sites(inspect "sites"): ${siteIds.map((sid) => {
          const s = g.infiltrationSites[sid]!;
          return `${sid}(${s.tokens.filter((t) => t.revealed).length}/${s.tokens.length})`;
        }).join(", ")}`,
      );
    }

    if (g.upkeep) {
      const rem = g.upkeep.budget - g.upkeep.spent;
      out.push(`\nUPKEEP: Budget ${rem} left (${g.upkeep.spent}/${g.upkeep.budget} spent) | Confirmed: [${g.upkeep.done.join(",") || "none"}]`);
      const eligSH = g.upkeep.safehouseCities.filter((ct) => !g.cities[ct].permanentSafehouse);
      out.push(`  PermSH(3b, ${c.availablePermanentSafehouses} left): ${eligSH.join(",") || "none"} | CounterSurv(1b): ${c.availableCounterSurveillance} left`);
      const aliasSlots: string[] = [];
      for (const color of PASSPORT_COLORS) {
        for (const aff of ["allied", "neutral", "soviet"] as const satisfies readonly Affiliation[]) {
          const al = c.passports[color].aliases[aff];
          if (al.created && !al.burned) {
            aliasSlots.push(`${color}:${aff}(${al.assets.length}/3)`);
          }
        }
      }
      if (aliasSlots.length > 0) out.push(`  Alias asset slots: ${aliasSlots.join(", ")}`);
      if (g.upkeep.bought.length > 0) {
        out.push(
          `  Bought: ${g.upkeep.bought.map((b, i) => `#${i}:${JSON.stringify(b.purchase)}(${b.cost}b)`).join("; ")}`,
        );
      }
    }

    if (ctx.deltaLog.length > 0) {
      out.push(`\nRECENT EVENTS:`);
      for (const e of ctx.deltaLog.slice(-14)) {
        out.push(`  ${formatLogLine(e)}`);
      }
    }
  }

  out.push(`\nACTIONS (${options.length}):`);
  out.push(...optionLines);

  return {
    phase: view.phase,
    month: c.month,
    monthName: c.monthName,
    attempt: c.attempt,
    branch: c.branch,
    funding: c.funding,
    viewer: view.viewer,
    viewerSeat: view.viewerSeat,
    waitingFor: ctx.waitingFor,
    sessionGameFinished: ctx.sessionGameFinished,
    turn: g?.turn ?? null,
    activeSeat: g?.active ?? null,
    actionsLeft: g?.actionsLeft ?? null,
    pendingTop: g?.pendingTop ?? null,
    unreadReadings: ctx.unreadReadings,
    unreadChat: ctx.unreadChat,
    deltaLog: ctx.deltaLog.slice(-14).map(formatLogLine),
    options: groups,
    compactText: out.join("\n"),
  };
}

export function buildUnreadReadings(world: World, afterId: number): ReadingEntry[] {
  return readingsSince(world, afterId);
}

export function currentPhase(world: World): PlayerView["phase"] {
  return phaseOf(world);
}

export function currentTopDecision(world: World) {
  return topDecision(world);
}
