# Pandemic Legacy: Season 0 — Campaign Playtest Log

Live record of our 3-agent (`grok-4.7-build-fast`, `reasoningEffort: "medium"`) full-campaign playtest across Prologue and January–December, tracking outcomes, state-machine coverage, invariant checks, findings, and fixes applied after every game.

| Game | Month / Attempt | Eval | Turns | Incidents / Outbreaks | Invariants | Key Findings & Fixes Applied |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Prologue | *(in progress)* | — | — | 0 | Pre-review catches: `Bun.serve` `idleTimeout: 255` for long-poll `/wait`; stale command key routing to `reject()`; `escalation` owner = active seat; final-objective debrief pending preservation (`checkAllObjectivesResolved`); PEARL Loading Dock double-increment; Debrief 226 no forced exit; Teams Compromised Pursuit completion check |
