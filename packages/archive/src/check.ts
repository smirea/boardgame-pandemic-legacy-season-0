import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

/** Publisher lines the census must name. Counts live in the archive, not here. */
export const PUBLISHER_KEYS = [
  "rulebook",
  "board",
  "pawn",
  "agent",
  "safehouse",
  "incident",
  "threat-marker",
  "tracking-token",
  "objective-token",
  "team",
  "reference-card",
  "passport",
  "intelligence-file",
  "personnel-file",
  "sticker-sheet",
  "threat-card",
  "player-card",
  "temporary-alias",
  "legacy-deck",
  "legacy-card",
  "debrief-book",
  "debrief-page",
  "dossier",
  "operations-card",
  "safe-deposit-box",
] as const;

const TEXT_ROLES = new Set(["rules", "flavor", "both"]);
const EDGE_TYPES = new Set(["opens", "destroys", "adds", "places", "reads"]);
const MARKERS = new Set(["STOP", "PAUSE", "continue"]);
const KINDS = new Set([
  "card",
  "door",
  "box",
  "sticker",
  "token",
  "mesh",
  "board",
  "rule-page",
  "deck",
  "note",
  "dossier",
  "file",
  "reference",
  "passport",
  "alias",
  "team",
  "pawn",
  "overlay",
]);

export type CheckReport = {
  ok: boolean;
  legacyCardsInWorkshopDeckOrder: number;
  resolvedReferences: number;
  unresolvedIds: number;
  missingImages: number;
  missingMeshes: number;
  emptyTranscriptions: number;
  censusTotalsEqualIndex: boolean;
  structuralErrors: number;
  lines: string[];
};

type Face = {
  id?: string;
  ttsState?: number | null;
  role?: string;
  transcription?: string;
  flavor?: string;
  image?: string | null;
};

type Edge = { type?: string; targetId?: string; label?: string };

type Mesh = { file?: string; diffuse?: string | null } | null;

type ArchiveRecord = {
  id?: string;
  kind?: string;
  censusKey?: string;
  sourceGuid?: string;
  provenance?: {
    workshopId?: string;
    note?: string;
    guids?: string[];
  };
  count?: number;
  faces?: Face[];
  states?: string[];
  edges?: Edge[];
  marker?: string | null;
  mesh?: Mesh;
};

type Census = {
  publisher?: Record<string, number>;
  totals?: Record<string, number>;
  discrepancies?: Record<string, string>;
};

type DeckOrder = {
  part1?: string[];
  part2?: string[];
  workshopOrder?: string[];
  drawOrder?: string[];
};

function emptyReport(): CheckReport {
  return {
    ok: false,
    legacyCardsInWorkshopDeckOrder: 0,
    resolvedReferences: 0,
    unresolvedIds: 0,
    missingImages: 0,
    missingMeshes: 0,
    emptyTranscriptions: 0,
    censusTotalsEqualIndex: false,
    structuralErrors: 1,
    lines: [],
  };
}

function finish(report: CheckReport): CheckReport {
  report.ok =
    report.structuralErrors === 0 &&
    report.legacyCardsInWorkshopDeckOrder > 0 &&
    report.unresolvedIds === 0 &&
    report.missingImages === 0 &&
    report.missingMeshes === 0 &&
    report.emptyTranscriptions === 0 &&
    report.censusTotalsEqualIndex;
  report.lines = [
    `legacy-cards-in-workshop-deck-order: ${report.legacyCardsInWorkshopDeckOrder}`,
    `resolved-references: ${report.resolvedReferences}`,
    `unresolved-ids: ${report.unresolvedIds}`,
    `missing-images: ${report.missingImages}`,
    `missing-meshes: ${report.missingMeshes}`,
    `empty-transcriptions: ${report.emptyTranscriptions}`,
    `census-totals-equal-index: ${report.censusTotalsEqualIndex ? "yes" : "no"}`,
    `structural-errors: ${report.structuralErrors}`,
  ];
  return report;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function insideArchive(archiveDir: string, relative: string): string | null {
  if (relative === "" || relative.includes("\0")) return null;
  const cleaned = normalize(relative);
  if (cleaned.startsWith("..") || cleaned.startsWith(sep) || cleaned.includes(`..${sep}`)) {
    return null;
  }
  const absolute = join(archiveDir, cleaned);
  const root = archiveDir.endsWith(sep) ? archiveDir : archiveDir + sep;
  if (absolute !== archiveDir && !absolute.startsWith(root)) return null;
  return absolute;
}

function fileExists(archiveDir: string, relative: string): boolean {
  const absolute = insideArchive(archiveDir, relative);
  if (!absolute) return false;
  if (!existsSync(absolute)) return false;
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

/**
 * Check the shipped archive. Counts come from the index, the records, and the workshop deck order.
 * This function does not contain card text and does not read image bytes.
 */
export function checkArchive(archiveDir: string): CheckReport {
  const indexPath = join(archiveDir, "index.json");
  const censusPath = join(archiveDir, "census.json");
  const orderPath = join(archiveDir, "deck-order.json");
  const guidsPath = join(archiveDir, "source", "guids.json");
  if (!existsSync(indexPath) || !existsSync(censusPath) || !existsSync(orderPath) || !existsSync(guidsPath)) {
    return finish(emptyReport());
  }

  const report = emptyReport();
  report.structuralErrors = 0;

  const index = readJson(indexPath) as { records?: { id?: string; file?: string }[] };
  const census = readJson(censusPath) as Census;
  const order = readJson(orderPath) as DeckOrder;
  const guidFile = readJson(guidsPath) as { guids?: string[] };

  const entries = index.records ?? [];
  if (entries.length === 0) report.structuralErrors += 1;

  const records = new Map<string, ArchiveRecord>();
  const claimed = new Set<string>();

  for (const entry of entries) {
    const id = entry.id ?? "";
    const file = entry.file ?? "";
    if (!id || !file) {
      report.structuralErrors += 1;
      continue;
    }
    if (records.has(id)) report.structuralErrors += 1;
    const absolute = insideArchive(archiveDir, file);
    if (!absolute || !existsSync(absolute)) {
      report.structuralErrors += 1;
      continue;
    }
    const record = readJson(absolute) as ArchiveRecord;
    if (record.id !== id) report.structuralErrors += 1;
    if (!KINDS.has(record.kind ?? "")) report.structuralErrors += 1;
    if (!record.censusKey) report.structuralErrors += 1;
    if (!Number.isInteger(record.count) || (record.count ?? 0) < 1) report.structuralErrors += 1;
    if (record.provenance?.workshopId !== "2618224591") report.structuralErrors += 1;
    records.set(id, record);
    for (const guid of record.provenance?.guids ?? []) claimed.add(guid);
  }

  const ids = new Set(records.keys());
  const workshopOrder = order.workshopOrder ?? [];
  report.legacyCardsInWorkshopDeckOrder = workshopOrder.length;
  if (workshopOrder.length === 0) report.structuralErrors += 1;
  if ((order.part1?.length ?? 0) + (order.part2?.length ?? 0) !== workshopOrder.length) {
    report.structuralErrors += 1;
  }

  const orderLists = [order.part1 ?? [], order.part2 ?? [], workshopOrder, order.drawOrder ?? []];
  for (const list of orderLists) {
    const local = new Set<string>();
    for (const id of list) {
      if (local.has(id)) report.structuralErrors += 1;
      local.add(id);
      if (!ids.has(id)) report.unresolvedIds += 1;
    }
  }

  for (const record of records.values()) {
    const faceIds = new Set<string>();
    for (const face of record.faces ?? []) {
      if (!face.id || faceIds.has(face.id)) report.structuralErrors += 1;
      if (face.id) faceIds.add(face.id);
      const role = face.role ?? "";
      if (!["rules", "flavor", "both", "art", "blank"].includes(role)) report.structuralErrors += 1;
      if (TEXT_ROLES.has(role) && (face.transcription ?? "").trim() === "") {
        report.emptyTranscriptions += 1;
      }
      if (face.image == null) {
        if ((record.provenance?.note ?? "").trim() === "") report.missingImages += 1;
      } else if (!fileExists(archiveDir, face.image)) {
        report.missingImages += 1;
      }
    }
    for (const stateId of record.states ?? []) {
      if (!faceIds.has(stateId)) report.structuralErrors += 1;
    }
    if (record.censusKey === "legacy-card" && !MARKERS.has(record.marker ?? "")) {
      report.structuralErrors += 1;
    }
    if (record.marker != null && !MARKERS.has(record.marker)) report.structuralErrors += 1;
    for (const edge of record.edges ?? []) {
      if (!EDGE_TYPES.has(edge.type ?? "")) report.structuralErrors += 1;
      const target = edge.targetId ?? "";
      if (!ids.has(target)) report.unresolvedIds += 1;
      else report.resolvedReferences += 1;
    }
    const mesh = record.mesh;
    if (mesh != null) {
      if (!mesh.file || !fileExists(archiveDir, mesh.file)) report.missingMeshes += 1;
      if (mesh.diffuse != null && mesh.diffuse !== "" && !fileExists(archiveDir, mesh.diffuse)) {
        report.missingMeshes += 1;
      }
    }
  }

  const recounted: Record<string, number> = {};
  for (const record of records.values()) {
    const key = record.censusKey ?? "";
    recounted[key] = (recounted[key] ?? 0) + (record.count ?? 0);
  }
  const totals = census.totals ?? {};
  const totalKeys = new Set([...Object.keys(recounted), ...Object.keys(totals)]);
  let censusMatches = true;
  for (const key of totalKeys) {
    if ((recounted[key] ?? 0) !== (totals[key] ?? 0)) censusMatches = false;
  }
  const publisher = census.publisher ?? {};
  for (const key of PUBLISHER_KEYS) {
    if (!(key in publisher)) {
      censusMatches = false;
      report.structuralErrors += 1;
    }
  }
  const discrepancies = census.discrepancies ?? {};
  for (const key of Object.keys(publisher)) {
    const published = publisher[key];
    const actual = recounted[key] ?? 0;
    if (published !== actual && (discrepancies[key] ?? "").trim() === "") censusMatches = false;
  }
  report.censusTotalsEqualIndex = censusMatches && entries.length > 0;

  const guids = guidFile.guids ?? [];
  if (guids.length === 0) report.structuralErrors += 1;
  const guidSet = new Set<string>();
  for (const guid of guids) {
    if (guidSet.has(guid)) report.structuralErrors += 1;
    guidSet.add(guid);
    if (!claimed.has(guid)) report.structuralErrors += 1;
  }

  return finish(report);
}

export function findArchiveDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "archive", "index.json"))) return join(dir, "archive");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(startDir, "archive");
}
