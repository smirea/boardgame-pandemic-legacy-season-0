import { existsSync, openSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { GameRecording } from "@repo/game";
import { replayRecording, violations } from "@repo/game";
import { generateBriefs } from "./brief";
import {
  ACTIVE_RUN_FILE,
  ensureRunDirs,
  loadConfig,
  PLAYTEST_ROOT,
  readActiveDaemon,
  REPO_ROOT,
  runDirOf,
} from "./config";

const argv = process.argv.slice(2);
const sub = argv[0];

async function waitForHealth(runName: string, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const metaPath = join(runDirOf(runName), "daemon.json");
  while (Date.now() < deadline) {
    if (existsSync(metaPath)) {
      try {
        const meta = readActiveDaemon(runName);
        const res = await fetch(`${meta.url}/health`);
        if (res.ok) return meta.url;
      } catch {
        // retry
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for playtest daemon '${runName}' to start`);
}

async function stopExisting(runOverride?: string): Promise<void> {
  try {
    const meta = readActiveDaemon(runOverride);
    try {
      await fetch(`${meta.url}/admin/stop`, { method: "POST" });
    } catch {
      try {
        process.kill(meta.pid, "SIGTERM");
      } catch {
        // already stopped
      }
    }
    const metaPath = join(runDirOf(meta.run), "daemon.json");
    if (existsSync(metaPath)) unlinkSync(metaPath);
    if (!runOverride && existsSync(ACTIVE_RUN_FILE)) unlinkSync(ACTIVE_RUN_FILE);
    console.log(`Stopped daemon for '${meta.run}' (pid ${meta.pid})`);
  } catch {
    console.log("No running playtest daemon found.");
  }
}

async function main(): Promise<void> {
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(
      "Usage: ./apps/playtest/lab <start <config> [--fresh] | stop | status | brief | summary | next-game | advance-january>",
    );
    return;
  }

  if (sub === "start") {
    const configPath = argv[1] ?? "apps/playtest/configs/campaign.json";
    const fresh = argv.includes("--fresh");
    const cfg = loadConfig(configPath);
    const runDir = ensureRunDirs(cfg.run);

    // Stop any previous daemon for this run first
    if (existsSync(join(runDir, "daemon.json"))) {
      await stopExisting(cfg.run);
    }

    const logFile = join(runDir, "daemon.log");
    const outFd = openSync(logFile, "a");
    const args = ["run", join(PLAYTEST_ROOT, "src/daemon.ts"), configPath];
    if (fresh) args.push("--fresh");

    const child = spawn("bun", args, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", outFd, outFd],
    });
    child.unref();

    const url = await waitForHealth(cfg.run);
    const health = await (await fetch(`${url}/health`)).json();
    console.log(`Daemon ready: ${url} | ${JSON.stringify(health)}`);
    return;
  }

  if (sub === "stop") {
    await stopExisting(argv[1]);
    return;
  }

  if (sub === "status") {
    const meta = readActiveDaemon(argv[1]);
    const res = await fetch(`${meta.url}/health`);
    console.log(JSON.stringify({ ...meta, health: await res.json() }, null, 2));
    return;
  }

  if (sub === "summary") {
    const meta = readActiveDaemon(argv[1]);
    const res = await fetch(`${meta.url}/summary`);
    console.log(await res.text());
    return;
  }

  if (sub === "brief") {
    const meta = readActiveDaemon(argv[1]);
    const cfg = loadConfig(meta.configPath);
    const files = generateBriefs(cfg);
    console.log("Generated briefs:\n" + files.map((f) => `  - ${f}`).join("\n"));
    return;
  }

  if (sub === "next-game") {
    const meta = readActiveDaemon(argv[1]);
    const res = await fetch(`${meta.url}/admin/next-game`, { method: "POST" });
    console.log(await res.text());
    if (!res.ok) process.exit(1);
    return;
  }

  if (sub === "advance-january") {
    const meta = readActiveDaemon(argv[1]);
    const res = await fetch(`${meta.url}/admin/advance-january`, { method: "POST" });
    console.log(await res.text());
    if (!res.ok) process.exit(1);
    return;
  }

  if (sub === "wait-game") {
    const meta = readActiveDaemon(argv[1]);
    while (true) {
      const res = await fetch(`${meta.url}/admin/wait-session-end`);
      const data = (await res.json()) as { sessionGameFinished?: boolean };
      if (data.sessionGameFinished) {
        console.log(JSON.stringify(data));
        return;
      }
    }
  }

  if (sub === "replay-all") {
    const meta = readActiveDaemon(argv[1]);
    const recDir = join(runDirOf(meta.run), "records");
    const files = existsSync(recDir) ? readdirSync(recDir).filter((f) => f.endsWith(".json")).sort() : [];
    for (const file of files) {
      const rec = JSON.parse(readFileSync(join(recDir, file), "utf8")) as GameRecording;
      const out = replayRecording(rec);
      const errs = violations(out.world);
      console.log(`${file}: replayed ${out.stepCount} steps -> ${out.phase} (violations: ${errs.length})`);
      if (errs.length > 0) {
        console.error(errs.join("\n"));
        process.exit(1);
      }
    }
    if (files.length === 0) console.log("No recorded games yet.");
    return;
  }

  console.error(`Unknown lab command: ${sub}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`lab error: ${String(err)}`);
  process.exit(1);
});
