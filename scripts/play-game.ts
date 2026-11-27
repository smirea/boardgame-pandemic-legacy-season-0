#!/usr/bin/env bun
import { join } from "node:path";
import { pack } from "@repo/game";
import { RUNS_ROOT } from "../apps/playtest/src/config";
import type { EffortLevel, PlayerSpec } from "../apps/playtest/src/harnesses";
import {
  DEFAULT_EFFORT,
  parsePlayerSpec,
  verifyHarnessesInstalled,
} from "../apps/playtest/src/harnesses";
import { GameHost } from "../apps/playtest/src/host";
import { GameOrchestrator } from "../apps/playtest/src/orchestrator";

const MONTH_ALIASES: Record<string, number> = {
  prologue: 0,
  pro: 0,
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function parseMonthArg(raw: string): number {
  const lower = raw.trim().toLowerCase();
  if (lower in MONTH_ALIASES) return MONTH_ALIASES[lower]!;
  const num = Number(lower);
  if (Number.isInteger(num) && num >= 0 && num <= 12) return num;
  throw new Error(`Invalid month '${raw}' (expected 0..12 or prologue/jan..dec)`);
}

function usage(): string {
  return `Usage:
  ./scripts/play-game.ts <--month X | --save filepath | --campaign [start-month]> --player name[:harness/model[@effort]] ...

Modes (choose one):
  --month <0..12|name>       Play a single month (e.g. --month 1, --month jan, --month prologue)
  --save <filepath>          Resume playing from an existing v2/v1 save JSON file
  --campaign [start-month]   Play continuously from start-month (default 1 = January) through December (or --until)

Player Specs (repeatable, 2 to 4 players):
  --player <spec>            name[:harness[/model[@effort]]]
                             Default harness: claude | Default model: haiku (latest) | Default effort: medium
                             Supported harnesses: claude, codex, agy, grok
                             Examples:
                               --player maya --player devon
                               --player maya:claude/haiku --player devon:codex/gpt-6-luna
                               --player sora:agy/gemini-3.8-flash-medium --player vex:grok/grok-4.7-build-fast@low

Options:
  --until <0..12|name>       Stop campaign after this month (e.g. --campaign 1 --until 2 for Jan + Feb)
  --seed <number>            Deterministic RNG seed (default: 1962)
  --effort <level>           Default reasoning effort: low|medium|high|xhigh (default: medium)
  --run <name>               Run folder name under apps/playtest/runs/<name> (default: timestamped)
  --memory-dir <path>        Persistent directory for agent memories & strategy.md (default: <runDir>/memory)
  --max-games <N>            Maximum games to play in this invocation
  --max-wakes <N>            Maximum agent wakes per game (default: 400)
  --no-auto-step             Wake agents for every forced single-button step (begin-turn, draw-cards, etc.)
  --keep-threads             Reuse agent threads across months instead of starting fresh threads with memory handoff
  --verbose                  Print per-turn token/cost telemetry
  -h, --help                 Show this help`;
}

type ParsedCli = {
  mode: "month" | "save" | "campaign";
  startMonth?: number;
  endMonth?: number;
  savePath?: string;
  playerRaw: string[];
  effort: EffortLevel;
  seed: number;
  runName: string;
  memoryDir?: string;
  maxGames?: number;
  maxWakes: number;
  autoStepForced: boolean;
  keepThreads: boolean;
  verbose: boolean;
};

function parseCli(argv: string[]): ParsedCli | null {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(usage());
    return null;
  }

  let mode: "month" | "save" | "campaign" | null = null;
  let startMonth: number | undefined;
  let endMonth: number | undefined;
  let savePath: string | undefined;
  const playerRaw: string[] = [];
  let effort: EffortLevel = DEFAULT_EFFORT;
  let seed = 1962;
  let runName = "";
  let memoryDir: string | undefined;
  let maxGames: number | undefined;
  let maxWakes = 400;
  let autoStepForced = true;
  let keepThreads = false;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];

    if (arg === "--month") {
      if (!next || next.startsWith("--")) throw new Error("--month requires a value (0..12 or month name)");
      if (mode) throw new Error(`Cannot combine --month with --${mode}`);
      mode = "month";
      startMonth = parseMonthArg(next);
      i += 1;
    } else if (arg === "--save") {
      if (!next || next.startsWith("--")) throw new Error("--save requires a file path");
      if (mode && mode !== "campaign") throw new Error(`Cannot combine --save with --${mode}`);
      mode = mode ?? "save";
      savePath = next;
      i += 1;
    } else if (arg === "--campaign") {
      if (mode && mode !== "save") throw new Error(`Cannot combine --campaign with --${mode}`);
      mode = "campaign";
      if (next && !next.startsWith("--")) {
        startMonth = parseMonthArg(next);
        i += 1;
      } else if (!savePath) {
        startMonth = 1;
      }
    } else if (arg === "--until") {
      if (!next || next.startsWith("--")) throw new Error("--until requires a month");
      endMonth = parseMonthArg(next);
      i += 1;
    } else if (arg === "--player" || arg === "-p") {
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a player spec`);
      playerRaw.push(next);
      i += 1;
    } else if (arg === "--effort") {
      if (!next || !["low", "medium", "high", "xhigh"].includes(next)) {
        throw new Error("--effort must be one of low|medium|high|xhigh");
      }
      effort = next as EffortLevel;
      i += 1;
    } else if (arg === "--seed") {
      if (!next || !Number.isFinite(Number(next))) throw new Error("--seed requires an integer");
      seed = Number(next);
      i += 1;
    } else if (arg === "--run") {
      if (!next || next.startsWith("--")) throw new Error("--run requires a name");
      runName = next;
      i += 1;
    } else if (arg === "--memory-dir") {
      if (!next || next.startsWith("--")) throw new Error("--memory-dir requires a directory path");
      memoryDir = next;
      i += 1;
    } else if (arg === "--max-games") {
      if (!next || !Number.isInteger(Number(next)) || Number(next) < 1) {
        throw new Error("--max-games requires a positive integer");
      }
      maxGames = Number(next);
      i += 1;
    } else if (arg === "--max-wakes") {
      if (!next || !Number.isInteger(Number(next)) || Number(next) < 1) {
        throw new Error("--max-wakes requires a positive integer");
      }
      maxWakes = Number(next);
      i += 1;
    } else if (arg === "--no-auto-step") {
      autoStepForced = false;
    } else if (arg === "--keep-threads") {
      keepThreads = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!mode) {
    throw new Error(`Must specify one of --month, --save, or --campaign.\n\n${usage()}`);
  }
  if (playerRaw.length < 2 || playerRaw.length > 4) {
    throw new Error(`Expected 2 to 4 --player flags (got ${playerRaw.length}).\n\n${usage()}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const defaultRun =
    mode === "month"
      ? `month-${startMonth}-${stamp}`
      : mode === "campaign"
        ? `campaign-${startMonth ?? "save"}-${stamp}`
        : `save-${stamp}`;

  return {
    mode,
    startMonth,
    endMonth,
    savePath,
    playerRaw,
    effort,
    seed,
    runName: runName || defaultRun,
    memoryDir,
    maxGames,
    maxWakes,
    autoStepForced,
    keepThreads,
    verbose,
  };
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (!cli) return;

  const players: PlayerSpec[] = cli.playerRaw.map((raw) => parsePlayerSpec(raw, cli.effort));
  verifyHarnessesInstalled(players);

  const runDir = join(RUNS_ROOT, cli.runName);
  const memoryDir = cli.memoryDir ?? join(runDir, "memory");

  const host = new GameHost({
    runDir,
    memoryDir,
    players,
    seed: cli.seed,
    startMonth: cli.startMonth,
    savePath: cli.savePath,
  });

  const shutdown = () => {
    host.persistAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`Pandemic Legacy: Season 0 — Agent Game Runner`);
  console.log(`  Run dir:    ${runDir}`);
  console.log(`  Memory dir: ${memoryDir}`);
  console.log(`  Seed:       ${cli.seed}`);
  console.log(
    `  Players:    ${host.players.map((p) => `${p.name} (${p.seat}/${p.passport}) -> ${p.harness}/${p.model}@${p.effort}`).join(" | ")}`,
  );

  const orchestrator = new GameOrchestrator(host, {
    maxWakesPerGame: cli.maxWakes,
    autoStepForced: cli.autoStepForced,
    keepThreadsAcrossGames: cli.keepThreads,
    verbose: cli.verbose,
  });

  const t0 = performance.now();
  try {
    await orchestrator.run({
      mode: cli.mode,
      targetMonth: cli.mode === "month" ? cli.startMonth : undefined,
      endMonth: cli.endMonth,
      maxGames: cli.maxGames,
    });
  } finally {
    host.persistAll();
  }

  const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`RUN SUMMARY (${elapsedSec}s)`);
  console.log(`═══════════════════════════════════════════════════════════`);

  for (const g of host.completedGames) {
    console.log(
      `  • ${g.monthName} A${g.attempt}: ${g.evaluation} | Obj ${g.completedObjectives} ok/${g.failedObjectives} fail | Turns ${g.turns} | Inc ${g.incidents} | Out ${g.outbreaks} | Fund ${g.fundingBefore}→${g.fundingAfter} | Replay ${g.replayOk ? `PASS(${g.replaySteps})` : `FAIL(${g.replayError})`}`,
    );
  }

  console.log(`\nAgent Telemetry:`);
  let grandCost = 0;
  for (const gameTel of orchestrator.telemetry) {
    console.log(`  [${gameTel.gameTag}] (${gameTel.wakes} wakes)`);
    for (const st of gameTel.threads) {
      grandCost += st.costUsd;
      console.log(
        `    - ${st.name} (${st.harness}/${st.model}@${st.effort}): ${st.turns} turns | in=${st.inputTokens} cacheRead=${st.cacheReadTokens} cacheWrite=${st.cacheWriteTokens} out=${st.outputTokens} | $${st.costUsd.toFixed(4)} | ${(st.totalDurationMs / 1000).toFixed(1)}s | thread=${st.sessionId ?? "n/a"}`,
      );
    }
  }
  console.log(`  Total estimated cost: $${grandCost.toFixed(4)}`);
  console.log(`\nArtifacts:`);
  console.log(`  Latest save: ${join(runDir, "saves/latest.json")}`);
  console.log(`  Strategy:    ${join(memoryDir, "strategy.md")}`);
  console.log(`  Memories:    ${host.players.map((p) => join(memoryDir, `${p.id}.md`)).join(", ")}`);
  console.log(`  Chat log:    ${join(runDir, "chat.jsonl")}`);
  console.log(`  Audit:       ${join(runDir, "audit.json")}`);
  console.log(`  Telemetry:   ${join(runDir, "telemetry.json")}`);
  console.log(`  Next month:  ${pack.monthNames[host.world.campaign.month] ?? host.world.campaign.month} (Attempt ${host.world.campaign.attempt})`);

  if (host.audit.invariantViolations.length > 0 || host.completedGames.some((g) => !g.replayOk)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`play-game error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
