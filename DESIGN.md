# Design Language: Pandemic Legacy — Season 0

> **How to use this document**
> This is the living design vision for **Pandemic Legacy: Season 0**—capturing the visual language, interaction grammar, motion feel, craft standards, and tradeoffs for every client surface.
>
> Before building or modifying any UI, interaction, or animation:
> 1. **Check existing components in `apps/ui/` first.** Reuse or extend an established pattern before inventing a new one.
> 2. **Consult this file** for rationale, visual hierarchy, color/pattern truth, and interaction tradeoffs.
> 3. **Keep this file current.** Whenever a real design decision shifts the system, update `DESIGN.md` in the same change.

---

## 1. Product Vision & Audience

- **Built for trusted friends at a shared virtual table (plus solo multi-hand):** Skip public-platform bloat (accounts, room browsers, matchmaking, server-side anti-cheat). Spend that craft budget on tactile visuals, crisp motion, expressive sound, and deep quality of life.
- **One laptop screen, zero page scrolling:** A board game is a spatial object taken in at a glance. Design uncompromisingly for laptop viewports so the entire active play space—world map, operations, player passports, hand, and key tracks—fits cleanly on one screen with no full-page scroll.
- **Faithful to the box, native to the screen:** Preserve 100% of Season 0's rules, espionage atmosphere, and printed ephemera while removing physical bookkeeping tedium—live deck odds, Threat-deck memory (tracking intensified cards), spoiler-free unlocked rules & Debrief archive, instant undo (with playful table consensus when undoing revealed hidden info), and an unobtrusive in-place peek at the original printed scan for any component.
- **One crafted default:** Opinionated, cohesive defaults (full story, sound on with persisted mute/volume, deliberate pacing) over settings sprawl. No backwards-compatibility shims during development.

---

## 2. Period Aesthetic: 1962 Cold War Intelligence Operations Desk

Season 0 is set in **1962** during the height of the Cold War—Department of Sabotage Field Manual `N4245.3`, Debrief Book `N4245.4`, covert travel under forged passports, and Project MEDUSA.

Its aesthetic is **1962 Mid-Century Modernist Espionage**: Saul Bass poster geometry, Swiss International Typographic grids, Pan Am airline luggage tags, manila intelligence dossiers, embossed diplomatic passports, vintage matchbook dead-drops, architectural blueprints, typewritten memos, and stark rubber ink stamps.

It is **not** generic green-on-black hacker terminals, **not** sterile SaaS cards, and **not** Season 2's warm antiquarian parchment chart. It is cooler, sharper, inkier, and more geometric.

### Five Physical Materials

Every surface in the client belongs to one of five tactile materials drawn directly from the game's artwork:

| Material | Visual Character | Where It Appears |
|---|---|---|
| **Situation Room Desk** | Deep cool slate-charcoal (`#111518` / `#181d22`) and speckled dark graphite card stock (`#2b2f31`, echoing the Action Reference card). Quiet, low-contrast peripheral chrome. | Outer viewport frame, top telemetry bar, subtle HUD rails, recessed trays. |
| **Folded Map & Manila Dossier Stock** | Bright folded paper world map (slate-teal oceans `#6d8e95`, cool ash landmasses `#b4bcb6`, visible crease seams, newsprint margins `#dcd8cb`) and warm manila stock (`#e2dcc8` / `#d6c8a8`) with sharp 1px ink rules, hairline crosshairs, dashed perforations, and hole-punched binder edges. | The world board, Lobby, Game Calendar, Operations objective tabs, Debrief Book entries, Legacy briefings, Dossier doors, Upkeep / Spend Budget sheets. |
| **Diplomatic Passport Stock** | Deep forest-green grained leather (`#0c331c`) embossed with brushed gold foil (`#c7a944`) on the cover; pale security-watermarked paper (`#e3e0cb`), dashed sticker slots, dark espresso-umber Liability wells (`#4d3417`), and metallic silver scratch-off Cover pips inside. | Player seats, full Passport spreads (Allied / Neutral / Soviet pages), Temporary Aliases, Asset & Liability attachments. |
| **Ephemera Card Families** | Each card type keeps its unmistakable physical metaphor from the box: **City cards** as 1962 airline luggage tags (string eyelet, dashed flight line, affiliation medallion, olive radar map crop, vertical region band + pattern strip); **Events** as vintage matchbooks (ochre print, starburst, red-tipped matches); **Threats** as darkened olive surveillance dossiers with charcoal `INCIDENT` footers; **Escalations** as duotone crimson/charcoal noir alerts; **Legacy cards** as crosshatched vermilion `STOP`/`PAUSE` dividers and paper-clipped portrait memos. | Player hands, draw/discard piles, reveals, card pickers, archive & debug galleries. |
| **Infiltration Blueprint** | Architectural blueprint cyan/steel-blue (`#4a769e` / `#6a98c1`) with crisp white dashed walls, hatchways, security tokens, tunnels, and outlined stencil door numbers (`47`, `41`). | Indoor infiltration compounds (Sabik's Safehouse, PEARL Compound) whenever a pawn leaves the world map to infiltrate. |

### Typography

Three clear typographic voices matching the printed 1962 manuals and cards (no antiquarian serifs):

- **Display / Titles / Alerts:** Bold squared-corner or condensed modernist grotesque (e.g., `Saira Condensed` or `Barlow Condensed`, uppercase with tight tracking) for city names, operation headlines, `ESCALATION`, `STOP`, and `GAME CALENDAR – 1962`.
- **UI & Rules Sans:** Clean mid-century geometric sans (e.g., `Jost` or `DM Sans`) for action labels, passport fields, rules text, and HUD counters.
- **Typewriter & Telemetry Mono:** Mechanical monospace (e.g., `IBM Plex Mono` or `Courier Prime`, with `tabular-nums`) for narrative quotes, Debrief Book flavor text, Coop's memos, card index codes (`Ops 84f`, `01-02f`, `S-E-C-R-E-T`), and live deck probabilities.
- **Stencil / Outlined Numerals:** Crisp hollow/outlined numerals for dossier doors (`11`–`47`, `A`–`U`) and manual numbers (`N4245.4`).

### One Shared Color & Pattern Truth

All tokens, cards, city tiles, mini-piles, badges, tooltips, and highlights read from one shared token module so nothing ever disagrees. Because Season 0 carries **three orthogonal identity axes** (Regions, Affiliations, Passports) plus dual-era threats, **color is always reinforced by shape or pattern**:

#### 1. Six Regions (Color + Mandatory Mid-Century Pattern)

| Region | Swatch | Signature Pattern |
|---|---|---|
| **North America** | Lilac Mauve `#b598b3` | Diagonal stripes |
| **South America** | Powder Cerulean `#86bdd4` | Scalloped circle lattice |
| **Europe** | Ochre Gold `#c99c18` | Harlequin diamonds |
| **Africa** | Pistachio Sage `#a3bc74` | Halftone polka dots |
| **Asia** | Warm Sand `#c4ae86` | Woven ogee medallions |
| **Pacific Rim** | Terracotta Coral `#e48664` | Seigaiha waves |

#### 2. Three Affiliations (Dark Medallion `#1d201c` + Distinct Silhouette)

| Affiliation | Ink | Icon |
|---|---|---|
| **Allied** | Sky Cyan `#4eb3e0` | 4-point NATO compass star |
| **Neutral** | Warm Silver `#a3a69e` | Wireframe latitude/longitude globe |
| **Soviet** | Signal Vermilion `#dc621e` | Hammer & sickle |

#### 3. Four Passport / Pawn Seats

| Passport | Fill | Treatment on Dark Chrome |
|---|---|---|
| **Black** | Obsidian `#252926` | Warm silver contour & highlight rim so it never vanishes on the dark desk |
| **Green** | Seafoam Mint `#7dc7a6` | Crisp dark ink when used as badge/button fill |
| **Pink** | Retro Coral `#e57c85` | Distinct from crimson threat alerts via lighter dusty-rose value |
| **White** | Bone Ivory `#e8e4d8` | Slate contour for legibility on both paper and dark surfaces |

#### 4. Threat, Campaign & Interactive Accents

| Semantic Role | Swatch | Meaning |
|---|---|---|
| **Espionage Threat / Alert** | Signal Crimson `#c93b27` (deep `#a63406`) | Threat Level track, Surveillance eyes, Incidents, Escalations, `ALIAS BURNED` stamps, Acquire Target bullseyes |
| **Classified / Legacy** | Burnt Rust `#954617` / Signal Orange `#d55e11` | Debrief Book spine band, Legacy `STOP` borders, Confidential frames |
| **MEDUSA / Biological** | Acid Bio-Olive `#8aa224` | Biohazard contamination, exposed/disease cubes, Outbreaks—immediately distinct from crimson espionage threats |
| **Infiltration / PEARL** | Blueprint Cyan `#5a8bb8` | Compound floor-plans, hatchways, blueprint rooms, tunnels |
| **Active Attention Signal** | Luminous Ivory-Brass `#f5dfa0` + dark halo + animated radar reticle | **The single unmistakable "act here" signal** across the entire UI. High-luminance contrast + concentric target-ring motion ensures legibility over every region color (including Europe Ochre and Asia Sand) without colliding with any semantic hue |

---

## 3. Tabletop Layout & Component Standardization

### The Board Is the Hero — Boxless & Full-Bleed
- Frame the bright, tactile world map inside dark, quiet peripheral chrome. Avoid wrapping HUD elements in heavy bordered SaaS panels that eat viewport space and make the table feel like an admin form.
- Float game objects directly over the table (hands, operations tabs, passport slips, status tracks) with minimal chrome and generous typography readable at laptop distance.
- Let expressive elements (stamped seals, paper-clipped portraits, card lifts, radar reticles) break past rectangular edges naturally instead of clipping them under rigid `overflow: hidden` boxes.
- **Fit spreads to the viewport, never scrollboxes:** Selection screens, dossier doors, card fans, reveals, and archives scale cleanly to fit on screen—no cramped inner scrollbars or `...` truncation.
- **Zero browser-default chrome:** Suppress native `title` tooltips and browser autofill popups everywhere so nothing breaks tabletop immersion.

### Show, Don't Tell — And Never Do Both
- Communicate state through spatial placement, icons, color+pattern, and motion before prose. Omit helper paragraphs, redundant category headers, static map legends, and duplicate labels whenever the visual already says it.
- **Universal inline symbology:** Render recurring Season 0 concepts (affiliation medallions, Soviet agent fedoras, vans/teams, safehouses, surveillance eyes, bullseye targets, cover pips, disease cubes, Debrief chips) as consistent inline icons wherever game text appears.

### One Canonical Component Per Physical Artifact
Standardize aggressively so the UI stays concise and cohesive as Season 0's 12-month legacy mechanics expand:
- Every printed component (City luggage tag, Event matchbook, Threat dossier, Operations tab, Passport page, Debrief sheet, Map piece, Consensus gate, Reference scan peek) has **one production component** reused identically across live play, briefings, pickers, archives, upkeep, and `/debug` galleries. Never build simplified debug copies or bespoke modal tables for real game objects.
- Keep `apps/ui` organized around a thin main table shell composing focused behavior controllers and shared primitives.

### Season 0's Signature Spatial Surfaces
- **World Map (Always Present):** All 48 cities, routes, regions, affiliations, agents, vans, safehouses, surveillance eyes, exposed/contaminated markers, and satellites live on one crisp, zoom/pan-ready map grounded in build-time spatial geometry so visual connections always match rules legality.
- **Corner Passport Seats:** Anchor seats consistently at screen corners (local player fixed in a stable home corner). At rest, each seat shows a compact diplomatic passport slip (pawn identity, active alias affiliation medallion, remaining cover pips, hand count). Hovering or opening expands the full security-paper passport spread (portrait, codename, occupation, specialization, assets, umber liabilities, scratch-off cover track, and tabs across Allied / Neutral / Soviet pages) and fans their hand.
- **Operations & Telemetry Rail:** Compact top/edge anchors for the 1962 Month & Funding badge, Threat Level fedora track, active tabbed manila Objective cards (with in-place flip reveals when an unknown target city is identified), and Player/Threat deck counters.
- **Infiltration Compound Shift:** When an agent enters an infiltration site (e.g., Sabik's Safehouse or PEARL), transition deliberately into the **Blueprint Cyan** compound view (rooms, white dashed walls, hatchways, flip-able security tokens, numbered doors) while keeping the world map one click away.
- **Classified Archive Sheets:** Dossier doors, Safe Deposit Boxes, Debrief Book (`N4245.4`), Intelligence & Personnel Files, and the Game Calendar open as crisp, loose manila/newsprint documents laid over the desk—never generic gray modals.

---

## 4. Interaction Design & Shared Table Feel

### Direct Manipulation on the Table
- Players act directly on the game objects themselves: click lit cities or blueprint rooms to move, click agents or vans on the board, pick cards directly from their hand, and fan real cards across the table when inspecting or choosing from a pile. Never replace board or card clicks with dropdowns or modal lists.
- **Zero friction on repeatable steps:** Cheap, frequent moves (Drive/Ferry, Neutralize Agent, Drive/Ferry Team, placing setup pieces) execute in a single click—repeating or undoing beats quantity dialogs.
- **Anchored, legible choices:** Surface only currently legal actions by default (tucking unavailable actions with clear, engine-derived reasons when inspected) and keep sequential turn prompts anchored in one consistent ergonomic zone so the cursor never chases buttons across the screen.
- **Single legality oracle:** All interactive affordances, lit targets, and disabled explanations derive directly from `@repo/game`'s `reject()` and `options`—never re-implement game rules inside Svelte components.

### Hover to Inspect, Click to Act
Hover is a live cross-linked intelligence lens across the whole desk:
- Hovering a **City card** (in hand, discard, or deck summary) pulses a concentric radar ping on that city on the map and shows legal flight/share affordances.
- Hovering an **Objective tab** spotlights target cities, eligible regions/affiliations, and relevant active teams on the map.
- Hovering a **Passport seat** expands their alias summary, fans their hand, and highlights their pawn (and current infiltration room, if inside a compound).
- Hovering **Deck & Threat counters** opens an interactive (hoverable) breakdown showing exact draw odds, Escalation risk, and known intensified Threat cities—while spotlighting those cities on the board.

### Always Let Players See the Board
Every full-screen overlay—lobby, Legacy briefing, Debrief entry, Dossier unboxing, Spend Budget upkeep, or consensus vote—must offer an effortless peek/step-aside to inspect and pan the live map before committing.

### Shared Table Presence & One Consensus Language
- **Live table feel:** Show peer cursors in passport colors, temporary map pings, and shared red-grease-pencil map annotations (ephemeral social state outside game saves, where erasing clears only your own marks), plus clean keyboard shortcuts isolated from text inputs.
- **Witness every beat together:** Step through Legacy reveals, Debrief readings, cover scratches, Escalations, Incidents, and Outbreaks in sync so every screen shares the same dramatic beat.
- **One consensus control:** Use one standardized passport-colored voting strip for every table-wide gate (start game, continue past briefings, upkeep ready, undo after reveal) that collapses cleanly to one click in solo play and never deadlocks if a friend steps away.

---

## 5. Motion, Pacing & Period Soundscape

### Cue-Driven Choreography, Never Timer-Locked State
- `@repo/game` advances state synchronously and emits ordered `AnimationCue[]` (`packages/game/src/timeline.ts`) alongside `world.game.log`. The client animates reactively from those cues without delaying engine transitions.
- This guarantees instant responsiveness, identical choreography for remote peers and replays, and clean skips on reload, undo, or replay scrub.

### 1962 Tactile Motion Character
Prefer **crisp, physical, mechanical motion** over bouncy SaaS springs:
- **Move the real pieces:** Pawns and team vans travel smoothly along geography-aware routes; commercial/unrecorded flights arc cleanly with a brief dashed flight trail; agents and disease cubes lift from supply and settle with crisp weight; cards flip, register briefly, and glide smoothly into hands without layout jitter.
- **Period signature beats:**
  - *Cover Scratch:* Metallic silver foil rubs away across the passport pip to reveal clean space, Liability (`⚯`), or Burned.
  - *Stamps:* Crisp ink-stamp impact (`ALIAS BURNED`, `COMPLETED`, `FAILED`, `TOP SECRET`) with slight authentic angle and decisive settle.
  - *Dossier Doors & Boxes:* Tactile perforated tear/peel reveal spreading real unlocked components across the desk.
- **Stakes-proportional pacing:** Routine actions stay brisk (`150–260ms`); card draws and cover scratches pause briefly to register; major crises (Escalations, Incidents, Outbreaks, Alias Burned, Month End) earn deliberate dramatic pacing—with a fast time-lapse recap option at game end.

### Zero Idle Cost
- Board games sit still while friends talk and plan. Render canvas/WebGL/3D layers strictly on demand (sleeping after motion settles and halting completely in hidden tabs).
- Cap ambient attention pulses cleanly, isolate high-frequency hover/cursor reactivity from full board redraws, and lazy-load debug/feedback tooling so live play pays zero overhead.

### Period Soundscape (When Audio Is Built)
- **Adaptive 1962 score:** Cool-jazz / espionage tension bed (muted upright bass, brushed percussion, subtle vibraphone/brass harmonics) that escalates with Threat Level and shifts subtly from covert intrigue into stark biological dread once MEDUSA emerges.
- **Analog foley:** Crisp, key-matched physical cues timed to visual impact—cardboard slide, typewriter clack, metallic coin scratch, rubber stamp thump, map-pin click, teletype/radio burst.
- **Context-aware & verifiable:** Synthesize or render offline for objective balance checks, pause cleanly when the tab is hidden, and hush voices/rapid cues during fast-forward replays.

---

## 6. Client Architecture, Tooling & Verification

- **Three strictly separated state layers:**
  1. **Game & Campaign state:** Authoritative `@repo/game` `World` / `PlayerView` (saved, diffed, undoable).
  2. **Table & Seating state:** Reload-persistent seat assignments and passport claims, immune to game undo.
  3. **Ephemeral social state:** Live cursors, pings, and grease-pencil annotations—never stored in saves or triggering engine recomputation.
- **Built-in `/debug` workbench from day one:** Treat visual observability as part of the product—include a production component gallery (exact-scale components with live state toggles and original scan comparisons), a deterministic UI state loader for rapid visual polish, and an in-app feedback capture flow that attaches screenshots and reproducible saves.
- **Verify on the real client:** Logic tests stay millisecond-fast in `@repo/game` and `@repo/shared`; visual polish, interaction feel, and performance are verified directly on the running app, inspecting real interactions rather than proxies.

---

## 7. Guiding Tradeoffs

| We Choose | Over | Why | Accepted Tradeoff |
|---|---|---|---|
| **Laptop single-screen tabletop** | Mobile-responsive scrolling layouts | Spatial board games demand the whole map, seats, and hand visible together | Phones are out of scope |
| **1962 modernist ephemera + dark desk** | Generic spy-terminal neon or SaaS boxes | Matches the physical Season 0 box art and keeps the map legible for hours | Custom component styling instead of off-the-shelf UI kits |
| **Color + pattern/shape redundancy** | Color-only region & faction coding | Six muted mid-century regions + three affiliations stay unmistakable at a glance | Every region/affiliation primitive carries its pattern/icon |
| **Direct tabletop manipulation** | Modal option menus & form dropdowns | Faster, more tactile play with minimal eye travel | Requires an explicit board/card interaction layer |
| **Cue-driven reactive animation (`AnimationCue`)** | Timer-blocked engine state | Instant rules core, identical peer/replay playback, clean undo & seeking | Visual layer manages cue playback and render lag |
| **One canonical component everywhere** | Separate play, briefing, and debug views | Concise codebase, visual consistency, zero drift between gallery and live table | Shared components must support compact and full scales cleanly |
| **Digital-native QOL + original scan peek** | Literal physical bookkeeping | Removes deck/rules tedium while keeping trust in the printed game | Each mechanic needs intentional digital translation |

---

## 8. Anti-Patterns to Reject on Sight

1. **Spy-movie neon clichés:** Matrix green terminals, glowing cyberpunk grids, or faux-CRT scanlines—Season 0 is 1962 paper, ink, passport leather, and Swiss print design.
2. **Season 2 carry-over drift:** Antiquarian serifs, sepia maritime parchment, or warm candle-lit styling that belongs to Season 2 rather than Cold War 1962.
3. **Form UI on a tabletop:** Wrapping every readout in opaque bordered cards, or asking players to pick cities, cards, or vans from dropdowns/modals instead of clicking them on the table.
4. **Show AND tell:** Writing instructional prose, category labels, or static map legends beside visuals that already communicate the state.
5. **Color-only encoding:** Showing a region hue without its signature pattern, or an affiliation color without its medallion icon.
6. **Scrollboxes, `...` truncation, and clipped art:** Solving dense spreads with scrollbars or hard clipping instead of scaling cleanly to fit.
7. **Split-brain legality or debug doppelgängers:** Duplicating rule checks in Svelte components instead of reading `@repo/game`'s `reject()`/`options`, or building simplified stand-ins for `/debug`.
8. **Teleporting pieces or spinning idle loops:** Snapping pieces/cards with zero physical continuity, or burning CPU/GPU while players sit and discuss their turn.
