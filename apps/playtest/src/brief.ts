import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pack, parseSave } from "@repo/game";
import type { AuditState } from "./audit";
import { createAuditState, untouchedTargetsForWorld } from "./audit";
import type { PlaytestConfig } from "./config";
import { REPO_ROOT, runDirOf } from "./config";

export function generateBriefs(config: PlaytestConfig): string[] {
  const runDir = runDirOf(config.run);
  const savePath = join(runDir, "saves/latest.json");
  if (!existsSync(savePath)) throw new Error(`Missing save at ${savePath}`);
  const save = parseSave(JSON.parse(readFileSync(savePath, "utf8")));
  const auditPath = join(runDir, "audit.json");
  const audit: AuditState = existsSync(auditPath)
    ? (JSON.parse(readFileSync(auditPath, "utf8")) as AuditState)
    : createAuditState();

  const c = save.world.campaign;
  const monthName = pack.monthNames[c.month] ?? `Month ${c.month}`;
  const gameTag = `${monthName.toLowerCase()}-a${c.attempt}`;
  const targets = untouchedTargetsForWorld(audit, save.world);

  const historyLines =
    c.results.length === 0
      ? ["(No permanent months completed yet)"]
      : c.results.map(
          (r) =>
            `- ${pack.monthNames[r.month]} Att ${r.attempt}: ${r.evaluation} (${r.completedObjectives} completed, ${r.failedObjectives} failed, Funding ${r.fundingBefore}->${r.fundingAfter}, ${r.turns} turns, ${r.incidents} incidents, ${r.outbreaks} outbreaks)`,
        );

  const written: string[] = [];

  for (const player of config.players) {
    const personaText = readFileSync(resolve(REPO_ROOT, player.persona), "utf8");
    const memoryPath = join(runDir, "memory", `${player.id}.md`);
    if (!existsSync(memoryPath)) {
      writeFileSync(
        memoryPath,
        `# ${player.name} (${player.id}) Campaign Memory\n\nRecord key observations, clues, aliases, strategies, and bugs spotted across months.\n`,
      );
    }
    const reportPath = join(runDir, "reports", `${gameTag}-${player.id}.md`);
    const briefPath = join(runDir, "briefs", `${player.id}.md`);

    const livePassport =
      c.seating.find((s) => s.seat === player.seat)?.passport ?? player.passport;
    const passportObj = c.passports[livePassport];
    const aliasLines = (["allied", "neutral", "soviet"] as const)
      .map((aff) => {
        const al = passportObj.aliases[aff];
        if (!al.created) return null;
        const occ = al.occupation ? pack.occupationById[al.occupation].name : "?";
        const spec = al.specialization ? ` + ${al.specialization}` : "";
        const assets = al.assets.filter((a) => !a.dead).map((a) => `${a.id}${a.city ? `@${a.city}` : ""}`).join(", ");
        const libs = al.liabilities.map((l) => `${l.id}${l.region ? `@${l.region}` : ""}`).join(", ");
        return `- **${aff}${al.burned ? " [BURNED]" : ""}**: "${al.name}" (${occ}${spec}) | Cover left: ${al.coverTrack.length - al.coverScratched}/${al.coverTrack.length} | Assets: ${assets || "none"} | Liabilities: ${libs || "none"}`;
      })
      .filter((x): x is string => x !== null);

    const content = `# Playtest Session Brief — ${player.name} (${player.id})

## Mission
Play **${monthName}${c.month > 0 ? ` (Attempt ${c.attempt})` : ""}** of **Pandemic Legacy: Season 0** cooperatively with your 2 teammates via \`./apps/playtest/play --as ${player.id}\`.

Read [GUIDE.md](${join(REPO_ROOT, "apps/playtest/GUIDE.md")}) before your first move if you need command syntax.
Your persistent memory file: \`${memoryPath}\` (read it at the start and update it at the end).
Write your post-game report to: \`${reportPath}\`.

## Your Persona
${personaText}

## Your Passport (${livePassport.toUpperCase()}, Chronic Infections: ${passportObj.chronicInfections})
${aliasLines.length > 0 ? aliasLines.join("\n") : "(No permanent aliases created yet — Allied aliases are created in January.)"}

## Current Campaign State
- **Month / Attempt**: ${monthName}${c.month > 0 ? ` (Attempt ${c.attempt})` : ""} (Phase: \`${save.phase}\`)
- **Branch**: ${c.branch.toUpperCase()} | **Funding**: ${c.funding} | **Unlocked Rules**: ${c.rules.join(", ") || "core only"}
- **Opened Boxes**: ${c.openedBoxes.join(", ") || "none"} | **Opened Doors**: ${c.openedDoors.join(", ") || "none"}
- **Active Restrictions**: ${c.restrictions.join(", ") || "none"}
- **Past Games**:
${historyLines.join("\n")}

## State-Machine & Mechanic Coverage Targets (Try These Naturally If Useful!)
- **Untouched unlocked actions**: ${targets.actions.join(", ") || "all unlocked actions tested!"}
- **Untouched unlocked events**: ${targets.events.join(", ") || "all unlocked events tested!"}
- **Untouched available assets**: ${targets.assets.slice(0, 12).join(", ") || "all tested!"}
${targets.rooms.length > 0 ? `- **Unvisited PEARL rooms**: ${targets.rooms.join(", ")}` : ""}
${targets.misc.length > 0 ? `- **Extra checks**: ${targets.misc.join("; ")}` : ""}

## Session Rules & Pacing
1. Start by reading your memory file and running \`./apps/playtest/play --as ${player.id} status\`.
${player.lead ? `2. You are the **Lead** (\`${player.id}\`): start the game (\`do start-game\`), coordinate setup steps (\`do flip-all-threats\`, \`do pick-events ...\`, \`do confirm-events\`), and drive shared legacy/game-end prompts after consulting teammates in chat.` : `2. Wait for Maya (\`p1\`) to start the game with \`./apps/playtest/play --as ${player.id} wait\`. Coordinate in chat and take your turns promptly!`}
3. **Read every verbatim Legacy card, Debrief entry, Box, Door, Operations card, and PEARL room** printed by the CLI!
4. **Stay brisk**: chain known sequential actions in one shell command with \`&&\` (e.g. \`play --as ${player.id} do begin-turn && play --as ${player.id} do drive:paris && play --as ${player.id} do neutralize\`), keep chat to ~1 concise note per turn, and include \`@p1\`/\`@p2\`/\`@p3\`/\`@all\` or \`?\` when you need a teammate to wake up immediately.
5. Play to win while deliberately exercising varied Event cards, occupations, assets, infiltration rooms, and edge cases from the Coverage Targets above.
6. Report ANY bug, rules mismatch, missing text, or UX friction immediately with \`./apps/playtest/play --as ${player.id} report "..."\`.
7. **STOP when the CLI prints \`SESSION COMPLETE\`** (back in \`lobby\` after upkeep, or \`finished\` after December). Do NOT start the next month! Update \`${memoryPath}\`, write \`${reportPath}\` (covering: outcome, strategy/choices, mechanics exercised, bugs/friction found, verbatim text quality), and finish your turn.
`;

    writeFileSync(briefPath, content);
    written.push(briefPath);
  }

  return written;
}
