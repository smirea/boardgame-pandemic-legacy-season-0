# Pandemic Legacy: Season 0

This directory is the game, extracted so it can be played locally later. It holds the English workshop mod [2618224591](https://steamcommunity.com/sharedfiles/filedetails/?id=2618224591) (Pandemic Legacy Season 0 English Mod v2, 1.17.1) and the 16-page Z-Man rulebook. Paths below are relative to this directory.

One component is one record. The shape is frozen in [SCHEMA.md](SCHEMA.md). `records/<id>.json` is the data. `records/<id>.md` is the same record for reading. An id uses the printed code when the piece has one: `legacy/00-01`, `door/35`, `door/C`, `box/0004`. An operations card keeps the id the save gave it (`operations/i14`) and stores the number from its back in `printedCode` (`76`). The two ends of that deck have no number, so their `printedCode` is null.

## Follow an instruction

`edges` on a record are the instructions printed on it. `targetId` is the next record. `type` is `opens`, `destroys`, `adds`, `places`, or `reads`.

A legacy card's `marker` is `STOP`, `PAUSE`, or `continue`. `deck-order.json` → `drawOrder` is the starting legacy deck in printed order: part 1 from `00-01`, then part 2. That list has 134 cards. The 16 later copies sealed in box 0005 are `legacy/sealed-*` and are not in the draw order. `workshopOrder` is the Tabletop Simulator stack order, with `00-01` at the bottom of part 1.

Opening a door or a safe deposit box is an `opens` edge. The door or box record then `adds` each component inside it. A nested open is another edge on one of those components. Door 14's card, for example, offers doors 19 and 24. Debrief 206 and 190 open doors 38, G, and C.

## Layout

| Path | What it is |
| --- | --- |
| `index.json` | Every record id and its JSON path. The checker starts here. |
| `census.json` | Publisher counts, counts in this archive, and the notes where they differ. |
| `CATALOG.md` | The same census, then one row per record. |
| `deck-order.json` | Legacy deck order, as above. |
| `board.md` | The 48 cities: region, allegiance, connections, and the one printed safehouse (Washington). |
| `rules/rulebook.md` | Cleaned field manual. `<!-- page: NN -->` marks the 16 pages. |
| `rules/rulebook-final.md` | That manual with every rule sticker in its slot. |
| `rules/pages/` | Those pages as PNG. |
| `source/workshop-2618224591.bson` | The workshop file as downloaded. |
| `source/workshop.json` | That file decoded to JSON. |
| `source/rulebook-1j1ju.pdf` | The rulebook PDF. |
| `source/guids.json` | Every Tabletop Simulator GUID the save contains. Each one is claimed by a record. |
| `media/original/` | The 500 downloaded files: images and the 7 custom `.obj` meshes. |
| `media/split/` | One image per card cell. Shared backs are not split. |
| `media/url-map.json` | Save URL → file under `media/original/`. Keys are the original `cloud-3` URLs. |
| `records/` | One JSON file and one Markdown file per component. |
| `SOURCES.md` | Where the PDF and the workshop file came from, and what was not downloaded. |

`records/` is grouped by kind: `legacy/`, `door/`, `box/`, `debrief/`, `operations/`, `player/`, `threat/`, `passport/`, `pearl/`, `dossier/`, `tile/`, `sticker/`, and the rest. A Tabletop Simulator scroll state is a face on the same record (`state-1` is the face in the save, then `state-2` onward), not a second record. Cards have `front` and `back`. Only the rulebook, the twelve passports, and the debrief book use state lists.

An image path on a face, such as `media/split/ff910e2efc70-24.jpg`, is relative to this directory. A custom mesh is `mesh.file` on the record, the same way.

## Census

`CATALOG.md` is the tally. The book and the mod do not match on five lines, and both numbers are kept:

- Dossiers: the book counts 3 folios. This archive also has each sealed door (42 clickable doors, plus door 47, which is a PEARL entrance card in bag 0003 rather than a dossier pocket).
- Passports: the book counts 4. The mod has 4 pawn colors × 3 allegiances, and each has 11 cover-scratch faces.
- Player cards: the book counts 58. Six more are sealed in box 0008. The five escalation cards are one object the mod clones.
- Legacy deck: the book counts one deck in two parts. Box 0005 also holds a sealed copy of the late cards.
- Incidents: the book counts 7. Later boxes add copies.

Legacy cards have no printed total. There are 150 here: 81 in part 1 (including the end-of-part warning), 53 in part 2 (including the end-of-deck warning), and 16 sealed. Operations cards are 42, numbered 50–89, which is what the book says in two different sentences. Debrief entries run 100–252 with no gaps, plus the index sheet.

Doors the book never names and the save does not contain (31–34, 45, B, D, E, K, M, N, P, Q, R, V–Z, and I) are not invented. Letter I is skipped because the sticker slots skip it.

## Checker

From the repo root:

```sh
bun test packages/archive/src/check.test.ts
```

`packages/archive/src/check.ts` walks up from its file until it finds `docs/game/index.json`, then checks that archive. It fails when an edge points at a missing id, a rules or flavor face has no transcription, an image or mesh file is missing, a GUID in `source/guids.json` is unclaimed, or a census total does not match a recount of the index. It does not contain card text. The test prints the counts and runs the check twice.
