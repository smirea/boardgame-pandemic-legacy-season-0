# Transcription standard

Subagents read the printed image and write JSON. They do not run OCR, and they do not copy text out of `archive/records`. The strings already in those records came from Tesseract and are often wrong.

The extractor loads two files after a batch merge:

- `archive/transcriptions/faces.json` replaces a record's faces and, for a legacy card, its `marker`.
- `archive/transcriptions/debrief.json` replaces numbered debrief entries.

Each batch writes one file under `archive/transcriptions/batches/`. The main thread merges those files. A batch file is the only file a subagent writes.

## Card and tile batches

Top-level keys are record ids (`legacy/00-01`, `threat/washington`, `tile/1f7195`).

```json
{
  "legacy/00-01": {
    "marker": "continue",
    "faces": {
      "front": {
        "role": "both",
        "transcription": "Every word on the face, in reading order.",
        "flavor": "Narrative or quoted speech only. Empty when the face has none."
      },
      "back": {
        "role": "both",
        "transcription": "",
        "flavor": ""
      }
    }
  }
}
```

- `transcription` is the complete face: instructions, numbers, and story, verbatim, in reading order. A scan may be rotated. Read the text upright. Do not summarize, translate, or smooth the wording.
- `flavor` repeats only the narrative sentences and quoted speech. Leave it `""` when the face is only rules.
- `role` is `both` when the face has story and rules, `rules` when it is only instructions, `flavor` when it is only story, `art` when it has no words, `blank` when the face is empty. An `art` or `blank` face has `transcription` and `flavor` set to `""`.
- A word you cannot read is `[unreadable]`. Do not invent it. A number you cannot read stays `[unreadable]`, not a nearby guess.
- Keep printed numbers exact: `Door 11`, `Door L`, `Box 0003`, `Debrief 140`, `Entry 140`, operations numbers, city names.
- The corner pill (`00-01f`, `00-01b`) is the card code, not body text. Leave it out of the transcription.
- `marker` is only for legacy cards. `STOP` when the card tells the group to stop drawing further legacy cards. `PAUSE` when it tells them to pause the draw. Otherwise `continue`. The words inside “do not stop” are not a STOP marker. Other records omit `marker`.

## Debrief batches

Each item is one column of a book page. Join a left column and its right column by entry number. An entry that starts at the bottom of the left column finishes at the top of the right column.

```json
{
  "100": {
    "image": "media/original/<page file>.jpg",
    "transcription": "Upright rules under this entry number.",
    "flavor": "Italic narrative under this entry number."
  }
}
```

`image` is the full page path from the assignment, not the column crop. Entry numbers run from 100 through 252. Skip the running header (`DEBRIEF BOOK`, `N4245.4`, `S-E-C-R-E-T`) and the page number. Do not invent entries that are not on the page.

## Board batch

`archive/transcriptions/batches/board.json` uses the card shape for record id `board`, face `front`. The transcription is a line per city: `City | region | allegiance | connections | safehouse`. Allegiance is the icon (Allied star, Neutral globe, Soviet hammer), not the background color. Background color is the region. Also write `archive/board.md` with the same tally, the five protocols (CRANE, HADES, RABBIT, STRAW, ZEPHYR), and which cities have a printed safehouse.
