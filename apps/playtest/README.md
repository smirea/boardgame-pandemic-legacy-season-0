# Pandemic Legacy: Season 0 — Multi-Agent Playtest Framework

Runs a live `@repo/game` Effect Stack session directly in-process (no server required) so AI agents across `claude`, `codex`, `agy`, and `grok` harnesses can play single months, resume saves, or run full campaigns while coordinating in table chat, reading verbatim Legacy/Debrief/Box/Door cards, buying upkeep upgrades, and updating shared strategy and persistent personal memories.

## Automated Multi-Agent Runner (`./scripts/play-game.ts`)

Each player runs in its own persistent thread inside its chosen harness (default: `claude/haiku` at `medium` reasoning), receiving low-token delta game state packets and exact legal actions on every wake.

```bash
# Play a single month (defaults to claude/haiku@medium)
./scripts/play-game.ts --month 1 --player maya --player devon

# Play January through February as a continuous campaign with memory & strategy handoff
./scripts/play-game.ts --campaign 1 --until 2 --player maya --player devon --run jan-feb

# Resume from any saved game with mixed harnesses/models
./scripts/play-game.ts --save apps/playtest/runs/jan-feb/saves/latest.json \
  --player maya:claude/haiku --player devon:codex/gpt-6-luna

# Mix all four supported harnesses (claude, codex, agy, grok)
./scripts/play-game.ts --month 1 \
  --player maya:claude/haiku@medium \
  --player devon:codex/gpt-6-luna@medium \
  --player sora:agy/gemini-3.8-flash-medium \
  --player vex:grok/grok-4.7-build-fast@low
```

### In-Process Game API (`apps/playtest/src/host.ts` + `serialize.ts`)

`GameHost` drives `@repo/game` directly in memory with zero network/server overhead:

- `getStatePacket(player)` — low-token compact & JSON state, unread verbatim readings, unread chat, delta event log, and exact available actions
- `executeExpression(player, { expr | command, why })` — runs compact expressions (`drive:london`) or raw `@repo/game` `Command`s with live invariant checks, recording, and save persistence
- `postChat(player, text)` & `inspect(player, query)` — table chat and on-demand `board`/`files`/`sites`/`log`/`readings`/`info:<id>` lookups
- `readMemory`/`writeMemory`, `readStrategy`/`writeStrategy`, `postIssue`, `writeGameReport`, `auditSummary`

## Manual CLI Daemon (`lab` / `play`)

For manually driving a session across separate terminal shells:

```bash
./apps/playtest/lab start apps/playtest/configs/campaign.json --fresh
./apps/playtest/play --as p1 status
./apps/playtest/play --as p1 do start-game
./apps/playtest/lab stop
```
