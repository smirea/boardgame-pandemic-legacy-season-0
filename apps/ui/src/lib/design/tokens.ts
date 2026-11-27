import type { Affiliation, PassportColor, RegionId } from "@repo/game";

/**
 * Typed semantic token registry bridged to `src/routes/theme.css`.
 * Keep raw colors, font families, and z-index values in `theme.css` alone;
 * UI components, SVGs, and canvas layers reference these semantic token names.
 */

export const FONT_TOKENS = {
  ui: "--font-ui",
  display: "--font-display",
  typewriter: "--font-typewriter",
} as const;

export const SURFACE_TOKENS = {
  desk: "--surface-desk",
  chrome: "--surface-chrome",
  panel: "--surface-panel",
  panelSolid: "--surface-panel-solid",
  referenceCard: "--surface-reference-card",
  mapOcean: "--surface-map-ocean",
  mapLand: "--surface-map-land",
  mapMargin: "--surface-map-margin",
  manila: "--surface-manila",
  manilaDeep: "--surface-manila-deep",
  securityPaper: "--surface-security-paper",
  liability: "--surface-liability",
  passportCover: "--surface-passport-cover",
  coverFoil: "--surface-cover-foil",
  blueprint: "--surface-blueprint",
  blueprintDeep: "--surface-blueprint-deep",
} as const;

export const INK_TOKENS = {
  primary: "--ink-primary",
  muted: "--ink-muted",
  paper: "--ink-paper",
  paperMuted: "--ink-paper-muted",
  liability: "--ink-liability",
  passportFoil: "--ink-passport-foil",
  blueprint: "--ink-blueprint",
} as const;

export const SIGNAL_TOKENS = {
  espionage: "--signal-espionage",
  espionageDeep: "--signal-espionage-deep",
  classified: "--signal-classified",
  classifiedDeep: "--signal-classified-deep",
  medusa: "--signal-medusa",
  blueprint: "--signal-blueprint",
  attention: "--signal-attention",
  attentionHalo: "--signal-attention-halo",
  positive: "--signal-positive",
  warning: "--signal-warning",
} as const;

export const Z_TOKENS = {
  hud: "--z-hud",
  dock: "--z-dock",
  ring: "--z-ring",
  pick: "--z-pick",
  draw: "--z-draw",
  show: "--z-show",
  hover: "--z-hover",
  bar: "--z-bar",
  cover: "--z-cover",
  menu: "--z-menu",
  host: "--z-host",
  flight: "--z-flight",
  tooltip: "--z-tooltip",
} as const;

export type RegionPatternKind = "stripes" | "scallops" | "diamonds" | "dots" | "ogee" | "waves";

export type RegionVisualToken = {
  label: string;
  colorToken: `--region-${RegionId}`;
  tintToken: `--region-${RegionId}-tint`;
  patternId: `region-pattern-${RegionId}`;
  patternKind: RegionPatternKind;
};

export const REGION_TOKENS: Record<RegionId, RegionVisualToken> = {
  "north-america": {
    label: "North America",
    colorToken: "--region-north-america",
    tintToken: "--region-north-america-tint",
    patternId: "region-pattern-north-america",
    patternKind: "stripes",
  },
  "south-america": {
    label: "South America",
    colorToken: "--region-south-america",
    tintToken: "--region-south-america-tint",
    patternId: "region-pattern-south-america",
    patternKind: "scallops",
  },
  europe: {
    label: "Europe",
    colorToken: "--region-europe",
    tintToken: "--region-europe-tint",
    patternId: "region-pattern-europe",
    patternKind: "diamonds",
  },
  africa: {
    label: "Africa",
    colorToken: "--region-africa",
    tintToken: "--region-africa-tint",
    patternId: "region-pattern-africa",
    patternKind: "dots",
  },
  asia: {
    label: "Asia",
    colorToken: "--region-asia",
    tintToken: "--region-asia-tint",
    patternId: "region-pattern-asia",
    patternKind: "ogee",
  },
  "pacific-rim": {
    label: "Pacific Rim",
    colorToken: "--region-pacific-rim",
    tintToken: "--region-pacific-rim-tint",
    patternId: "region-pattern-pacific-rim",
    patternKind: "waves",
  },
};

export type AffiliationIconKind = "compass-star" | "globe" | "hammer-sickle";

export type AffiliationVisualToken = {
  label: string;
  colorToken: `--affiliation-${Affiliation}`;
  medallionToken: "--affiliation-medallion";
  icon: AffiliationIconKind;
};

export const AFFILIATION_TOKENS: Record<Affiliation, AffiliationVisualToken> = {
  allied: {
    label: "Allied",
    colorToken: "--affiliation-allied",
    medallionToken: "--affiliation-medallion",
    icon: "compass-star",
  },
  neutral: {
    label: "Neutral",
    colorToken: "--affiliation-neutral",
    medallionToken: "--affiliation-medallion",
    icon: "globe",
  },
  soviet: {
    label: "Soviet",
    colorToken: "--affiliation-soviet",
    medallionToken: "--affiliation-medallion",
    icon: "hammer-sickle",
  },
};

export type SeatVisualToken = {
  label: string;
  colorToken: `--seat-${PassportColor}`;
  rimToken: `--seat-${PassportColor}-rim` | null;
};

export const SEAT_TOKENS: Record<PassportColor, SeatVisualToken> = {
  black: {
    label: "Black",
    colorToken: "--seat-black",
    rimToken: "--seat-black-rim",
  },
  green: {
    label: "Green",
    colorToken: "--seat-green",
    rimToken: null,
  },
  pink: {
    label: "Pink",
    colorToken: "--seat-pink",
    rimToken: null,
  },
  white: {
    label: "White",
    colorToken: "--seat-white",
    rimToken: "--seat-white-rim",
  },
};

export type CssTokenName = `--${string}`;

/** Wraps a semantic CSS custom property name for inline CSS or SVG attributes. */
export function cssVar(token: CssTokenName): string {
  return `var(${token})`;
}

/**
 * Resolves a semantic token's live computed value from `document.documentElement`.
 * Intended for Canvas and WebGL renderers so they read from `theme.css` instead of duplicating literals.
 */
export function readCssToken(token: CssTokenName): string {
  if (typeof window === "undefined") {
    throw new Error(`readCssToken(${token}) requires a browser document`);
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!value) {
    throw new Error(`Missing semantic CSS token: ${token}`);
  }
  return value;
}
