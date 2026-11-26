import type {
  Affiliation,
  AssetId,
  CityId,
  DoorId,
  EventId,
  InfiltrationSiteId,
  LiabilityId,
  OccupationId,
  PearlDoorNumber,
  RegionId,
  RestrictionId,
  RoomId,
  SecuritySymbol,
  SpecializationId,
} from "../ids";
import {
  BOX_ARCHIVE,
  CITY_ARCHIVE,
  DEBRIEF_ARCHIVE,
  DOOR_ARCHIVE,
  LEGACY_ARCHIVE,
  LEGACY_DRAW_ORDER,
  OPERATIONS_ARCHIVE,
  PASSPORT_TRACKS,
  SEALED_LEGACY_ORDER,
  SYMPTOM_NAMES,
} from "./archive.generated";

export type IncidentEffect =
  | { kind: "sleeper-cells"; region: RegionId }
  | { kind: "safehouse-compromised"; region: RegionId }
  | { kind: "recognized"; regions: readonly [RegionId, RegionId] }
  | { kind: "teams-compromised" };

export type CityDef = {
  id: CityId;
  name: string;
  country: string;
  region: RegionId;
  affiliation: Affiliation;
  connections: readonly CityId[];
  keypad: number;
  printedSafehouse: boolean;
  startingSurveillance: number;
  incidentTitle: string;
  incidentText: string;
  incidentEffect: IncidentEffect;
};

export type OccupationDef = {
  id: OccupationId;
  name: string;
  affiliation: Affiliation;
  text: string;
};

export type SpecializationDef = {
  id: SpecializationId;
  name: string;
  affiliation: Affiliation;
  text: string;
};

export type AssetCategory = "contact" | "visa" | "gear";

export type AssetDef = {
  id: AssetId;
  name: string;
  category: AssetCategory;
  cost: number;
  text: string;
  needsCity: boolean;
  sovietOnly?: boolean;
  maxBoxes?: number;
  unlockedBy: "start" | DoorId;
};

export type LiabilityDef = {
  id: LiabilityId;
  name: string;
  text: string;
  needsRegion: boolean;
  unlockedBy: "start" | DoorId;
};

export type EventDef = {
  id: EventId;
  name: string;
  text: string;
  actionsOnly?: boolean;
  unlockedBy: "start" | string;
};

export type RestrictionDef = {
  id: RestrictionId;
  opsNumber: number;
  name: string;
  text: string;
};

export type InfiltrationEdgeDef = {
  id: string;
  a: RoomId;
  b: RoomId;
  /** Number of security token circles along this wall (0 for a hatchway). */
  securitySlots: number;
  /** True for the 5 PEARL hatchways that cannot be infiltrated until a Tunnel sticker is placed. */
  hatchway: boolean;
};

export type RoomDef = {
  id: RoomId;
  name: string;
  site: InfiltrationSiteId;
  entrance?: boolean;
  /** PEARL dossier door number (1..14) that reveals this room. */
  pearlDoor?: PearlDoorNumber;
  text: string;
};

export type InfiltrationSiteDef = {
  id: InfiltrationSiteId;
  name: string;
  city: CityId;
  requiredAffiliation: Affiliation;
  entrance: RoomId;
  rooms: readonly RoomDef[];
  edges: readonly InfiltrationEdgeDef[];
};

export const REGIONS: readonly RegionId[] = [
  "north-america",
  "south-america",
  "europe",
  "africa",
  "asia",
  "pacific-rim",
];

export const REGION_NAMES: Record<RegionId, string> = {
  "north-america": "North America",
  "south-america": "South America",
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  "pacific-rim": "Pacific Rim",
};

export const AFFILIATIONS: readonly Affiliation[] = ["allied", "neutral", "soviet"];

export const THREAT_TRACK = [2, 2, 2, 3, 3, 4] as const;

export const STARTING_SUPPLIES = {
  agents: 36,
  safehouses: 8,
  incidentOutbreakTokens: 7,
  teamsPerAffiliation: 3,
  actionTokens: 12,
  pursuitTokens: 12,
  checkpointTokens: 12,
  satellites: 5,
  symptoms: 12,
  permanentSafehouseStickers: 5,
  startingCounterSurveillanceStickers: 10,
  contaminationStickers: 12,
  tunnelStickers: 5,
} as const;

export const MONTH_NAMES = [
  "Prologue",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const REGION_BY_TEXT: Record<string, RegionId> = {
  "North America": "north-america",
  "South America": "south-america",
  Europe: "europe",
  Africa: "africa",
  Asia: "asia",
  "Pacific Rim": "pacific-rim",
  "the Pacific Rim": "pacific-rim",
};

function parseRegionName(raw: string): RegionId {
  const region = REGION_BY_TEXT[raw.trim()];
  if (!region) throw new Error(`Unknown region "${raw}" in threat incident text`);
  return region;
}

function parseIncidentEffect(title: string, text: string): IncidentEffect {
  if (title === "TEAMS COMPROMISED") return { kind: "teams-compromised" };
  if (title === "SLEEPER CELLS ACTIVATE") {
    const m = text.match(/tokens in ([^.]+)\./);
    if (!m) throw new Error(`Could not parse Sleeper Cells region from: ${text}`);
    return { kind: "sleeper-cells", region: parseRegionName(m[1]!) };
  }
  if (title === "SAFEHOUSE COMPROMISED") {
    const m = text.match(/in ([^.]+?) and return/);
    if (!m) throw new Error(`Could not parse Safehouse Compromised region from: ${text}`);
    return { kind: "safehouse-compromised", region: parseRegionName(m[1]!) };
  }
  if (title === "RECOGNIZED") {
    const m = text.match(/Players in (.+?) or (.+?) \(/);
    if (!m) throw new Error(`Could not parse Recognized regions from: ${text}`);
    return {
      kind: "recognized",
      regions: [parseRegionName(m[1]!), parseRegionName(m[2]!)],
    };
  }
  throw new Error(`Unknown incident effect "${title}": ${text}`);
}

const RAW_CITIES: readonly [
  CityId,
  string,
  RegionId,
  Affiliation,
  readonly CityId[],
  boolean,
  number,
][] = [
  // North America (8)
  ["atlanta", "Atlanta", "north-america", "allied", ["havana", "los-angeles", "mexico-city", "toronto", "washington"], false, 0],
  ["havana", "Havana", "north-america", "soviet", ["atlanta", "bogota", "mexico-city"], false, 1],
  ["los-angeles", "Los Angeles", "north-america", "allied", ["atlanta", "mexico-city", "san-francisco", "sydney"], false, 0],
  ["mexico-city", "Mexico City", "north-america", "neutral", ["atlanta", "bogota", "havana", "los-angeles"], false, 0],
  ["new-york", "New York", "north-america", "allied", ["london", "madrid", "toronto", "washington"], false, 0],
  ["san-francisco", "San Francisco", "north-america", "allied", ["los-angeles", "saigon", "tokyo", "toronto"], false, 0],
  ["toronto", "Toronto", "north-america", "allied", ["atlanta", "new-york", "san-francisco", "washington"], false, 0],
  ["washington", "Washington", "north-america", "allied", ["atlanta", "new-york", "toronto"], true, 0],
  // South America (5)
  ["bogota", "Bogotá", "south-america", "neutral", ["havana", "lima", "mexico-city", "sao-paulo"], false, 0],
  ["buenos-aires", "Buenos Aires", "south-america", "neutral", ["lima", "sao-paulo"], false, 0],
  ["lima", "Lima", "south-america", "neutral", ["bogota", "buenos-aires", "santiago", "sao-paulo"], false, 0],
  ["santiago", "Santiago", "south-america", "neutral", ["lima", "sao-paulo"], false, 0],
  ["sao-paulo", "São Paulo", "south-america", "neutral", ["bogota", "buenos-aires", "lagos", "lima", "madrid", "santiago"], false, 0],
  // Europe (11)
  ["east-berlin", "East Berlin", "europe", "soviet", ["paris", "prague", "warsaw"], false, 1],
  ["istanbul", "Istanbul", "europe", "allied", ["baghdad", "cairo", "prague", "rome"], false, 0],
  ["kiev", "Kiev", "europe", "soviet", ["leningrad", "moscow", "warsaw"], false, 1],
  ["leningrad", "Leningrad", "europe", "soviet", ["kiev", "moscow", "warsaw"], false, 2],
  ["london", "London", "europe", "allied", ["new-york", "paris"], false, 0],
  ["madrid", "Madrid", "europe", "neutral", ["algiers", "new-york", "paris", "sao-paulo"], false, 0],
  ["moscow", "Moscow", "europe", "soviet", ["kiev", "leningrad", "novosibirsk"], false, 3],
  ["paris", "Paris", "europe", "allied", ["east-berlin", "london", "madrid", "rome"], false, 1],
  ["prague", "Prague", "europe", "soviet", ["east-berlin", "istanbul", "warsaw"], false, 0],
  ["rome", "Rome", "europe", "allied", ["algiers", "istanbul", "paris"], false, 0],
  ["warsaw", "Warsaw", "europe", "soviet", ["east-berlin", "kiev", "leningrad", "prague"], false, 1],
  // Africa (6)
  ["algiers", "Algiers", "africa", "allied", ["cairo", "madrid", "rome"], false, 0],
  ["cairo", "Cairo", "africa", "soviet", ["algiers", "baghdad", "istanbul", "khartoum", "riyadh"], false, 1],
  ["johannesburg", "Johannesburg", "africa", "allied", ["khartoum", "leopoldville"], false, 0],
  ["khartoum", "Khartoum", "africa", "neutral", ["cairo", "johannesburg", "lagos", "leopoldville", "riyadh"], false, 0],
  ["lagos", "Lagos", "africa", "neutral", ["khartoum", "leopoldville", "sao-paulo"], false, 0],
  ["leopoldville", "Leopoldville", "africa", "neutral", ["johannesburg", "khartoum", "lagos"], false, 0],
  // Asia (13)
  ["baghdad", "Baghdad", "asia", "soviet", ["cairo", "istanbul", "karachi", "riyadh"], false, 0],
  ["bangkok", "Bangkok", "asia", "neutral", ["bombay", "calcutta", "hanoi", "jakarta", "manila"], false, 0],
  ["bombay", "Bombay", "asia", "neutral", ["bangkok", "calcutta", "delhi", "jakarta", "karachi"], false, 0],
  ["calcutta", "Calcutta", "asia", "neutral", ["bangkok", "bombay", "delhi", "hanoi"], false, 0],
  ["delhi", "Delhi", "asia", "neutral", ["bombay", "calcutta", "hanoi", "karachi"], false, 0],
  ["hanoi", "Hanoi", "asia", "soviet", ["bangkok", "calcutta", "delhi", "saigon"], false, 0],
  ["karachi", "Karachi", "asia", "neutral", ["baghdad", "bombay", "delhi", "riyadh"], false, 0],
  ["novosibirsk", "Novosibirsk", "asia", "soviet", ["moscow", "peking"], false, 0],
  ["peking", "Peking", "asia", "soviet", ["novosibirsk", "pyongyang", "shanghai"], false, 1],
  ["pyongyang", "Pyongyang", "asia", "soviet", ["peking", "shanghai", "tokyo"], false, 0],
  ["riyadh", "Riyadh", "asia", "neutral", ["baghdad", "cairo", "karachi", "khartoum"], false, 0],
  ["saigon", "Saigon", "asia", "allied", ["hanoi", "manila", "osaka", "san-francisco", "shanghai"], false, 0],
  ["shanghai", "Shanghai", "asia", "soviet", ["osaka", "peking", "pyongyang", "saigon", "tokyo"], false, 1],
  // Pacific Rim (5)
  ["jakarta", "Jakarta", "pacific-rim", "neutral", ["bangkok", "bombay", "manila", "sydney"], false, 0],
  ["manila", "Manila", "pacific-rim", "neutral", ["bangkok", "jakarta", "saigon", "sydney"], false, 0],
  ["osaka", "Osaka", "pacific-rim", "neutral", ["saigon", "shanghai", "tokyo"], false, 0],
  ["sydney", "Sydney", "pacific-rim", "allied", ["jakarta", "los-angeles", "manila"], false, 0],
  ["tokyo", "Tokyo", "pacific-rim", "neutral", ["osaka", "pyongyang", "san-francisco", "shanghai"], false, 0],
];

export const CITIES: readonly CityDef[] = RAW_CITIES.map(
  ([id, name, region, affiliation, connections, printedSafehouse, startingSurveillance]) => {
    const meta = CITY_ARCHIVE[id];
    if (!meta) throw new Error(`Missing archive metadata for city "${id}"`);
    return {
      id,
      name,
      country: meta.country,
      region,
      affiliation,
      connections,
      keypad: meta.keypad,
      printedSafehouse,
      startingSurveillance,
      incidentTitle: meta.incidentTitle,
      incidentText: meta.incidentText,
      incidentEffect: parseIncidentEffect(meta.incidentTitle, meta.incidentText),
    };
  },
);

export const CITY_BY_ID: Record<CityId, CityDef> = Object.fromEntries(
  CITIES.map((c) => [c.id, c]),
) as Record<CityId, CityDef>;

export const OCCUPATIONS: readonly OccupationDef[] = [
  // Allied (also Temporary Aliases)
  {
    id: "research-assistant",
    name: "Research Assistant",
    affiliation: "allied",
    text: "When you do the Share Intel action, you may give any 1 City card. When others Share Intel with you, they may take any 1 City card from you.",
  },
  {
    id: "medical-conference-coordinator",
    name: "Medical Conference Coordinator",
    affiliation: "allied",
    text: "As an action, you may move a team or a different player's pawn up to 3 cities away from its current city. (The team/pawn does not enter any cities in between.)",
  },
  {
    id: "hospital-administrator",
    name: "Hospital Administrator",
    affiliation: "allied",
    text: "You may do the Assemble Team action with one fewer card.",
  },
  {
    id: "clinic-planner",
    name: "Clinic Planner",
    affiliation: "allied",
    text: "When you do the Build Safehouse action, you do not need a City card. As an action, while at a safehouse, discard a City card to move to any city on the board.",
  },
  // Neutral (Box 0007)
  {
    id: "aluminum-salesperson",
    name: "Aluminum Salesperson",
    affiliation: "neutral",
    text: "Once per turn, as an action, you may take a City card from another player in your city.",
  },
  {
    id: "cargo-pilot",
    name: "Cargo Pilot",
    affiliation: "neutral",
    text: "As an action, you may move to a city with a safehouse.",
  },
  {
    id: "electrician",
    name: "Electrician",
    affiliation: "neutral",
    text: "When you do the Identify Target City action, reveal the required cards instead of discarding them.",
  },
  {
    id: "plastics-technician",
    name: "Plastics Technician",
    affiliation: "neutral",
    text: "If you begin your turn with this alias, take 1 Action token.",
  },
  // Soviet (Box 0002)
  {
    id: "red-army-doctor",
    name: "Red Army Doctor",
    affiliation: "soviet",
    text: "When you enter a Soviet city, return all of your Symptom cards to the supply.",
  },
  {
    id: "first-assistant",
    name: "First Assistant to Politburo Minister",
    affiliation: "soviet",
    text: "Once on your turn as an action, you may draw a Soviet City card from the Player discard pile.",
  },
  {
    id: "street-cleaner",
    name: "Street Cleaner",
    affiliation: "soviet",
    text: "When you enter a Soviet city, remove all the agents from that city.",
  },
  {
    id: "collective-manager",
    name: "Collective Manager",
    affiliation: "soviet",
    text: "For each cover you would lose, you may instead discard 1 City card.",
  },
];

export const OCCUPATION_BY_ID: Record<OccupationId, OccupationDef> = Object.fromEntries(
  OCCUPATIONS.map((o) => [o.id, o]),
) as Record<OccupationId, OccupationDef>;

export const SPECIALIZATIONS: readonly SpecializationDef[] = [
  {
    id: "treat",
    name: "Treat",
    affiliation: "allied",
    text: "As an action, return 1 Disease cube in your city to the supply.",
  },
  {
    id: "transport-crew",
    name: "Transport Crew",
    affiliation: "neutral",
    text: "On your turn, whenever you move to a new city, you may move any teams in your city with you.",
  },
  {
    id: "deep-cover",
    name: "Deep Cover",
    affiliation: "soviet",
    text: "When you do the Neutralize Agents action, remove all the agents from your city.",
  },
];

export const SPECIALIZATION_BY_ID: Record<SpecializationId, SpecializationDef> =
  Object.fromEntries(SPECIALIZATIONS.map((s) => [s.id, s])) as Record<
    SpecializationId,
    SpecializationDef
  >;

export const ASSETS: readonly AssetDef[] = [
  // Starting Contacts
  {
    id: "shop-owner",
    name: "Shop Owner",
    category: "contact",
    cost: 3,
    text: "As an action, while in the Shop Owner's city, swap 2 City cards from your hand with 1 City card from the Player discard pile.",
    needsCity: true,
    unlockedBy: "start",
  },
  {
    id: "crime-boss",
    name: "Crime Boss",
    category: "contact",
    cost: 2,
    text: "Once per turn, as an action, remove 1 agent from the Crime Boss's city or a city adjacent to it.",
    needsCity: true,
    unlockedBy: "start",
  },
  {
    id: "politician",
    name: "Politician",
    category: "contact",
    cost: 2,
    text: "Once per turn, as an action, while in the Politician's city, you may give a City card to a player in any city.",
    needsCity: true,
    unlockedBy: "start",
  },
  // Visas (3 starting + 2 Door 18 + 2 Door 20)
  ...([
    ["visa-1", "start"],
    ["visa-2", "start"],
    ["visa-3", "start"],
    ["visa-4", "18"],
    ["visa-5", "18"],
    ["visa-6", "20"],
    ["visa-7", "20"],
  ] as const).map(
    ([id, unlockedBy]): AssetDef => ({
      id,
      name: "Visa",
      category: "visa",
      cost: 1,
      text: "As an action, you may move to the city named on this visa.",
      needsCity: true,
      unlockedBy,
    }),
  ),
  // Starting Gear
  {
    id: "spy-camera",
    name: "Spy Camera",
    category: "gear",
    cost: 1,
    text: "As an action, draw the City card matching your current city from the Player discard pile.",
    needsCity: false,
    unlockedBy: "start",
  },
  {
    id: "auth-424",
    name: "Authorization Code 424",
    category: "gear",
    cost: 1,
    text: "Once per turn, as an action, remove 1 agent from an adjacent city.",
    needsCity: false,
    unlockedBy: "start",
  },
  {
    id: "tracking-device",
    name: "Tracking Device",
    category: "gear",
    cost: 1,
    text: "During the Do Actions step of your turn, you may look at the top 2 cards of the Threat deck (not an action).",
    needsCity: false,
    unlockedBy: "start",
  },
  // Door 12 (end of February)
  {
    id: "auth-715",
    name: "Authorization Code 715",
    category: "gear",
    cost: 2,
    text: "As an action, you may remove all agents from a city containing an active team.",
    needsCity: false,
    unlockedBy: "12",
  },
  {
    id: "auth-405",
    name: "Authorization Code 405",
    category: "gear",
    cost: 1,
    text: "As an action, discard a City card to move a team to the matching city.",
    needsCity: false,
    unlockedBy: "12",
  },
  // Door 13 (end of March)
  {
    id: "gunbrella",
    name: "Gunbrella",
    category: "gear",
    cost: 2,
    text: "When you do the Neutralize Agent action in your city, remove 1 or 2 agents from the city.",
    needsCity: false,
    unlockedBy: "13",
  },
  {
    id: "black-book",
    name: "Black Book",
    category: "gear",
    cost: 1,
    text: "As an action, discard a City card to place a safehouse into the matching city.",
    needsCity: false,
    unlockedBy: "13",
  },
  // Door 15 (end of May)
  {
    id: "code-book",
    name: "Code Book",
    category: "gear",
    cost: 2,
    text: "You need 1 fewer card to do the Identify Target City action.",
    needsCity: false,
    unlockedBy: "15",
  },
  {
    id: "dr-robert",
    name: "Dr. Robert",
    category: "contact",
    cost: 2,
    text: "If you start your turn in this city, take 2 Action tokens. The city must be a Soviet city.",
    needsCity: true,
    sovietOnly: true,
    unlockedBy: "15",
  },
  // Door 17 (end of June)
  {
    id: "army-doctor",
    name: "Army Doctor",
    category: "contact",
    cost: 1,
    text: "If you enter the Army Doctor's city, return all your Symptom cards to the supply.",
    needsCity: true,
    unlockedBy: "17",
  },
  {
    id: "forged-papers",
    name: "Forged Papers",
    category: "gear",
    cost: 1,
    text: "You can fly to Soviet cities using the Commercial Flight action if you discard the matching City card.",
    needsCity: false,
    unlockedBy: "17",
  },
  // Door 22 (end of June)
  {
    id: "experimental-medicine",
    name: "Experimental Medicine",
    category: "gear",
    cost: 2,
    text: "As an action, remove all the Disease cubes from your city.",
    needsCity: false,
    unlockedBy: "22",
  },
  {
    id: "field-medic",
    name: "Field Medic",
    category: "contact",
    cost: 1,
    text: "As an action, remove 1 Disease cube from the Field Medic's city or a city adjacent to it.",
    needsCity: true,
    unlockedBy: "22",
  },
  // Door 23 (end of September)
  {
    id: "portable-computing-device",
    name: "Portable Computing Device",
    category: "gear",
    cost: 2,
    text: "When you do the Infiltrate action, you may use keypad numbers that are 1 higher or 1 lower than required.",
    needsCity: false,
    unlockedBy: "23",
  },
  {
    id: "suitcase-full-of-money",
    name: "Suitcase Full of Money",
    category: "gear",
    cost: 2,
    text: "Instead of scratching a cover, you may check a box below.",
    needsCity: false,
    maxBoxes: 3,
    unlockedBy: "23",
  },
  // Door 25 (end of July)
  {
    id: "shortwave-radio",
    name: "Shortwave Radio",
    category: "gear",
    cost: 1,
    text: "You may do the Identify Target City action from any safehouse (regardless of region).",
    needsCity: false,
    unlockedBy: "25",
  },
  {
    id: "cobbler",
    name: "Cobbler",
    category: "contact",
    cost: 2,
    text: "As an action, discard 3 City cards of the same affiliation to change a team in the Cobbler's city to the affiliation of the cards.",
    needsCity: true,
    unlockedBy: "25",
  },
  // Door 27 (end of October)
  {
    id: "unapproved-supplements",
    name: "Unapproved Supplements",
    category: "gear",
    cost: 2,
    text: "As an action, you may remove a Disease cube from an adjacent city.",
    needsCity: false,
    unlockedBy: "27",
  },
  {
    id: "infrared-goggles",
    name: "Infrared Goggles",
    category: "gear",
    cost: 0,
    text: "Once per turn, take 2 Action tokens when you do the Enter/Exit Infiltration Site action.",
    needsCity: false,
    unlockedBy: "27",
  },
  // Door 28 (end of November)
  {
    id: "test-pilot",
    name: "Test Pilot",
    category: "contact",
    cost: 1,
    text: "While in the Test Pilot's city, spend an action to remove a Satellite token from the game.",
    needsCity: true,
    unlockedBy: "28",
  },
  {
    id: "prescription-pills",
    name: "Prescription Pills",
    category: "gear",
    cost: 2,
    text: "Your hand limit is increased by 1 card while this alias is active. (When you change aliases, discard cards if necessary.)",
    needsCity: false,
    unlockedBy: "28",
  },
];

export const ASSET_BY_ID: Record<AssetId, AssetDef> = Object.fromEntries(
  ASSETS.map((a) => [a.id, a]),
) as Record<AssetId, AssetDef>;

export const LIABILITIES: readonly LiabilityDef[] = [
  // Starting 8
  {
    id: "followed-soviet",
    name: "Followed (Soviet)",
    text: "If you end your turn in a Soviet city, without an agent, add an agent to that city.",
    needsRegion: false,
    unlockedBy: "start",
  },
  {
    id: "authorities-watching",
    name: "Authorities Watching",
    text: "You may not do the Neutralize Agent action while in a city with an Incident token.",
    needsRegion: false,
    unlockedBy: "start",
  },
  {
    id: "hassled-soviet",
    name: "Hassled (Soviet)",
    text: "If you end your turn in a Soviet city without a safehouse, discard 1 card (after the Draw Cards step).",
    needsRegion: false,
    unlockedBy: "start",
  },
  {
    id: "cipher-decoded",
    name: "Cipher Decoded",
    text: "You cannot do the Share Intel action when you are in the marked region.",
    needsRegion: true,
    unlockedBy: "start",
  },
  {
    id: "monitored-soviet",
    name: "Monitored (Soviet)",
    text: "If you draw 2 Soviet City cards at the end of your turn, lose 1 cover.",
    needsRegion: false,
    unlockedBy: "start",
  },
  {
    id: "tracked",
    name: "Tracked",
    text: "You cannot do the Drive/Ferry Team action when you are in the marked region.",
    needsRegion: true,
    unlockedBy: "start",
  },
  {
    id: "airports-alerted-soviet",
    name: "Airports Alerted (Soviet)",
    text: "You may not do the Unrecorded Flight action from a Soviet city.",
    needsRegion: false,
    unlockedBy: "start",
  },
  {
    id: "recognized-region",
    name: "Recognized",
    text: "If you are in the marked region, lose a cover whenever an Incident token is added to it.",
    needsRegion: true,
    unlockedBy: "start",
  },
  // Door 11
  {
    id: "followed-neutral",
    name: "Followed (Neutral)",
    text: "If you end your turn in a neutral city without an agent, add an agent to your city.",
    needsRegion: false,
    unlockedBy: "11",
  },
  {
    id: "hassled-neutral",
    name: "Hassled (Neutral)",
    text: "If you end your turn in a neutral city without a safehouse, discard 1 card (after the Draw Cards step).",
    needsRegion: false,
    unlockedBy: "11",
  },
  {
    id: "airports-alerted-neutral",
    name: "Airports Alerted (Neutral)",
    text: "You may not do the Unrecorded Flight action from a neutral city.",
    needsRegion: false,
    unlockedBy: "11",
  },
  {
    id: "monitored-neutral",
    name: "Monitored (Neutral)",
    text: "If you draw 2 neutral City cards at the end of your turn, lose 1 cover.",
    needsRegion: false,
    unlockedBy: "11",
  },
  // Door 16
  {
    id: "symptomatic",
    name: "Symptomatic",
    text: "You may not do the Neutralize Agent action if you have 2 or more Symptom cards.",
    needsRegion: false,
    unlockedBy: "16",
  },
  {
    id: "suspected-identify",
    name: "Suspected (Identify)",
    text: "You may not do the Identify Target City action.",
    needsRegion: false,
    unlockedBy: "16",
  },
  {
    id: "incautious",
    name: "Incautious",
    text: "When you do the Disrupt Trial action, take 2 Symptom cards.",
    needsRegion: false,
    unlockedBy: "16",
  },
  {
    id: "watch-list",
    name: "Watch List",
    text: "You may not do a Commercial Flight into or out of a city with an Incident token.",
    needsRegion: false,
    unlockedBy: "16",
  },
  // Door 21
  {
    id: "airports-alerted-allied",
    name: "Airports Alerted (Allied)",
    text: "You may not do the Unrecorded Flight action from an Allied city.",
    needsRegion: false,
    unlockedBy: "21",
  },
  {
    id: "followed-allied",
    name: "Followed (Allied)",
    text: "If you end your turn in an Allied city without an agent, add an agent to your city.",
    needsRegion: false,
    unlockedBy: "21",
  },
  {
    id: "hassled-allied",
    name: "Hassled (Allied)",
    text: "If you end your turn in an Allied city without a safehouse, discard 1 card (after the Draw Cards step).",
    needsRegion: false,
    unlockedBy: "21",
  },
  {
    id: "monitored-allied",
    name: "Monitored (Allied)",
    text: "If you draw 2 Allied City cards at the end of your turn, lose 1 cover.",
    needsRegion: false,
    unlockedBy: "21",
  },
  // Door 26
  {
    id: "careless",
    name: "Careless",
    text: "You may not do the Neutralize Agent action in a city with a control center.",
    needsRegion: false,
    unlockedBy: "26",
  },
  {
    id: "suspected-allied-team",
    name: "Suspected (Allied Team)",
    text: "You may not do the Drive/Ferry Team action to move an Allied team.",
    needsRegion: false,
    unlockedBy: "26",
  },
  {
    id: "bad-cover-story",
    name: "Bad Cover Story",
    text: "You may not do the Disable Satellite action.",
    needsRegion: false,
    unlockedBy: "26",
  },
  {
    id: "marginalized",
    name: "Marginalized",
    text: "You may not do the Create Checkpoint action.",
    needsRegion: false,
    unlockedBy: "26",
  },
];

export const LIABILITY_BY_ID: Record<LiabilityId, LiabilityDef> = Object.fromEntries(
  LIABILITIES.map((l) => [l.id, l]),
) as Record<LiabilityId, LiabilityDef>;

export const EVENTS: readonly EventDef[] = [
  {
    id: "a-holdover-from-the-war",
    name: "A Holdover from the War",
    text: "Put a safehouse onto 1 city on the board. Play any time. Not an action.",
    unlockedBy: "start",
  },
  {
    id: "airlift",
    name: "Airlift",
    text: "Move a pawn to any city or move a team to any city. Play any time. Not an action.",
    unlockedBy: "start",
  },
  {
    id: "counter-intelligence",
    name: "Counter-Intelligence",
    text: "Put 1 card from the Threat discard pile into the game end area. Play any time. You may play this between the Add Agents and Intensify steps of an escalation. Not an action.",
    unlockedBy: "start",
  },
  {
    id: "cover-of-darkness",
    name: "Cover of Darkness",
    text: "This turn, remove 1 agent from each city the player drives/ferries to. Play during the Do Actions step of a turn. Not an action.",
    actionsOnly: true,
    unlockedBy: "start",
  },
  {
    id: "forecast",
    name: "Forecast",
    text: "Look at the next 6 Threat cards. Rearrange them in any order and return them to the top of the Threat deck. Play any time. Not an action.",
    unlockedBy: "start",
  },
  {
    id: "bureaucratic-entanglements",
    name: "Bureaucratic Entanglements",
    text: "Remove 1 or 2 agents from the board. Play any time. Not an action.",
    unlockedBy: "legacy/01-07",
  },
  {
    id: "encoded-messages",
    name: "Encoded Messages",
    text: "Choose 2 players. They select 1 card from their hands and swap them. Play any time. Not an action.",
    unlockedBy: "legacy/01-08",
  },
  {
    id: "weekend-rendezvous",
    name: "Weekend Rendezvous",
    text: "You may move any pawn(s) to a single city containing another pawn. Play any time. Not an action.",
    unlockedBy: "legacy/01-09",
  },
  {
    id: "scramble-teams",
    name: "Scramble Teams",
    text: "Move every team up to 3 cities away from their current locations. Play any time. Not an action.",
    unlockedBy: "legacy/01-10",
  },
  {
    id: "diversion",
    name: "Diversion",
    text: "Move up to 3 incident tokens to 1 city on the board. Play any time. Not an action.",
    unlockedBy: "legacy/02-10",
  },
  {
    id: "one-quiet-night",
    name: "One Quiet Night",
    text: "Skip the Draw Threat Cards step this turn. Play any time. Not an action.",
    unlockedBy: "legacy/03-09",
  },
  {
    id: "undocumented-actions",
    name: "Undocumented Actions",
    text: "Move a Restriction card to the reserve. It is no longer in effect this game. Play any time. Not an action.",
    unlockedBy: "legacy/04-22",
  },
  {
    id: "extended-time",
    name: "Extended Time",
    text: "Give 2 Action Tokens to the current player. Play any time. Not an action.",
    unlockedBy: "legacy/04-23",
  },
  {
    id: "border-security",
    name: "Border Security",
    text: "Each player may add up to 2 checkpoint tokens to the board on connections adjacent to their current city. Play any time. Not an action.",
    unlockedBy: "legacy/05-09",
  },
  {
    id: "trial-vaccine",
    name: "Trial Vaccine",
    text: "Remove 2 disease cubes from the board. Play any time. Not an action.",
    unlockedBy: "legacy/06-14",
  },
  {
    id: "spectrum-interference",
    name: "Spectrum Interference",
    text: "Return up to 2 Satellite tokens (that are currently in play) back to the reserve. Play any time. Not an action.",
    unlockedBy: "legacy/07-07",
  },
  {
    id: "decryption-book",
    name: "Decryption Book",
    text: "Reveal 4 security tokens in the PEARL Compound. Play any time. Not an action.",
    unlockedBy: "legacy/09-13",
  },
];

export const EVENT_BY_ID: Record<EventId, EventDef> = Object.fromEntries(
  EVENTS.map((e) => [e.id, e]),
) as Record<EventId, EventDef>;

export const RESTRICTIONS: readonly RestrictionDef[] = [
  {
    id: "oversight-required",
    opsNumber: 50,
    name: "Evaluation: Oversight Required",
    text: "You must be in Washington to do the Acquire Targets action.",
  },
  {
    id: "erratic",
    opsNumber: 51,
    name: "Evaluation: Erratic",
    text: "You may not Share Intel in Washington.",
  },
  {
    id: "too-cautious",
    opsNumber: 52,
    name: "Evaluation: Too Cautious",
    text: "You may not Assemble Teams in Washington.",
  },
  {
    id: "passive",
    opsNumber: 53,
    name: "Evaluation: Passive",
    text: "You must discard an additional City card (of any affiliation) when you do the Build Safehouse action.",
  },
  {
    id: "evasive",
    opsNumber: 54,
    name: "Evaluation: Evasive",
    text: "You must discard an additional City card (of any affiliation) when you do the Identify Target City action.",
  },
  {
    id: "arrogant",
    opsNumber: 55,
    name: "Evaluation: Arrogant",
    text: "You must discard an additional City card (of any affiliation) to do the Assemble Teams action.",
  },
  {
    id: "hesitant",
    opsNumber: 56,
    name: "Evaluation: Hesitant",
    text: "You must discard an additional card (of any affiliation) to do the Commercial Flight action to a neutral city.",
  },
  {
    id: "unpredictable",
    opsNumber: 57,
    name: "Evaluation: Unpredictable",
    text: "You must discard the matching Allied card to do the Commercial Flight action to an Allied city.",
  },
  {
    id: "soft",
    opsNumber: 58,
    name: "Evaluation: Soft",
    text: "You must discard a City card to do the Share Intel action.",
  },
  {
    id: "callous",
    opsNumber: 59,
    name: "Evaluation: Callous",
    text: "You may not do the Drive/Ferry Team action unless you are in a safehouse.",
  },
];

export const RESTRICTION_BY_ID: Record<RestrictionId, RestrictionDef> = Object.fromEntries(
  RESTRICTIONS.map((r) => [r.id, r]),
) as Record<RestrictionId, RestrictionDef>;

export const RESTRICTION_BY_OPS: Record<number, RestrictionId> = Object.fromEntries(
  RESTRICTIONS.map((r) => [r.opsNumber, r.id]),
);

export const INFILTRATION_SITES: Record<InfiltrationSiteId, InfiltrationSiteDef> = {
  "sabik-safehouse": {
    id: "sabik-safehouse",
    name: "Sabik's Safehouse",
    city: "mexico-city",
    requiredAffiliation: "neutral",
    entrance: "ss-entrance",
    rooms: [
      {
        id: "ss-entrance",
        name: "Entrance",
        site: "sabik-safehouse",
        entrance: true,
        text: "A Neutral alias is required to enter this infiltration site.",
      },
      {
        id: "ss-front-room",
        name: "Front Room",
        site: "sabik-safehouse",
        text: "If you are in this room during the Mop Up step, scratch 1 cover.",
      },
      {
        id: "ss-basement",
        name: "Basement",
        site: "sabik-safehouse",
        text: "Objective room: spend an action and discard 3 Neutral City cards.",
      },
    ],
    edges: [
      { id: "ss-1", a: "ss-entrance", b: "ss-front-room", securitySlots: 1, hatchway: false },
      { id: "ss-2", a: "ss-front-room", b: "ss-basement", securitySlots: 2, hatchway: false },
    ],
  },
  "sabik-hq": {
    id: "sabik-hq",
    name: "Sabik's HQ",
    city: "leningrad",
    requiredAffiliation: "soviet",
    entrance: "hq-entrance",
    rooms: [
      {
        id: "hq-entrance",
        name: "Entrance",
        site: "sabik-hq",
        entrance: true,
        text: "A Soviet alias is required to enter this infiltration site.",
      },
      {
        id: "hq-office",
        name: "Office",
        site: "sabik-hq",
        text: "When you enter this room, take 1 Action token.",
      },
      {
        id: "hq-security",
        name: "Security",
        site: "sabik-hq",
        text: "When you enter this room, scratch 1 cover.",
      },
      {
        id: "hq-secret-annex",
        name: "Secret Annex",
        site: "sabik-hq",
        text: "Objective room: spend an action and discard 3 Neutral City cards.",
      },
    ],
    edges: [
      { id: "hq-1", a: "hq-entrance", b: "hq-office", securitySlots: 3, hatchway: false },
      { id: "hq-2", a: "hq-entrance", b: "hq-security", securitySlots: 1, hatchway: false },
      { id: "hq-3", a: "hq-security", b: "hq-secret-annex", securitySlots: 2, hatchway: false },
      { id: "hq-4", a: "hq-office", b: "hq-secret-annex", securitySlots: 1, hatchway: false },
    ],
  },
  langley: {
    id: "langley",
    name: "Langley",
    city: "washington",
    requiredAffiliation: "allied",
    entrance: "lg-entrance",
    rooms: [
      {
        id: "lg-entrance",
        name: "Entrance",
        site: "langley",
        entrance: true,
        text: "An Allied alias is required to enter this infiltration site.",
      },
      {
        id: "lg-briefing-room",
        name: "Briefing Room",
        site: "langley",
        text: "When you enter this room, you may scratch 2 cover to add an Event card of your choice from the reserve to your hand.",
      },
      {
        id: "lg-armory",
        name: "Armory",
        site: "langley",
        text: "When you enter this room, you may add 1 Asset sticker to your Allied alias for free.",
      },
      {
        id: "lg-cold-storage",
        name: "Cold Storage",
        site: "langley",
        text: "Objective room: spend an action and discard any 3 City cards.",
      },
    ],
    edges: [
      { id: "lg-1", a: "lg-entrance", b: "lg-briefing-room", securitySlots: 3, hatchway: false },
      { id: "lg-2", a: "lg-entrance", b: "lg-armory", securitySlots: 2, hatchway: false },
      { id: "lg-3", a: "lg-armory", b: "lg-cold-storage", securitySlots: 2, hatchway: false },
      { id: "lg-4", a: "lg-briefing-room", b: "lg-cold-storage", securitySlots: 1, hatchway: false },
    ],
  },
  pearl: {
    id: "pearl",
    name: "PEARL Compound",
    city: "novosibirsk",
    requiredAffiliation: "soviet",
    entrance: "pearl-entrance",
    rooms: [
      {
        id: "pearl-entrance",
        name: "Entrance",
        site: "pearl",
        entrance: true,
        pearlDoor: 1,
        text: "A Soviet alias is required to enter this Infiltration site.",
      },
      {
        id: "pearl-gatehouse",
        name: "Gatehouse",
        site: "pearl",
        pearlDoor: 2,
        text: "If you are in this room during the Mop Up step, scratch 1 cover.",
      },
      {
        id: "pearl-loading-dock",
        name: "Loading Dock",
        site: "pearl",
        pearlDoor: 3,
        text: "When you enter this room, you may take 1 card from under a Disrupt Trial objective and add it to your hand. (You prevent the trial in that city.) If you do, read Debrief 105.",
      },
      {
        id: "pearl-barracks",
        name: "Barracks",
        site: "pearl",
        pearlDoor: 4,
        text: "If you are in this room during the Mop Up step, scratch 1 cover.",
      },
      {
        id: "pearl-control-room",
        name: "Control Room",
        site: "pearl",
        pearlDoor: 5,
        text: "When you enter this room, you may discard a City card matching the region of a Satellite token. If you do, remove the Satellite token in that region and destroy the Satellite card for that region.",
      },
      {
        id: "pearl-courtyard",
        name: "Courtyard",
        site: "pearl",
        pearlDoor: 6,
        text: "When you enter this room, you may scratch 1 cover to take 2 Action tokens.",
      },
      {
        id: "pearl-monitoring-room",
        name: "Monitoring Room",
        site: "pearl",
        pearlDoor: 7,
        text: "When you enter this room, turn any 2 unrevealed Security tokens face up.",
      },
      {
        id: "pearl-records-room",
        name: "Records Room",
        site: "pearl",
        pearlDoor: 8,
        text: "When you enter this room, take 1 Action token.",
      },
      {
        id: "pearl-archives",
        name: "Archives",
        site: "pearl",
        pearlDoor: 8,
        text: "When you enter this room, take 1 City card from the Player discard pile.",
      },
      {
        id: "pearl-holding-cells",
        name: "Holding Cells",
        site: "pearl",
        pearlDoor: 9,
        text: "When you enter this room, scratch 3 cover.",
      },
      {
        id: "pearl-medical-ward",
        name: "Medical Ward",
        site: "pearl",
        pearlDoor: 10,
        text: "No special room effect.",
      },
      {
        id: "pearl-directors-office",
        name: "Director's Office",
        site: "pearl",
        pearlDoor: 10,
        text: "When you enter this room, you may scratch 1 cover to draw 2 City cards from the Player discard pile.",
      },
      {
        id: "pearl-access-panel",
        name: "Access Panel",
        site: "pearl",
        pearlDoor: 11,
        text: "When you enter this room, you may swap 2 faceup Security tokens.",
      },
      {
        id: "pearl-manufacturing-facility",
        name: "Manufacturing Facility",
        site: "pearl",
        pearlDoor: 11,
        text: "When you enter this room, take 1 Action token.",
      },
      {
        id: "pearl-clinical-trial-room",
        name: "Clinical Trial Room",
        site: "pearl",
        pearlDoor: 12,
        text: "No special room effect.",
      },
      {
        id: "pearl-greenhouse",
        name: "Greenhouse",
        site: "pearl",
        pearlDoor: 13,
        text: "If you are in this room during the Mop Up step, scratch 2 cover.",
      },
      {
        id: "pearl-laboratory",
        name: "Laboratory",
        site: "pearl",
        pearlDoor: 14,
        text: "Laboratory of PEARL Compound.",
      },
    ],
    edges: [
      // 16 security-token corridors (19 security token circles total)
      { id: "p-e1", a: "pearl-entrance", b: "pearl-gatehouse", securitySlots: 2, hatchway: false },
      { id: "p-e2", a: "pearl-entrance", b: "pearl-courtyard", securitySlots: 1, hatchway: false },
      { id: "p-e3", a: "pearl-gatehouse", b: "pearl-loading-dock", securitySlots: 1, hatchway: false },
      { id: "p-e4", a: "pearl-loading-dock", b: "pearl-barracks", securitySlots: 1, hatchway: false },
      { id: "p-e5", a: "pearl-loading-dock", b: "pearl-records-room", securitySlots: 1, hatchway: false },
      { id: "p-e6", a: "pearl-barracks", b: "pearl-control-room", securitySlots: 1, hatchway: false },
      { id: "p-e7", a: "pearl-control-room", b: "pearl-medical-ward", securitySlots: 2, hatchway: false },
      { id: "p-e8", a: "pearl-courtyard", b: "pearl-monitoring-room", securitySlots: 2, hatchway: false },
      { id: "p-e9", a: "pearl-courtyard", b: "pearl-access-panel", securitySlots: 1, hatchway: false },
      { id: "p-e10", a: "pearl-monitoring-room", b: "pearl-records-room", securitySlots: 1, hatchway: false },
      { id: "p-e11", a: "pearl-archives", b: "pearl-clinical-trial-room", securitySlots: 1, hatchway: false },
      { id: "p-e12", a: "pearl-holding-cells", b: "pearl-directors-office", securitySlots: 1, hatchway: false },
      { id: "p-e13", a: "pearl-holding-cells", b: "pearl-greenhouse", securitySlots: 1, hatchway: false },
      { id: "p-e14", a: "pearl-directors-office", b: "pearl-laboratory", securitySlots: 1, hatchway: false },
      { id: "p-e15", a: "pearl-manufacturing-facility", b: "pearl-clinical-trial-room", securitySlots: 1, hatchway: false },
      { id: "p-e16", a: "pearl-clinical-trial-room", b: "pearl-greenhouse", securitySlots: 1, hatchway: false },
      // 5 hatchways (matching the 5 Tunnel stickers in Door 42)
      { id: "p-h1", a: "pearl-gatehouse", b: "pearl-monitoring-room", securitySlots: 0, hatchway: true },
      { id: "p-h2", a: "pearl-barracks", b: "pearl-holding-cells", securitySlots: 0, hatchway: true },
      { id: "p-h3", a: "pearl-monitoring-room", b: "pearl-archives", securitySlots: 0, hatchway: true },
      { id: "p-h4", a: "pearl-medical-ward", b: "pearl-laboratory", securitySlots: 0, hatchway: true },
      { id: "p-h5", a: "pearl-greenhouse", b: "pearl-laboratory", securitySlots: 0, hatchway: true },
    ],
  },
};

export const ROOM_BY_ID: Record<RoomId, RoomDef> = Object.fromEntries(
  Object.values(INFILTRATION_SITES).flatMap((site) => site.rooms.map((r) => [r.id, r])),
) as Record<RoomId, RoomDef>;

/** 9 keypad security tokens from Box 0006. */
export const BOX_0006_SECURITY_TOKENS: readonly SecuritySymbol[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
].map((value) => ({ kind: "keypad" as const, value }));

/** 21 region/affiliation security tokens from Box 0003. */
export const BOX_0003_SECURITY_TOKENS: readonly SecuritySymbol[] = [
  { kind: "region", region: "north-america" },
  { kind: "region", region: "north-america" },
  { kind: "region", region: "south-america" },
  { kind: "region", region: "europe" },
  { kind: "region", region: "europe" },
  { kind: "region", region: "africa" },
  { kind: "region", region: "africa" },
  { kind: "region", region: "asia" },
  { kind: "region", region: "asia" },
  { kind: "region", region: "asia" },
  { kind: "region", region: "pacific-rim" },
  { kind: "affiliation", affiliation: "allied" },
  { kind: "affiliation", affiliation: "allied" },
  { kind: "affiliation", affiliation: "allied" },
  { kind: "affiliation", affiliation: "neutral" },
  { kind: "affiliation", affiliation: "neutral" },
  { kind: "affiliation", affiliation: "neutral" },
  { kind: "affiliation", affiliation: "neutral" },
  { kind: "affiliation", affiliation: "soviet" },
  { kind: "affiliation", affiliation: "soviet" },
  { kind: "affiliation", affiliation: "soviet" },
];

export const pack = {
  cities: CITIES,
  cityById: CITY_BY_ID,
  regions: REGIONS,
  regionNames: REGION_NAMES,
  affiliations: AFFILIATIONS,
  threatTrack: THREAT_TRACK,
  supplies: STARTING_SUPPLIES,
  monthNames: MONTH_NAMES,
  occupations: OCCUPATIONS,
  occupationById: OCCUPATION_BY_ID,
  specializations: SPECIALIZATIONS,
  specializationById: SPECIALIZATION_BY_ID,
  assets: ASSETS,
  assetById: ASSET_BY_ID,
  liabilities: LIABILITIES,
  liabilityById: LIABILITY_BY_ID,
  events: EVENTS,
  eventById: EVENT_BY_ID,
  restrictions: RESTRICTIONS,
  restrictionById: RESTRICTION_BY_ID,
  restrictionByOps: RESTRICTION_BY_OPS,
  sites: INFILTRATION_SITES,
  roomById: ROOM_BY_ID,
  box0006Tokens: BOX_0006_SECURITY_TOKENS,
  box0003Tokens: BOX_0003_SECURITY_TOKENS,
  legacyDrawOrder: LEGACY_DRAW_ORDER,
  sealedLegacyOrder: SEALED_LEGACY_ORDER,
  legacyArchive: LEGACY_ARCHIVE,
  debriefArchive: DEBRIEF_ARCHIVE,
  operationsArchive: OPERATIONS_ARCHIVE,
  boxArchive: BOX_ARCHIVE,
  doorArchive: DOOR_ARCHIVE,
  passportTracks: PASSPORT_TRACKS,
  symptomNames: SYMPTOM_NAMES,
} as const;
