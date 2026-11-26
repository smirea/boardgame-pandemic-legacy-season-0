import { pack } from "./content/pack";
import { cityOfCard, effectiveSurveillance, handLimit } from "./helpers";
import type {
  Affiliation,
  CityId,
  InfiltrationSiteId,
  PlayerId,
  RegionId,
  RoomId,
  SeatId,
  SecuritySymbol,
} from "./ids";
import type { Phase } from "./machine";
import { seatOfPlayer } from "./machine";
import type {
  Campaign,
  Decision,
  GameCity,
  LogEntry,
  PlayerCard,
  ReadingEntry,
  TeamPiece,
  ThreatCard,
  UpkeepState,
  World,
} from "./state";

export type ObjectiveView = {
  id: string;
  cardCode: string;
  title: string;
  description: string;
  kind: string;
  status: "active" | "completed" | "failed";
  targetCities?: CityId[];
  requiredTeamsPerCity?: number;
  unknownRegion?: RegionId;
  unknownAffiliation?: Affiliation;
  unknownControlCentersOnly?: boolean;
  targetRevealed: boolean;
  revealedTargetCity: CityId | null;
  trialCities: CityId[];
  eliminatedCities: CityId[];
  infiltrationSite?: InfiltrationSiteId;
  infiltrationRoom?: RoomId;
  infiltrationDiscardCount?: number;
  infiltrationDiscardAffiliation?: Affiliation;
  region?: RegionId;
  hint?: string;
};

export type PublicTokenView = {
  id: string;
  edgeId: string;
  slotIndex: number;
  revealed: boolean;
  symbol: SecuritySymbol | null;
};

export type PlayerView = {
  phase: Phase;
  viewer: PlayerId;
  viewerSeat: SeatId | null;
  campaign: {
    month: number;
    monthName: string;
    attempt: 1 | 2;
    funding: number;
    branch: "cia" | "sabik";
    rules: Campaign["rules"];
    openedBoxes: Campaign["openedBoxes"];
    openedDoors: Campaign["openedDoors"];
    restrictions: Campaign["restrictions"];
    discretionaryBudgetBoxesLeft: number | null;
    helpFromSabikBoxesLeft: number | null;
    door14State: Campaign["door14State"];
    diseaseCubeSupplyMax: number;
    unlockedEvents: Campaign["unlockedEvents"];
    availableAssets: Campaign["availableAssets"];
    availableLiabilities: Campaign["availableLiabilities"];
    availablePermanentSafehouses: number;
    availableCounterSurveillance: number;
    availableTunnels: number;
    pearlOpenedDoors: Campaign["pearlOpenedDoors"];
    pearlTunnels: string[];
    pearlDoor41Placed: boolean;
    passports: Campaign["passports"];
    intelFile: Campaign["intelFile"];
    personnelFile: Campaign["personnelFile"];
    results: Campaign["results"];
    finalScore: number | null;
    readingsCount: number;
  };
  table: World["table"];
  game: {
    seats: SeatId[];
    active: SeatId;
    turn: number;
    actionsLeft: number;
    threatLevel: number;
    openingThreatsLeft: number;
    threatsLeft: number;
    skipThreat: boolean;
    coverOfDarknessActive: boolean;
    ignoredRestrictionThisTurn: Campaign["restrictions"][number] | null;
    activeRestrictions: Campaign["restrictions"];
    playerDeckCount: number;
    playerDiscard: { id: string; card: PlayerCard }[];
    threatDeckCount: number;
    threatDiscard: ThreatCard[];
    gameEndArea: ThreatCard[];
    peekedThreatCards: ThreatCard[];
    pickedEvents: Campaign["unlockedEvents"];
    satellites: RegionId[];
    checkpoints: [CityId, CityId][];
    supplies: NonNullable<World["game"]>["supplies"];
    teams: TeamPiece[];
    cities: Record<
      CityId,
      GameCity & {
        surveillance: number;
        effectiveSurveillance: number;
        permanentSafehouse: boolean;
        exposedIntensity: number | null;
        contaminated: boolean;
        controlCenter: boolean;
        bugged: boolean;
      }
    >;
    players: Record<
      SeatId,
      {
        seat: SeatId;
        passport: NonNullable<World["game"]>["players"][SeatId]["passport"];
        activeAlias: Affiliation | null;
        tempAlias: NonNullable<World["game"]>["players"][SeatId]["tempAlias"];
        needsTempAlias: boolean;
        location: CityId;
        infiltration: { site: InfiltrationSiteId; room: RoomId } | null;
        actionTokens: number;
        handLimit: number;
        hand: { id: string; card: PlayerCard }[];
      }
    >;
    objectives: ObjectiveView[];
    infiltrationSites: Partial<Record<InfiltrationSiteId, { site: InfiltrationSiteId; tokens: PublicTokenView[] }>>;
    pendingTop: Decision | null;
    pendingCount: number;
    outcome: NonNullable<World["game"]>["outcome"];
    upkeep: UpkeepState | null;
    recentLog: LogEntry[];
  } | null;
};

/** Projects the full World into a player-safe view (hiding unrevealed decks, unrevealed tokens, and unrevealed target cities). */
export function viewFor(world: World, phase: Phase, viewer: PlayerId, recentLogLimit = 30): PlayerView {
  const c = world.campaign;
  const g = world.game;
  const viewerSeat = seatOfPlayer(world, viewer);

  return {
    phase,
    viewer,
    viewerSeat,
    campaign: {
      month: c.month,
      monthName: pack.monthNames[c.month] ?? `Month ${c.month}`,
      attempt: c.attempt,
      funding: c.funding,
      branch: c.branch,
      rules: c.rules,
      openedBoxes: c.openedBoxes,
      openedDoors: c.openedDoors,
      restrictions: c.restrictions,
      discretionaryBudgetBoxesLeft: c.discretionaryBudgetBoxesLeft,
      helpFromSabikBoxesLeft: c.helpFromSabikBoxesLeft,
      door14State: c.door14State,
      diseaseCubeSupplyMax: c.diseaseCubeSupplyMax,
      unlockedEvents: c.unlockedEvents,
      availableAssets: c.availableAssets,
      availableLiabilities: c.availableLiabilities,
      availablePermanentSafehouses: c.availablePermanentSafehouses,
      availableCounterSurveillance: c.availableCounterSurveillance,
      availableTunnels: c.availableTunnels,
      pearlOpenedDoors: c.pearlOpenedDoors,
      pearlTunnels: c.pearlTunnels,
      pearlDoor41Placed: c.pearlDoor41Placed,
      passports: c.passports,
      intelFile: c.intelFile,
      personnelFile: c.personnelFile,
      results: c.results,
      finalScore: c.finalScore,
      readingsCount: c.readings.length,
    },
    table: world.table,
    game: g
      ? {
          seats: g.seats,
          active: g.active,
          turn: g.turn,
          actionsLeft: g.actionsLeft,
          threatLevel: pack.threatTrack[g.threatLevelIndex]!,
          openingThreatsLeft: g.openingThreatsLeft,
          threatsLeft: g.threatsLeft,
          skipThreat: g.skipThreat,
          coverOfDarknessActive: g.coverOfDarknessActive,
          ignoredRestrictionThisTurn: g.ignoredRestrictionThisTurn,
          activeRestrictions: g.activeRestrictions,
          playerDeckCount: g.playerDeck.length,
          playerDiscard: g.playerDiscard.map((id) => ({ id, card: g.playerCards[id]! })),
          threatDeckCount: g.threatDeck.length,
          threatDiscard: g.threatDiscard,
          gameEndArea: g.gameEndArea,
          peekedThreatCards: g.peekedThreatCards,
          pickedEvents: g.pickedEvents,
          satellites: g.satellites,
          checkpoints: g.checkpoints,
          supplies: g.supplies,
          teams: Object.values(g.teams),
          cities: Object.fromEntries(
            pack.cities.map((ct) => [
              ct.id,
              {
                ...g.locations[ct.id],
                surveillance: c.cities[ct.id].surveillance,
                effectiveSurveillance: effectiveSurveillance(world, ct.id),
                permanentSafehouse: c.cities[ct.id].permanentSafehouse,
                exposedIntensity: c.cities[ct.id].exposedIntensity,
                contaminated: c.cities[ct.id].contaminated,
                controlCenter: c.cities[ct.id].controlCenter,
                bugged: c.cities[ct.id].bugged,
              },
            ]),
          ) as NonNullable<PlayerView["game"]>["cities"],
          players: Object.fromEntries(
            g.seats.map((s) => {
              const p = g.players[s];
              return [
                s,
                {
                  seat: s,
                  passport: p.passport,
                  activeAlias: p.activeAlias,
                  tempAlias: p.tempAlias,
                  needsTempAlias: p.needsTempAlias,
                  location: p.location,
                  infiltration: p.infiltration,
                  actionTokens: p.actionTokens,
                  handLimit: handLimit(world, s),
                  // In Pandemic Legacy, player hands are open information on the table!
                  hand: p.hand.map((id) => ({ id, card: g.playerCards[id]! })),
                },
              ];
            }),
          ) as NonNullable<PlayerView["game"]>["players"],
          objectives: g.objectives.map((o) => ({
            id: o.id,
            cardCode: o.cardCode,
            title: o.title,
            description: o.description,
            kind: o.kind,
            status: o.status,
            targetCities: o.targetCities,
            requiredTeamsPerCity: o.requiredTeamsPerCity,
            unknownRegion: o.unknownRegion,
            unknownAffiliation: o.unknownAffiliation,
            unknownControlCentersOnly: o.unknownControlCentersOnly,
            targetRevealed: o.targetRevealed,
            revealedTargetCity:
              o.targetRevealed && o.hiddenCardId ? cityOfCard(g, o.hiddenCardId) : null,
            trialCities: o.trialCardIds
              .map((id) => cityOfCard(g, id))
              .filter((ct): ct is CityId => ct !== null),
            eliminatedCities: o.eliminatedCities,
            infiltrationSite: o.infiltrationSite,
            infiltrationRoom: o.infiltrationRoom,
            infiltrationDiscardCount: o.infiltrationDiscardCount,
            infiltrationDiscardAffiliation: o.infiltrationDiscardAffiliation,
            region: o.region,
            hint: o.hint,
          })),
          infiltrationSites: Object.fromEntries(
            Object.entries(g.infiltrationSites).map(([siteId, site]) => [
              siteId,
              {
                site: site.site,
                tokens: site.tokens.map((t) => ({
                  id: t.id,
                  edgeId: t.edgeId,
                  slotIndex: t.slotIndex,
                  revealed: t.revealed,
                  symbol: t.revealed ? t.symbol : null,
                })),
              },
            ]),
          ),
          pendingTop: g.pending[0] ?? null,
          pendingCount: g.pending.length,
          outcome: g.outcome,
          upkeep: g.upkeep,
          recentLog: g.log.slice(-recentLogLimit),
        }
      : null,
  };
}

export function readingsSince(world: World, afterId: number): ReadingEntry[] {
  return world.campaign.readings.filter((r) => r.id > afterId);
}
