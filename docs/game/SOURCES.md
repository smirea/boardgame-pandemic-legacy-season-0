# Sources

Workshop save and rulebook used for this archive. Nothing here is a substitute mod.

## Rulebook

- File: `source/rulebook-1j1ju.pdf`
- Fetched from `https://cdn.1j1ju.com/medias/d3/af/a2-pandemic-legacy-saison-0-rulebook.pdf`
- PDF 1.7, 16 pages, A4, dated 2020-12-06 in the file metadata
- Printed identity: Department of Sabotage Field Manual No. N4245.3, Pandemic Legacy Season 0, © 2020 Z-Man Games
- Page images: `rules/pages/page-01.png` through `page-16.png` (rendered at 140 dpi)
- The file has almost no text layer on the early pages. `rules/rulebook.md` is the cleaned manual with every rule sticker in its slot. A comment before each sticker says which card unlocks it. The page images are the book before those stickers
- Publisher contents cross-check: `https://www.zmangames.com/game/pandemic-legacy-season-0/` (same component list as page 2)

## Workshop mod

- Steam workshop file `2618224591`, title "Pandemic Legacy Season 0 English Mod v2"
- Version in the description and the save: 1.17.1 (2023-02-18)
- Save date stored in the file: `2/18/2023 7:19:12 AM`. `EpochTime` 1676698176. TTS `VersionNumber` `v13.2.2`
- Download: Steam `GetPublishedFileDetails` `file_url` `https://cdn.steamusercontent.com/ugc/2057618944672246448/FF7C5056CCEB84172DBB5051B75F4AD57C26BCF9/` (1,725,692 bytes)
- The upload is one BSON document (the first four bytes are the document length). Stored as `source/workshop-2618224591.bson`
- `source/workshop.json` is that document decoded to JSON
- Asset URLs inside the save use `http://cloud-3.steamusercontent.com/ugc/...`. Those hosts return 403 to a plain fetch. The same path on `https://cdn.steamusercontent.com/ugc/...` returned every file. `media/url-map.json` keys are the original save URLs
- 500 unique asset URLs, 0 failures: 424 JPEG, 69 PNG, 7 OBJ
- September helper workshop `2608806457` is not available (`GetPublishedFileDetails` result 9, no `file_url`). The PEARL compound tiles numbered 1–14 plus Entrance are already inside this mod's bag `0003`. They are labeled as that bag, not imported from the other workshop

## Not the corpus

- AppointedPie's original mod `2486331092` is credited by this mod and was not downloaded
- Tabletop Simulator Lua in the save (hotkeys, token reset, scripted setup) is not reproduced as rules
