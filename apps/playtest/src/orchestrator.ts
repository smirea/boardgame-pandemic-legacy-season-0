import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventId, PlayerId } from "@repo/game";
import { decisionOwner, effectiveSurveillance, optionsFor, pack, phaseOf, topDecision } from "@repo/game";
import { REPO_ROOT } from "./config";
import type { AgentTurnResponse, ThreadStats } from "./harnesses";
import { AgentThread } from "./harnesses";
import type { CommandApiResult, GameHost, HostPlayer } from "./host";
import type { CompactStatePacket } from "./serialize";

export type OrchestratorOptions = {
  maxWakesPerGame?: number;
  maxDiscussionRounds?: number;
  autoStepForced?: boolean;
  keepThreadsAcrossGames?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  onLog?: (line: string) => void;
};

export type GameRunTelemetry = {
  gameTag: string;
  month: number;
  monthName: string;
  attempt: 1 | 2;
  wakes: number;
  threads: ThreadStats[];
};

const BASE_SYSTEM_RULES = `You are playing a live cooperative campaign of Pandemic Legacy: Season 0 with your teammates.
Play thoughtfully to WIN every objective, survive Incidents/Escalations, make real legacy/story/upgrade decisions, and stress-test the game engine honestly.

HOW TO WIN SEASON 0 (CORE MECHANICS):
- Objectives usually require TEAMS, not just neutralizing agents! To assemble a Team: stand at a Safehouse whose city matches the affiliation you want (Allied Safehouse -> Allied Team, Neutral Safehouse -> Neutral Team, Soviet Safehouse -> Soviet Team) and discard 5 City cards of that affiliation (4 if Hospital Administrator) with 'assemble-team:...'.
- Move assembled Teams along city connections via 'drive-team:<team>:<city>' (1 action per hop from anywhere on the board, or via Coordinator/Airlift/Transport Crew). A Team is ACTIVE (*) when in a city matching its affiliation.
- Once an active Team reaches an objective's target city, spend 1 action ('acquire-targets') to acquire that target!
- For Unknown-city objectives (e.g. Locate Agent Sabik): you narrow candidates from drawn cards OR spend 1 action at a Safehouse in that region ('identify:...') discarding 3 City cards of that region to reveal the hidden target city!
- Coordinate 'share-give' / 'share-take' (both pawns in the city matching the card, unless giver is Research Assistant) so one player builds 5 matching-affiliation cards to assemble a Team.
- Balance neutralizing 3-agent Incident hotspots (and watching the 36-agent supply!) with building Teams & completing objectives BEFORE the Player Deck runs out!

RESPONSE FORMAT (strict JSON):
- say: concise message to teammates ONLY when coordinating a plan, asking a question, or flagging a major event (otherwise null — don't narrate routine moves!). To ask teammates for input BEFORE acting, include @name, @all, or ? and set commands: [].
- commands: array of 0+ exact command strings from ACTIONS to execute sequentially in ONE wake (e.g. ["drive:london", "neutralize", "build-safehouse", "end-actions"]). Batch your full turn's planned actions together to stay fast and low-token!
- inspect: leave as [] on almost all turns! Only use ("board", "files", "sites", "log", "readings", "info:<id>", "strategy", "memory") when you genuinely lack info not already in your thread — NEVER repeat "board" once you have already inspected the map!
- why: short tactical reason (or null).
- strategy: full updated markdown for shared team strategy.md whenever the team plan shifts (or null).
- memory: full updated markdown for your personal memory file whenever you learn key clues/rules or at post-game debrief (or null).
- report: bug/rules discrepancy note if anything looks wrong, or post-game debrief text (or null).

KEY RULES:
1. Read EVERY VERBATIM Legacy card, Debrief, Box, Door, and Operations card — they unlock rules, story clues, and new objectives.
2. Coordinate in 'say' before big shared choices: creating Aliases, Psych Eval questions, Event picks, Legacy choices, and Spend Budget upgrades.
3. Play Event cards whenever valuable (including Counter-Intelligence off-turn right before Escalation Intensify!).
4. In 'upkeep' (Spend Budget), discuss and spend budget on upgrades (buy:safehouse:<city>, buy:counter-surv:<city>, buy:asset:...) before running 'finish-upkeep'. Every player must confirm 'finish-upkeep'.
5. Use ONLY exact keys or documented templates from ACTIONS.
6. Mandatory single-button mechanical steps (like flipping opening threats, beginning surveillance with no rescue event, ending at 0 actions, drawing cards/threats with no pre-draw event) auto-advance for efficiency — you always get control for every real choice!`;

function buildSystemPrompt(
  player: HostPlayer,
  allPlayers: readonly HostPlayer[],
  memoryText: string,
  strategyText: string,
): string {
  const mates = allPlayers
    .filter((p) => p.id !== player.id)
    .map((p) => `${p.name} (id=${p.id}, ${p.seat}, ${p.passport} passport)`)
    .join(", ");

  const roleLine = player.lead
    ? `You are ${player.name} (id=${player.id}, ${player.seat}, ${player.passport} passport) — TEAM LEAD. You start the game, drive setup steps (opening threats, event selection, shared legacy decisions after checking with teammates), and run 'continue' at game end.`
    : `You are ${player.name} (id=${player.id}, ${player.seat}, ${player.passport} passport). Coordinate closely with your teammates: ${mates}.`;

  const sections = [
    BASE_SYSTEM_RULES,
    `\nYOUR IDENTITY:\n${roleLine}\nTeammates: ${mates}`,
  ];

  if (memoryText.trim()) {
    sections.push(`\nYOUR PERSISTENT MEMORY FROM PREVIOUS GAMES:\n${memoryText.trim()}`);
  }
  if (strategyText.trim()) {
    sections.push(`\nSHARED TEAM STRATEGY:\n${strategyText.trim()}`);
  }

  return sections.join("\n");
}

function findMentionedTeammates(
  say: string,
  speaker: HostPlayer,
  allPlayers: readonly HostPlayer[],
): HostPlayer[] {
  const lower = say.toLowerCase();
  const others = allPlayers.filter((p) => p.id !== speaker.id);
  if (lower.includes("@all") || lower.includes("@team")) return others;

  const explicit = others.filter(
    (p) =>
      lower.includes(`@${p.id.toLowerCase()}`) ||
      lower.includes(`@${p.name.toLowerCase()}`),
  );
  if (explicit.length > 0) return explicit;
  if (say.includes("?")) return others;
  return others;
}

export class GameOrchestrator {
  private readonly host: GameHost;
  private readonly apiBase: string;
  private readonly opts: Required<Omit<OrchestratorOptions, "onLog">>;
  private readonly logFn: (line: string) => void;
  private readonly threads = new Map<PlayerId, AgentThread>();
  private readonly allTelemetry: GameRunTelemetry[] = [];

  constructor(host: GameHost, options: OrchestratorOptions = {}) {
    this.host = host;
    this.apiBase = host.url;
    this.opts = {
      maxWakesPerGame: options.maxWakesPerGame ?? 400,
      maxDiscussionRounds: options.maxDiscussionRounds ?? 2,
      autoStepForced: options.autoStepForced ?? true,
      keepThreadsAcrossGames: options.keepThreadsAcrossGames ?? false,
      verbose: options.verbose ?? false,
      quiet: options.quiet ?? false,
    };
    this.logFn = options.onLog ?? ((line) => {
      if (!this.opts.quiet) console.log(line);
    });
  }

  get telemetry(): readonly GameRunTelemetry[] {
    return this.allTelemetry;
  }

  private initThreadsForGame(): void {
    if (this.opts.keepThreadsAcrossGames && this.threads.size === this.host.players.length) {
      return;
    }
    this.threads.clear();
    const strategy = this.host.readStrategy();
    for (const p of this.host.players) {
      const memory = this.host.readMemory(p.id);
      const sysPrompt = buildSystemPrompt(p, this.host.players, memory, strategy);
      this.threads.set(p.id, new AgentThread(p, sysPrompt, REPO_ROOT));
    }
  }

  private async apiGetState(
    player: PlayerId,
    params: { consume?: boolean; feedback?: string | null; notice?: string | null } = {},
  ): Promise<CompactStatePacket> {
    const qs = new URLSearchParams({
      player,
      format: "json",
      consume: params.consume === false ? "0" : "1",
    });
    if (params.feedback) qs.set("feedback", params.feedback);
    if (params.notice) qs.set("notice", params.notice);
    const res = await fetch(`${this.apiBase}/api/state?${qs.toString()}`);
    if (!res.ok) throw new Error(`GET /api/state failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as CompactStatePacket;
  }

  private async apiCommand(
    player: PlayerId,
    expr: string,
    why?: string | null,
  ): Promise<CommandApiResult> {
    const res = await fetch(`${this.apiBase}/api/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, expr, why: why ?? undefined }),
    });
    return (await res.json()) as CommandApiResult;
  }

  private async apiChat(player: PlayerId, text: string): Promise<{ seq: number }> {
    const res = await fetch(`${this.apiBase}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, text }),
    });
    const data = (await res.json()) as { ok: boolean; message?: { seq: number }; error?: string };
    if (!data.ok) throw new Error(`POST /api/chat failed: ${data.error}`);
    return { seq: data.message!.seq };
  }

  private async apiInspect(player: PlayerId, query: string): Promise<string> {
    const qs = new URLSearchParams({ player, query });
    const res = await fetch(`${this.apiBase}/api/inspect?${qs.toString()}`);
    const data = (await res.json()) as { ok: boolean; content: string };
    return data.content;
  }

  private async apiPutMemory(player: PlayerId, content: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/api/memory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, content }),
    });
    const data = (await res.json()) as { ok: boolean; path: string };
    return data.path;
  }

  private async apiPutStrategy(player: PlayerId, content: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/api/strategy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, content }),
    });
    const data = (await res.json()) as { ok: boolean; path: string };
    return data.path;
  }

  private async apiPostReport(
    player: PlayerId,
    text: string,
    gameReport = false,
    tag?: string,
  ): Promise<string> {
    const res = await fetch(`${this.apiBase}/api/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, text, gameReport, tag }),
    });
    const data = (await res.json()) as { ok: boolean; path: string };
    return data.path;
  }

  private recordTranscript(
    player: HostPlayer,
    prompt: string,
    resp: AgentTurnResponse,
    meta: { sessionId: string; durationMs: number; costUsd: number; phase: string },
  ): void {
    const path = join(this.host.runDir, "transcripts", `${player.id}.jsonl`);
    appendFileSync(
      path,
      JSON.stringify({
        at: new Date().toISOString(),
        phase: meta.phase,
        sessionId: meta.sessionId,
        durationMs: meta.durationMs,
        costUsd: meta.costUsd,
        promptChars: prompt.length,
        response: resp,
      }) + "\n",
    );
  }

  private tagPrefix(): string {
    const w = this.host.world;
    const c = w.campaign;
    const m = c.month === 0 ? "Pro" : `M${c.month}A${c.attempt}`;
    const t = w.game ? ` T${w.game.turn}` : "";
    return `[${m}${t} | ${phaseOf(w)}]`;
  }

  private pickActionablePlayer(
    counterIntelAsked: Set<string>,
    upkeepCursor: { index: number },
  ): { player: HostPlayer; notice: string | null; isCounterIntelWindow: boolean } {
    const w = this.host.world;
    const phase = phaseOf(w);
    const g = w.game;

    if (phase === "lobby" || phase === "over" || phase === "setup.threat" || phase === "setup.events") {
      return { player: this.host.leadPlayer, notice: null, isCounterIntelWindow: false };
    }

    if (!g) {
      return { player: this.host.leadPlayer, notice: null, isCounterIntelWindow: false };
    }

    const top = topDecision(w);
    if (top) {
      // Counter-Intelligence off-turn timing window before Escalation Intensify!
      if (top.t === "escalation" && top.step === "intensify") {
        for (const p of this.host.players) {
          const holdsCI = g.players[p.seat].hand.some(
            (id) => g.playerCards[id]?.kind === "event" && g.playerCards[id]?.event === "counter-intelligence",
          );
          const ciKey = `${g.turn}:${g.stats.escalations}:${top.escalationsLeft}:${p.id}`;
          if (holdsCI && !counterIntelAsked.has(ciKey)) {
            counterIntelAsked.add(ciKey);
            return {
              player: p,
              notice:
                "TIMING WINDOW: Escalation is paused right before INTENSIFY! You hold Counter-Intelligence — play 'play:counter-intelligence:<threatCardId>' now to remove a Threat card before reshuffling, or pass with commands: [].",
              isCounterIntelWindow: true,
            };
          }
        }
      }

      const owner = decisionOwner(w);
      if (owner) {
        const match = this.host.players.find((p) => p.seat === owner);
        if (match) return { player: match, notice: null, isCounterIntelWindow: false };
      }
      return { player: this.host.leadPlayer, notice: null, isCounterIntelWindow: false };
    }

    if (phase === "setup.aliases") {
      const pending = this.host.players.find((p) => !g.aliasesChosen.includes(p.seat));
      if (pending) return { player: pending, notice: null, isCounterIntelWindow: false };
    }

    if (phase === "upkeep" && g.upkeep) {
      const unconfirmed = this.host.players.filter((p) => !g.upkeep!.done.includes(p.id));
      if (unconfirmed.length > 0) {
        const pick = unconfirmed[upkeepCursor.index % unconfirmed.length]!;
        upkeepCursor.index += 1;
        return { player: pick, notice: null, isCounterIntelWindow: false };
      }
    }

    const active = this.host.players.find((p) => p.seat === g.active);
    return { player: active ?? this.host.leadPlayer, notice: null, isCounterIntelWindow: false };
  }

  private async applySideEffects(player: HostPlayer, resp: AgentTurnResponse): Promise<void> {
    if (resp.say) {
      await this.apiChat(player.id, resp.say);
      this.logFn(`💬 ${this.tagPrefix()} ${player.name}: ${resp.say}`);
    }
    if (resp.strategy) {
      await this.apiPutStrategy(player.id, resp.strategy);
      this.logFn(`🗺️  ${this.tagPrefix()} ${player.name} updated shared strategy.md`);
    }
    if (resp.memory) {
      await this.apiPutMemory(player.id, resp.memory);
      this.logFn(`🧠 ${this.tagPrefix()} ${player.name} updated memory/${player.id}.md`);
    }
    if (resp.report) {
      await this.apiPostReport(player.id, resp.report, false);
      this.logFn(`🐞 ${this.tagPrefix()} ${player.name} filed issue report: ${resp.report.slice(0, 120)}`);
    }
  }

  private async runPlayerWake(
    player: HostPlayer,
    options: {
      feedback?: string | null;
      notice?: string | null;
      inspectResults?: { query: string; content: string }[];
      extraPrompt?: string | null;
    } = {},
  ): Promise<AgentTurnResponse> {
    const thread = this.threads.get(player.id)!;
    const packet = await this.apiGetState(player.id, {
      consume: true,
      feedback: options.feedback,
      notice: options.notice,
    });

    const parts: string[] = [];
    if (options.inspectResults && options.inspectResults.length > 0) {
      for (const item of options.inspectResults) {
        parts.push(`[INSPECT: ${item.query}]\n${item.content}`);
      }
    }
    parts.push(packet.compactText);
    if (options.extraPrompt) {
      parts.push(`\n${options.extraPrompt}`);
    }
    const prompt = parts.join("\n\n");

    const turnRes = await thread.sendTurn(prompt);
    this.recordTranscript(player, prompt, turnRes.response, {
      sessionId: turnRes.sessionId,
      durationMs: turnRes.durationMs,
      costUsd: turnRes.usage.costUsd,
      phase: packet.phase,
    });

    if (this.opts.verbose) {
      this.logFn(
        `   [${player.id} ${player.harness}/${player.model} ${turnRes.durationMs}ms in=${turnRes.usage.inputTokens} cache=${turnRes.usage.cacheReadTokens} out=${turnRes.usage.outputTokens} $${turnRes.usage.costUsd.toFixed(4)}]`,
      );
    }

    return turnRes.response;
  }

  private stateSignature(): string {
    const w = this.host.world;
    const g = w.game;
    const top = topDecision(w);
    return [
      w.campaign.month,
      w.campaign.attempt,
      phaseOf(w),
      g?.turn ?? 0,
      g?.active ?? "-",
      g?.actionsLeft ?? 0,
      g?.openingThreatsLeft ?? 0,
      g?.threatsLeft ?? 0,
      top?.t ?? "-",
      top?.t === "escalation" ? top.step : "-",
      g?.upkeep?.spent ?? 0,
      g?.upkeep?.done.length ?? 0,
      g?.pickedEvents.join(",") ?? "",
      w.campaign.readings.length,
    ].join("|");
  }

  private someoneHoldsEvent(events: readonly EventId[]): boolean {
    const g = this.host.world.game;
    if (!g) return false;
    return g.seats.some((s) =>
      g.players[s].hand.some((id) => {
        const card = g.playerCards[id];
        return card?.kind === "event" && events.includes(card.event);
      }),
    );
  }

  /**
   * Auto-advances truly mandatory single-choice mechanical steps (without skipping any real
   * tactical choice, Event window, decision, or setup/upkeep prompt). Cuts wakes per turn ~4x.
   */
  private async tryAutoStepForced(counterIntelAsked: Set<string>): Promise<boolean> {
    if (!this.opts.autoStepForced) return false;
    const w = this.host.world;
    const phase = phaseOf(w);
    const g = w.game;
    const top = topDecision(w);

    if (phase === "lobby") {
      // Wait for lead only if Door 14 is ignored; otherwise auto-start ONLY when not first lobby?
      // Actually let lead start the game manually on lobby so they can confirm passports/start-game?
      // Auto-starting fresh lobby saves 2 turns AND respects passports already set by CLI!
      if (w.campaign.door14State === "ignored") return false;
      const res = await this.apiCommand(this.host.leadPlayer.id, "start-game", "auto-start");
      if (res.ok) {
        this.logFn(`⚙ ${this.tagPrefix()} auto -> start-game`);
        return true;
      }
      return false;
    }

    if (!g) return false;

    if (phase === "setup.threat" && !top && g.openingThreatsLeft > 0) {
      const res = await this.apiCommand(this.host.leadPlayer.id, "flip-all-threats", "auto-flip");
      if (res.ok) {
        this.logFn(`⚙ ${this.tagPrefix()} auto -> flip-all-threats (${res.executedCount} flipped)`);
        return true;
      }
      return false;
    }

    if (phase === "over" && !top) {
      const res = await this.apiCommand(this.host.leadPlayer.id, "continue", "auto-continue");
      if (res.ok) {
        this.logFn(`⚙ ${this.tagPrefix()} auto -> continue (game-end evaluation)`);
        return true;
      }
      return false;
    }

    if (top) {
      if (top.t === "escalation") {
        const active = this.host.players.find((p) => p.seat === g.active) ?? this.host.leadPlayer;
        if (top.step === "increase" || top.step === "add-agents") {
          const expr = `escalation:${top.step}`;
          const res = await this.apiCommand(active.id, expr, "auto-escalation");
          if (res.ok) {
            this.logFn(`⚠️  ${this.tagPrefix()} auto -> ${expr}`);
            return true;
          }
        } else if (top.step === "intensify") {
          // Only auto-intensify if NO unasked player holds Counter-Intelligence
          const hasUnaskedCI = this.host.players.some((p) => {
            const holdsCI = g.players[p.seat].hand.some(
              (id) => g.playerCards[id]?.kind === "event" && g.playerCards[id]?.event === "counter-intelligence",
            );
            const ciKey = `${g.turn}:${g.stats.escalations}:${top.escalationsLeft}:${p.id}`;
            return holdsCI && !counterIntelAsked.has(ciKey);
          });
          if (!hasUnaskedCI) {
            const res = await this.apiCommand(active.id, "escalation:intensify", "auto-escalation");
            if (res.ok) {
              this.logFn(`⚠️  ${this.tagPrefix()} auto -> escalation:intensify`);
              return true;
            }
          }
        }
      }
      return false;
    }

    const active = this.host.players.find((p) => p.seat === g.active);
    if (!active) return false;

    if (phase === "playing.surveillance") {
      const pState = g.players[active.seat];
      const loc = pState.location;
      const inDanger =
        !pState.infiltration &&
        !g.locations[loc].safehouse &&
        effectiveSurveillance(w, loc) > 0;
      // Don't auto-begin if active player would lose cover AND someone can rescue them with Airlift / Holdover!
      if (inDanger && this.someoneHoldsEvent(["airlift", "a-holdover-from-the-war"])) {
        return false;
      }
      const res = await this.apiCommand(active.id, "begin-turn", "auto-begin-turn");
      if (res.ok) {
        this.logFn(`⚙ ${this.tagPrefix()} auto -> begin-turn (${active.name})`);
        return true;
      }
      return false;
    }

    if (phase === "playing.actions" && g.actionsLeft === 0) {
      const legal = optionsFor(w, active.id, this.host.undoDepth);
      const hasFreeAction = legal.some(
        (o) => o.key === "spend-action-token" || o.key.startsWith("help-from-sabik:"),
      );
      if (!hasFreeAction) {
        const res = await this.apiCommand(active.id, "end-actions", "auto-end-actions");
        if (res.ok) {
          this.logFn(`⚙ ${this.tagPrefix()} auto -> end-actions (${active.name})`);
          return true;
        }
      }
      return false;
    }

    if (phase === "playing.draw") {
      const res = await this.apiCommand(active.id, "draw-cards", "auto-draw-cards");
      if (res.ok) {
        this.logFn(`⚙ ${this.tagPrefix()} auto -> draw-cards (${active.name})`);
        return true;
      }
      return false;
    }

    if (phase === "playing.threat" && !this.someoneHoldsEvent(["one-quiet-night", "forecast"])) {
      const res = await this.apiCommand(active.id, "draw-all-threats", "auto-draw-threats");
      if (res.ok) {
        this.logFn(`⚙ ${this.tagPrefix()} auto -> draw-all-threats (${active.name}, ${res.executedCount} card(s))`);
        return true;
      }
      return false;
    }

    return false;
  }

  /** Plays a single game (current month/attempt) to completion, then runs post-game debrief & memory updates. */
  async playOneGame(): Promise<void> {
    const startMonth = this.host.world.campaign.month;
    const startAttempt = this.host.world.campaign.attempt;
    const monthName = pack.monthNames[startMonth] ?? `Month ${startMonth}`;
    this.logFn(`\n═══════════════════════════════════════════════════════════`);
    this.logFn(
      `▶ Starting ${monthName}${startMonth > 0 ? ` (Attempt ${startAttempt})` : ""} | Funding: ${this.host.world.campaign.funding} | Players: ${this.host.players.map((p) => `${p.name}[${p.harness}/${p.model}@${p.effort}]`).join(", ")}`,
    );
    this.logFn(`═══════════════════════════════════════════════════════════`);

    this.initThreadsForGame();

    let wakes = 0;
    const counterIntelAsked = new Set<string>();
    const upkeepCursor = { index: 0 };
    const discussionRoundsBySig = new Map<string, number>();
    const inspectedBoardByPlayer = new Set<PlayerId>();
    let pendingFeedback: { player: PlayerId; text: string } | null = null;
    let pendingNotice: { player: PlayerId; text: string } | null = null;
    let pendingInspect: { player: PlayerId; items: { query: string; content: string }[] } | null = null;
    let consecutiveInspectOnly = 0;
    let consecutiveNoProgress = 0;

    while (!this.host.isGameFinished && phaseOf(this.host.world) !== "finished") {
      if (wakes >= this.opts.maxWakesPerGame) {
        throw new Error(
          `Exceeded maxWakesPerGame (${this.opts.maxWakesPerGame}) in ${monthName} at phase ${phaseOf(this.host.world)}`,
        );
      }

      if (!pendingFeedback && (await this.tryAutoStepForced(counterIntelAsked))) {
        continue;
      }

      const pick = this.pickActionablePlayer(counterIntelAsked, upkeepCursor);
      const actor = pick.player;
      const sigBefore = this.stateSignature();

      const feedback = pendingFeedback?.player === actor.id ? pendingFeedback.text : null;
      const notice =
        pick.notice ?? (pendingNotice?.player === actor.id ? pendingNotice.text : null);
      const inspectItems =
        pendingInspect?.player === actor.id ? pendingInspect.items : undefined;
      pendingFeedback = null;
      pendingNotice = null;
      pendingInspect = null;

      wakes += 1;
      const resp = await this.runPlayerWake(actor, {
        feedback,
        notice,
        inspectResults: inspectItems,
      });

      await this.applySideEffects(actor, resp);

      // Counter-Intelligence off-turn window: allow playing CI or passing cleanly
      if (pick.isCounterIntelWindow) {
        if (resp.commands.length > 0) {
          for (const expr of resp.commands) {
            const res = await this.apiCommand(actor.id, expr, resp.why);
            if (res.ok) {
              this.logFn(`⚡ ${this.tagPrefix()} ${actor.name} -> ${expr} (${res.feedback})`);
            } else {
              this.logFn(`✗ ${this.tagPrefix()} ${actor.name} -> ${expr} REJECTED: ${res.error}`);
            }
          }
        }
        continue;
      }

      // Inspect-only turn
      if (resp.inspect.length > 0 && resp.commands.length === 0) {
        consecutiveInspectOnly += 1;
        const results: { query: string; content: string }[] = [];
        for (const q of resp.inspect.slice(0, 4)) {
          if (q === "board") {
            if (inspectedBoardByPlayer.has(actor.id)) {
              results.push({ query: q, content: "(Static 48-city connections are already in your thread above; live city agents/safehouses are shown under Board(...) each turn.)" });
              continue;
            }
            inspectedBoardByPlayer.add(actor.id);
          }
          results.push({ query: q, content: await this.apiInspect(actor.id, q) });
        }
        this.logFn(`🔍 ${this.tagPrefix()} ${actor.name} inspected [${resp.inspect.join(", ")}]`);
        pendingInspect = { player: actor.id, items: results };
        if (consecutiveInspectOnly >= 2) {
          pendingNotice = {
            player: actor.id,
            text: "Inspection results attached above. Now execute at least one legal command from ACTIONS.",
          };
        }
        continue;
      }
      consecutiveInspectOnly = 0;

      // Execute command batch sequentially, interrupting on surprises or rejections
      if (resp.commands.length > 0) {
        let executedAny = false;
        let lastError: string | null = null;
        let lastExpr = "";

        for (const expr of resp.commands) {
          const prevActive = this.host.world.game?.active ?? null;
          const prevPending = topDecision(this.host.world)?.t ?? null;

          const res = await this.apiCommand(actor.id, expr, resp.why);
          if (!res.ok) {
            lastError = res.error ?? "Rejected";
            lastExpr = expr;
            this.logFn(`✗ ${this.tagPrefix()} ${actor.name} -> ${expr} | REJECTED: ${lastError}`);
            break;
          }

          executedAny = true;
          this.logFn(`▶ ${this.tagPrefix()} ${actor.name} -> ${expr}${resp.why ? `  (${resp.why})` : ""}`);

          if (res.violations.length > 0) {
            this.logFn(`🚨 INVARIANT VIOLATION: ${res.violations.join("; ")}`);
          }

          if (res.newReadingsCount > 0) {
            this.logFn(`📜 ${res.newReadingsCount} new verbatim reading(s) revealed — pausing batch so players read it`);
            break;
          }
          if (res.sessionGameFinished || phaseOf(this.host.world) === "finished") {
            break;
          }
          const nextPending = res.pendingTop?.t ?? null;
          if (nextPending !== null && nextPending !== prevPending) {
            break;
          }
          const nextActive = this.host.world.game?.active ?? null;
          if (prevActive !== null && nextActive !== prevActive) {
            break;
          }
          if (
            res.phaseAfter !== res.phaseBefore &&
            (res.phaseAfter === "upkeep" || res.phaseAfter === "over" || res.phaseAfter === "postgame")
          ) {
            break;
          }
        }

        if (lastError) {
          pendingFeedback = {
            player: actor.id,
            text: `REJECTED '${lastExpr}': ${lastError}. Check exact legal keys under ACTIONS and try again.`,
          };
          consecutiveNoProgress = executedAny ? 0 : consecutiveNoProgress + 1;
        } else {
          consecutiveNoProgress = 0;
        }

        // Only satisfy non-redundant inspect queries requested alongside commands
        if (resp.inspect.length > 0 && !this.host.isGameFinished) {
          const results: { query: string; content: string }[] = [];
          for (const q of resp.inspect.slice(0, 3)) {
            if (q === "board") {
              if (inspectedBoardByPlayer.has(actor.id)) continue;
              inspectedBoardByPlayer.add(actor.id);
            }
            results.push({ query: q, content: await this.apiInspect(actor.id, q) });
          }
          if (results.length > 0) {
            pendingInspect = { player: actor.id, items: results };
          }
        }

        if (consecutiveNoProgress >= 5) {
          throw new Error(
            `Player '${actor.name}' failed to make progress after 5 consecutive rejected turns at ${phaseOf(this.host.world)}`,
          );
        }
        continue;
      }

      // 0 commands, 0 inspect -> Discussion turn!
      const usedRounds = discussionRoundsBySig.get(sigBefore) ?? 0;
      if (resp.say && usedRounds < this.opts.maxDiscussionRounds) {
        discussionRoundsBySig.set(sigBefore, usedRounds + 1);
        const listeners = findMentionedTeammates(resp.say, actor, this.host.players);
        for (const mate of listeners) {
          if (this.host.isGameFinished) break;
          wakes += 1;
          const mateResp = await this.runPlayerWake(mate, {
            notice: `${actor.name} spoke to the table and is waiting for your input before acting. Reply concisely in 'say' (you may also play an off-turn Event card or upkeep purchase in 'commands' if helpful, otherwise leave commands: []).`,
          });
          await this.applySideEffects(mate, mateResp);
          for (const expr of mateResp.commands) {
            const r = await this.apiCommand(mate.id, expr, mateResp.why);
            if (r.ok) {
              this.logFn(`⚡ ${this.tagPrefix()} ${mate.name} -> ${expr}`);
              if (r.sessionGameFinished) break;
            } else {
              this.logFn(`✗ ${this.tagPrefix()} ${mate.name} -> ${expr} REJECTED: ${r.error}`);
              break;
            }
          }
        }
        consecutiveNoProgress = 0;
        continue;
      }

      // Discussion cap reached or empty response -> nudge actor to execute an action
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= 4) {
        throw new Error(
          `Stalled: player '${actor.name}' returned no commands ${consecutiveNoProgress} times in a row at ${phaseOf(this.host.world)}`,
        );
      }
      pendingNotice = {
        player: actor.id,
        text: "Please execute at least one legal command from ACTIONS now so the game advances.",
      };
    }

    // Run Post-Game Debrief & Memory/Strategy Update across all player threads
    await this.runPostGameDebrief(wakes, startMonth, monthName, startAttempt);
  }

  private async runPostGameDebrief(
    wakes: number,
    month: number,
    monthName: string,
    attempt: 1 | 2,
  ): Promise<void> {
    const completed = this.host.completedGames.at(-1);
    const gameTag = completed?.tag ?? this.host.currentGameTag();

    this.logFn(`\n───────────────────────────────────────────────────────────`);
    if (completed) {
      this.logFn(
        `🏁 ${completed.monthName} (Attempt ${completed.attempt}) COMPLETE: ${completed.evaluation} | Obj ${completed.completedObjectives} ok / ${completed.failedObjectives} failed | Turns: ${completed.turns} | Inc: ${completed.incidents} | Out: ${completed.outbreaks} | Funding: ${completed.fundingBefore}→${completed.fundingAfter}`,
      );
      this.logFn(
        `${completed.replayOk ? "✅" : "❌"} Deterministic Replay: ${completed.replaySteps} steps, ${completed.violationCount} live violations${completed.replayError ? ` (${completed.replayError})` : ""}`,
      );
    }
    this.logFn(`📝 Running post-game debrief, strategy & memory updates...`);

    const filesSnapshot = await this.apiInspect(this.host.leadPlayer.id, "files");
    const auditText = await (await fetch(`${this.apiBase}/api/audit`)).text();

    for (const p of this.host.players) {
      const currentMem = this.host.readMemory(p.id);
      const debriefPrompt = [
        `POST-GAME DEBRIEF (${monthName} Attempt ${attempt} complete).`,
        `Your final campaign files and passports:\n${filesSnapshot}`,
        `\nAudit snapshot:\n${auditText}`,
        `\nYour previous memory file:\n${currentMem}`,
        `\nPlease respond with:`,
        `- commands: []`,
        `- memory: REQUIRED — full updated markdown for your personal memory file (preserve important past facts, add this game's outcome, passport/alias upgrades/cover/assets/liabilities, permanent safehouses/surveillance, Intel/Personnel clues, and tactical lessons for next month).`,
        p.lead
          ? `- strategy: REQUIRED — full updated markdown for shared team strategy.md guiding the team's plan for the next month.`
          : `- strategy: optional refinement to shared strategy.md (or null if team strategy is good).`,
        `- report: REQUIRED — concise post-game report (outcome, key decisions, upgrades bought, story clues spotted, any bugs or rules friction).`,
        `- say: brief closing note to teammates (or null).`,
      ].join("\n");

      const resp = await this.runPlayerWake(p, { extraPrompt: debriefPrompt });
      if (resp.say) {
        await this.apiChat(p.id, resp.say);
        this.logFn(`💬 [Debrief] ${p.name}: ${resp.say}`);
      }
      if (resp.memory) {
        const memPath = await this.apiPutMemory(p.id, resp.memory);
        this.logFn(`🧠 Saved personal memory: ${memPath}`);
      }
      if (resp.strategy) {
        const stratPath = await this.apiPutStrategy(p.id, resp.strategy);
        this.logFn(`🗺️  Saved shared strategy: ${stratPath}`);
      }
      if (resp.report) {
        const repPath = await this.apiPostReport(p.id, resp.report, true, gameTag);
        this.logFn(`📄 Saved game report: ${repPath}`);
      }
    }

    const stats: GameRunTelemetry = {
      gameTag,
      month,
      monthName,
      attempt,
      wakes,
      threads: this.host.players.map((p) => this.threads.get(p.id)!.getStats()),
    };
    this.allTelemetry.push(stats);
    writeFileSync(
      join(this.host.runDir, "telemetry.json"),
      JSON.stringify(this.allTelemetry, null, 2),
    );
  }

  /** Plays a target month (Attempt 1 + Attempt 2 if Attempt 1 fails) or a campaign range [startMonth..endMonth]. */
  async run(config: { mode: "month" | "campaign" | "save"; targetMonth?: number; endMonth?: number; maxGames?: number }): Promise<void> {
    let gamesPlayed = 0;
    const maxGames = config.maxGames ?? (config.mode === "campaign" ? 26 : 2);

    while (gamesPlayed < maxGames) {
      if (phaseOf(this.host.world) === "finished") break;

      const curMonth = this.host.world.campaign.month;
      if (config.mode === "month" && config.targetMonth !== undefined && curMonth > config.targetMonth) {
        break;
      }
      if (config.mode === "campaign" && config.endMonth !== undefined && curMonth > config.endMonth) {
        break;
      }

      if (gamesPlayed > 0) {
        if (curMonth === 0) {
          const advRes = await fetch(`${this.apiBase}/api/admin/advance-january`, { method: "POST" });
          if (!advRes.ok) throw new Error(`Failed to advance to January: ${await advRes.text()}`);
        } else {
          const nextRes = await fetch(`${this.apiBase}/api/admin/next-game`, { method: "POST" });
          if (!nextRes.ok) throw new Error(`Failed to reset for next game: ${await nextRes.text()}`);
        }
      }

      await this.playOneGame();
      gamesPlayed += 1;

      if (config.mode === "save" && config.endMonth === undefined) {
        break;
      }
      if (config.mode === "month" && config.targetMonth === 0) {
        break;
      }
    }
  }
}
