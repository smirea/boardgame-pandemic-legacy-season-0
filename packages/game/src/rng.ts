export type RngState = { state: number };

export function createRng(seed: number): RngState {
  const normalized = seed >>> 0;
  return { state: normalized === 0 ? 0x9e3779b9 : normalized };
}

/** Mulberry32 step; mutates `rng.state` in place (safe inside immer drafts). */
export function nextFloat(rng: RngState): number {
  let t = (rng.state = (rng.state + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(rng: RngState, maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error(`nextInt requires positive bound, got ${maxExclusive}`);
  return Math.floor(nextFloat(rng) * maxExclusive);
}

export function shuffle<T>(rng: RngState, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export function pickOne<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pickOne called on empty list");
  return items[nextInt(rng, items.length)]!;
}
