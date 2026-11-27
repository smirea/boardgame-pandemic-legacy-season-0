# Pandemic Legacy: Season 0 — Multi-Agent Playtest Framework

Runs a live `@repo/game` Effect Stack session over a local HTTP API so AI agents (across `claude`, `codex`, `agy`, and `grok` harnesses) can play single months, resume saves, or run full campaigns while coordinating in table chat, reading verbatim Legacy/Debrief/Box/Door cards, buying upkeep upgrades, and updating shared strategy and persistent personal memories.

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

# Start only the local HTTP state/command API (for external scripts or manual driving)
./scripts/play-game.ts --month 1 --player maya --player devon --serve-only --port 4321
```

### Local HTTP API (`apps/playtest/src/host.ts`)

- `GET /api/health` — current month, attempt, phase, and seated players
- `GET /api/state?player=<id>&format=compact|json` — low-token serialized state, unread verbatim readings, unread chat, delta event log, and exact available actions
- `POST /api/command` — execute a compact `expr` (e.g. `{"player":"maya","expr":"drive:london"}`) or raw `@repo/game` `Command`
- `POST /api/chat` — post a message to table chat
- `GET /api/inspect?player=<id>&query=<board|files|sites|log|readings|info:id|strategy|memory>`
- `GET|PUT /api/memory` & `GET|PUT /api/strategy` — persistent personal memories and shared `strategy.md`
- `POST /api/report` — log bug reports (`issues.jsonl`) or per-game debrief reports
- `GET /api/audit` & `GET /api/save` — live rules coverage, invariant violations, and v2 save snapshot

## Manual CLI Daemon (`lab` / `play`)

For manually driving a daemon from separate terminals:

```bash
./apps/playtest/lab start apps/playtest/configs/campaign.json --fresh
./apps/playtest/play --as p1 status
./apps/playtest/play --as p1 do start-game
./apps/playtest/lab stop
```
