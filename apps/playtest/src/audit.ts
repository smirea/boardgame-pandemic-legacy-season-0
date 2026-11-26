import type { Command, LogEntry, Phase, World } from "@repo/game";
import { hasRule, pack } from "@repo/game";

export type AuditState = {
  totalCommands: number;
  phases: Record<string, number>;
  commands: Record<string, number>;
  actions: Record<string, number>;
  events: Record<string, number>;
  decisions: Record<string, number>;
  occupationsUsed: Record<string, number>;
  specializationsUsed: Record<string, number>;
  assetsUsed: Record<string, number>;
  liabilitiesGained: Record<string, number>;
  restrictionsSeen: Record<string, number>;
  boxesOpened: string[];
  doorsOpened: string[];
  rulesUnlocked: string[];
  legacyCardsRead: string[];
  debriefsRead: string[];
  operationsCardsRead: string[];
  sitesEntered: string[];
  roomsEntered: Record<string, number>;
  pearlDoorsOpened: number[];
  tunnelsUnlocked: string[];
  incidentsByKind: Record<string, number>;
  outbreaks: number;
  chainOutbreaks: number;
  burnedAliases: number;
  satellitesLaunched: number;
  satellitesDisabled: number;
  satellitesDestroyed: number;
  evaluations: Record<string, number>;
  undoCount: number;
  refundCount: number;
  invariantViolations: {
    at: string;
    month: number;
    attempt: number;
    command: string;
    errors: string[];
  }[];
  rejections: {
    at: string;
    player: string;
    expr: string;
    reason: string;
  }[];
};

export function createAuditState(): AuditState {
  return {
    totalCommands: 0,
    phases: {},
    commands: {},
    actions: {},
    events: {},
    decisions: {},
    occupationsUsed: {},
    specializationsUsed: {},
    assetsUsed: {},
    liabilitiesGained: {},
    restrictionsSeen: {},
    boxesOpened: [],
    doorsOpened: [],
    rulesUnlocked: [],
    legacyCardsRead: [],
    debriefsRead: [],
    operationsCardsRead: [],
    sitesEntered: [],
    roomsEntered: {},
    pearlDoorsOpened: [],
    tunnelsUnlocked: [],
    incidentsByKind: {},
    outbreaks: 0,
    chainOutbreaks: 0,
    burnedAliases: 0,
    satellitesLaunched: 0,
    satellitesDisabled: 0,
    satellitesDestroyed: 0,
    evaluations: {},
    undoCount: 0,
    refundCount: 0,
    invariantViolations: [],
    rejections: [],
  };
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function addUnique<T>(arr: T[], val: T): void {
  if (!arr.includes(val)) arr.push(val);
}

export function recordCommandAudit(
  audit: AuditState,
  phaseAfter: Phase,
  cmd: Command,
  world: World,
  newLogEntries: LogEntry[],
  violationErrors: string[],
): void {
  audit.totalCommands += 1;
  bump(audit.phases, phaseAfter);
  bump(audit.commands, cmd.type);

  if (cmd.type === "ACTION") {
    bump(audit.actions, cmd.action.a);
    if (cmd.action.a === "treat") bump(audit.specializationsUsed, "treat");
    if (cmd.action.a === "drive" && cmd.action.carryTeams?.length) {
      bump(audit.specializationsUsed, "transport-crew");
    }
    if (cmd.action.a === "commercial-flight" && cmd.action.carryTeams?.length) {
      bump(audit.specializationsUsed, "transport-crew");
    }
    if (cmd.action.a === "unrecorded-flight" && cmd.action.carryTeams?.length) {
      bump(audit.specializationsUsed, "transport-crew");
    }
    if (cmd.action.a === "cargo-pilot-flight" && cmd.action.carryTeams?.length) {
      bump(audit.specializationsUsed, "transport-crew");
    }
    if (cmd.action.a === "visa-move" && cmd.action.carryTeams?.length) {
      bump(audit.specializationsUsed, "transport-crew");
    }
    if (cmd.action.a === "visa-move") bump(audit.assetsUsed, cmd.action.asset);
    const assetActionMap: Record<string, string> = {
      "shop-owner-swap": "shop-owner",
      "crime-boss-remove": "crime-boss",
      "politician-give": "politician",
      "field-medic-treat": "field-medic",
      "cobbler-convert": "cobbler",
      "test-pilot-remove-satellite": "test-pilot",
      "spy-camera-draw": "spy-camera",
      "auth-424-remove": "auth-424",
      "auth-715-clear": "auth-715",
      "auth-405-move-team": "auth-405",
      "black-book-safehouse": "black-book",
      "experimental-medicine-treat": "experimental-medicine",
      "unapproved-supplements-treat": "unapproved-supplements",
      "tracking-device-peek": "tracking-device",
    };
    const mappedAsset = assetActionMap[cmd.action.a];
    if (mappedAsset) bump(audit.assetsUsed, mappedAsset);
  } else if (cmd.type === "PLAY") {
    bump(audit.events, cmd.play.e);
  } else if (cmd.type === "DECIDE") {
    bump(audit.decisions, cmd.answer.t);
    if (cmd.answer.t === "choose-liability") {
      bump(audit.liabilitiesGained, cmd.answer.liability);
    }
    if (cmd.answer.t === "cover-mitigation" && cmd.answer.choice === "suitcase") {
      bump(audit.assetsUsed, "suitcase-full-of-money");
    }
  } else if (cmd.type === "UNDO") {
    audit.undoCount += 1;
  } else if (cmd.type === "REFUND") {
    audit.refundCount += 1;
  }

  // Sync campaign unlocks & active player occupations/assets
  const c = world.campaign;
  if (!audit.legacyCardsRead) audit.legacyCardsRead = [];
  if (!audit.debriefsRead) audit.debriefsRead = [];
  if (!audit.operationsCardsRead) audit.operationsCardsRead = [];
  for (const r of c.readings) {
    if (r.kind === "legacy") addUnique(audit.legacyCardsRead, r.ref);
    else if (r.kind === "debrief") addUnique(audit.debriefsRead, r.ref);
    else if (r.kind === "operations") addUnique(audit.operationsCardsRead, r.ref);
  }
  for (const b of c.openedBoxes) addUnique(audit.boxesOpened, b);
  for (const d of c.openedDoors) addUnique(audit.doorsOpened, d);
  for (const r of c.rules) addUnique(audit.rulesUnlocked, r);
  for (const pd of c.pearlOpenedDoors) addUnique(audit.pearlDoorsOpened, pd);
  for (const t of c.pearlTunnels) addUnique(audit.tunnelsUnlocked, t);
  for (const res of c.restrictions) bump(audit.restrictionsSeen, res, 0);

  if (world.game) {
    for (const res of world.game.activeRestrictions) {
      if (!audit.restrictionsSeen[res]) audit.restrictionsSeen[res] = 1;
    }
    for (const s of world.game.seats) {
      const p = world.game.players[s];
      if (p.tempAlias) {
        if (!audit.occupationsUsed[p.tempAlias]) audit.occupationsUsed[p.tempAlias] = 1;
      } else if (p.passport && p.activeAlias) {
        const al = c.passports[p.passport].aliases[p.activeAlias];
        if (al.occupation && !audit.occupationsUsed[al.occupation]) {
          audit.occupationsUsed[al.occupation] = 1;
        }
        if (al.specialization === "deep-cover" && cmd.type === "ACTION" && cmd.action.a === "neutralize-agent") {
          bump(audit.specializationsUsed, "deep-cover");
        }
        for (const a of al.assets) {
          if (!a.dead && !audit.assetsUsed[a.id]) audit.assetsUsed[a.id] = 1;
        }
      }
    }
  }

  // Scan new log entries for incidents, outbreaks, infiltration rooms, satellites, burns
  for (const entry of newLogEntries) {
    if (entry.t === "incident") {
      bump(audit.incidentsByKind, entry.title);
    } else if (entry.t === "outbreak") {
      audit.outbreaks += 1;
      if (entry.chain) audit.chainOutbreaks += 1;
    } else if (entry.t === "burned") {
      audit.burnedAliases += 1;
    } else if (entry.t === "infiltration") {
      addUnique(audit.sitesEntered, entry.site);
      bump(audit.roomsEntered, entry.room);
    } else if (entry.t === "satellite") {
      if (entry.action === "launched") audit.satellitesLaunched += 1;
      if (entry.action === "disabled" || entry.action === "removed") audit.satellitesDisabled += 1;
      if (entry.action === "destroyed") audit.satellitesDestroyed += 1;
    }
  }

  // Record evaluations cleanly by recounting c.results
  const evalCounts: Record<string, number> = {};
  for (const res of c.results) {
    bump(evalCounts, res.evaluation);
  }
  audit.evaluations = evalCounts;

  if (violationErrors.length > 0) {
    audit.invariantViolations.push({
      at: new Date().toISOString(),
      month: c.month,
      attempt: c.attempt,
      command: cmd.type,
      errors: violationErrors,
    });
  }
}

export function untouchedTargetsForWorld(audit: AuditState, world: World): {
  actions: string[];
  events: string[];
  assets: string[];
  rooms: string[];
  misc: string[];
} {
  const c = world.campaign;

  const coreActions = [
    "drive",
    "commercial-flight",
    "unrecorded-flight",
    "neutralize-agent",
    "share-intel",
    "build-safehouse",
    "identify-target-city",
    "assemble-team",
    "drive-team",
    "acquire-targets",
  ];
  const unlockedActions = [...coreActions];
  if (hasRule(c, "L")) unlockedActions.push("disrupt-trial");
  if (hasRule(c, "M")) unlockedActions.push("change-alias");
  if (hasRule(c, "E")) unlockedActions.push("spend-action-token");
  if (hasRule(c, "N")) unlockedActions.push("create-checkpoint");
  if (hasRule(c, "O")) unlockedActions.push("get-treatment");
  if (hasRule(c, "T")) unlockedActions.push("disable-satellite");
  if (hasRule(c, "P")) unlockedActions.push("enter-infiltration", "exit-infiltration");
  if (hasRule(c, "Q")) unlockedActions.push("infiltrate", "complete-infiltration-objective");
  if (hasRule(c, "U")) unlockedActions.push("unlock-hatchway");
  if (c.openedBoxes.includes("0001")) unlockedActions.push("treat");

  const actions = unlockedActions.filter((a) => !audit.actions[a]);
  const events = c.unlockedEvents.filter((e) => !audit.events[e]);
  const assets = c.availableAssets.filter((a) => !audit.assetsUsed[a]);

  const rooms: string[] = [];
  if (c.openedBoxes.includes("0003")) {
    for (const r of pack.sites.pearl.rooms) {
      if (!audit.roomsEntered[r.id]) rooms.push(r.id);
    }
  }

  const misc: string[] = [];
  if (audit.undoCount === 0) misc.push("Test UNDO during Do Actions");
  if (audit.refundCount === 0 && c.month >= 1) misc.push("Test REFUND during Spend Budget (upkeep)");
  if (c.discretionaryBudgetBoxesLeft && c.discretionaryBudgetBoxesLeft > 0) {
    misc.push("Test Discretionary Budget (+1 Event card) in setup.events");
  }
  if (c.helpFromSabikBoxesLeft && c.helpFromSabikBoxesLeft > 0 && !audit.actions["use-help-from-sabik"]) {
    misc.push("Test Help from Sabik free action to ignore a Restriction");
  }

  return { actions, events, assets, rooms, misc };
}

export function formatAuditSummary(audit: AuditState, world: World): string {
  const c = world.campaign;
  const lines: string[] = [];
  lines.push(`=== CAMPAIGN COVERAGE & AUDIT ===`);
  lines.push(
    `Month: ${pack.monthNames[c.month]} (Attempt ${c.attempt}) | Branch: ${c.branch.toUpperCase()} | Funding: ${c.funding} | Commands: ${audit.totalCommands}`,
  );
  lines.push(
    `Games recorded: ${c.results.length} (${Object.entries(audit.evaluations).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}) | Final Score: ${c.finalScore ?? "n/a"}`,
  );
  lines.push(`Invariant violations: ${audit.invariantViolations.length} | Rejected commands: ${audit.rejections.length}`);
  lines.push(`Phases hit (${Object.keys(audit.phases).length}/13): ${Object.keys(audit.phases).sort().join(", ")}`);
  lines.push(`Commands hit (${Object.keys(audit.commands).length}/23): ${Object.keys(audit.commands).sort().join(", ")}`);
  lines.push(`Actions hit (${Object.keys(audit.actions).length}/42): ${Object.keys(audit.actions).sort().join(", ")}`);
  lines.push(`Events played (${Object.keys(audit.events).length}/${c.unlockedEvents.length} unlocked / 17 total): ${Object.keys(audit.events).sort().join(", ") || "none"}`);
  lines.push(`Decisions resolved (${Object.keys(audit.decisions).length}/26): ${Object.keys(audit.decisions).sort().join(", ") || "none"}`);
  lines.push(`Occupations used (${Object.keys(audit.occupationsUsed).length}/12): ${Object.keys(audit.occupationsUsed).sort().join(", ") || "none"}`);
  lines.push(`Specializations used (${Object.keys(audit.specializationsUsed).length}/3): ${Object.keys(audit.specializationsUsed).sort().join(", ") || "none"}`);
  lines.push(`Assets used (${Object.keys(audit.assetsUsed).length}/${pack.assets.length}): ${Object.keys(audit.assetsUsed).sort().join(", ") || "none"}`);
  lines.push(`Liabilities gained (${Object.keys(audit.liabilitiesGained).length}/24): ${Object.keys(audit.liabilitiesGained).sort().join(", ") || "none"}`);
  lines.push(`Boxes opened (${audit.boxesOpened.length}/8): ${audit.boxesOpened.join(", ") || "none"}`);
  lines.push(`Doors opened (${audit.doorsOpened.length}/43): ${audit.doorsOpened.join(", ") || "none"}`);
  lines.push(`Rules unlocked (${audit.rulesUnlocked.length}/27): ${audit.rulesUnlocked.join(", ") || "none"}`);
  lines.push(
    `Verbatim readings delivered: ${c.readings.length} total (Legacy=${audit.legacyCardsRead?.length ?? 0}, Debriefs=${audit.debriefsRead?.length ?? 0}, Ops=${audit.operationsCardsRead?.length ?? 0})`,
  );
  lines.push(`Sites entered (${audit.sitesEntered.length}/4): ${audit.sitesEntered.join(", ") || "none"} | Rooms (${Object.keys(audit.roomsEntered).length}/28): ${Object.keys(audit.roomsEntered).sort().join(", ") || "none"}`);
  lines.push(`PEARL doors opened (${audit.pearlDoorsOpened.length}/14): ${audit.pearlDoorsOpened.join(", ") || "none"} | Tunnels: ${audit.tunnelsUnlocked.join(", ") || "none"}`);
  lines.push(
    `Incidents: ${Object.entries(audit.incidentsByKind).map(([k, v]) => `${k}=${v}`).join(", ") || "none"} | Outbreaks: ${audit.outbreaks} (chain=${audit.chainOutbreaks}) | Burned: ${audit.burnedAliases} | Satellites: +${audit.satellitesLaunched}/-${audit.satellitesDisabled}/x${audit.satellitesDestroyed}`,
  );
  lines.push(`Undo used: ${audit.undoCount} | Refund used: ${audit.refundCount}`);
  if (audit.invariantViolations.length > 0) {
    lines.push(`\n!!! INVARIANT VIOLATIONS !!!`);
    for (const v of audit.invariantViolations) {
      lines.push(`  - [${v.month}/${v.attempt}] ${v.command}: ${v.errors.join("; ")}`);
    }
  }
  return lines.join("\n");
}
