# Game engine (`@repo/game`)

- Framework-free, deterministic Pandemic Legacy: Season 0 rules engine and XState v5 state machine.
- All randomness lives in `world.campaign.rng`. Never call `Math.random()` or `Date.now()` inside the engine.
- `reject(world, phase, command)` in `src/machine.ts` is the single legality source of truth used by XState guards, `src/options.ts`, playtest bots, and future UI.
- `src/content/archive.generated.ts` is generated from `docs/game/` by `bun scripts/gen-content.ts` so every legacy card, debrief entry, box, door, operations card, incident, event, and passport track carries verbatim printed text without runtime filesystem reads.
- Every state-changing event appends structured, monotonic `LogEntry` items to `world.game.log` and full-text `ReadingEntry` items to `world.campaign.readings` so future UI and animations can drive off the log and replay diffs cleanly.
