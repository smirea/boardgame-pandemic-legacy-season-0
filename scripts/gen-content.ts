#!/usr/bin/env bun
/**
 * Generates packages/game/src/content/archive.generated.ts from docs/game/ so the game engine
 * has verbatim printed text for every legacy card, debrief entry, operations card, box, door,
 * threat incident, city keypad number, and passport cover track without filesystem access.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = dirname(dirname(import.meta.path));
const archiveRoot = join(repoRoot, "docs/game");
const outPath = join(repoRoot, "packages/game/src/content/archive.generated.ts");

type Face = {
  id: string;
  role: string;
  transcription: string;
  flavor: string;
};

type Edge = { type: string; targetId: string; label: string };

type RecordJson = {
  id: string;
  printedCode: string | null;
  kind: string;
  censusKey: string;
  count: number;
  faces: Face[];
  edges: Edge[];
  marker: "STOP" | "PAUSE" | "continue" | null;
};

const index = JSON.parse(readFileSync(join(archiveRoot, "index.json"), "utf8")) as {
  records: { id: string; file: string }[];
};
const deckOrder = JSON.parse(readFileSync(join(archiveRoot, "deck-order.json"), "utf8")) as {
  drawOrder: string[];
};

const byId = new Map<string, RecordJson>();
for (const entry of index.records) {
  const rec = JSON.parse(readFileSync(join(archiveRoot, entry.file), "utf8")) as RecordJson;
  byId.set(rec.id, rec);
}

function slugCity(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function faceText(rec: RecordJson, id: string): { rules: string; flavor: string } {
  const f = rec.faces.find((x) => x.id === id);
  if (!f) return { rules: "", flavor: "" };
  return { rules: cleanText(f.transcription), flavor: cleanText(f.flavor) };
}

// 1. Legacy cards
type LegacyArchiveCard = {
  id: string;
  code: string;
  marker: "STOP" | "PAUSE" | "continue";
  front: string;
  back: string;
  frontFlavor: string;
  backFlavor: string;
};

const legacyCards: Record<string, LegacyArchiveCard> = {};
for (const rec of byId.values()) {
  if (!rec.id.startsWith("legacy/")) continue;
  const front = faceText(rec, "front");
  const back = faceText(rec, "back");
  legacyCards[rec.id] = {
    id: rec.id,
    code: rec.printedCode ?? rec.id.replace("legacy/", ""),
    marker: rec.marker ?? "continue",
    front: front.rules,
    back: back.rules,
    frontFlavor: front.flavor,
    backFlavor: back.flavor,
  };
}

const sealedLegacyOrder = [
  "legacy/sealed-11-01",
  "legacy/sealed-11-02",
  "legacy/sealed-11-03",
  "legacy/sealed-11-04",
  "legacy/sealed-11-05",
  "legacy/sealed-11-06",
  "legacy/sealed-11-07",
  "legacy/sealed-12-01",
  "legacy/sealed-12-02",
  "legacy/sealed-12-03",
  "legacy/sealed-12-04",
  "legacy/sealed-12-05",
  "legacy/sealed-12-06",
  "legacy/sealed-12-07",
  "legacy/sealed-12-08",
  "legacy/sealed-end-of-legacy-deck",
];

// 2. Debrief entries (100..252)
type DebriefArchiveEntry = {
  number: number;
  flavor: string;
  rules: string;
  fullText: string;
};

const debriefs: Record<number, DebriefArchiveEntry> = {};
for (const rec of byId.values()) {
  if (!rec.id.startsWith("debrief/") || !rec.printedCode) continue;
  const num = Number(rec.printedCode);
  if (!Number.isInteger(num) || num < 100) continue;
  const front = faceText(rec, "front");
  const parts: string[] = [];
  if (front.flavor) parts.push(front.flavor);
  if (front.rules && front.rules !== front.flavor) parts.push(front.rules);
  debriefs[num] = {
    number: num,
    flavor: front.flavor,
    rules: front.rules,
    fullText: parts.join("\n\n"),
  };
}

// 3. Operations cards (50..89)
type OperationsArchiveCard = {
  number: number;
  id: string;
  text: string;
  flavor: string;
};

const operationsCards: Record<number, OperationsArchiveCard> = {};
for (const rec of byId.values()) {
  if (!rec.id.startsWith("operations/") || !rec.printedCode) continue;
  const num = Number(rec.printedCode);
  if (!Number.isInteger(num) || num < 50) continue;
  const front = faceText(rec, "front");
  operationsCards[num] = {
    number: num,
    id: rec.id,
    text: front.rules,
    flavor: front.flavor,
  };
}

// 4. Boxes & Doors verbatim contents
function collectContainerTexts(containerId: string): string[] {
  const rec = byId.get(containerId);
  if (!rec) return [];
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const edge of rec.edges) {
    const child = byId.get(edge.targetId);
    if (!child) continue;
    // Skip raw pearl door placeholders and pure single-digit tokens
    for (const face of child.faces) {
      const t = cleanText(face.transcription);
      if (!t || t === "??" || /^\d$/.test(t) || /^000\d$/.test(t) || /^DOOR \d+$/.test(t)) {
        continue;
      }
      if (!seen.has(t)) {
        seen.add(t);
        texts.push(t);
      }
    }
  }
  return texts;
}

const boxes: Record<string, string[]> = {};
for (const code of ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]) {
  boxes[code] = collectContainerTexts(`box/${code}`);
}

const doors: Record<string, string[]> = {};
for (const rec of byId.values()) {
  if (!rec.id.startsWith("door/") || !rec.printedCode) continue;
  doors[rec.printedCode] = collectContainerTexts(rec.id);
}

// 5. Threat card incident texts & player card keypad numbers
type CityArchiveMeta = {
  keypad: number;
  country: string;
  incidentTitle: string;
  incidentText: string;
};

const cityArchive: Record<string, CityArchiveMeta> = {};
for (const rec of byId.values()) {
  if (!rec.id.startsWith("player/") || !rec.printedCode || rec.printedCode === "Escalation") {
    continue;
  }
  const cityId = slugCity(rec.printedCode);
  const front = faceText(rec, "front").rules;
  const match = front.match(/(\d)\s*$/);
  if (!match) {
    throw new Error(`Could not parse keypad number for ${rec.id}: ${front}`);
  }
  const keypad = Number(match[1]);

  const threat = byId.get(`threat/${cityId}`);
  if (!threat) throw new Error(`Missing threat card for ${cityId}`);
  const threatLines = faceText(threat, "front")
    .rules.split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Format: CITY, COUNTRY, INCIDENT, TITLE, TEXT
  const country = threatLines[1] ?? "";
  const incIdx = threatLines.findIndex((l) => l === "INCIDENT");
  const incidentTitle = threatLines[incIdx + 1] ?? "";
  const incidentText = threatLines.slice(incIdx + 2).join(" ");

  cityArchive[cityId] = { keypad, country, incidentTitle, incidentText };
}

// 6. Passport cover tracks (all 12 pages)
type CoverPip = "empty" | "discard" | "liability" | "burned";
const passportTracks: Record<string, CoverPip[]> = {};
for (const rec of byId.values()) {
  if (!rec.id.startsWith("passport/")) continue;
  const key = rec.id.replace("passport/", "");
  const lastFace = rec.faces[rec.faces.length - 1]!;
  const pips: CoverPip[] = [];
  for (const line of lastFace.transcription.split("\n")) {
    const m = line.match(/^\d+\.\s*scratched,\s*(.+)$/);
    if (!m) continue;
    const raw = m[1]!.trim();
    if (raw === "empty") pips.push("empty");
    else if (raw === "crossed card") pips.push("discard");
    else if (raw === "handcuffs") pips.push("liability");
    else if (raw === "flame") pips.push("burned");
    else throw new Error(`Unknown cover pip "${raw}" in ${rec.id}`);
  }
  if (pips.length !== 10) {
    throw new Error(`Expected 10 cover pips for ${rec.id}, got ${pips.length}`);
  }
  passportTracks[key] = pips;
}

// 7. Symptom card names
const symptomNames: string[] = [];
for (let i = 4; i <= 15; i++) {
  const id = `legacy/04-${String(i).padStart(2, "0")}`;
  const rec = byId.get(id)!;
  const lines = faceText(rec, "front")
    .rules.split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  symptomNames.push(lines[1] ?? `Symptom ${i - 3}`);
}

const header = `// Generated by scripts/gen-content.ts from docs/game/. Do not edit by hand.\n\n`;
const body = [
  `export type CoverPip = "empty" | "discard" | "liability" | "burned";`,
  `export type LegacyArchiveCard = { id: string; code: string; marker: "STOP" | "PAUSE" | "continue"; front: string; back: string; frontFlavor: string; backFlavor: string };`,
  `export type DebriefArchiveEntry = { number: number; flavor: string; rules: string; fullText: string };`,
  `export type OperationsArchiveCard = { number: number; id: string; text: string; flavor: string };`,
  `export type CityArchiveMeta = { keypad: number; country: string; incidentTitle: string; incidentText: string };`,
  `export const LEGACY_DRAW_ORDER: readonly string[] = ${JSON.stringify(deckOrder.drawOrder, null, 2)};`,
  `export const SEALED_LEGACY_ORDER: readonly string[] = ${JSON.stringify(sealedLegacyOrder, null, 2)};`,
  `export const LEGACY_ARCHIVE: Record<string, LegacyArchiveCard> = ${JSON.stringify(legacyCards, null, 2)};`,
  `export const DEBRIEF_ARCHIVE: Record<number, DebriefArchiveEntry> = ${JSON.stringify(debriefs, null, 2)};`,
  `export const OPERATIONS_ARCHIVE: Record<number, OperationsArchiveCard> = ${JSON.stringify(operationsCards, null, 2)};`,
  `export const BOX_ARCHIVE: Record<string, readonly string[]> = ${JSON.stringify(boxes, null, 2)};`,
  `export const DOOR_ARCHIVE: Record<string, readonly string[]> = ${JSON.stringify(doors, null, 2)};`,
  `export const CITY_ARCHIVE: Record<string, CityArchiveMeta> = ${JSON.stringify(cityArchive, null, 2)};`,
  `export const PASSPORT_TRACKS: Record<string, readonly CoverPip[]> = ${JSON.stringify(passportTracks, null, 2)};`,
  `export const SYMPTOM_NAMES: readonly string[] = ${JSON.stringify(symptomNames, null, 2)};`,
].join("\n\n");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${header}${body}\n`);
console.log(
  `Generated ${outPath}: ${Object.keys(legacyCards).length} legacy cards, ${Object.keys(debriefs).length} debriefs, ${Object.keys(operationsCards).length} operations cards, ${Object.keys(boxes).length} boxes, ${Object.keys(doors).length} doors, ${Object.keys(cityArchive).length} cities, ${Object.keys(passportTracks).length} passport tracks, ${symptomNames.length} symptoms.`,
);
