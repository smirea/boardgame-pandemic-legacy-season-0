import type { CoverPip } from "./content/archive.generated";
import type {
  Affiliation,
  AssetId,
  BoxId,
  CardId,
  CityId,
  DoorId,
  EventId,
  InfiltrationSiteId,
  LiabilityId,
  ObjectiveId,
  OccupationId,
  PassportColor,
  PearlDoorNumber,
  PlayerId,
  RegionId,
  RestrictionId,
  RoomId,
  RuleId,
  SeatId,
  SecuritySymbol,
  SpecializationId,
  TeamId,
} from "./ids";
import type { RngState } from "./rng";

export type AttachedAsset = {
  id: AssetId;
  city: CityId | null;
  dead: boolean;
  /** Used by Suitcase Full of Money (up to 3 boxes checked across the campaign). */
  boxesChecked: number;
};

export type AttachedLiability = {
  id: LiabilityId;
  region: RegionId | null;
};

export type AliasPage = {
  affiliation: Affiliation;
  created: boolean;
  name: string;
  occupation: OccupationId | null;
  specialization: SpecializationId | null;
  assets: AttachedAsset[];
  liabilities: AttachedLiability[];
  coverTrack: CoverPip[];
  coverScratched: number;
  burned: boolean;
};

export type Passport = {
  color: PassportColor;
  aliases: Record<Affiliation, AliasPage>;
  /** Chronic Infection stickers placed on the cover of the passport (Debrief 105). */
  chronicInfections: number;
};

export type CampaignCity = {
  permanentSafehouse: boolean;
  surveillance: number;
  /** null if never exposed (or quarantined); otherwise 0..3 matching its Infection card starting intensity. */
  exposedIntensity: number | null;
  contaminated: boolean;
  controlCenter: boolean;
  bugged: boolean;
};

export type InfectionCardDef = {
  id: string;
  city: CityId;
  startingIntensity: number;
};

export type Evaluation = "SUCCEEDING" | "ADEQUATE" | "FAILING";

export type GameResult = {
  month: number;
  attempt: 1 | 2;
  evaluation: Evaluation;
  completedObjectives: number;
  failedObjectives: number;
  fundingBefore: number;
  fundingAfter: number;
  reason: string;
  turns: number;
  incidents: number;
  outbreaks: number;
  escalations: number;
  seats: { seat: SeatId; passport: PassportColor | null; alias: string }[];
};

export type ReadingKind =
  | "legacy"
  | "debrief"
  | "box"
  | "door"
  | "operations"
  | "room"
  | "rule"
  | "system";

export type ReadingEntry = {
  id: number;
  kind: ReadingKind;
  ref: string;
  title: string;
  text: string;
  month: number;
  gameIndex: number;
};

export type PsychQuestionSpec = {
  number: number;
  prompt: string;
  kind: "agree-disagree" | "scale-1-5";
};

export type TransmissionMethod = "airborne" | "animal-contact" | "saliva" | "waterborne";
export type DeploymentAnswer = "jellyfish" | "agent-sabik" | "pollen" | "unknown";

export type Campaign = {
  rng: RngState;
  /** 0 = Prologue, 1..12 = January..December */
  month: number;
  attempt: 1 | 2;
  funding: number;
  branch: "cia" | "sabik";
  legacyOrder: string[];
  legacyIndex: number;
  /** Which card the deck paused at, awaiting its trigger. */
  legacyPause: string | null;
  openedBoxes: BoxId[];
  openedDoors: DoorId[];
  destroyedBox0005: boolean;
  rules: RuleId[];
  /** Every piece of printed text revealed during the campaign, in order. */
  readings: ReadingEntry[];
  nextReadingId: number;
  /** Cards placed in the Intelligence File (Coop's Notes, ops 60-65, 77-80, 82, reports). */
  intelFile: { id: string; title: string; text: string }[];
  /** Cards placed in the Personnel File (psych tests & eval results). */
  personnelFile: { id: string; title: string; text: string }[];
  psychAnswers: Record<number, string | number>;
  transmissionMethod: TransmissionMethod | null;
  deploymentReport: DeploymentAnswer | null;
  /** Discretionary Budget (03-07): null until unlocked or after destroyed; 0..3 boxes left. */
  discretionaryBudgetBoxesLeft: number | null;
  /** Help from Sabik (ops 81): null if not held/destroyed; 0..3 boxes left. */
  helpFromSabikBoxesLeft: number | null;
  /** Active campaign Restriction cards (ops 50..59). */
  restrictions: RestrictionId[];
  /** Door 14 New Zealand briefcase state. */
  door14State: "unopened" | "pending" | "ignored" | "opened-19" | "blown-24";
  /** +6 budget units from opening Door 19 for the next Spend Budget step. */
  door19BonusPending: boolean;
  /** Relapse (09-11) permanently added to Player deck if any passport had Chronic Infection. */
  relapseInDeck: boolean;
  /** Number of available Disease cubes in the campaign supply (0 -> 6 -> 16 -> 28). */
  diseaseCubeSupplyMax: number;
  passports: Record<PassportColor, Passport>;
  cities: Record<CityId, CampaignCity>;
  infectionCards: InfectionCardDef[];
  /** Satellite cards destroyed via PEARL Control Room. */
  destroyedSatellites: RegionId[];
  unlockedEvents: EventId[];
  availableAssets: AssetId[];
  availableLiabilities: LiabilityId[];
  availablePermanentSafehouses: number;
  availableCounterSurveillance: number;
  availableContaminationStickers: number;
  availableTunnels: number;
  availableChronicInfections: number;
  /** PEARL dossier doors permanently opened (Door 1 = Door 47 starts open when Box 0003 opens). */
  pearlOpenedDoors: PearlDoorNumber[];
  /** PEARL hatchway edge IDs that have a Tunnel sticker placed permanently. */
  pearlTunnels: string[];
  /** Door 41 Records Room overlay placed in December. */
  pearlDoor41Placed: boolean;
  /** Operations infiltration site cards still active in reserve (destroyed on schedule). */
  destroyedOpsCards: number[];
  /** Objectives carried into attempt 2 when replaying a month after FAILING attempt 1. */
  replayObjectives: ActiveObjectiveTemplate[] | null;
  results: GameResult[];
  finalScore: number | null;
  finalEvaluationDebrief: number | null;
  endingDebriefs: number[];
  /** Default seating chosen in lobby (2..4 seats). */
  seating: { seat: SeatId; passport: PassportColor | null }[];
};

export type PlayerCard =
  | { id: CardId; kind: "city"; city: CityId }
  | { id: CardId; kind: "event"; event: EventId }
  | { id: CardId; kind: "escalation" }
  | { id: CardId; kind: "satellite"; region: RegionId }
  | { id: CardId; kind: "relapse" }
  | { id: CardId; kind: "symptom"; name: string };

export type ThreatCard =
  | { id: string; kind: "city"; city: CityId }
  | { id: string; kind: "infection"; infectionId: string; city: CityId; startingIntensity: number };

export type TeamPiece = {
  id: TeamId;
  affiliation: Affiliation;
  city: CityId | null;
};

export type GameCity = {
  agents: number;
  diseaseCubes: number;
  safehouse: boolean;
  incidents: number;
  outbreaks: number;
  pursuit: boolean;
};

export type PlayerState = {
  seat: SeatId;
  /** null in Prologue or while using a Temporary Alias after being burned. */
  passport: PassportColor | null;
  /** Active alias affiliation when using a passport. */
  activeAlias: Affiliation | null;
  /** Temporary alias occupation in Prologue or after burning an alias. */
  tempAlias: OccupationId | null;
  /** True from the moment an alias burns until the player picks a temp alias at the start of their next turn. */
  needsTempAlias: boolean;
  location: CityId;
  /** Non-null while pawn is inside an infiltration site room (not considered in any city!). */
  infiltration: { site: InfiltrationSiteId; room: RoomId } | null;
  hand: CardId[];
  actionTokens: number;
  /** Per-turn once-per-turn usage flags (e.g. "crime-boss", "politician", "auth-424", "aluminum", "first-assistant", "infrared-goggles", "tracking-device"). */
  usedThisTurn: string[];
};

export type ObjectiveKind =
  | "known-cities"
  | "unknown-city"
  | "disrupt-trial"
  | "pursuit"
  | "infiltration"
  | "quarantine-exposed"
  | "bug-existing-control-center";

export type ActiveObjectiveTemplate = {
  id: ObjectiveId;
  cardCode: string;
  title: string;
  description: string;
  kind: ObjectiveKind;
  status: "active" | "completed" | "failed";
  /** For known-cities: target cities (all must have requiredTeamsPerCity active teams simultaneously). */
  targetCities?: CityId[];
  requiredTeamsPerCity?: number;
  /** For unknown-city: pool filter description & pool of eligible cities. */
  unknownRegion?: RegionId;
  unknownAffiliation?: Affiliation;
  unknownControlCentersOnly?: boolean;
  noIdentifyAction?: boolean;
  /** For disrupt-trial: region, count of trial cities, whether ALL remaining trial cities are required (Sept), and infection starting intensity (0..3). */
  trialRegion?: RegionId;
  trialCount?: number;
  trialRequireAll?: boolean;
  trialIntensity?: number;
  /** For pursuit: starting city. */
  pursuitStartCity?: CityId;
  /** For infiltration: site, target room, discard count, optional required affiliation of discarded cards. */
  infiltrationSite?: InfiltrationSiteId;
  infiltrationRoom?: RoomId;
  infiltrationDiscardCount?: number;
  infiltrationDiscardAffiliation?: Affiliation;
  /** For quarantine-exposed / bug-existing-control-center: region. */
  region?: RegionId;
  /** Debrief numbers on complete / fail (with optional attempt-1 vs attempt-2 variants). */
  debriefComplete: number;
  debriefFail: number;
  debriefFailAttempt2?: number;
  /** Extra note shown to players (e.g. Sabik's hint about Laboratory in SE corner). */
  hint?: string;
};

export type ActiveObjective = ActiveObjectiveTemplate & {
  /** Hidden target City card placed under an unknown-city objective. */
  hiddenCardId: CardId | null;
  /** True once revealed via Identify Target City or Records Room (Door 41). */
  targetRevealed: boolean;
  /** Faceup trial City cards placed under a disrupt-trial objective. */
  trialCardIds: CardId[];
  /** Cities eliminated via drawing Player cards (for UI/bot tracking). */
  eliminatedCities: CityId[];
};

export type PlacedSecurityToken = {
  id: string;
  edgeId: string;
  slotIndex: number;
  symbol: SecuritySymbol;
  revealed: boolean;
};

export type ActiveInfiltrationSite = {
  site: InfiltrationSiteId;
  tokens: PlacedSecurityToken[];
};

export type PendingCoverLoss = {
  seat: SeatId;
  remaining: number;
  source: string;
};

export type Decision =
  // Setup & Legacy decisions
  | {
      t: "create-aliases";
      affiliation: Affiliation;
    }
  | {
      t: "psych-questions";
      cardId: string;
      questions: PsychQuestionSpec[];
    }
  | {
      t: "transmission-report";
      cardId: string;
    }
  | {
      t: "deployment-report";
      cardId: string;
    }
  | {
      t: "sabik-offer";
    }
  | {
      t: "file-report";
      options: readonly [number, number];
      prompt: string;
    }
  | {
      t: "door14-briefcase";
    }
  | {
      t: "place-counter-surveillance";
      remaining: number;
      source: string;
    }
  | {
      t: "kill-contact";
      source: string;
    }
  | {
      t: "free-infrared-goggles";
    }
  | {
      t: "december-choice";
      variant: "cia-sabik" | "sabik-cooper";
      objectiveId: ObjectiveId;
    }
  | {
      t: "distribute-action-tokens";
      remaining: number;
      source: string;
    }
  | {
      t: "choose-return-symptom";
      source: string;
    }
  | {
      t: "remove-agents-board";
      seat: SeatId;
      remaining: number;
      source: string;
    }
  | {
      t: "reveal-pearl-tokens";
      seat: SeatId;
      remaining: number;
      source: string;
    }
  | {
      t: "place-free-checkpoint";
      seat: SeatId;
      source: string;
    }
  | {
      t: "pick-temp-alias";
      seat: SeatId;
    }
  // Core gameplay decisions
  | {
      t: "hand-limit";
      seat: SeatId;
    }
  | {
      t: "discard-card";
      seat: SeatId;
      remaining: number;
      source: string;
    }
  | {
      t: "cover-mitigation";
      seat: SeatId;
      source: string;
      /** Additional pending cover losses for this same seat queued behind this one. */
      more: number;
    }
  | {
      t: "choose-liability";
      seat: SeatId;
      region: RegionId;
    }
  | {
      t: "escalation";
      step: "increase" | "add-agents" | "intensify" | "pursuit";
      escalationsLeft: number;
      drawnBottomCity?: CityId;
    }
  | {
      t: "remove-safehouse";
      region: RegionId;
      source: string;
    }
  | {
      t: "forecast";
      seat: SeatId;
      cards: ThreatCard[];
    }
  | {
      t: "border-security";
      seatsLeft: SeatId[];
      placedByCurrent: number;
    }
  | {
      t: "room-choice";
      seat: SeatId;
      room:
        | "pearl-loading-dock"
        | "pearl-control-room"
        | "pearl-courtyard"
        | "pearl-archives"
        | "pearl-directors-office"
        | "pearl-access-panel"
        | "lg-briefing-room"
        | "lg-armory";
    };

export type LogEntry = { seq: number } & (
  | { t: "phase"; phase: string }
  | { t: "turn"; turn: number; seat: SeatId }
  | { t: "action"; seat: SeatId; action: string; detail: string; cost: number }
  | { t: "move"; seat: SeatId; from: CityId; to: CityId; by: string }
  | { t: "team-move"; team: TeamId; from: CityId | null; to: CityId; by: string }
  | { t: "draw"; seat: SeatId; cards: CardId[] }
  | { t: "escalation"; step: string; detail: string }
  | { t: "satellite"; region: RegionId; action: "launched" | "disabled" | "destroyed" }
  | { t: "threat"; card: string; city: CityId; effect: string }
  | { t: "incident"; city: CityId; bottomCard: string; title: string; detail: string }
  | { t: "outbreak"; city: CityId; chain: boolean }
  | { t: "cover"; seat: SeatId; result: string; source: string }
  | { t: "burned"; seat: SeatId; passport: PassportColor; alias: Affiliation }
  | { t: "symptom"; seat: SeatId; action: "gained" | "returned"; name: string }
  | { t: "event"; seat: SeatId; event: EventId; detail: string }
  | { t: "objective"; objective: ObjectiveId; status: "completed" | "failed"; detail: string }
  | { t: "infiltration"; seat: SeatId; site: InfiltrationSiteId; room: RoomId; detail: string }
  | { t: "pursuit"; detail: string }
  | { t: "reading"; readingId: number; kind: ReadingKind; ref: string; title: string }
  | { t: "note"; text: string }
  | { t: "end"; evaluation: Evaluation | null; reason: string }
);

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type LogInput = DistributiveOmit<LogEntry, "seq">;

export type Purchase =
  | { t: "asset"; passport: PassportColor; affiliation: Affiliation; asset: AssetId; city?: CityId }
  | { t: "permanent-safehouse"; city: CityId }
  | { t: "counter-surveillance"; city: CityId };

export type BoughtEntry = {
  purchase: Purchase;
  cost: number;
};

export type UpkeepState = {
  budget: number;
  spent: number;
  bought: BoughtEntry[];
  /** Cities eligible for Permanent Safehouse (contained a safehouse at game end and not already permanent). */
  safehouseCities: CityId[];
  surveillanceAdded: CityId[];
  contaminationAdded: CityId[];
  done: PlayerId[];
};

export type Game = {
  seats: SeatId[];
  players: Record<SeatId, PlayerState>;
  active: SeatId;
  turn: number;
  actionsLeft: number;
  coverOfDarknessActive: boolean;
  /** Restriction currently ignored for the rest of the active player's turn via Help from Sabik. */
  ignoredRestrictionThisTurn: RestrictionId | null;
  /** Whether Check Surveillance has already been resolved for the current turn. */
  surveillanceChecked: boolean;
  /** Remaining opening Threat cards to flip during setup.threat (9 down to 0). */
  openingThreatsLeft: number;
  /** Remaining Threat cards to flip during playing.threat. */
  threatsLeft: number;
  /** How many Threat cards have already been flipped this turn. */
  threatsDrawnThisTurn: number;
  /** Whether the 2 Player cards have been drawn in Step 4 this turn. */
  cardsDrawn: boolean;
  skipThreat: boolean;
  /** Escalations still queued for this Draw step if 2 Escalations were drawn together. */
  queuedEscalations: number;
  /** Whether Hassled check has run after Draw step. */
  hassledChecked: boolean;
  /** Top Threat cards peeked via Tracking Device (cleared when Threat deck changes). */
  peekedThreatCards: ThreatCard[];
  threatLevelIndex: number;
  locations: Record<CityId, GameCity>;
  teams: Record<TeamId, TeamPiece>;
  /** Undirected edges `[a, b]` with canonical sorted order `a < b`. */
  checkpoints: [CityId, CityId][];
  satellites: RegionId[];
  supplies: {
    agents: number;
    incidentOutbreakTokens: number;
    diseaseCubes: number;
    safehouses: number;
    actionTokens: number;
    pursuitTokens: number;
    checkpointTokens: number;
    satellites: number;
    symptoms: string[];
  };
  playerCards: Record<CardId, PlayerCard>;
  playerDeck: CardId[];
  playerDiscard: CardId[];
  threatDeck: ThreatCard[];
  threatDiscard: ThreatCard[];
  gameEndArea: ThreatCard[];
  pickedEvents: EventId[];
  discretionaryCheckedThisGame: number;
  /** Seats that have chosen their starting alias during setup.aliases. */
  aliasesChosen: SeatId[];
  objectives: ActiveObjective[];
  activeRestrictions: RestrictionId[];
  infiltrationSites: Partial<Record<InfiltrationSiteId, ActiveInfiltrationSite>>;
  loadingDockVisitsThisGame: number;
  /** Remaining cover losses queued behind an interactive decision (e.g. multi-cover loss from surveillance/Holding Cells). */
  coverQueue: PendingCoverLoss[];
  /** Remaining seats waiting for cover loss or liability resolution. */
  pending: Decision[];
  /** Counters for game chronicle / audit. */
  stats: {
    incidents: number;
    outbreaks: number;
    escalations: number;
  };
  outcome: {
    ended: true;
    reason: string;
    evaluation: Evaluation | null;
  } | null;
  endedVotes: PlayerId[];
  postgameResolved: boolean;
  upkeep: UpkeepState | null;
  log: LogEntry[];
  nextSeq: number;
  /** Campaign snapshot before a Prologue game so Prologue stays non-permanent when finished. */
  prologueRestore: Campaign | null;
};

export type TableSeat = {
  player: PlayerId;
  name: string;
  seat: SeatId;
};

export type Table = {
  seats: TableSeat[];
  ready: Record<PlayerId, boolean>;
};

export type World = {
  campaign: Campaign;
  game: Game | null;
  table: Table;
};
