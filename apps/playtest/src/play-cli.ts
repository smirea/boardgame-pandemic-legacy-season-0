import { readActiveDaemon } from "./config";

const argv = process.argv.slice(2);
let player = "";
let runOverride: string | undefined;
const rest: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const tok = argv[i]!;
  if (tok === "--as" && argv[i + 1]) {
    player = argv[++i]!;
  } else if (tok === "--run" && argv[i + 1]) {
    runOverride = argv[++i]!;
  } else {
    rest.push(tok);
  }
}

const cmd = rest[0];
if (!player || !cmd) {
  console.error("Usage: ./apps/playtest/play --as <p1|p2|p3> <status|board|sites|files|readings|info|log|say|wait|do|report> [args...]");
  process.exit(1);
}

const daemon = readActiveDaemon(runOverride);

async function run(): Promise<void> {
  const base = daemon.url;

  if (cmd === "status") {
    const res = await fetch(`${base}/status?player=${encodeURIComponent(player)}`);
    console.log(await res.text());
    return;
  }
  if (cmd === "board") {
    const res = await fetch(`${base}/board?player=${encodeURIComponent(player)}`);
    console.log(await res.text());
    return;
  }
  if (cmd === "sites") {
    const res = await fetch(`${base}/sites?player=${encodeURIComponent(player)}`);
    console.log(await res.text());
    return;
  }
  if (cmd === "files") {
    const res = await fetch(`${base}/files?player=${encodeURIComponent(player)}`);
    console.log(await res.text());
    return;
  }
  if (cmd === "readings") {
    const after = rest[1] ?? "0";
    const res = await fetch(`${base}/readings?after=${encodeURIComponent(after)}`);
    console.log(await res.text());
    return;
  }
  if (cmd === "info") {
    const id = rest[1] ?? "";
    const res = await fetch(`${base}/info?id=${encodeURIComponent(id)}`);
    console.log(await res.text());
    return;
  }
  if (cmd === "log") {
    const n = rest[1] ?? "30";
    const res = await fetch(`${base}/log?n=${encodeURIComponent(n)}`);
    console.log(await res.text());
    return;
  }
  if (cmd === "wait") {
    const timeout = rest[1] ?? "25";
    const res = await fetch(
      `${base}/wait?player=${encodeURIComponent(player)}&timeout=${encodeURIComponent(timeout)}`,
    );
    console.log(await res.text());
    return;
  }
  if (cmd === "say") {
    const text = rest.slice(1).join(" ").trim();
    if (!text) {
      console.error("Message cannot be empty");
      process.exit(1);
    }
    const res = await fetch(`${base}/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, text }),
    });
    console.log(await res.text());
    return;
  }
  if (cmd === "report") {
    const text = rest.slice(1).join(" ").trim();
    if (!text) {
      console.error("Report text cannot be empty");
      process.exit(1);
    }
    const res = await fetch(`${base}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, text }),
    });
    console.log(await res.text());
    return;
  }
  if (cmd === "do") {
    const args = rest.slice(1);
    const whyIdx = args.findIndex((a) => a === "why:" || a.startsWith("why:"));
    const why =
      whyIdx === -1
        ? undefined
        : args[whyIdx] === "why:"
          ? args.slice(whyIdx + 1).join(" ")
          : [args[whyIdx]!.slice(4), ...args.slice(whyIdx + 1)].join(" ").trim();
    const res = await fetch(`${base}/do`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, args, why }),
    });
    const text = await res.text();
    console.log(text);
    if (!res.ok) process.exit(1);
    return;
  }

  console.error(`Unknown subcommand: ${cmd}`);
  process.exit(1);
}

run().catch((err) => {
  console.error(`play CLI error: ${String(err)}`);
  process.exit(1);
});
