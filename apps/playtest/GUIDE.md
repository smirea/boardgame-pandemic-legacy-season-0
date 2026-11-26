# Player Guide — Pandemic Legacy: Season 0 CLI

You are playing a real cooperative campaign of **Pandemic Legacy: Season 0** through the `./apps/playtest/play` CLI.

Always pass your player id with `--as <id>` (e.g. `./apps/playtest/play --as p1 status`).

## Core Loop

1. Run `play --as <id> status` to see the phase, board, objectives, hands, aliases, supplies, legal options, and **any new verbatim printed text** (Legacy cards, Debriefs, Boxes, Doors, Operations cards, PEARL rooms).
2. Read **every single word** of newly revealed Legacy cards, Debrief entries, Operations cards, Boxes, Doors, and PEARL areas — they contain story clues, objectives, and rule unlocks!
3. When it is NOT your turn to act (and you do not want to play an Event card), run:
   ```bash
   ./apps/playtest/play --as <id> wait
   ```
   `wait` blocks cleanly (up to ~25s) until it is your turn, a teammate posts in chat, a new printed card is revealed, or the game session finishes. If `wait` times out, inspect the status and call `wait` again (do NOT busy-loop or use `sleep`).
4. Communicate concisely with teammates via table chat:
   ```bash
   ./apps/playtest/play --as <id> say "I can meet you in London to share Europe cards, or fly to Moscow."
   ```
5. Execute moves with `do`:
   ```bash
   ./apps/playtest/play --as <id> do <key> why: "<short rationale>"
   ```
   `do` executes the move and immediately prints the updated status, your next options, any newly revealed verbatim printed text, and any new chat messages. You may chain sequential known moves in one shell call with `&&` (e.g. `play --as p2 do begin-turn && play --as p2 do neutralize && play --as p2 do drive:london`) and keep chat to 1 concise message per turn so turns flow briskly.

## Stopping Rule (One Game Per Session)

- Each session plays **exactly one game** (the current month/attempt) through Game End, Postgame decisions, and Spend Budget (`upkeep`).
- In `upkeep`, coordinate budget spending in chat, then every player runs `do finish-upkeep`.
- When status says **`SESSION COMPLETE`** (back in `lobby` after upkeep, or `finished` after December), **STOP playing immediately**. Do NOT run `start-game` again!
- Update your personal memory file and write your post-game report file at the exact paths listed in your brief, then finish your turn.

## Useful Commands

| Command | What it does |
| --- | --- |
| `play --as <id> status` | Full turn view: phase, objectives, supplies, active cities/agents/cubes/safehouses/teams, hands, aliases, options, unread verbatim readings |
| `play --as <id> board` | Full 48-city map table (surveillance, agents, cubes, safehouses, incidents, outbreaks, control centers, exposure, connections, keypads) |
| `play --as <id> sites` | Full infiltration site room graphs, security tokens (revealed & unrevealed), hatchways, and room text |
| `play --as <id> files` | Full Intelligence File, Personnel File, unlocked Rules, active Restrictions, and Passports |
| `play --as <id> readings [afterId]` | Re-read verbatim printed texts (Legacy, Debrief, Box, Door, Ops, PEARL) |
| `play --as <id> info <id>` | Inspect full printed text of any Event, Asset, Liability, Occupation, Specialization, Restriction, City, or Rule |
| `play --as <id> log [N]` | Last N game log entries (default 30) |
| `play --as <id> say "<msg>"` | Post to table chat |
| `play --as <id> wait [sec]` | Wait for your turn, chat, new reading, or session end |
| `play --as <id> do <expr> [why: ...]` | Perform an option key or custom command (see below) |
| `play --as <id> report "<bug>"` | File a bug, rules discrepancy, UX friction, or soft-lock immediately |

## Convenient `do` Shortcuts & Custom Syntax

Any key shown under **OPTIONS** in `status` works verbatim with `play --as <id> do <key>`.
In addition, these helpers and parameterized commands are available:

- `do flip-all-threats` — Flips all remaining opening Threat cards one by one (stops if a decision interrupts).
- `do draw-all-threats` — Draws all remaining Threat cards this turn one by one (stops on any decision or game end).
- `do resolve-escalation` — Steps through an Escalation (`increase` -> `add-agents`, pausing at `intensify` if someone holds `Counter-Intelligence` so they can play it, otherwise finishing `intensify`/`pursuit`).
- `do pick-events <ev1,ev2,...> [disc=N]` — Pick specific Event cards in `setup.events` (e.g. `do pick-events airlift,forecast,one-quiet-night disc=1`).
- `do create-aliases <aff> <blackName>:<occ> <greenName>:<occ> <pinkName>:<occ> <whiteName>:<occ>` — Custom alias names & occupations (or use the `create-aliases:<aff>` option key for defaults).
- `do psych <cardId> <q=val> [<q=val> ...]` — Answer Psych Eval questions with your team's real answers (e.g. `do psych legacy/01-05 1=AGREE 2=DISAGREE 3=AGREE`, or `5=2 6=4 7=3`).
- `do drive-carry:<city>:<team1>[,<team2>]` — Transport Crew move carrying specific teams.
- `do unrecorded:<city>` — Unrecorded Flight to ANY city (not just the highlighted shortcuts).
- `do fly:<city> [extra:<cardCity>]` — Commercial Flight (with optional extra card when Restriction `hesitant` is active).
- `do identify:<objId>:<city1>,<city2>,...` — Identify Target City with specific cards.
- `do assemble-team:<city1>,<city2>,... [relocate:<teamId>]` — Assemble Team with specific cards.
- `do complete-infiltration:<objId>:<city1>,<city2>,...` — Complete an infiltration objective with specific cards.
- `do unlock-hatchway:<edgeId>:<city1>,<city2>,...` — Unlock a PEARL hatchway with specific cards summing >= 10.
- `do infiltrate:<roomId>[:<city1>,<city2>...]` — Infiltrate a room revealing specific City cards.
- `do coord-team:<teamId>:<city>` / `do coord-pawn:<seat>:<city>` — Medical Conference Coordinator move to ANY city 1-3 hops away.
- `do clinic-fly:<cardCity>:<destCity>` — Clinic Planner flight discarding any City card.
- `do buy:asset:<assetId>:<passport>:<aff>[:<city>]` — Buy any available Asset in upkeep (choose ANY valid city for Contacts/Visas!).
- `do play:holdover:<city> [relocate:<fromCity>]` — Play A Holdover from the War on ANY city.
- `do play:airlift:<seat|teamId>:<city>` — Play Airlift to ANY city.
- `do play:bureaucratic:<city1>[,<city2>]` — Remove 1-2 agents from specific cities.
- `do play:trial-vaccine:<city1>[,<city2>]` — Remove 2 Disease cubes from specific cities.
- `do play:diversion:<src1>[,<src2>...]-><dest>` — Move 1-3 Incident tokens to any city.
- `do play:scramble-teams:<team1>=<city1>[,<team2>=<city2>...]` — Move multiple teams up to 3 hops.
- `do play:encoded-messages:<seatA>:<cardA>:<seatB>:<cardB>` — Swap specific cards between two seats.
- `do play:weekend-rendezvous:<toCity>:<seat1>[,<seat2>...]` — Move pawns to a city with another pawn.
- `do forecast:<id1>,<id2>,...` — Reorder Forecast Threat cards top-to-bottom.
- `do room:armory:<assetId>[:<city>]` — Langley Armory free Asset in any valid city.
- `do room:directors-office:<city1>[,<city2>]` — Director's Office specific discard picks.
- `do room:swap:<tokenA>:<tokenB>` — Access Panel specific Security token swap.
- `do raw '<JSON Command>'` — Send any exact `@repo/game` `Command` object directly.

## Bug & Rules Hunting Mandate

You are both a **real player trying to win the campaign** AND a **QA tester trying to exhaust the state machine**:
- Check your brief's **Coverage Targets** and deliberately weave untouched actions, events, assets, occupations, infiltration rooms, `undo`, and mechanics into real gameplay whenever sensible.
- If a legal board-game move is rejected, an illegal move is allowed, a card's printed text doesn't match what happened, a reading was missing, or something felt awkward, file it immediately with `play --as <id> report "..."` AND include it in your end-of-game report!
