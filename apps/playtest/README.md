# Pandemic Legacy: Season 0 — Multi-Agent Playtest Harness

Runs a live `@repo/game` XState actor in a local HTTP daemon so a team of AI agents (or humans) can play a complete Season 0 campaign via CLI while receiving full verbatim printed text for every Legacy card, Debrief entry, Box, Door, Operations card, and PEARL area, and tracking exhaustive state-machine coverage and invariant violations.

## Quick Start

```bash
# Start a fresh campaign daemon (auto-seats p1, p2, p3)
./apps/playtest/lab start apps/playtest/configs/campaign.json --fresh

# Generate per-game player briefs (with live untouched coverage targets)
./apps/playtest/lab brief

# Play commands as a player
./apps/playtest/play --as p1 status
./apps/playtest/play --as p1 do start-game
./apps/playtest/play --as p1 do flip-all-threats

# Review coverage & invariants after a game
./apps/playtest/lab summary

# Prepare the next game (or advance from Prologue to January)
./apps/playtest/lab advance-january
./apps/playtest/lab next-game

# Stop daemon
./apps/playtest/lab stop
```
