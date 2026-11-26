# Record template

Frozen before bulk extraction. Every item in the archive is one JSON object with this shape. The checker in `packages/archive` reads these fields and no others.

```json
{
  "id": "legacy/00-01",
  "printedCode": "00-01",
  "kind": "card",
  "censusKey": "legacy-card",
  "sourceGuid": "bc9541",
  "provenance": {
    "workshopId": "2618224591",
    "version": "1.17.1",
    "savePath": "351/0/80",
    "duplicatePaths": ["352/80"],
    "note": ""
  },
  "count": 1,
  "faces": [
    {
      "id": "front",
      "ttsState": null,
      "role": "both",
      "transcription": "full printed rules text",
      "flavor": "full printed flavor text, or empty when the face has none",
      "image": "media/split/legacy-00-01-front.webp"
    }
  ],
  "states": [],
  "edges": [
    { "type": "opens", "targetId": "door/11", "label": "Open Door 11" }
  ],
  "marker": "STOP",
  "unreferenced": false
}
```

## Fields

- `id` is stable and unique. Decks, doors, and boxes use the printed code (`door/11`, `door/L`, `box/0001`, `legacy/00-01`). A duplicate GUID is not a second record. Its other save paths go in `provenance.duplicatePaths`.
- `printedCode` is the code printed on the component (`00-01`, `76`, `0004`). Null when nothing is printed. An operations card uses the number on its back (50–89). The two unnumbered ends of that deck stay null.
- `kind` is one of `card`, `door`, `box`, `sticker`, `token`, `mesh`, `board`, `rule-page`, `deck`, `note`, `dossier`, `file`, `reference`, `passport`, `alias`, `team`, `pawn`, `overlay`.
- `censusKey` is the publisher line this record counts toward, or `mod-extra` when the mod added it, or `duplicate-shell` for an empty extra copy. Publisher keys: `rulebook`, `board`, `pawn`, `agent`, `safehouse`, `incident`, `threat-marker`, `tracking-token`, `objective-token`, `team`, `reference-card`, `passport`, `intelligence-file`, `personnel-file`, `sticker-sheet`, `threat-card`, `player-card`, `temporary-alias`, `legacy-deck`, `legacy-card`, `debrief-book`, `debrief-page`, `dossier`, `operations-card`, `safe-deposit-box`.
- `sourceGuid` is the primary TTS GUID. `provenance.guids` lists every GUID this record claims, including states and a second object merged into this one (a safe-deposit box model merged with its content bag). The checker requires every GUID in `source/guids.json` to appear in some record.
- `count` is how many identical physical pieces this one record stands for when the mod stacks them (36 agents that share a mesh). The record still lists every GUID in `provenance` when they differ. Pieces with their own face art get their own records and `count` 1.
- `faces` is every printed side and every alternate Tabletop Simulator state. A card has `front` and `back` (`ttsState` null). An object with a TTS state list has `state-1` for the face showing in the save (TTS state 1, which is not repeated inside `States`) and `state-2`, `state-3`, … for every entry in `States`, in numeric order. `ttsState` is that number. Scratch tracks, passport cover steps, debrief pages, and in-mod rulebook pages are these states, not extra records. `role` is `rules`, `flavor`, `both`, `art`, or `blank`. A `rules`, `flavor`, or `both` face must have a non-empty `transcription`. Flavor text lives in `flavor` and may also be repeated in `transcription` when the face is a single block of text. `art` and `blank` may have an empty transcription. `image` is a path relative to this directory. A page of a PDF is `<file>.pdf#page=<n>`. Null when there is no image to keep, which the face's `imageNote` (or, for the whole record, `provenance.note`) must say: a download that failed, or a passport scratch state, which keeps only the state-1 image and lists the pips in its transcription.
- `states` lists face ids that are alternate states of the same object (debrief pages, rule pages, scratched faces).
- `edges` are outbound instructions. `type` is `opens`, `destroys`, `adds`, `places`, or `reads`. `targetId` is another record id. `label` is the printed instruction. A card is not done until every edge resolves.
- `marker` is `STOP`, `PAUSE`, `continue`, or null. Legacy cards must set it. Other records use null.
- `unreferenced` is true when no rulebook line and no edge names this record. Those records stay in the archive.
- `mesh` is `{ "file": "media/original/<hash>.obj", "diffuse": "media/original/<hash>.jpg" | null }` when the object has a custom mesh. Null when it does not. Both files must exist when set.

## Deck order

`deck-order.json` is taken from the workshop save, not from a reading of the cards.

- `part1` and `part2` are the TTS `ContainedObjects` order (index 0 is the first object in the save).
- `drawOrder` is the printed order: part 1 from `00-01` forward, then part 2. The save stores part 1 with `00-01` at the bottom of the array.

## Checker

`packages/archive/src/check.ts` loads `docs/game` and returns counts. It fails when a legacy, door, or box edge target is missing, a text face has no transcription, an image or mesh path is missing on disk, or a census total does not equal a recount of the index. It does not contain card text.
