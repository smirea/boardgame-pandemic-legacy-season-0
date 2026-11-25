import { expect, test } from "bun:test";
import { checkArchive, findArchiveDir } from "./check.ts";

test("Every legacy, door, and box reference in the archive resolves, every text face is transcribed, and every image and mesh is on disk.", () => {
  const archive = findArchiveDir(import.meta.dir);
  const first = checkArchive(archive);
  const second = checkArchive(archive);
  expect(first).toEqual(second);
  for (const line of first.lines) console.log(line);
  expect(first.legacyCardsInWorkshopDeckOrder).toBeGreaterThan(0);
  expect(first.unresolvedIds).toBe(0);
  expect(first.missingImages).toBe(0);
  expect(first.missingMeshes).toBe(0);
  expect(first.emptyTranscriptions).toBe(0);
  expect(first.censusTotalsEqualIndex).toBe(true);
  expect(first.ok).toBe(true);
});
