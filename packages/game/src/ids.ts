export type RegionId =
  | "north-america"
  | "south-america"
  | "europe"
  | "africa"
  | "asia"
  | "pacific-rim";

export type Affiliation = "allied" | "neutral" | "soviet";

export type PassportColor = "black" | "green" | "pink" | "white";
export const PASSPORT_COLORS: readonly PassportColor[] = ["black", "green", "pink", "white"];

export type SeatId = "seat-1" | "seat-2" | "seat-3" | "seat-4";
export const SEAT_IDS: readonly SeatId[] = ["seat-1", "seat-2", "seat-3", "seat-4"];

export type PlayerId = string;
export type CardId = string;
export type TeamId = string;

export type CityId =
  | "atlanta"
  | "havana"
  | "los-angeles"
  | "mexico-city"
  | "new-york"
  | "san-francisco"
  | "toronto"
  | "washington"
  | "bogota"
  | "buenos-aires"
  | "lima"
  | "santiago"
  | "sao-paulo"
  | "east-berlin"
  | "istanbul"
  | "kiev"
  | "leningrad"
  | "london"
  | "madrid"
  | "moscow"
  | "paris"
  | "prague"
  | "rome"
  | "warsaw"
  | "algiers"
  | "cairo"
  | "johannesburg"
  | "khartoum"
  | "lagos"
  | "leopoldville"
  | "baghdad"
  | "bangkok"
  | "bombay"
  | "calcutta"
  | "delhi"
  | "hanoi"
  | "karachi"
  | "novosibirsk"
  | "peking"
  | "pyongyang"
  | "riyadh"
  | "saigon"
  | "shanghai"
  | "jakarta"
  | "manila"
  | "osaka"
  | "sydney"
  | "tokyo";

export type RuleId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z"
  | "AA"
  | "BB";

export type BoxId = "0001" | "0002" | "0003" | "0004" | "0005" | "0006" | "0007" | "0008";

export type DoorId =
  | "11"
  | "12"
  | "13"
  | "14"
  | "15"
  | "16"
  | "17"
  | "18"
  | "19"
  | "20"
  | "21"
  | "22"
  | "23"
  | "24"
  | "25"
  | "26"
  | "27"
  | "28"
  | "29"
  | "30"
  | "35"
  | "36"
  | "37"
  | "38"
  | "39"
  | "40"
  | "41"
  | "42"
  | "43"
  | "44"
  | "46"
  | "47"
  | "A"
  | "C"
  | "F"
  | "G"
  | "H"
  | "J"
  | "L"
  | "O"
  | "S"
  | "T"
  | "U";

export type OccupationId =
  // Allied (also Temporary Aliases)
  | "research-assistant"
  | "medical-conference-coordinator"
  | "hospital-administrator"
  | "clinic-planner"
  // Neutral (Box 0007)
  | "aluminum-salesperson"
  | "cargo-pilot"
  | "electrician"
  | "plastics-technician"
  // Soviet (Box 0002)
  | "red-army-doctor"
  | "first-assistant"
  | "street-cleaner"
  | "collective-manager";

export type SpecializationId = "treat" | "transport-crew" | "deep-cover";

export type AssetId =
  // Starting Contacts
  | "shop-owner"
  | "crime-boss"
  | "politician"
  // Starting Visas (3 copies on sheet + 2 in Door 18 + 2 in Door 20)
  | "visa-1"
  | "visa-2"
  | "visa-3"
  | "visa-4"
  | "visa-5"
  | "visa-6"
  | "visa-7"
  // Starting Gear
  | "spy-camera"
  | "auth-424"
  | "tracking-device"
  // Door 12
  | "auth-715"
  | "auth-405"
  // Door 13
  | "gunbrella"
  | "black-book"
  // Door 15
  | "code-book"
  | "dr-robert"
  // Door 17
  | "army-doctor"
  | "forged-papers"
  // Door 22
  | "experimental-medicine"
  | "field-medic"
  // Door 23
  | "portable-computing-device"
  | "suitcase-full-of-money"
  // Door 25
  | "shortwave-radio"
  | "cobbler"
  // Door 27
  | "unapproved-supplements"
  | "infrared-goggles"
  // Door 28
  | "test-pilot"
  | "prescription-pills";

export type LiabilityId =
  // Starting 8
  | "followed-soviet"
  | "authorities-watching"
  | "hassled-soviet"
  | "cipher-decoded"
  | "monitored-soviet"
  | "tracked"
  | "airports-alerted-soviet"
  | "recognized-region"
  // Door 11 (Neutral)
  | "followed-neutral"
  | "hassled-neutral"
  | "airports-alerted-neutral"
  | "monitored-neutral"
  // Door 16
  | "symptomatic"
  | "suspected-identify"
  | "incautious"
  | "watch-list"
  // Door 21 (Allied)
  | "airports-alerted-allied"
  | "followed-allied"
  | "hassled-allied"
  | "monitored-allied"
  // Door 26
  | "careless"
  | "suspected-allied-team"
  | "bad-cover-story"
  | "marginalized";

export type EventId =
  | "a-holdover-from-the-war"
  | "airlift"
  | "counter-intelligence"
  | "cover-of-darkness"
  | "forecast"
  | "bureaucratic-entanglements"
  | "encoded-messages"
  | "weekend-rendezvous"
  | "scramble-teams"
  | "diversion"
  | "one-quiet-night"
  | "undocumented-actions"
  | "extended-time"
  | "border-security"
  | "trial-vaccine"
  | "spectrum-interference"
  | "decryption-book";

export type RestrictionId =
  | "oversight-required"
  | "erratic"
  | "too-cautious"
  | "passive"
  | "evasive"
  | "arrogant"
  | "hesitant"
  | "unpredictable"
  | "soft"
  | "callous";

export type InfiltrationSiteId = "sabik-safehouse" | "sabik-hq" | "langley" | "pearl";

export type RoomId =
  // Sabik's Safehouse
  | "ss-entrance"
  | "ss-front-room"
  | "ss-basement"
  // Sabik's HQ
  | "hq-entrance"
  | "hq-office"
  | "hq-security"
  | "hq-secret-annex"
  // Langley
  | "lg-entrance"
  | "lg-briefing-room"
  | "lg-armory"
  | "lg-cold-storage"
  // PEARL Compound (17 rooms across 14 doors)
  | "pearl-entrance"
  | "pearl-gatehouse"
  | "pearl-loading-dock"
  | "pearl-barracks"
  | "pearl-control-room"
  | "pearl-courtyard"
  | "pearl-monitoring-room"
  | "pearl-records-room"
  | "pearl-archives"
  | "pearl-holding-cells"
  | "pearl-medical-ward"
  | "pearl-directors-office"
  | "pearl-access-panel"
  | "pearl-manufacturing-facility"
  | "pearl-clinical-trial-room"
  | "pearl-greenhouse"
  | "pearl-laboratory";

export type PearlDoorNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type SecuritySymbol =
  | { kind: "keypad"; value: number }
  | { kind: "region"; region: RegionId }
  | { kind: "affiliation"; affiliation: Affiliation };

export type ObjectiveId = string;
