import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  AnimationCue,
  Command,
  Decision,
  GameRecording,
  GameSession,
  Phase,
  PlayerId,
  Save,
  SeatId,
  World,
} from "@repo/game";
import {
  advanceThroughMonth,
  createGameSession,
  createRecording,
  decisionOwner,
  optionsFor,
  pack,
  parseSave,
  PASSPORT_COLORS,
  phaseOf,
  readingsSince,
  replayRecording,
  SEAT_IDS,
  seatOfPlayer,
  topDecision,
  toSave,
  viewFor,
  violations,
} from "@repo/game";
import type { AuditState } from "./audit";
import { createAuditState, formatAuditSummary, recordCommandAudit } from "./audit";
import { parseDoCommand } from "./commands";
import type { PlayerSpec } from "./harnesses";
import type { ChatMessage } from "./render";
import {
  formatLogLine,
  renderBoard,
  renderFiles,
  renderInfo,
  renderReadings,
  renderSites,
} from "./render";
import type { CompactStatePacket } from "./serialize";
import { renderCompactState } from "./serialize";

export type HostPlayer = PlayerSpec & {
  seat: SeatId;
  passport: (typeof PASSPORT_COLORS)[number];
  lead: boolean;
};

export type GameHostOptions = {
  runDir: string;
  memoryDir: string;
  players: PlayerSpec[];
  seed?: number;
  startMonth?: number;
  savePath?: string;
  port?: number;
};

export type CommandApiResult = {
  ok: boolean;
  error?: string;
  feedback?: string;
  phaseBefore: Phase;
  phaseAfter: Phase;
  executedCount: number;
  newReadingsCount: number;
  pendingTop: Decision | null;
  violations: string[];
  sessionGameFinished: boolean;
  cues: AnimationCue[];
  trace: string[];
  gameTag?: string;
};

export type CompletedGameRecord = {
  tag: string;
  month: number;
  monthName: string;
  attempt: 1 | 2;
  evaluation: string;
  completedObjectives: number;
  failedObjectives: number;
  turns: number;
  incidents: number;
  outbreaks: number;
  fundingBefore: number;
  fundingAfter: number;
  savePath: string;
  recordingPath: string | null;
  replayOk: boolean;
  replaySteps: number;
  replayError?: string;
  violationCount: number;
};

type PlayerCursors = {
  reading: Record<PlayerId, number>;
  chat: Record<PlayerId, number>;
  log: Record<PlayerId, number>;
  strategyVersion: Record<PlayerId, number>;
};

/** Splits a CLI-style command expression while preserving quoted tokens and raw JSON payloads. */
export function tokenizeCommandExpr(expr: string): string[] {
  const trimmed = expr.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("raw ")) {
    return ["raw", trimmed.slice(4).trim()];
  }
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

export class GameHost {
  readonly runDir: string;
  readonly memoryDir: string;
  readonly players: HostPlayer[];
  readonly session: GameSession;
  readonly audit: AuditState;
  readonly chatLog: ChatMessage[] = [];
  readonly completedGames: CompletedGameRecord[] = [];

  private readonly cursors: PlayerCursors = {
    reading: {},
    chat: {},
    log: {},
    strategyVersion: {},
  };
  private strategyVersion = 0;
  private sessionGameStarted = false;
  private sessionGameFinished = false;
  private activeRecording: GameRecording | null = null;
  private lastGameTag: string | null = null;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private readonly latestSavePath: string;
  private readonly auditPath: string;
  private readonly chatPath: string;
  private readonly actionsPath: string;
  private readonly issuesPath: string;
  private readonly strategyPath: string;

  constructor(options: GameHostOptions) {
    if (options.players.length < 2 || options.players.length > 4) {
      throw new Error(`Pandemic Legacy: Season 0 requires 2 to 4 players (got ${options.players.length})`);
    }

    const seenIds = new Set<string>();
    for (const p of options.players) {
      if (seenIds.has(p.id)) {
        throw new Error(`Duplicate player id '${p.id}' — player names must be distinct`);
      }
      seenIds.add(p.id);
    }

    this.runDir = resolve(options.runDir);
    this.memoryDir = resolve(options.memoryDir);
    for (const sub of ["", "saves", "records", "reports", "transcripts"]) {
      mkdirSync(join(this.runDir, sub), { recursive: true });
    }
    mkdirSync(this.memoryDir, { recursive: true });

    this.latestSavePath = join(this.runDir, "saves/latest.json");
    this.auditPath = join(this.runDir, "audit.json");
    this.chatPath = join(this.runDir, "chat.jsonl");
    this.actionsPath = join(this.runDir, "actions.jsonl");
    this.issuesPath = join(this.runDir, "issues.jsonl");
    this.strategyPath = join(this.memoryDir, "strategy.md");

    this.players = options.players.map((p, idx) => ({
      ...p,
      seat: SEAT_IDS[idx]!,
      passport: PASSPORT_COLORS[idx]!,
      lead: idx === 0,
    }));

    this.audit = createAuditState();

    if (options.savePath) {
      const fullSavePath = resolve(options.savePath);
      if (!existsSync(fullSavePath)) {
        throw new Error(`Save file not found: ${fullSavePath}`);
      }
      const save: Save = parseSave(JSON.parse(readFileSync(fullSavePath, "utf8")));
      this.rebindSaveSeats(save.world);
      this.session = createGameSession({ save });
      if (this.session.state.world.table.seats.length === 0) {
        this.seatAllPlayers();
      }
      const existingMax = this.session.state.world.campaign.readings.at(-1)?.id ?? 0;
      for (const p of this.players) {
        this.cursors.reading[p.id] = existingMax;
      }
    } else {
      const seed = options.seed ?? 1962;
      this.session = createGameSession({ seed });
      this.seatAllPlayers();
      const targetMonth = options.startMonth ?? 1;
      if (targetMonth < 0 || targetMonth > 12 || !Number.isInteger(targetMonth)) {
        throw new Error(`Invalid month '${targetMonth}' (expected 0..12)`);
      }
      if (targetMonth >= 1) {
        const res = this.session.dispatch({ type: "BEGIN_JANUARY", player: this.leadPlayer.id });
        if (!res.ok) throw new Error(`Failed to enter January: ${res.error}`);
      }
      if (targetMonth >= 2) {
        let safety = 0;
        while (
          this.session.state.world.campaign.month < targetMonth &&
          phaseOf(this.session.state.world) !== "finished"
        ) {
          if (++safety > 30) {
            throw new Error(`Could not advance campaign to month ${targetMonth}`);
          }
          advanceThroughMonth(this.session);
        }
        // Reset reading cursors to current count so agents starting at month M only get new month M+ readings
        const existingMax = this.session.state.world.campaign.readings.at(-1)?.id ?? 0;
        for (const p of this.players) {
          this.cursors.reading[p.id] = existingMax;
        }
      }
    }

    const initialPhase = phaseOf(this.session.state.world);
    this.sessionGameStarted = initialPhase !== "lobby";
    this.sessionGameFinished = initialPhase === "finished";
    if (this.sessionGameStarted && !this.sessionGameFinished) {
      this.activeRecording = createRecording(toSave(this.session));
    }

    if (existsSync(this.strategyPath)) {
      this.strategyVersion = 1;
    }

    for (const p of this.players) {
      const memPath = this.memoryPathOf(p.id);
      if (!existsSync(memPath)) {
        writeFileSync(
          memPath,
          `# ${p.name} (${p.seat}) Memory\n\nNo games completed yet. Record campaign events, alias details, board changes, story clues, and lessons learned here.\n`,
        );
      }
      this.cursors.strategyVersion[p.id] = this.strategyVersion;
    }

    this.persistAll();
  }

  get leadPlayer(): HostPlayer {
    return this.players[0]!;
  }

  get world(): World {
    return this.session.state.world;
  }

  get undoDepth(): number {
    return this.session.state.undo.length;
  }

  get isGameFinished(): boolean {
    return this.sessionGameFinished;
  }

  get url(): string {
    if (!this.server) throw new Error("GameHost HTTP server has not been started");
    return `http://127.0.0.1:${this.server.port}`;
  }

  memoryPathOf(playerId: PlayerId): string {
    return join(this.memoryDir, `${playerId}.md`);
  }

  readMemory(playerId: PlayerId): string {
    const p = this.memoryPathOf(playerId);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }

  writeMemory(playerId: PlayerId, content: string): void {
    writeFileSync(this.memoryPathOf(playerId), content.trimEnd() + "\n");
  }

  readStrategy(): string {
    return existsSync(this.strategyPath) ? readFileSync(this.strategyPath, "utf8") : "";
  }

  writeStrategy(author: PlayerId, content: string): void {
    writeFileSync(this.strategyPath, content.trimEnd() + "\n");
    this.strategyVersion += 1;
    this.cursors.strategyVersion[author] = this.strategyVersion;
  }

  writeGameReport(playerId: PlayerId, content: string, tag?: string): string {
    const gameTag = tag ?? this.lastGameTag ?? this.currentGameTag();
    const outPath = join(this.runDir, "reports", `${gameTag}-${playerId}.md`);
    writeFileSync(outPath, content.trimEnd() + "\n");
    return outPath;
  }

  currentGameTag(): string {
    const c = this.world.campaign;
    const monthName = (pack.monthNames[c.month] ?? `m${c.month}`).toLowerCase();
    return `g${String(c.results.length + 1).padStart(2, "0")}-${monthName}-a${c.attempt}`;
  }

  private seatAllPlayers(): void {
    for (const p of this.players) {
      const joinRes = this.session.dispatch({
        type: "JOIN",
        player: p.id,
        name: p.name,
        seat: p.seat,
      });
      if (!joinRes.ok) throw new Error(`Failed to join ${p.id}: ${joinRes.error}`);
      const passRes = this.session.dispatch({
        type: "ASSIGN_PASSPORT",
        player: p.id,
        seat: p.seat,
        passport: p.passport,
      });
      if (!passRes.ok) throw new Error(`Failed to assign passport for ${p.id}: ${passRes.error}`);
    }
  }

  private rebindSaveSeats(world: World): void {
    if (world.table.seats.length === 0) return;
    if (world.table.seats.length !== this.players.length) {
      throw new Error(
        `Save has ${world.table.seats.length} seated player(s), but ${this.players.length} --player flag(s) were supplied`,
      );
    }
    const oldToNew = new Map<string, HostPlayer>();
    world.table.seats.sort((a, b) => SEAT_IDS.indexOf(a.seat) - SEAT_IDS.indexOf(b.seat));
    world.table.seats.forEach((entry, idx) => {
      const hp = this.players[idx]!;
      oldToNew.set(entry.player, hp);
      hp.seat = entry.seat;
      const savedPassport = world.campaign.seating.find((s) => s.seat === entry.seat)?.passport;
      if (savedPassport) hp.passport = savedPassport;
      entry.player = hp.id;
      entry.name = hp.name;
    });
    if (world.game?.upkeep) {
      world.game.upkeep.done = world.game.upkeep.done.map((oldId) => oldToNew.get(oldId)?.id ?? oldId);
    }
  }

  waitingForSummary(): string {
    const world = this.world;
    const phase = phaseOf(world);
    if (this.sessionGameFinished) return "Game complete (debrief & memory update)";
    if (phase === "finished") return "Campaign finished";
    if (phase === "lobby") return `${this.leadPlayer.id} to run 'start-game'`;
    const g = world.game;
    if (!g) return this.leadPlayer.id;

    const top = topDecision(world);
    if (top) {
      const owner = decisionOwner(world);
      if (owner) {
        const p = world.table.seats.find((s) => s.seat === owner)?.player ?? owner;
        return `${p}(${owner}) to resolve '${top.t}'`;
      }
      return `Team (${this.leadPlayer.id} lead) to resolve '${top.t}'`;
    }
    if (phase === "setup.threat") return `${this.leadPlayer.id} to flip opening threats`;
    if (phase === "setup.events") return `${this.leadPlayer.id} to pick/confirm Event cards`;
    if (phase === "setup.aliases") {
      const pendingSeats = g.seats.filter((s) => !g.aliasesChosen.includes(s));
      const names = pendingSeats.map((s) => world.table.seats.find((ts) => ts.seat === s)?.player ?? s);
      return `${names.join(", ")} to choose starting alias`;
    }
    if (phase === "over") return `${this.leadPlayer.id} to run 'continue'`;
    if (phase === "upkeep") {
      const notDone = world.table.seats
        .map((s) => s.player)
        .filter((pid) => !g.upkeep?.done.includes(pid));
      return `Upkeep (${notDone.join(", ")} remaining)`;
    }
    const activePlayer = world.table.seats.find((s) => s.seat === g.active)?.player ?? g.active;
    return `${activePlayer}(${g.active}) in ${phase}`;
  }

  getStatePacket(
    player: PlayerId,
    options: {
      consume?: boolean;
      actionFeedback?: string | null;
      notice?: string | null;
      inspectResults?: { query: string; content: string }[];
    } = {},
  ): CompactStatePacket {
    const consume = options.consume ?? true;
    const world = this.world;

    const lastRead = this.cursors.reading[player] ?? 0;
    const unreadReadings = readingsSince(world, lastRead);
    if (consume && unreadReadings.length > 0) {
      this.cursors.reading[player] = unreadReadings[unreadReadings.length - 1]!.id;
    }

    const lastChat = this.cursors.chat[player] ?? 0;
    const unreadChat = this.chatLog.filter((m) => m.seq > lastChat && m.player !== player);
    if (consume && this.chatLog.length > 0) {
      this.cursors.chat[player] = this.chatLog[this.chatLog.length - 1]!.seq;
    }

    const g = world.game;
    const lastLogSeq = this.cursors.log[player] ?? 0;
    const deltaLog = g ? g.log.filter((e) => e.seq > lastLogSeq) : [];
    if (consume && g && g.log.length > 0) {
      this.cursors.log[player] = g.log[g.log.length - 1]!.seq;
    }

    let strategyUpdate: string | null = null;
    if ((this.cursors.strategyVersion[player] ?? 0) < this.strategyVersion) {
      strategyUpdate = this.readStrategy() || null;
      if (consume) this.cursors.strategyVersion[player] = this.strategyVersion;
    }

    return renderCompactState(world, player, this.undoDepth, {
      unreadReadings,
      unreadChat,
      deltaLog,
      inspectResults: options.inspectResults,
      strategyUpdate,
      actionFeedback: options.actionFeedback,
      waitingFor: this.waitingForSummary(),
      sessionGameFinished: this.sessionGameFinished,
      notice: options.notice,
    });
  }

  inspect(player: PlayerId, query: string): string {
    const q = query.trim();
    const view = viewFor(this.world, player);
    if (q === "board") return renderBoard(view);
    if (q === "sites") return renderSites(view);
    if (q === "files") return renderFiles(view);
    if (q === "strategy") return this.readStrategy() || "(No shared strategy written yet.)";
    if (q === "memory") return this.readMemory(player) || "(Memory empty.)";
    if (q === "log" || q.startsWith("log:")) {
      const n = q.startsWith("log:") ? Number(q.slice(4)) || 30 : 30;
      const g = this.world.game;
      return g ? g.log.slice(-n).map(formatLogLine).join("\n") : "No active game log.";
    }
    if (q === "readings" || q.startsWith("readings:")) {
      const after = q.startsWith("readings:") ? Number(q.slice(9)) || 0 : 0;
      const list = readingsSince(this.world, after);
      return list.length > 0 ? renderReadings(list) : `No readings after #${after}.`;
    }
    if (q.startsWith("info:")) {
      return renderInfo(q.slice(5).trim());
    }
    return renderInfo(q);
  }

  postChat(player: PlayerId, text: string): ChatMessage {
    const ts = this.world.table.seats.find((s) => s.player === player);
    const msg: ChatMessage = {
      seq: this.chatLog.length + 1,
      at: new Date().toISOString(),
      player,
      name: ts?.name ?? player,
      text: text.trim(),
    };
    this.chatLog.push(msg);
    appendFileSync(this.chatPath, JSON.stringify(msg) + "\n");
    return msg;
  }

  postIssue(player: PlayerId, text: string): void {
    const entry = {
      at: new Date().toISOString(),
      player,
      month: this.world.campaign.month,
      attempt: this.world.campaign.attempt,
      phase: phaseOf(this.world),
      turn: this.world.game?.turn ?? null,
      text: text.trim(),
    };
    appendFileSync(this.issuesPath, JSON.stringify(entry) + "\n");
  }

  resetForNextGame(): void {
    const phase = phaseOf(this.world);
    if (phase === "finished") throw new Error("Campaign is already finished");
    this.sessionGameFinished = false;
    this.sessionGameStarted = phase !== "lobby";
    // Reset log cursors since the new game starts a fresh log sequence at 1
    for (const p of this.players) {
      this.cursors.log[p.id] = 0;
    }
  }

  private dispatchOne(
    player: PlayerId,
    command: Command,
    why?: string,
  ):
    | {
        ok: true;
        phaseBefore: Phase;
        phaseAfter: Phase;
        newReadingsCount: number;
        cues: AnimationCue[];
        trace: string[];
        violations: string[];
        gameTag?: string;
      }
    | { ok: false; error: string; phaseBefore: Phase } {
    const worldBefore = this.world;
    const phaseBefore = phaseOf(worldBefore);

    if (this.sessionGameFinished && command.type === "START_GAME") {
      return {
        ok: false,
        phaseBefore,
        error: "Current game is complete; call /api/admin/next-game before starting the next month",
      };
    }

    const monthBefore = worldBefore.campaign.month;
    const attemptBefore = worldBefore.campaign.attempt;
    const readingsBefore = worldBefore.campaign.readings.length;
    const logStart = worldBefore.game?.log.length ?? 0;
    const preSave = command.type === "START_GAME" ? toSave(this.session) : null;

    const result = this.session.dispatch(command);
    if (!result.ok) {
      this.audit.rejections.push({
        at: new Date().toISOString(),
        player,
        expr: JSON.stringify(command),
        reason: result.error,
      });
      this.persistAudit();
      return { ok: false, phaseBefore, error: result.error };
    }

    if (command.type === "START_GAME" && preSave) {
      this.sessionGameStarted = true;
      this.sessionGameFinished = false;
      this.activeRecording = createRecording(preSave);
      for (const p of this.players) this.cursors.log[p.id] = 0;
    }

    const worldAfter = result.state.world;
    const phaseAfter = phaseOf(worldAfter);
    const logEnd = worldAfter.game?.log.length ?? 0;
    const newReadingsCount = worldAfter.campaign.readings.length - readingsBefore;

    if (this.activeRecording) {
      this.activeRecording.steps.push({
        index: this.activeRecording.steps.length,
        at: new Date().toISOString(),
        phaseBefore,
        phaseAfter,
        command,
        logStart,
        logEnd,
      });
    }

    const errs = violations(worldAfter);
    recordCommandAudit(this.audit, phaseAfter, command, worldAfter, result.events, errs);

    appendFileSync(
      this.actionsPath,
      JSON.stringify({
        at: new Date().toISOString(),
        player,
        phaseBefore,
        phaseAfter,
        command,
        why: why ?? null,
        violations: errs,
      }) + "\n",
    );

    let gameTag: string | undefined;
    if (this.sessionGameStarted && (phaseAfter === "lobby" || phaseAfter === "finished")) {
      this.sessionGameFinished = true;
      const monthName = (pack.monthNames[monthBefore] ?? `m${monthBefore}`).toLowerCase();
      const gameNum = monthBefore === 0 ? 0 : Math.max(1, worldAfter.campaign.results.length);
      gameTag = `game-${String(gameNum).padStart(2, "0")}-${monthName}-a${attemptBefore}`;
      this.lastGameTag = gameTag;

      const savePath = join(this.runDir, "saves", `${gameTag}.json`);
      writeFileSync(savePath, JSON.stringify(toSave(this.session), null, 2));

      let recordingPath: string | null = null;
      let replayOk = true;
      let replaySteps = 0;
      let replayError: string | undefined;

      if (this.activeRecording) {
        recordingPath = join(this.runDir, "records", `${gameTag}.json`);
        writeFileSync(recordingPath, JSON.stringify(this.activeRecording, null, 2));
        try {
          const rep = replayRecording(this.activeRecording);
          replaySteps = rep.stepCount;
          const repViolations = violations(rep.world);
          if (repViolations.length > 0) {
            replayOk = false;
            replayError = `Replay violations: ${repViolations.join("; ")}`;
          }
        } catch (err) {
          replayOk = false;
          replayError = String(err);
        }
        this.activeRecording = null;
      }

      const lastResult = worldAfter.campaign.results.at(-1);
      this.completedGames.push({
        tag: gameTag,
        month: monthBefore,
        monthName: pack.monthNames[monthBefore] ?? `Month ${monthBefore}`,
        attempt: attemptBefore,
        evaluation: lastResult?.evaluation ?? (monthBefore === 0 ? "PROLOGUE" : "COMPLETE"),
        completedObjectives: lastResult?.completedObjectives ?? 0,
        failedObjectives: lastResult?.failedObjectives ?? 0,
        turns: lastResult?.turns ?? 0,
        incidents: lastResult?.incidents ?? 0,
        outbreaks: lastResult?.outbreaks ?? 0,
        fundingBefore: lastResult?.fundingBefore ?? worldAfter.campaign.funding,
        fundingAfter: lastResult?.fundingAfter ?? worldAfter.campaign.funding,
        savePath,
        recordingPath,
        replayOk,
        replaySteps,
        replayError,
        violationCount: errs.length,
      });
    }

    this.persistAll();

    return {
      ok: true,
      phaseBefore,
      phaseAfter,
      newReadingsCount,
      cues: result.cues,
      trace: result.trace.map((f) => f.t),
      violations: errs,
      gameTag,
    };
  }

  executeExpression(
    player: PlayerId,
    input: { expr?: string; command?: Command; why?: string },
  ): CommandApiResult {
    const phaseBefore = phaseOf(this.world);

    if (input.command) {
      const cmd: Command = { ...input.command, player };
      const res = this.dispatchOne(player, cmd, input.why);
      if (!res.ok) {
        return {
          ok: false,
          error: res.error,
          phaseBefore,
          phaseAfter: phaseOf(this.world),
          executedCount: 0,
          newReadingsCount: 0,
          pendingTop: topDecision(this.world),
          violations: [],
          sessionGameFinished: this.sessionGameFinished,
          cues: [],
          trace: [],
        };
      }
      return {
        ok: true,
        feedback: `Executed ${cmd.type} -> ${res.phaseAfter}`,
        phaseBefore,
        phaseAfter: res.phaseAfter,
        executedCount: 1,
        newReadingsCount: res.newReadingsCount,
        pendingTop: topDecision(this.world),
        violations: res.violations,
        sessionGameFinished: this.sessionGameFinished,
        cues: res.cues,
        trace: res.trace,
        gameTag: res.gameTag,
      };
    }

    const args = tokenizeCommandExpr(input.expr ?? "");
    const parsed = parseDoCommand(this.world, player, this.undoDepth, args);
    if (parsed.kind === "error") {
      this.audit.rejections.push({
        at: new Date().toISOString(),
        player,
        expr: input.expr ?? "",
        reason: parsed.message,
      });
      this.persistAudit();
      return {
        ok: false,
        error: parsed.message,
        phaseBefore,
        phaseAfter: phaseOf(this.world),
        executedCount: 0,
        newReadingsCount: 0,
        pendingTop: topDecision(this.world),
        violations: [],
        sessionGameFinished: this.sessionGameFinished,
        cues: [],
        trace: [],
      };
    }

    if (parsed.kind === "single") {
      const res = this.dispatchOne(player, parsed.command, input.why);
      if (!res.ok) {
        return {
          ok: false,
          error: res.error,
          phaseBefore,
          phaseAfter: phaseOf(this.world),
          executedCount: 0,
          newReadingsCount: 0,
          pendingTop: topDecision(this.world),
          violations: [],
          sessionGameFinished: this.sessionGameFinished,
          cues: [],
          trace: [],
        };
      }
      return {
        ok: true,
        feedback: `Executed ${input.expr} -> ${res.phaseAfter}`,
        phaseBefore,
        phaseAfter: res.phaseAfter,
        executedCount: 1,
        newReadingsCount: res.newReadingsCount,
        pendingTop: topDecision(this.world),
        violations: res.violations,
        sessionGameFinished: this.sessionGameFinished,
        cues: res.cues,
        trace: res.trace,
        gameTag: res.gameTag,
      };
    }

    // Batch convenience helpers
    let count = 0;
    let totalReadings = 0;
    const allCues: AnimationCue[] = [];
    const allTrace: string[] = [];
    const allViolations: string[] = [];
    let gameTag: string | undefined;

    while (true) {
      const w = this.world;
      const top = topDecision(w);
      let nextCmd: Command | null = null;

      if (parsed.batch === "flip-all-threats") {
        if (phaseOf(w) !== "setup.threat" || top !== null) break;
        nextCmd = { type: "FLIP_OPENING_THREAT", player };
      } else if (parsed.batch === "draw-all-threats") {
        if (phaseOf(w) !== "playing.threat" || top !== null) break;
        nextCmd = { type: "DRAW_THREAT", player };
      } else if (parsed.batch === "resolve-escalation") {
        if (!top || top.t !== "escalation") break;
        if (top.step === "intensify" && count > 0) {
          const g = w.game!;
          const anyoneHasCI = g.seats.some((st) =>
            g.players[st].hand.some(
              (id) => g.playerCards[id]?.kind === "event" && g.playerCards[id]?.event === "counter-intelligence",
            ),
          );
          if (anyoneHasCI) break;
        }
        nextCmd = { type: "DECIDE", player, answer: { t: "escalation" } };
      }

      if (!nextCmd) break;
      const res = this.dispatchOne(player, nextCmd, input.why);
      if (!res.ok) {
        if (count === 0) {
          return {
            ok: false,
            error: res.error,
            phaseBefore,
            phaseAfter: phaseOf(this.world),
            executedCount: 0,
            newReadingsCount: 0,
            pendingTop: topDecision(this.world),
            violations: [],
            sessionGameFinished: this.sessionGameFinished,
            cues: [],
            trace: [],
          };
        }
        break;
      }
      count += 1;
      totalReadings += res.newReadingsCount;
      allCues.push(...res.cues);
      allTrace.push(...res.trace);
      allViolations.push(...res.violations);
      if (res.gameTag) gameTag = res.gameTag;
      if (res.newReadingsCount > 0 || this.sessionGameFinished) break;
    }

    return {
      ok: true,
      feedback: `${parsed.batch}: executed ${count} step(s) -> ${phaseOf(this.world)}`,
      phaseBefore,
      phaseAfter: phaseOf(this.world),
      executedCount: count,
      newReadingsCount: totalReadings,
      pendingTop: topDecision(this.world),
      violations: allViolations,
      sessionGameFinished: this.sessionGameFinished,
      cues: allCues,
      trace: allTrace,
      gameTag,
    };
  }

  private persistAudit(): void {
    writeFileSync(this.auditPath, JSON.stringify(this.audit, null, 2));
  }

  persistAll(): void {
    writeFileSync(this.latestSavePath, JSON.stringify(toSave(this.session), null, 2));
    this.persistAudit();
  }

  startServer(port = 0): string {
    if (this.server) return this.url;

    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      idleTimeout: 120,
      fetch: async (req) => {
        const url = new URL(req.url);
        const path = url.pathname;

        try {
          if (path === "/api/health") {
            return Response.json({
              ok: true,
              phase: phaseOf(this.world),
              month: this.world.campaign.month,
              monthName: pack.monthNames[this.world.campaign.month] ?? `Month ${this.world.campaign.month}`,
              attempt: this.world.campaign.attempt,
              sessionGameFinished: this.sessionGameFinished,
              players: this.players.map((p) => ({
                id: p.id,
                name: p.name,
                seat: p.seat,
                harness: p.harness,
                model: p.model,
              })),
            });
          }

          if (path === "/api/state") {
            const player = url.searchParams.get("player") ?? this.leadPlayer.id;
            const format = url.searchParams.get("format") ?? "json";
            const consume = url.searchParams.get("consume") !== "0";
            const feedback = url.searchParams.get("feedback");
            const notice = url.searchParams.get("notice");
            const packet = this.getStatePacket(player, {
              consume,
              actionFeedback: feedback,
              notice,
            });
            if (format === "compact") return new Response(packet.compactText);
            return Response.json(packet);
          }

          if (path === "/api/command" && req.method === "POST") {
            const body = (await req.json()) as {
              player: PlayerId;
              expr?: string;
              command?: Command;
              why?: string;
            };
            const res = this.executeExpression(body.player, body);
            return Response.json(res, { status: res.ok ? 200 : 400 });
          }

          if (path === "/api/chat" && req.method === "POST") {
            const body = (await req.json()) as { player: PlayerId; text: string };
            if (!body.text?.trim()) {
              return Response.json({ ok: false, error: "Empty chat message" }, { status: 400 });
            }
            const msg = this.postChat(body.player, body.text);
            return Response.json({ ok: true, message: msg });
          }

          if (path === "/api/inspect") {
            const player = url.searchParams.get("player") ?? this.leadPlayer.id;
            const query = url.searchParams.get("query") ?? "board";
            return Response.json({
              ok: true,
              query,
              content: this.inspect(player, query),
            });
          }

          if (path === "/api/memory") {
            if (req.method === "GET") {
              const player = url.searchParams.get("player") ?? this.leadPlayer.id;
              return Response.json({ ok: true, player, content: this.readMemory(player) });
            }
            if (req.method === "PUT") {
              const body = (await req.json()) as { player: PlayerId; content: string };
              this.writeMemory(body.player, body.content);
              return Response.json({ ok: true, path: this.memoryPathOf(body.player) });
            }
          }

          if (path === "/api/strategy") {
            if (req.method === "GET") {
              return Response.json({ ok: true, version: this.strategyVersion, content: this.readStrategy() });
            }
            if (req.method === "PUT") {
              const body = (await req.json()) as { player: PlayerId; content: string };
              this.writeStrategy(body.player, body.content);
              return Response.json({ ok: true, version: this.strategyVersion, path: this.strategyPath });
            }
          }

          if (path === "/api/report" && req.method === "POST") {
            const body = (await req.json()) as {
              player: PlayerId;
              text: string;
              gameReport?: boolean;
              tag?: string;
            };
            if (body.gameReport) {
              const pathSaved = this.writeGameReport(body.player, body.text, body.tag);
              return Response.json({ ok: true, path: pathSaved });
            }
            this.postIssue(body.player, body.text);
            return Response.json({ ok: true, path: this.issuesPath });
          }

          if (path === "/api/audit") {
            const format = url.searchParams.get("format") ?? "text";
            if (format === "json") return Response.json(this.audit);
            return new Response(formatAuditSummary(this.audit, this.world));
          }

          if (path === "/api/save") {
            return Response.json(toSave(this.session));
          }

          if (path === "/api/admin/next-game" && req.method === "POST") {
            this.resetForNextGame();
            return Response.json({
              ok: true,
              month: this.world.campaign.month,
              attempt: this.world.campaign.attempt,
              phase: phaseOf(this.world),
            });
          }

          if (path === "/api/admin/advance-january" && req.method === "POST") {
            const res = this.executeExpression(this.leadPlayer.id, {
              command: { type: "BEGIN_JANUARY", player: this.leadPlayer.id },
            });
            if (!res.ok) return Response.json(res, { status: 400 });
            this.resetForNextGame();
            return Response.json({ ok: true, month: this.world.campaign.month });
          }

          if (path === "/api/admin/stop" && req.method === "POST") {
            this.persistAll();
            setTimeout(() => this.stopServer(), 30);
            return Response.json({ ok: true });
          }

          return Response.json({ ok: false, error: "Not Found" }, { status: 404 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    });

    return this.url;
  }

  stopServer(): void {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    this.persistAll();
  }

  /** Helper used by orchestrator to check if a seat has any actionable legal options right now. */
  hasLegalOptions(player: PlayerId): boolean {
    if (this.sessionGameFinished) return false;
    return optionsFor(this.world, player, this.undoDepth).length > 0;
  }

  seatOf(player: PlayerId): SeatId | null {
    return seatOfPlayer(this.world, player);
  }
}
