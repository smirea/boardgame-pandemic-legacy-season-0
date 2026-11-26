import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PassportColor, PlayerId, SeatId } from "@repo/game";

export type PlayerConfig = {
  id: PlayerId;
  name: string;
  seat: SeatId;
  passport: PassportColor;
  persona: string;
  lead: boolean;
};

export type PlaytestConfig = {
  run: string;
  seed: number;
  model: string;
  reasoningEffort?: string;
  players: PlayerConfig[];
};

export type DaemonMeta = {
  pid: number;
  port: number;
  url: string;
  run: string;
  configPath: string;
  startedAt: string;
};

export const REPO_ROOT = resolve(dirname(import.meta.path), "../../..");
export const PLAYTEST_ROOT = join(REPO_ROOT, "apps/playtest");
export const RUNS_ROOT = join(PLAYTEST_ROOT, "runs");
export const ACTIVE_RUN_FILE = join(RUNS_ROOT, "active.json");

export function loadConfig(configPath: string): PlaytestConfig {
  const full = resolve(REPO_ROOT, configPath);
  const raw = JSON.parse(readFileSync(full, "utf8")) as PlaytestConfig;
  if (!raw.run || !Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 4) {
    throw new Error(`Invalid playtest config at ${full}`);
  }
  return raw;
}

export function runDirOf(runName: string): string {
  return join(RUNS_ROOT, runName);
}

export function ensureRunDirs(runName: string): string {
  const dir = runDirOf(runName);
  for (const sub of ["", "saves", "records", "briefs", "memory", "reports"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  return dir;
}

export function readActiveDaemon(runOverride?: string): DaemonMeta {
  if (runOverride) {
    const file = join(runDirOf(runOverride), "daemon.json");
    if (!existsSync(file)) throw new Error(`No daemon running for run '${runOverride}'`);
    return JSON.parse(readFileSync(file, "utf8")) as DaemonMeta;
  }
  if (!existsSync(ACTIVE_RUN_FILE)) {
    throw new Error("No active playtest daemon. Start one with ./apps/playtest/lab start <config>");
  }
  const active = JSON.parse(readFileSync(ACTIVE_RUN_FILE, "utf8")) as { run: string };
  const file = join(runDirOf(active.run), "daemon.json");
  if (!existsSync(file)) {
    throw new Error(`Daemon metadata missing for active run '${active.run}'`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as DaemonMeta;
}
