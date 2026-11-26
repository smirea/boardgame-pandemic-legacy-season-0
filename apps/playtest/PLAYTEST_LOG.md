# Pandemic Legacy: Season 0 — Campaign Playtest Log

Live record of our 3-agent (`grok-4.7-build-fast`, `reasoningEffort: "medium"`) full-campaign playtest across Prologue and January–December, tracking outcomes, state-machine coverage, invariant checks, findings, and fixes applied after every game.

| Game | Month / Attempt | Eval | Turns | Incidents / Outbreaks | Invariants | Key Findings & Fixes Applied |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Prologue | SUCCEEDING (2/2: Kiev, Novosibirsk) | 13 | 6 inc (1 token left) / 0 out | 0 | All 8 verbatim readings verified; 0 illegal moves accepted. Fixed: `Bun.serve` `idleTimeout: 255`; stale option key routing; `escalation` owner = active seat; Threat Level `slot X/6` display; board tags `ag:`/`surv:`/`dis:` (no `[A]`/`[S]` collision); full 3-hop `coordinator-move` options + compact CLI grouping; `share-intel` take/give log wording; `revealedTargetCity` retained post-Acquire; Prologue Step 1 evaluation reading + non-scoring result preservation; `create-aliases` positional + keyed syntax; final-objective debrief preservation |
