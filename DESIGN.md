# Design Language: Pandemic Legacy — Season 0

> **How to use and enforce this document**
> This is the living design vision for **Pandemic Legacy: Season 0**—defining the physical metaphor, 1962 visual language, information density, interaction rules, motion feel, and tradeoffs for every client surface.
>
> Whenever you build or change any interface, interaction, or animation:
> 1. **Check existing components in `apps/ui/` first.** Reuse or extend an established pattern before introducing a new one.
> 2. **Follow `DESIGN.md` and push back when a request conflicts with it.** If an ask goes against these guidelines, call out the conflict directly so we decide whether to **adhere to the guidelines** or **update `DESIGN.md` and refactor affected surfaces to stay consistent**. Never silently drift.
> 3. **Keep `DESIGN.md` current.** Update this file in the same change whenever the design language evolves.
> 4. **Always use semantic names.** Raw colors, concrete font families, elevation shadows, motion curves, and z-index layers live in one place—the code tokens in [apps/ui/src/routes/theme.css](apps/ui/src/routes/theme.css) and [apps/ui/src/lib/design/tokens.ts](apps/ui/src/lib/design/tokens.ts). Never duplicate raw values or font names in `DESIGN.md` or inside UI components.

---

## 1. Product Vision & Audience

- **Built for trusted friends at a shared virtual table (plus solo multi-hand):** Skip public-platform overhead (user accounts, public room browsers, matchmaking, server-side anti-cheat). Spend that craft budget on physical presence, fluid motion, adaptive audio, and deep quality of life.
- **One laptop screen, zero page scrolling:** A board game is a spatial object meant to be read at a glance. Design uncompromisingly for laptop viewports so the entire active table—map, operations, seats, hand, and key tracks—fits cleanly on one screen with no full-page scroll.
- **Faithful to the box, native to the screen:** Preserve 100% of Season 0's rules, espionage atmosphere, and printed ephemera while letting the digital medium shine—live deck probabilities, Threat-deck memory, spoiler-safe unlocked rules and Debrief archives, instant undo (with playful table consensus when undoing revealed hidden information), and an unobtrusive in-place peek at the original printed scan for any component.
- **One crafted default:** Ship one opinionated, cohesive experience (single Situation Room dark theme, full story, deliberate pacing, sound on with persisted mute/volume) rather than fragmenting the design behind preference toggles.

---

## 2. A Tabletop Game Brought to Life

The core design goal is **a physical 1962 tabletop game brought to life**—not a web dashboard wearing a spy skin.

- **Physical inspiration everywhere:** UI elements should draw directly from the real physical objects on a 1962 intelligence desk—a folded paper world map, manila folders, briefcases, diplomatic passports, airline luggage tags, vintage matchbooks, paper clippings, architectural blueprints, ink stamps, perforated dossier doors, and metallic scratch-off foil.
- **Object permanence — elements always move, never disappear:** Nothing pops into existence out of thin air or blinks away into nothingness. Pieces lift and travel across routes; drawn, played, or discarded cards glide between actual decks, hands, and discard stacks; paper clippings, reports, and notes physically slip into the Intelligence Folder, Personnel Folder, or briefcase with a crisp, high-quality animation of that happening; sealed dossier doors and safe deposit boxes open and lay their contents onto the table.
- **Natural tabletop spreads:** Whenever multiple items are presented together—card selections, unboxing spreads, reveals, archives, or component pickers—lay them out across the viewport as if spread or scattered naturally across a real tabletop (clean spatial breathing room, subtle organic angle/elevation, dynamic scaling to fit), never trapped inside scrolling tables or cramped listboxes.
- **Boxless, full-bleed table:** Float game objects directly over the desk and map with minimal peripheral chrome. Let expressive artifacts—stamps, paper-clipped portraits, lifted cards, reticles—break past rectangular bounds rather than clipping under rigid containers.

---

## 3. Period Aesthetic & Single Token Source of Truth

Season 0 takes place in **1962** during the Cold War—Department of Sabotage Field Manual `N4245.3`, Debrief Book `N4245.4`, covert travel under forged passports, and Project MEDUSA.

Its graphic identity is **1962 Mid-Century Modernist Espionage**: Saul Bass poster geometry, Swiss International Typographic grids, mid-century airline ephemera, government field manuals, manila dossiers, and cold-war industrial print. It is cooler, sharper, inkier, and more geometric than Season 2's warm antiquarian chart, and explicitly avoids neon cyberpunk or faux-CRT spy-terminal clichés.

All concrete colors, font families, shadows, motion curves, and z-index layers live strictly in:
- [apps/ui/src/routes/theme.css](apps/ui/src/routes/theme.css) — CSS custom properties and Tailwind theme bindings
- [apps/ui/src/lib/design/tokens.ts](apps/ui/src/lib/design/tokens.ts) — Typed semantic token registry (linking `@repo/game` IDs to semantic tokens, patterns, and icon kinds) plus live CSS resolution for Canvas/WebGL layers

Every component, style rule, and design discussion uses these **semantic token names**:

### Materials & Surfaces
- **Situation Room Desk (`--surface-desk`, `--surface-chrome`, `--surface-panel`, `--surface-reference-card`):** Cool, quiet dark peripheral frame so the bright board and paper artifacts carry the screen. Paired with `--ink-primary`, `--ink-muted`, `--border-subtle`, and `--border-strong`.
- **Folded Map (`--surface-map-ocean`, `--surface-map-land`, `--surface-map-margin`, `--line-map-crease`):** Bright tactile paper map with crisp crease seams and generous contrast for pieces and routes.
- **Manila & Security Paper (`--surface-manila`, `--surface-manila-deep`, `--surface-security-paper`, `--surface-liability`):** Loose sheets laid over the desk—dossiers, briefings, Debrief Book entries, Operations tabs, Game Calendar, and open passport interiors—using `--ink-paper`, `--ink-paper-muted`, `--ink-liability`, and `--border-paper`.
- **Diplomatic Passport Leather & Foil (`--surface-passport-cover`, `--ink-passport-foil`, `--surface-cover-foil`):** Deep embossed leather covers for closed passports and metallic scratch-off foil for concealed cover pips.
- **Infiltration Blueprint (`--surface-blueprint`, `--surface-blueprint-deep`, `--ink-blueprint`, `--border-blueprint`):** Crisp architectural floor-plan stock whenever a pawn leaves the world map to infiltrate an indoor compound (such as Sabik's Safehouse or PEARL).

### Typography Roles
Three semantic typographic voices (self-hosted and wired in [apps/ui/src/routes/layout.css](apps/ui/src/routes/layout.css) and [apps/ui/src/routes/theme.css](apps/ui/src/routes/theme.css)):
- **Default UI & Rules (`--font-ui`):** Clean mid-century geometric sans for controls, passport labels, action prompts, and readable rules copy.
- **Display & Headlines (`--font-display`):** Bold squared-condensed industrial display for city titles, operation headlines, calendar headers, and high-stakes alerts (`ESCALATION`, `STOP`, `ALIAS BURNED`).
- **Typewriter & Telemetry (`--font-typewriter`):** Authentic mechanical monospace (with `tabular-nums`) for narrative briefings, Debrief Book flavor quotes, stamped classifications, card index codes, and live numeric odds.

### Orthogonal Semantic Identities (Never Color Alone)
Season 0 tracks several overlapping identity axes at once, so **color is always reinforced by pattern, silhouette, or icon** via `REGION_TOKENS`, `AFFILIATION_TOKENS`, and `SEAT_TOKENS`:
- **Six Regions (`--region-*` + `--region-*-tint` + mandatory geometric pattern):** Each of the six regions pairs its semantic hue with its distinct 1962 pattern (`stripes`, `scallops`, `diamonds`, `dots`, `ogee`, `waves`) so every city tile, card, and objective band is unmistakable even without relying on color alone.
- **Three Affiliations (`--affiliation-medallion` + `--affiliation-allied` / `--affiliation-neutral` / `--affiliation-soviet`):** Always rendered as high-contrast silhouettes (`compass-star`, `globe`, `hammer-sickle`) inside a dark circular medallion.
- **Four Passport Seats (`--seat-black`, `--seat-green`, `--seat-pink`, `--seat-white` + rim tokens where needed):** Stable player identity carried across pawns, corner passport slips, live cursors, map annotations, and table consensus controls.
- **Dual-Era Signals & One Active Attention Signal:**
  - Espionage threats, surveillance, incidents, and burn stamps use `--signal-espionage` / `--signal-espionage-deep`.
  - Classified Legacy dividers and Debrief Book accents use `--signal-classified` / `--signal-classified-deep`.
  - Biological MEDUSA contamination and outbreaks use `--signal-medusa`, staying sharply distinct from espionage alerts.
  - Compound/blueprint actions use `--signal-blueprint`.
  - **One unified interactive attention signal (`--signal-attention` + `--signal-attention-halo`):** Every place the player can or should act next uses the same high-luminance reticle/highlight treatment so it reads clearly over every region color and never competes with passive risk cues.

---

## 4. Information Density

Optimize for **immediate spatial scannability at rest, deep precision on demand**:

- **Show, don't tell — and never do both:** Communicate state through spatial placement, icons, color+pattern, and physical movement before prose. Omit helper paragraphs, redundant section headers, static legends, and duplicate readouts whenever the visual state already speaks for itself.
- **Resting state carries only live play essentials:** At rest, the tabletop shows the board state, pieces, active objectives, compact corner seats, hand, and top-level counters—clean enough to read the entire geopolitical situation in one sweep without visual noise.
- **Progressive depth without leaving the table:** Secondary detail—exact deck probabilities, known intensified Threat cards, full alias assets/liabilities, card uses, locked action refusal reasons, and original scan peeks—lives one hover or click away in rich, non-disruptive overlays rather than permanently cluttering the board.
- **Universal inline symbology:** Whenever rules or status text references a recurring game concept (affiliation, agent, team van, safehouse, surveillance eye, target bullseye, cover pip, disease cube, Debrief reference), render its consistent color-matched inline symbol rather than plain text.
- **Fit cleanly, never truncate or scrollbox:** Dynamic sizing and responsive tabletop spreads replace `...` truncation and inner scrollbars.

---

## 5. Standing Interaction Rules

Prefer broad, consistent interaction rules that apply uniformly across every surface:

- **Hover to inspect, click to act:**
  - Use custom hover interactions broadly across the table to reveal extra context, cross-link related board elements, preview targets, or expand compact resting views.
  - Custom hover inspection is **mandatory** on any ambiguous element and on all icon-only actions or buttons.
  - **Never use the native HTML `title` attribute** or allow native browser autofill popups anywhere in the game—every tooltip is a styled, game-native hover surface (and hoverable itself when it contains deeper interactive breakdowns).
- **Direct manipulation on physical objects:** Interact directly with the map, blueprint rooms, pieces, cards, folders, and passports. Never substitute modal option lists or dropdowns when clicking or dragging a real tabletop object can carry the action.
- **Zero friction on repeatable moves, anchored deliberate choices:** Cheap repeatable actions execute in a single click (repeating or undoing beats quantity dialogs). Surface only legal moves by default, tuck unavailable actions away with engine-derived reasons on inspection, and anchor multi-step turn choices in one stable ergonomic zone.
- **Single legality oracle:** Derive every legal target, affordance, and refusal explanation directly from `@repo/game`'s `reject()` and `options`—never duplicate game rules in UI code.
- **Always let players see the board:** Every full-screen overlay (lobby, briefing, Debrief Book, dossier unboxing, upkeep, group vote) provides an effortless step-aside to inspect and pan the live map before deciding.
- **One canonical component per physical artifact:** Build one production component per game object (card families, passport spread, dossier folder, map token, consensus gate, reference scan peek) and reuse it identically in live play, briefings, pickers, archives, upkeep, and `/debug` galleries.
- **Shared table presence & one consensus grammar:** Anchor player seats consistently around the corners (local player in a fixed home corner), share live peer cursors and temporary map pings, witness story and crisis beats in sync across all screens, and use one unified seat-colored consensus control for every table-wide gate (collapsing cleanly in solo play and never deadlocking on an idle player).

---

## 6. Motion, Ambient Life & Sound

- **Cue-driven choreography, unblocked rules:** `@repo/game` advances synchronously and emits ordered `AnimationCue[]` (`packages/game/src/timeline.ts`). The UI sequences animations reactively from that stream without locking engine state behind timers—guaranteeing snappy input, automatic peer/replay parity, and clean skips on reload, undo, or replay seek.
- **Mechanical 1962 motion feel (`--duration-*`, `--ease-mechanical`):** Favor crisp, physical weight over bouncy UI springs—card slides across a desk, decisive ink-stamp impacts, metallic foil scratch-offs, smooth route travel and dashed flight arcs, perforated dossier peels, and papers gliding smoothly into their folders or briefcases. Scale duration to dramatic stakes: routine moves stay brisk; Escalations, Incidents, Outbreaks, Cover Burns, and Legacy reveals earn deliberate pauses.
- **Performant, focus-gated ambient animations:** Subtle ambient motion and pulses (active attention reticles, gentle radar rings, active crisis tension cues) are encouraged to keep the tabletop feeling alive—provided they stay compositor-cheap (transform/opacity, zero layout thrash) and **run only while the tab is visible and focused** (automatically paused via `data-ambient-animation` / `html[data-window-inactive]`, and honoring `prefers-reduced-motion`). Heavy canvas/WebGL scenes still render on demand and halt completely in inactive tabs.
- **Period soundscape (when audio is added):** Adaptive 1962 cool-jazz / espionage tension bed that responds to Threat Level and shifts subtly when biological MEDUSA threats emerge, paired with crisp analog foley (paper slide, folder tuck, typewriter clack, metallic scratch, rubber stamp thump, radio click) and expressive voiced briefings—verifiable offline, paused cleanly when tabs hide, and hushed during fast-forward replays.

---

## 7. State Architecture, Persistence & Verification

- **Clean state separation:**
  1. **Authoritative game & campaign state:** `@repo/game` `World` / `PlayerView` (saved, diffed, undoable).
  2. **Table & persisted social state:** Reload-persistent seat assignments, passport claims, and **player map drawings**—stored in the save file using a compact, efficient stroke representation (e.g., quantized/delta-encoded polylines keyed by seat so erasing removes only your own marks) so tactical map markings survive across sessions without bloating saves or polluting undoable game rules history.
  3. **Ephemeral presence state:** Live peer cursors and temporary board pings—never saved and never triggering game recomputation.
- **Built-in `/debug` workbench:** Treat visual observability as first-class—maintain a production component gallery (exact-scale components with live state toggles and reference scan comparisons), deterministic state checkpoints for visual polish, and an in-app feedback capture flow attaching screenshots and reproducible saves.
- **Verify on the real app:** Keep millisecond pure-logic tests in `@repo/game` and `@repo/shared`; verify visual craft, motion continuity, and real interactions directly against the running client.

---

## 8. Guiding Tradeoffs

| We Choose | Over | Why | Accepted Tradeoff |
|---|---|---|---|
| **Tabletop brought to life (object permanence & spreads)** | Static admin layouts & instant pop-in | Makes the game feel tactile, legible, and deeply atmospheric | Requires deliberate flight/folder animations and dynamic layout math |
| **Single semantic token source (`theme.css` + `tokens.ts`)** | Hardcoded colors, fonts, and ad-hoc styles | Zero visual drift, instant global tuning, clean separation of design from docs | Strict discipline to reject raw literals in code and docs |
| **Laptop single-screen tabletop** | Mobile-responsive scrolling layouts | Spatial board games need the whole map, seats, and hand visible together | Phones are out of scope |
| **Color + pattern/shape redundancy** | Color-only region & faction coding | Keeps six muted regions and three affiliations unmistakable at a glance | Every region and affiliation primitive carries its pattern/emblem |
| **General standing rules** | Per-element micro-specs | Concise guidance that scales cleanly across 12 months of legacy mechanics | Agents apply judgment consistently and push back on edge cases |
| **Compact persisted drawings in save file** | Ephemeral-only annotations | Tactical notes survive across sessions and reloads like markings on a real board | Needs compact stroke encoding kept separate from rules undo |
| **Focus-gated ambient animations** | Either completely static UI or spinning background loops | Keeps the table feeling alive while respecting battery and CPU when unfocused | Ambient cues must stick to cheap compositor properties and respect focus state |
| **Cue-driven reactive animation (`AnimationCue`)** | Timer-blocked engine state | Instant rules core, identical peer/replay playback, clean undo & seeking | Client layer coordinates visual choreography from the cue stream |

---

## 9. Anti-Patterns to Reject on Sight

1. **Silent guideline drift:** Implementing a request that violates `DESIGN.md` without pushing back to either follow the rule or intentionally update the guideline and refactor.
2. **Raw styling literals:** Hardcoding hex colors, font-family names, or arbitrary z-index values in components or design docs instead of semantic tokens.
3. **Vanishing elements & sterile form UI:** Blinking cards/clippings out of existence instead of animating them into their folder/briefcase/pile, or boxing tabletop controls into bordered SaaS cards and dropdowns.
4. **Native browser chrome:** Using HTML `title` attributes, leaving icon-only buttons without custom hover inspection, or allowing browser autofill popups.
5. **Show AND tell:** Writing helper prose, redundant labels, or static legends next to visuals that already express the state.
6. **Color-only encoding:** Showing a region hue without its pattern or an affiliation color without its medallion emblem.
7. **Spy-movie neon or Season 2 carry-over:** Matrix-green CRT terminals, antiquarian serifs, or warm maritime sepia styling that clashes with 1962 modernist print.
8. **Split-brain rules or debug doppelgängers:** Duplicating legality checks in UI components instead of reading `@repo/game`, or maintaining simplified stand-in components for `/debug`.
9. **Scrollboxes, `...` truncation, and unfocused CPU burn:** Solving dense spreads with scrollbars or letting ambient animations and render loops run when the tab is unfocused or hidden.
