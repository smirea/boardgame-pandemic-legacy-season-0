import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command, GameActor, GameRecording, Phase, PlayerId, World } from "@repo/game";
import {
  createGameActor,
  createRecording,
  decisionOwner,
  optionsFor,
  pack,
  parseSave,
  phaseOf,
  readingsSince,
  reject,
  seatOfPlayer,
  toSave,
  viewFor,
  violations,
} from "@repo/game";
import type { AuditState } from "./audit";
import { createAuditState, formatAuditSummary, recordCommandAudit } from "./audit";
import { parseDoCommand } from "./commands";
import type { DaemonMeta, PlaytestConfig } from "./config";
import { ACTIVE_RUN_FILE, ensureRunDirs, loadConfig } from "./config";
import type { ChatMessage } from "./render";
import {
  formatLogLine,
  renderBoard,
  renderFiles,
  renderInfo,
  renderReadings,
  renderSites,
  renderStatus,
} from "./render";

type Cursors = {
  reading: Record<PlayerId, number>;
  chat: Record<PlayerId, number>;
};

const configArg = process.argv[2];
const fresh = process.argv.includes("--fresh");
const portArgIdx = process.argv.indexOf("--port");
const requestedPort = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) : 0;

if (!configArg) {
  console.error("Usage: bun apps/playtest/src/daemon.ts <config.json> [--fresh] [--port N]");
  process.exit(1);
}

const config: PlaytestConfig = loadConfig(configArg);
const runDir = ensureRunDirs(config.run);
const latestSavePath = join(runDir, "saves/latest.json");
const auditPath = join(runDir, "audit.json");
const cursorsPath = join(runDir, "cursors.json");
const chatPath = join(runDir, "chat.jsonl");
const actionsPath = join(runDir, "actions.jsonl");
const issuesPath = join(runDir, "issues.jsonl");
const daemonMetaPath = join(runDir, "daemon.json");

if (fresh) {
  for (const p of [latestSavePath, auditPath, cursorsPath, chatPath, actionsPath, issuesPath]) {
    if (existsSync(p)) unlinkSync(p);
  }
}

let actor: GameActor;
if (!fresh && existsSync(latestSavePath)) {
  const save = parseSave(JSON.parse(readFileSync(latestSavePath, "utf8")));
  actor = createGameActor({ save });
} else {
  actor = createGameActor({ seed: config.seed });
  for (const p of config.players) {
    actor.send({ type: "JOIN", player: p.id, name: p.name, seat: p.seat });
    actor.send({ type: "ASSIGN_PASSPORT", player: p.id, seat: p.seat, passport: p.passport });
  }
}

let audit: AuditState =
  !fresh && existsSync(auditPath)
    ? (JSON.parse(readFileSync(auditPath, "utf8")) as AuditState)
    : createAuditState();

let cursors: Cursors =
  !fresh && existsSync(cursorsPath)
    ? (JSON.parse(readFileSync(cursorsPath, "utf8")) as Cursors)
    : { reading: {}, chat: {} };

const chatLog: ChatMessage[] = [];
if (!fresh && existsSync(chatPath)) {
  for (const line of readFileSync(chatPath, "utf8").split("\n")) {
    if (line.trim()) chatLog.push(JSON.parse(line) as ChatMessage);
  }
}

let sessionGameStarted = phaseOf(actor.getSnapshot().value) !== "lobby";
let sessionGameFinished = phaseOf(actor.getSnapshot().value) === "finished";
let activeRecording: GameRecording | null = null;
let versionSeq = 1;

type Waiter = {
  player: PlayerId;
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
};
const waiters: Waiter[] = [];
const sessionEndWaiters: (() => void)[] = [];

function persistAll(): void {
  const save = toSave(actor);
  writeFileSync(latestSavePath, JSON.stringify(save, null, 2));
  writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  writeFileSync(cursorsPath, JSON.stringify(cursors, null, 2));
}

function leadPlayerId(): PlayerId {
  return config.players.find((p) => p.lead)?.id ?? config.players[0]!.id;
}

function waitingForSummary(world: World, phase: Phase): string {
  if (sessionGameFinished) return "Session complete (awaiting coordinator review)";
  if (phase === "finished") return "Campaign finished!";
  if (phase === "lobby") return `${leadPlayerId()} to run 'do start-game'`;
  const g = world.game;
  if (!g) return leadPlayerId();

  if (g.pending.length > 0) {
    const owner = decisionOwner(world);
    if (owner) {
      const p = world.table.seats.find((s) => s.seat === owner)?.player ?? owner;
      return `${p} (${owner}) to resolve '${g.pending[0]!.t}'`;
    }
    return `Team (${leadPlayerId()} lead) to resolve '${g.pending[0]!.t}'`;
  }
  if (phase === "setup.threat") return `${leadPlayerId()} to flip opening Threat cards ('do flip-all-threats')`;
  if (phase === "setup.events") return `${leadPlayerId()} to pick/confirm Event cards`;
  if (phase === "setup.aliases") {
    const pendingSeats = g.seats.filter((s) => !g.aliasesChosen.includes(s));
    const names = pendingSeats.map((s) => world.table.seats.find((ts) => ts.seat === s)?.player ?? s);
    return `${names.join(", ")} to choose starting alias`;
  }
  if (phase === "over") return `${leadPlayerId()} to run 'do continue'`;
  if (phase === "upkeep") {
    const notDone = world.table.seats
      .map((s) => s.player)
      .filter((pid) => !g.upkeep?.done.includes(pid));
    return `Upkeep spend/confirm (${notDone.join(", ")} not confirmed yet)`;
  }
  const activePlayer = world.table.seats.find((s) => s.seat === g.active)?.player ?? g.active;
  return `${activePlayer} (${g.active}) in ${phase}`;
}

function isPlayerActionable(world: World, phase: Phase, player: PlayerId): boolean {
  if (sessionGameFinished || phase === "finished") return true;
  const seat = seatOfPlayer(world, player);
  if (!seat) return false;
  const lead = leadPlayerId();
  const g = world.game;

  if (phase === "lobby") return player === lead;
  if (!g) return false;

  if (g.pending.length > 0) {
    const top = g.pending[0]!;
    if (
      top.t === "escalation" &&
      top.step === "intensify" &&
      g.players[seat].hand.some(
        (id) => g.playerCards[id]?.kind === "event" && g.playerCards[id]?.event === "counter-intelligence",
      )
    ) {
      return true;
    }
    const owner = decisionOwner(world);
    return owner === null ? player === lead : owner === seat;
  }
  if (phase === "setup.threat" || phase === "setup.events" || phase === "over") {
    return player === lead;
  }
  if (phase === "setup.aliases") {
    return !g.aliasesChosen.includes(seat);
  }
  if (phase === "upkeep") {
    return !g.upkeep?.done.includes(player);
  }
  if (phase.startsWith("playing.")) {
    return g.active === seat;
  }
  return false;
}

function hasUnreadFor(world: World, phase: Phase, player: PlayerId): boolean {
  const lastRead = cursors.reading[player] ?? 0;
  if (readingsSince(world, lastRead).length > 0) return true;
  const lastChat = cursors.chat[player] ?? 0;
  const unread = chatLog.filter((m) => m.seq > lastChat && m.player !== player);
  if (unread.length === 0) return false;
  // In setup/lobby/postgame/upkeep, always wake for teammate chat; during playing.*, wake on direct pings (@id, @all, or '?')
  if (!phase.startsWith("playing.")) return true;
  const tag = `@${player}`;
  return unread.some(
    (m) => m.text.includes(tag) || m.text.includes("@all") || m.text.includes("?"),
  );
}

function wakeWaiters(): void {
  versionSeq += 1;
  const snap = actor.getSnapshot();
  const phase = phaseOf(snap.value);
  const world = snap.context.world;
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i]!;
    if (isPlayerActionable(world, phase, w.player) || hasUnreadFor(world, phase, w.player)) {
      clearTimeout(w.timer);
      waiters.splice(i, 1);
      w.resolve();
    }
  }
  if (sessionGameFinished) {
    while (sessionEndWaiters.length > 0) {
      sessionEndWaiters.shift()!();
    }
  }
}

function consumeStatusPayload(player: PlayerId, actionFeedback?: string): string {
  const snap = actor.getSnapshot();
  const phase = phaseOf(snap.value);
  const world = snap.context.world;
  const undoDepth = snap.context.undo.length;

  const lastRead = cursors.reading[player] ?? 0;
  const unreadReadings = readingsSince(world, lastRead);
  if (unreadReadings.length > 0) {
    cursors.reading[player] = unreadReadings[unreadReadings.length - 1]!.id;
  }

  const lastChat = cursors.chat[player] ?? 0;
  const unreadChat = chatLog.filter((m) => m.seq > lastChat);
  if (unreadChat.length > 0) {
    cursors.chat[player] = unreadChat[unreadChat.length - 1]!.seq;
  }

  writeFileSync(cursorsPath, JSON.stringify(cursors, null, 2));

  const view = viewFor(world, phase, player, 30);
  const opts = sessionGameFinished ? [] : optionsFor(world, phase, player, undoDepth);
  return renderStatus(view, opts, unreadReadings, unreadChat, {
    sessionGameFinished,
    waitingFor: waitingForSummary(world, phase),
    actionFeedback,
  });
}

function executeSingleCommand(
  player: PlayerId,
  command: Command,
  why?: string,
): { ok: true; phaseAfter: Phase } | { ok: false; error: string } {
  const snapBefore = actor.getSnapshot();
  const phaseBefore = phaseOf(snapBefore.value);
  const worldBefore = snapBefore.context.world;

  if (sessionGameFinished && command.type === "START_GAME") {
    return {
      ok: false,
      error:
        "This game session is complete! Update your memory file, write your post-game report, and stop so the coordinator can review findings before the next month.",
    };
  }

  const err = reject(worldBefore, phaseBefore, command, snapBefore.context.undo.length);
  if (err) {
    audit.rejections.push({
      at: new Date().toISOString(),
      player,
      expr: JSON.stringify(command),
      reason: err,
    });
    writeFileSync(auditPath, JSON.stringify(audit, null, 2));
    return { ok: false, error: err };
  }

  const gameMonthBefore = worldBefore.campaign.month;
  const gameAttemptBefore = worldBefore.campaign.attempt;
  const gameCountBefore = worldBefore.campaign.results.length;
  const logStart = worldBefore.game?.log.length ?? 0;

  if (command.type === "START_GAME") {
    sessionGameStarted = true;
    sessionGameFinished = false;
    activeRecording = createRecording(toSave(actor));
  }

  actor.send(command);

  const snapAfter = actor.getSnapshot();
  const phaseAfter = phaseOf(snapAfter.value);
  const worldAfter = snapAfter.context.world;
  const logEnd = worldAfter.game?.log.length ?? 0;
  const newLogs = worldAfter.game ? worldAfter.game.log.slice(logStart, logEnd) : [];

  if (activeRecording) {
    activeRecording.steps.push({
      index: activeRecording.steps.length,
      at: new Date().toISOString(),
      phaseBefore,
      phaseAfter,
      command,
      logStart,
      logEnd,
    });
  }

  const errs = violations(worldAfter);
  recordCommandAudit(audit, phaseAfter, command, worldAfter, newLogs, errs);

  appendFileSync(
    actionsPath,
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

  // Detect game boundary completion (returned to lobby after a game, or campaign finished!)
  if (sessionGameStarted && (phaseAfter === "lobby" || phaseAfter === "finished")) {
    sessionGameFinished = true;
    const tag = `game-${String(gameCountBefore + (gameMonthBefore === 0 ? 0 : 1)).padStart(2, "0")}-${pack.monthNames[gameMonthBefore]?.toLowerCase() ?? gameMonthBefore}-a${gameAttemptBefore}`;
    writeFileSync(join(runDir, "saves", `${tag}.json`), JSON.stringify(toSave(actor), null, 2));
    if (activeRecording) {
      writeFileSync(
        join(runDir, "records", `${tag}.json`),
        JSON.stringify(activeRecording, null, 2),
      );
      activeRecording = null;
    }
  }

  persistAll();
  wakeWaiters();
  return { ok: true, phaseAfter };
}

persistAll();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: requestedPort,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === "/health") {
        const snap = actor.getSnapshot();
        return Response.json({
          ok: true,
          run: config.run,
          phase: phaseOf(snap.value),
          month: snap.context.world.campaign.month,
          attempt: snap.context.world.campaign.attempt,
          sessionGameFinished,
          version: versionSeq,
        });
      }

      if (path === "/status") {
        const player = url.searchParams.get("player") ?? leadPlayerId();
        return new Response(consumeStatusPayload(player));
      }

      if (path === "/board") {
        const player = url.searchParams.get("player") ?? leadPlayerId();
        const snap = actor.getSnapshot();
        return new Response(renderBoard(viewFor(snap.context.world, phaseOf(snap.value), player)));
      }

      if (path === "/sites") {
        const player = url.searchParams.get("player") ?? leadPlayerId();
        const snap = actor.getSnapshot();
        return new Response(renderSites(viewFor(snap.context.world, phaseOf(snap.value), player)));
      }

      if (path === "/files") {
        const player = url.searchParams.get("player") ?? leadPlayerId();
        const snap = actor.getSnapshot();
        return new Response(renderFiles(viewFor(snap.context.world, phaseOf(snap.value), player)));
      }

      if (path === "/readings") {
        const after = Number(url.searchParams.get("after") ?? "0");
        const snap = actor.getSnapshot();
        const list = readingsSince(snap.context.world, after);
        return new Response(
          list.length > 0 ? renderReadings(list) : `No readings after #${after}.`,
        );
      }

      if (path === "/info") {
        const id = url.searchParams.get("id") ?? "";
        return new Response(renderInfo(id));
      }

      if (path === "/log") {
        const count = Number(url.searchParams.get("n") ?? "30");
        const g = actor.getSnapshot().context.world.game;
        if (!g) return new Response("No active game log.");
        return new Response(g.log.slice(-count).map(formatLogLine).join("\n"));
      }

      if (path === "/summary") {
        const snap = actor.getSnapshot();
        return new Response(formatAuditSummary(audit, snap.context.world));
      }

      if (path === "/say" && req.method === "POST") {
        const body = (await req.json()) as { player: PlayerId; text: string };
        const ts = actor.getSnapshot().context.world.table.seats.find((s) => s.player === body.player);
        const msg: ChatMessage = {
          seq: chatLog.length + 1,
          at: new Date().toISOString(),
          player: body.player,
          name: ts?.name ?? body.player,
          text: body.text,
        };
        chatLog.push(msg);
        appendFileSync(chatPath, JSON.stringify(msg) + "\n");
        cursors.chat[body.player] = msg.seq;
        writeFileSync(cursorsPath, JSON.stringify(cursors, null, 2));
        wakeWaiters();
        return new Response(`Posted chat #${msg.seq}.`);
      }

      if (path === "/report" && req.method === "POST") {
        const body = (await req.json()) as { player: PlayerId; text: string };
        const snap = actor.getSnapshot();
        const entry = {
          at: new Date().toISOString(),
          player: body.player,
          month: snap.context.world.campaign.month,
          attempt: snap.context.world.campaign.attempt,
          phase: phaseOf(snap.value),
          turn: snap.context.world.game?.turn ?? null,
          text: body.text,
        };
        appendFileSync(issuesPath, JSON.stringify(entry) + "\n");
        return new Response(`Issue logged to issues.jsonl.`);
      }

      if (path === "/wait") {
        const player = url.searchParams.get("player") ?? leadPlayerId();
        const timeoutSec = Math.min(45, Math.max(1, Number(url.searchParams.get("timeout") ?? "25")));
        const snapNow = actor.getSnapshot();
        const phaseNow = phaseOf(snapNow.value);
        if (
          !isPlayerActionable(snapNow.context.world, phaseNow, player) &&
          !hasUnreadFor(snapNow.context.world, phaseNow, player)
        ) {
          await new Promise<void>((resolve) => {
            const w: Waiter = {
              player,
              resolve,
              timer: setTimeout(() => {
                const idx = waiters.indexOf(w);
                if (idx !== -1) waiters.splice(idx, 1);
                resolve();
              }, timeoutSec * 1000),
            };
            waiters.push(w);
          });
        }
        return new Response(consumeStatusPayload(player));
      }

      if (path === "/do" && req.method === "POST") {
        const body = (await req.json()) as { player: PlayerId; args: string[]; why?: string };
        const snap = actor.getSnapshot();
        const phase = phaseOf(snap.value);
        const parsed = parseDoCommand(
          snap.context.world,
          phase,
          body.player,
          snap.context.undo.length,
          body.args,
        );
        if (parsed.kind === "error") {
          audit.rejections.push({
            at: new Date().toISOString(),
            player: body.player,
            expr: body.args.join(" "),
            reason: parsed.message,
          });
          writeFileSync(auditPath, JSON.stringify(audit, null, 2));
          return new Response(`REJECTED: ${parsed.message}`, { status: 400 });
        }

        if (parsed.kind === "single") {
          const res = executeSingleCommand(body.player, parsed.command, body.why);
          if (!res.ok) return new Response(`REJECTED: ${res.error}`, { status: 400 });
          return new Response(
            consumeStatusPayload(body.player, `Executed ${parsed.command.type} -> ${res.phaseAfter}`),
          );
        }

        // Batch helpers (each step still executes an explicit XState transition!)
        let count = 0;
        if (parsed.batch === "flip-all-threats") {
          while (true) {
            const s = actor.getSnapshot();
            if (phaseOf(s.value) !== "setup.threat") break;
            if ((s.context.world.game?.pending.length ?? 0) > 0) break;
            const r = executeSingleCommand(
              body.player,
              { type: "FLIP_OPENING_THREAT", player: body.player },
              body.why,
            );
            if (!r.ok) {
              if (count === 0) return new Response(`REJECTED: ${r.error}`, { status: 400 });
              break;
            }
            count += 1;
          }
          return new Response(
            consumeStatusPayload(body.player, `Flipped ${count} opening Threat card(s).`),
          );
        }

        if (parsed.batch === "draw-all-threats") {
          while (true) {
            const s = actor.getSnapshot();
            if (phaseOf(s.value) !== "playing.threat") break;
            if ((s.context.world.game?.pending.length ?? 0) > 0) break;
            const r = executeSingleCommand(
              body.player,
              { type: "DRAW_THREAT", player: body.player },
              body.why,
            );
            if (!r.ok) {
              if (count === 0) return new Response(`REJECTED: ${r.error}`, { status: 400 });
              break;
            }
            count += 1;
          }
          return new Response(
            consumeStatusPayload(body.player, `Drew ${count} Threat card(s).`),
          );
        }

        if (parsed.batch === "resolve-escalation") {
          while (true) {
            const s = actor.getSnapshot();
            const top = s.context.world.game?.pending[0];
            if (!top || top.t !== "escalation") break;
            // Pause at intensify if ANY player holds Counter-Intelligence!
            if (top.step === "intensify" && count > 0) {
              const g = s.context.world.game!;
              const anyoneHasCI = g.seats.some((st) =>
                g.players[st].hand.some(
                  (id) => g.playerCards[id]?.kind === "event" && g.playerCards[id]?.event === "counter-intelligence",
                ),
              );
              if (anyoneHasCI) break;
            }
            const r = executeSingleCommand(
              body.player,
              { type: "DECIDE", player: body.player, answer: { t: "escalation" } },
              body.why,
            );
            if (!r.ok) {
              if (count === 0) return new Response(`REJECTED: ${r.error}`, { status: 400 });
              break;
            }
            count += 1;
          }
          return new Response(
            consumeStatusPayload(body.player, `Advanced ${count} Escalation step(s).`),
          );
        }
      }

      if (path === "/admin/wait-session-end") {
        let timedOut = false;
        if (!sessionGameFinished) {
          await new Promise<void>((resolve) => {
            const onDone = () => {
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(() => {
              const idx = sessionEndWaiters.indexOf(onDone);
              if (idx !== -1) sessionEndWaiters.splice(idx, 1);
              timedOut = true;
              resolve();
            }, 180_000);
            sessionEndWaiters.push(onDone);
          });
        }
        const snap = actor.getSnapshot();
        return Response.json({
          ok: true,
          timedOut,
          phase: phaseOf(snap.value),
          month: snap.context.world.campaign.month,
          attempt: snap.context.world.campaign.attempt,
          sessionGameFinished,
          violations: audit.invariantViolations.length,
        });
      }

      if (path === "/admin/next-game" && req.method === "POST") {
        const snap = actor.getSnapshot();
        const phase = phaseOf(snap.value);
        if (phase === "finished") {
          return Response.json({ ok: false, error: "Campaign is already finished" }, { status: 400 });
        }
        sessionGameFinished = false;
        sessionGameStarted = phase !== "lobby";
        wakeWaiters();
        return Response.json({
          ok: true,
          phase,
          month: snap.context.world.campaign.month,
          attempt: snap.context.world.campaign.attempt,
        });
      }

      if (path === "/admin/advance-january" && req.method === "POST") {
        const res = executeSingleCommand(leadPlayerId(), {
          type: "BEGIN_JANUARY",
          player: leadPlayerId(),
        });
        if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });
        sessionGameFinished = false;
        sessionGameStarted = false;
        return Response.json({ ok: true, month: actor.getSnapshot().context.world.campaign.month });
      }

      if (path === "/admin/stop" && req.method === "POST") {
        persistAll();
        setTimeout(() => process.exit(0), 50);
        return Response.json({ ok: true });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return new Response(`INTERNAL ERROR: ${String(err)}`, { status: 500 });
    }
  },
});

const meta: DaemonMeta = {
  pid: process.pid,
  port: server.port ?? requestedPort,
  url: `http://127.0.0.1:${server.port ?? requestedPort}`,
  run: config.run,
  configPath: configArg,
  startedAt: new Date().toISOString(),
};
writeFileSync(daemonMetaPath, JSON.stringify(meta, null, 2));
writeFileSync(ACTIVE_RUN_FILE, JSON.stringify({ run: config.run }, null, 2));
console.log(`Playtest daemon started for '${config.run}' at ${meta.url} (pid ${meta.pid})`);
