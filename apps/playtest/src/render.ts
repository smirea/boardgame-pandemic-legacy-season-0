import type {
  AssetId,
  CityId,
  EventId,
  InfiltrationSiteId,
  LiabilityId,
  LogEntry,
  OccupationId,
  OptionItem,
  PlayerCard,
  PlayerView,
  ReadingEntry,
  RestrictionId,
  SpecializationId,
} from "@repo/game";
import { formatSecuritySymbol, pack, PASSPORT_COLORS } from "@repo/game";

export type ChatMessage = {
  seq: number;
  at: string;
  player: string;
  name: string;
  text: string;
};

function formatCard(card: PlayerCard): string {
  if (card.kind === "city") {
    const ct = pack.cityById[card.city];
    return `${ct.id} (${ct.affiliation[0]!.toUpperCase()}/${ct.region}/#${ct.keypad})`;
  }
  if (card.kind === "event") {
    const ev = pack.eventById[card.event];
    return `EVENT:${ev.id} ["${ev.name}"]`;
  }
  if (card.kind === "symptom") return `SYMPTOM:${card.name}`;
  if (card.kind === "satellite") return `SATELLITE:${card.region}`;
  return card.kind.toUpperCase();
}

export function renderReadings(readings: ReadingEntry[]): string {
  if (readings.length === 0) return "";
  const lines: string[] = [];
  for (const r of readings) {
    lines.push(`\n==================== VERBATIM TEXT (#${r.id} · ${r.kind.toUpperCase()} · ${r.ref}) ====================`);
    lines.push(`TITLE: ${r.title}`);
    lines.push(r.text);
    lines.push(`==============================================================================`);
  }
  return lines.join("\n");
}

export function renderStatus(
  view: PlayerView,
  options: OptionItem[],
  unreadReadings: ReadingEntry[],
  unreadChat: ChatMessage[],
  meta: { sessionGameFinished: boolean; waitingFor: string; actionFeedback?: string },
): string {
  const c = view.campaign;
  const g = view.game;
  const lines: string[] = [];

  if (meta.actionFeedback) {
    lines.push(`>>> ${meta.actionFeedback}`);
  }

  if (meta.sessionGameFinished) {
    lines.push(
      `\n*** SESSION COMPLETE (${c.month === 12 && view.phase === "finished" ? "CAMPAIGN FINISHED" : "GAME COMPLETE — BACK IN LOBBY"}) ***`,
    );
    lines.push(
      `Do NOT start the next game! Update your memory file, write your post-game report, and end your turn.`,
    );
  }

  // Always show unread verbatim readings right at the top so agents never miss card text!
  if (unreadReadings.length > 0) {
    lines.push(renderReadings(unreadReadings));
  }

  if (unreadChat.length > 0) {
    lines.push(`\n--- NEW TABLE CHAT ---`);
    for (const m of unreadChat) {
      lines.push(`[#${m.seq}] ${m.name} (${m.player}): ${m.text}`);
    }
  }

  lines.push(
    `\n=== STATUS: ${c.monthName}${c.month > 0 ? ` (Attempt ${c.attempt})` : ""} | Phase: ${view.phase} | Branch: ${c.branch.toUpperCase()} | Funding: ${c.funding} | You: ${view.viewer} (${view.viewerSeat ?? "unseated"}) ===`,
  );
  lines.push(`Waiting for: ${meta.waitingFor}`);

  if (!g) {
    lines.push(
      `Table: ${view.table.seats.map((s) => `${s.player}=${s.name}[${s.seat}]`).join(", ") || "empty"}`,
    );
    if (c.results.length > 0) {
      const last = c.results[c.results.length - 1]!;
      lines.push(
        `Last game: ${pack.monthNames[last.month]} Att ${last.attempt} -> ${last.evaluation} (${last.completedObjectives} ok, ${last.failedObjectives} failed, funding ${last.fundingBefore}->${last.fundingAfter})`,
      );
    }
    if (c.door14State === "ignored") {
      lines.push(`NOTE: Door 14 New Zealand briefcase is still ignored and may be resolved now!`);
    }
  } else {
    lines.push(
      `Turn ${g.turn} | Active: ${g.active} | Actions left: ${g.actionsLeft} | Threat Level: ${g.threatLevel} (slot ${g.threatLevelIndex + 1}/6) | Player Deck: ${g.playerDeckCount} | Threat Deck: ${g.threatDeckCount} (Discard: ${g.threatDiscard.length}, GameEndArea: ${g.gameEndArea.length})`,
    );
    if (g.coverOfDarknessActive) lines.push(`ACTIVE EFFECT: Cover of Darkness is active this turn!`);
    if (g.skipThreat) lines.push(`ACTIVE EFFECT: One Quiet Night — Threat step will be skipped!`);
    if (g.ignoredRestrictionThisTurn) {
      lines.push(`ACTIVE EFFECT: Help from Sabik ignoring ${g.ignoredRestrictionThisTurn} this turn!`);
    }
    if (g.peekedThreatCards.length > 0) {
      lines.push(
        `PEEKED TOP THREAT CARDS: ${g.peekedThreatCards.map((t) => (t.kind === "infection" ? `INFECTION:${t.city}` : t.city)).join(" -> ")}`,
      );
    }

    // Pending decision banner
    if (g.pendingTop) {
      lines.push(`\n!!! PENDING DECISION (${g.pendingCount} queued): ${g.pendingTop.t} !!!`);
      lines.push(`Details: ${JSON.stringify(g.pendingTop)}`);
      if (g.pendingTop.t === "room-choice") {
        const r = pack.roomById[g.pendingTop.room];
        lines.push(`Room text (${r.name}): ${r.text}`);
      }
      if (g.pendingTop.t === "psych-questions") {
        for (const q of g.pendingTop.questions) {
          lines.push(`  Q${q.number} (${q.kind}): ${q.prompt}`);
        }
      }
      if (g.pendingTop.t === "forecast") {
        lines.push(
          `  Current top->bottom: ${g.pendingTop.cards.map((t) => `${t.id}(${t.kind === "infection" ? "INF:" : ""}${t.city})`).join(", ")}`,
        );
      }
      if (g.pendingTop.t === "create-aliases") {
        const aff = g.pendingTop.affiliation;
        const occs = pack.occupations.filter((o) => o.affiliation === aff);
        lines.push(`  Available ${aff} occupations (assign 1 unique to each of black/green/pink/white):`);
        for (const o of occs) {
          lines.push(`    - ${o.id} (${o.name}): ${o.text}`);
        }
      }
    }

    if (view.phase === "setup.events") {
      lines.push(`\n--- EVENT SELECTION (Funding: ${c.funding}${c.discretionaryBudgetBoxesLeft ? `, Discretionary Budget boxes left: ${c.discretionaryBudgetBoxesLeft}` : ""}) ---`);
      lines.push(`Currently selected (${g.pickedEvents.length}): ${g.pickedEvents.join(", ") || "none"}`);
      lines.push(`Unlocked Events (${c.unlockedEvents.length} — use 'do pick-events ev1,ev2,... [disc=N]' to change):`);
      for (const evId of c.unlockedEvents) {
        const ev = pack.eventById[evId];
        const sel = g.pickedEvents.includes(evId) ? "[SELECTED]" : "[        ]";
        lines.push(`  ${sel} ${ev.id}: ${ev.text}`);
      }
    }

    // Objectives
    lines.push(`\n--- OBJECTIVES ---`);
    for (const obj of g.objectives) {
      const extra: string[] = [];
      if (obj.targetCities) extra.push(`targets=[${obj.targetCities.join(",")}]`);
      if (obj.requiredTeamsPerCity && obj.requiredTeamsPerCity > 1) {
        extra.push(`teams=${obj.requiredTeamsPerCity}`);
      }
      if (obj.kind === "unknown-city") {
        extra.push(
          obj.targetRevealed
            ? `REVEALED=${obj.revealedTargetCity}`
            : `hidden(${obj.unknownRegion ?? obj.unknownAffiliation ?? "control-centers"}; eliminated=${obj.eliminatedCities.join(",") || "none"})`,
        );
      }
      if (obj.trialCities.length > 0) extra.push(`trials=[${obj.trialCities.join(",")}]`);
      if (obj.infiltrationSite) {
        extra.push(`site=${obj.infiltrationSite}/${obj.infiltrationRoom} (discard ${obj.infiltrationDiscardCount}${obj.infiltrationDiscardAffiliation ? " " + obj.infiltrationDiscardAffiliation : ""})`);
      }
      if (obj.hint) extra.push(`HINT: ${obj.hint}`);
      lines.push(`  [${obj.status.toUpperCase()}] ${obj.id} (${obj.cardCode}): ${obj.title}`);
      lines.push(`      ${obj.description}${extra.length ? ` | ${extra.join(" | ")}` : ""}`);
    }

    // Supplies & Restrictions
    const sup = g.supplies;
    const supParts = [
      `agents=${sup.agents}/36`,
      `inc/out=${sup.incidentOutbreakTokens}/7`,
      `safehouses=${sup.safehouses}/8`,
    ];
    if (c.diseaseCubeSupplyMax > 0) supParts.push(`cubes=${sup.diseaseCubes}/${c.diseaseCubeSupplyMax}`);
    if (c.rules.includes("E")) supParts.push(`actionTok=${sup.actionTokens}/12`);
    if (c.rules.includes("K")) supParts.push(`pursuit=${sup.pursuitTokens}/12`);
    if (c.rules.includes("N")) supParts.push(`checkpoints=${sup.checkpointTokens}/12`);
    if (c.rules.includes("D")) supParts.push(`satellites=${sup.satellites}/5 (active:[${g.satellites.join(",")}])`);
    if (c.rules.includes("H")) supParts.push(`symptomsLeft=${sup.symptoms.length}/12`);
    lines.push(`\nSupplies: ${supParts.join(" | ")}`);
    if (g.activeRestrictions.length > 0) {
      lines.push(
        `ACTIVE RESTRICTIONS: ${g.activeRestrictions.map((r) => `${r} ("${pack.restrictionById[r].text}")`).join(" ; ")}`,
      );
    }
    if (c.helpFromSabikBoxesLeft) {
      lines.push(`Help from Sabik boxes left: ${c.helpFromSabikBoxesLeft}/3`);
    }

    // Players & Hands
    lines.push(`\n--- PLAYERS ---`);
    for (const seat of g.seats) {
      const p = g.players[seat];
      const ts = view.table.seats.find((s) => s.seat === seat);
      const marker = g.active === seat ? "*" : " ";
      let aliasStr = "";
      if (p.tempAlias) {
        aliasStr = `Temp:${pack.occupationById[p.tempAlias].name}`;
      } else if (p.passport && p.activeAlias) {
        const al = c.passports[p.passport].aliases[p.activeAlias];
        const occName = al.occupation ? pack.occupationById[al.occupation].name : "?";
        const specStr = al.specialization ? `+${al.specialization}` : "";
        const coverLeft = al.coverTrack.length - al.coverScratched;
        const nextPip = al.coverTrack[al.coverScratched] ?? "BURNED";
        const assetsStr = al.assets
          .filter((a) => !a.dead)
          .map((a) => `${a.id}${a.city ? `@${a.city}` : ""}${a.id === "suitcase-full-of-money" ? `(${a.boxesChecked}/3)` : ""}`)
          .join(",");
        const libsStr = al.liabilities
          .map((l) => `${l.id}${l.region ? `@${l.region}` : ""}`)
          .join(",");
        aliasStr = `${p.passport}/${p.activeAlias} "${al.name}" [${occName}${specStr}] cover=${coverLeft}/${al.coverTrack.length}(next:${nextPip})${assetsStr ? ` assets=[${assetsStr}]` : ""}${libsStr ? ` libs=[${libsStr}]` : ""}`;
      } else if (p.needsTempAlias) {
        aliasStr = "BURNED (picking temp alias next turn)";
      }
      const locStr = p.infiltration
        ? `IN ${p.infiltration.site}/${p.infiltration.room} (${p.location})`
        : p.location;
      const tokStr = p.actionTokens > 0 ? ` actTok=${p.actionTokens}` : "";
      lines.push(
        `${marker} ${seat} (${ts?.player ?? "?"} ${ts?.name ?? ""}) @ ${locStr} | ${aliasStr}${tokStr}`,
      );
      lines.push(
        `    Hand (${p.hand.length}/${p.handLimit}): ${p.hand.map((h) => formatCard(h.card)).join(", ") || "(empty)"}`,
      );
    }

    // Teams & Checkpoints
    const deployedTeams = g.teams.filter((t) => t.city !== null);
    lines.push(
      `\nTeams on board (${deployedTeams.length}/9): ${
        deployedTeams
          .map((t) => {
            const active = pack.cityById[t.city!].affiliation === t.affiliation;
            return `${t.id}@${t.city}${active ? "(ACTIVE)" : "(inactive)"}`;
          })
          .join(", ") || "none"
      }`,
    );
    if (g.checkpoints.length > 0) {
      lines.push(`Checkpoints: ${g.checkpoints.map(([a, b]) => `${a}<->${b}`).join(", ")}`);
    }

    // Board Hotspots (compact)
    const hotspots: string[] = [];
    const pawnCities = new Set(g.seats.map((s) => g.players[s].location));
    const teamCities = new Set(deployedTeams.map((t) => t.city!));
    for (const ct of pack.cities) {
      const st = g.cities[ct.id];
      const interesting =
        st.agents > 0 ||
        st.diseaseCubes > 0 ||
        st.incidents > 0 ||
        st.outbreaks > 0 ||
        st.safehouse ||
        st.pursuit ||
        st.exposedIntensity !== null ||
        st.contaminated ||
        st.controlCenter ||
        pawnCities.has(ct.id) ||
        teamCities.has(ct.id);
      if (!interesting) continue;
      const tags: string[] = [];
      if (st.agents > 0) tags.push(`A:${st.agents}`);
      if (st.diseaseCubes > 0) tags.push(`D:${st.diseaseCubes}`);
      if (st.safehouse) tags.push(st.permanentSafehouse ? "SH*" : "SH");
      if (st.effectiveSurveillance > 0) tags.push(`S:${st.effectiveSurveillance}`);
      if (st.incidents > 0) tags.push(`INC:${st.incidents}`);
      if (st.outbreaks > 0) tags.push(`OUT:${st.outbreaks}`);
      if (st.pursuit) tags.push("PURSUIT");
      if (st.exposedIntensity !== null) tags.push(`EXP(${st.exposedIntensity})`);
      if (st.contaminated) tags.push("CONTAM");
      if (st.controlCenter) tags.push(st.bugged ? "CC(BUG)" : "CC");
      hotspots.push(`${ct.id}[${ct.affiliation[0]!.toUpperCase()}](${tags.join(",")})`);
    }
    lines.push(`\nBoard Hotspots (${hotspots.length}; run 'board' for all 48): ${hotspots.join(" | ")}`);

    // Infiltration Sites summary
    const siteIds = Object.keys(g.infiltrationSites) as InfiltrationSiteId[];
    if (siteIds.length > 0) {
      const summaries = siteIds.map((sid) => {
        const s = g.infiltrationSites[sid]!;
        const rev = s.tokens.filter((t) => t.revealed).length;
        return `${sid}(${rev}/${s.tokens.length} tokens revealed)`;
      });
      lines.push(`Infiltration Sites (run 'sites' for graph): ${summaries.join(", ")}`);
    }

    // Upkeep
    if (g.upkeep) {
      lines.push(`\n--- SPEND BUDGET (UPKEEP) ---`);
      lines.push(
        `Budget: ${g.upkeep.budget - g.upkeep.spent} left (${g.upkeep.spent}/${g.upkeep.budget} spent) | Confirmed: [${g.upkeep.done.join(", ") || "none"}]`,
      );
      lines.push(
        `Eligible Permanent Safehouse cities (3b, ${c.availablePermanentSafehouses} stickers left): ${g.upkeep.safehouseCities.join(", ") || "none"}`,
      );
      lines.push(`Counter-Surveillance stickers left (1b): ${c.availableCounterSurveillance}`);
      lines.push(
        `Available Assets: ${c.availableAssets.map((a) => `${a}(${pack.assetById[a].cost}b)`).join(", ") || "none"}`,
      );
      if (g.upkeep.bought.length > 0) {
        lines.push(
          `Bought this upkeep: ${g.upkeep.bought.map((b, i) => `#${i}:${JSON.stringify(b.purchase)}(${b.cost}b)`).join("; ")}`,
        );
      }
    }

    // Recent log tail (last 6 entries)
    if (g.recentLog.length > 0) {
      lines.push(`\nRecent Log:`);
      for (const e of g.recentLog.slice(-6)) {
        lines.push(`  ${formatLogLine(e)}`);
      }
    }
  }

  // Legal Options
  lines.push(`\n--- OPTIONS (${options.length}) ---`);
  if (options.length === 0) {
    lines.push(`  (No moves right now — run 'wait' to wait for your turn or teammate updates)`);
  } else {
    const shown = options.slice(0, 60);
    for (const o of shown) {
      lines.push(`  ${o.key}  —  ${o.label}`);
    }
    if (options.length > shown.length) {
      lines.push(`  ... +${options.length - shown.length} more options (use specific syntax from GUIDE.md)`);
    }
  }

  return lines.join("\n");
}

export function formatLogLine(e: LogEntry): string {
  switch (e.t) {
    case "turn":
      return `#${e.seq} TURN ${e.turn} (${e.seat})`;
    case "action":
      return `#${e.seq} [${e.seat}] ${e.action} (cost ${e.cost}): ${e.detail}`;
    case "move":
      return `#${e.seq} MOVE ${e.seat}: ${e.from} -> ${e.to} (${e.by})`;
    case "team-move":
      return `#${e.seq} TEAM ${e.team}: ${e.from ?? "supply"} -> ${e.to} (${e.by})`;
    case "draw":
      return `#${e.seq} DRAW ${e.seat}: ${e.cards.join(", ")}`;
    case "escalation":
      return `#${e.seq} ESCALATION[${e.step}]: ${e.detail}`;
    case "satellite":
      return `#${e.seq} SATELLITE ${e.region}: ${e.action}`;
    case "threat":
      return `#${e.seq} THREAT ${e.city}: ${e.effect}`;
    case "incident":
      return `#${e.seq} INCIDENT in ${e.city} (bottom=${e.bottomCard} ${e.title}): ${e.detail}`;
    case "outbreak":
      return `#${e.seq} ${e.chain ? "CHAIN " : ""}OUTBREAK in ${e.city}`;
    case "cover":
      return `#${e.seq} COVER ${e.seat}: ${e.result} (${e.source})`;
    case "burned":
      return `#${e.seq} BURNED ${e.seat}: ${e.passport}/${e.alias}`;
    case "symptom":
      return `#${e.seq} SYMPTOM ${e.seat}: ${e.action} ${e.name}`;
    case "event":
      return `#${e.seq} EVENT ${e.seat} [${e.event}]: ${e.detail}`;
    case "objective":
      return `#${e.seq} OBJECTIVE ${e.objective} ${e.status.toUpperCase()}: ${e.detail}`;
    case "infiltration":
      return `#${e.seq} INFILTRATION ${e.seat} @ ${e.site}/${e.room}: ${e.detail}`;
    case "pursuit":
      return `#${e.seq} PURSUIT: ${e.detail}`;
    case "reading":
      return `#${e.seq} READING #${e.readingId} [${e.kind}] ${e.title}`;
    case "note":
      return `#${e.seq} NOTE: ${e.text}`;
    case "end":
      return `#${e.seq} GAME END (${e.evaluation ?? "pending"}): ${e.reason}`;
    case "phase":
      return `#${e.seq} PHASE: ${e.phase}`;
  }
}

export function renderBoard(view: PlayerView): string {
  const g = view.game;
  const lines: string[] = ["=== FULL 48-CITY BOARD ==="];
  for (const reg of pack.regions) {
    lines.push(`\n[${pack.regionNames[reg]}]${g?.satellites.includes(reg) ? " *** SATELLITE ACTIVE (+1 SURV) ***" : ""}`);
    for (const ct of pack.cities.filter((x) => x.region === reg)) {
      const st = g?.cities[ct.id];
      const base = `${ct.id} (${ct.affiliation[0]!.toUpperCase()}, #${ct.keypad})`;
      const conn = `-> ${ct.connections.join(",")}`;
      if (!st) {
        lines.push(`  ${base} | ${conn}`);
        continue;
      }
      const flags: string[] = [];
      if (st.agents) flags.push(`A:${st.agents}`);
      if (st.diseaseCubes) flags.push(`D:${st.diseaseCubes}`);
      if (st.effectiveSurveillance) flags.push(`S:${st.effectiveSurveillance}`);
      if (st.safehouse) flags.push(st.permanentSafehouse ? "SH*" : "SH");
      if (st.incidents) flags.push(`INC:${st.incidents}`);
      if (st.outbreaks) flags.push(`OUT:${st.outbreaks}`);
      if (st.pursuit) flags.push("PURSUIT");
      if (st.exposedIntensity !== null) flags.push(`EXP(${st.exposedIntensity})`);
      if (st.contaminated) flags.push("CONTAM");
      if (st.controlCenter) flags.push(st.bugged ? "CC(BUG)" : "CC");
      lines.push(`  ${base} [${flags.join(",") || "clear"}] ${conn}`);
    }
  }
  return lines.join("\n");
}

export function renderSites(view: PlayerView): string {
  const g = view.game;
  if (!g) return "No active game.";
  const siteIds = Object.keys(g.infiltrationSites) as InfiltrationSiteId[];
  if (siteIds.length === 0) return "No Infiltration Sites currently in play.";
  const lines: string[] = ["=== INFILTRATION SITES ==="];
  for (const sid of siteIds) {
    const def = pack.sites[sid];
    const active = g.infiltrationSites[sid]!;
    lines.push(`\n## ${def.name} (${sid}) — City: ${def.city}, Required Alias: ${def.requiredAffiliation}`);
    lines.push("Rooms:");
    for (const r of def.rooms) {
      const opened =
        sid !== "pearl" ||
        (r.pearlDoor !== undefined && view.campaign.pearlOpenedDoors.includes(r.pearlDoor));
      const occupants = g.seats.filter(
        (s) => g.players[s].infiltration?.site === sid && g.players[s].infiltration?.room === r.id,
      );
      const doorTag = r.pearlDoor !== undefined ? ` [Door ${r.pearlDoor}]` : "";
      const occTag = occupants.length ? ` <--- PAWNS: ${occupants.join(",")}` : "";
      if (opened) {
        const overrideText =
          r.id === "pearl-records-room" && view.campaign.pearlDoor41Placed
            ? "DOOR 41 OVERRIDE: When you enter this room, reveal the City card underneath Stop Operation LION'S TOOTH!"
            : r.text;
        lines.push(`  - ${r.id} (${r.name}${doorTag})${occTag}: ${overrideText}`);
      } else {
        lines.push(`  - ${r.id} [UNOPENED PEARL Door ${r.pearlDoor}]`);
      }
    }
    lines.push("Connections:");
    for (const edge of def.edges) {
      if (edge.hatchway) {
        const tun = view.campaign.pearlTunnels.includes(edge.id) ? "TUNNEL OPEN (1 card)" : "LOCKED HATCHWAY (sum>=10 to unlock)";
        lines.push(`  - ${edge.id}: ${edge.a} <-> ${edge.b} [${tun}]`);
      } else {
        const toks = active.tokens.filter((t) => t.edgeId === edge.id);
        const tokDesc = toks
          .map((t) => (t.revealed && t.symbol ? `${t.id}=${formatSecuritySymbol(t.symbol)}` : `${t.id}=?`))
          .join(", ");
        lines.push(`  - ${edge.id}: ${edge.a} <-> ${edge.b} [${tokDesc}]`);
      }
    }
  }
  return lines.join("\n");
}

export function renderFiles(view: PlayerView): string {
  const c = view.campaign;
  const lines: string[] = ["=== CAMPAIGN FILES & PASSPORTS ==="];
  lines.push(`Unlocked Rules (${c.rules.length}): ${c.rules.join(", ") || "none"}`);
  lines.push(`Opened Boxes: ${c.openedBoxes.join(", ") || "none"}`);
  lines.push(`Opened Doors: ${c.openedDoors.join(", ") || "none"}`);
  lines.push(`Campaign Restrictions: ${c.restrictions.map((r) => `${r} (${pack.restrictionById[r].text})`).join("; ") || "none"}`);

  lines.push(`\n--- INTELLIGENCE FILE (${c.intelFile.length}) ---`);
  for (const item of c.intelFile) {
    lines.push(`* [${item.id}] ${item.title}\n${item.text}\n`);
  }

  lines.push(`\n--- PERSONNEL FILE (${c.personnelFile.length}) ---`);
  for (const item of c.personnelFile) {
    lines.push(`* [${item.id}] ${item.title}\n${item.text}\n`);
  }

  lines.push(`\n--- PASSPORTS ---`);
  for (const color of PASSPORT_COLORS) {
    const p = c.passports[color];
    lines.push(`Passport ${color.toUpperCase()} (Chronic Infections: ${p.chronicInfections}):`);
    for (const aff of ["allied", "neutral", "soviet"] as const) {
      const al = p.aliases[aff];
      if (!al.created) {
        lines.push(`  - ${aff}: (not yet created)`);
        continue;
      }
      const occ = al.occupation ? `${pack.occupationById[al.occupation].name} — ${pack.occupationById[al.occupation].text}` : "none";
      const spec = al.specialization ? `${pack.specializationById[al.specialization].name} — ${pack.specializationById[al.specialization].text}` : "none";
      const cover = `${al.coverScratched}/${al.coverTrack.length} scratched [${al.coverTrack.slice(al.coverScratched).join(",")}]`;
      const assets = al.assets
        .map((a) => `${a.id}${a.city ? `@${a.city}` : ""}${a.dead ? "(DEAD)" : ""}${a.id === "suitcase-full-of-money" ? `(${a.boxesChecked}/3)` : ""}`)
        .join(", ");
      const libs = al.liabilities.map((l) => `${l.id}${l.region ? `@${l.region}` : ""}`).join(", ");
      lines.push(
        `  - ${aff}${al.burned ? " [BURNED]" : ""}: "${al.name}" | Occ: ${occ} | Spec: ${spec} | Cover: ${cover} | Assets(${al.assets.length}/3): ${assets || "none"} | Liabilities(${al.liabilities.length}/2): ${libs || "none"}`,
      );
    }
  }
  return lines.join("\n");
}

export function renderInfo(id: string): string {
  if (id in pack.eventById) {
    const e = pack.eventById[id as EventId];
    return `EVENT ${e.id} — ${e.name}\n${e.text}`;
  }
  if (id in pack.assetById) {
    const a = pack.assetById[id as AssetId];
    return `ASSET ${a.id} (${a.category}, cost ${a.cost}) — ${a.name}\n${a.text}`;
  }
  if (id in pack.liabilityById) {
    const l = pack.liabilityById[id as LiabilityId];
    return `LIABILITY ${l.id} — ${l.name}\n${l.text}`;
  }
  if (id in pack.occupationById) {
    const o = pack.occupationById[id as OccupationId];
    return `OCCUPATION ${o.id} (${o.affiliation}) — ${o.name}\n${o.text}`;
  }
  if (id in pack.specializationById) {
    const s = pack.specializationById[id as SpecializationId];
    return `SPECIALIZATION ${s.id} (${s.affiliation}) — ${s.name}\n${s.text}`;
  }
  if (id in pack.restrictionById) {
    const r = pack.restrictionById[id as RestrictionId];
    return `RESTRICTION ${r.id} (Ops ${r.opsNumber}) — ${r.name}\n${r.text}`;
  }
  if (id in pack.cityById) {
    const ct = pack.cityById[id as CityId];
    return `CITY ${ct.id} — ${ct.name}, ${ct.country} (${ct.affiliation}, ${pack.regionNames[ct.region]}, keypad #${ct.keypad})\nConnections: ${ct.connections.join(", ")}\nIncident (${ct.incidentTitle}): ${ct.incidentText}`;
  }
  if (id in pack.doorArchive) {
    return `DOOR ${id}:\n${pack.doorArchive[id]!.join("\n\n")}`;
  }
  return `No entry found for '${id}'. Try an event, asset, liability, occupation, specialization, restriction, city, or door ID.`;
}
