import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type HarnessKind = "claude" | "codex" | "agy" | "grok";
export type EffortLevel = "low" | "medium" | "high" | "xhigh";

export const VALID_HARNESSES: readonly HarnessKind[] = ["claude", "codex", "agy", "grok"];
export const DEFAULT_HARNESS: HarnessKind = "claude";
export const DEFAULT_EFFORT: EffortLevel = "medium";

export const DEFAULT_MODELS: Record<HarnessKind, string> = {
  claude: "haiku",
  codex: "gpt-6-luna",
  agy: "gemini-3.8-flash-medium",
  grok: "grok-4.7-build-fast",
};

export type PlayerSpec = {
  id: string;
  name: string;
  harness: HarnessKind;
  model: string;
  effort: EffortLevel;
};

export type AgentTurnResponse = {
  say: string | null;
  commands: string[];
  inspect: string[];
  why: string | null;
  strategy: string | null;
  memory: string | null;
  report: string | null;
};

export type TokenUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type HarnessTurnResult = {
  response: AgentTurnResponse;
  rawText: string;
  sessionId: string;
  usage: TokenUsage;
  durationMs: number;
};

/**
 * Strict JSON Schema accepted by all 4 harnesses (Claude, Codex, Agy, Grok).
 * All keys are required with nullable types for OpenAI strict schema compatibility.
 */
export const AGENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    say: {
      type: ["string", "null"],
      description: "Optional concise table chat message to teammates. Use @name, @all, or ? to request a reply before acting.",
    },
    commands: {
      type: "array",
      items: { type: "string" },
      description: "0 or more exact command strings from ACTIONS to execute sequentially.",
    },
    inspect: {
      type: "array",
      items: { type: "string" },
      description: "Optional inspection queries (board, files, sites, log, readings, info:<id>, strategy, memory).",
    },
    why: {
      type: ["string", "null"],
      description: "Brief tactical rationale recorded in the action log.",
    },
    strategy: {
      type: ["string", "null"],
      description: "Optional full replacement markdown for shared team strategy.md (only when creating or updating team strategy).",
    },
    memory: {
      type: ["string", "null"],
      description: "Optional full replacement markdown for your personal memory file (for future games).",
    },
    report: {
      type: ["string", "null"],
      description: "Optional bug/rules issue report or post-game debrief text.",
    },
  },
  required: ["say", "commands", "inspect", "why", "strategy", "memory", "report"],
  additionalProperties: false,
} as const;

export const AGENT_RESPONSE_SCHEMA_JSON = JSON.stringify(AGENT_RESPONSE_SCHEMA);

let cachedCodexSchemaPath: string | null = null;
function ensureCodexSchemaFile(): string {
  if (!cachedCodexSchemaPath) {
    cachedCodexSchemaPath = join(tmpdir(), `pl-s0-agent-schema-${process.pid}.json`);
    writeFileSync(cachedCodexSchemaPath, AGENT_RESPONSE_SCHEMA_JSON);
  }
  return cachedCodexSchemaPath;
}

const VALID_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh"]);

function slugifyPlayerId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Invalid player name '${name}'`);
  return slug;
}

/**
 * Parses `name[:harness[/model[@effort]]]` (or `name[:harness[@effort]]`).
 * Default harness is `claude`, default model is latest `haiku`, default effort is `medium`.
 */
export function parsePlayerSpec(
  raw: string,
  defaultEffort: EffortLevel = DEFAULT_EFFORT,
): PlayerSpec {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty --player spec");

  const colonIdx = trimmed.indexOf(":");
  const displayName = (colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx)).trim();
  if (!displayName) throw new Error(`Missing player name in '${raw}'`);
  const id = slugifyPlayerId(displayName);

  if (colonIdx === -1) {
    return {
      id,
      name: displayName,
      harness: DEFAULT_HARNESS,
      model: DEFAULT_MODELS[DEFAULT_HARNESS],
      effort: defaultEffort,
    };
  }

  let spec = trimmed.slice(colonIdx + 1).trim();
  let effort: EffortLevel = defaultEffort;

  const atIdx = spec.lastIndexOf("@");
  if (atIdx !== -1) {
    const effRaw = spec.slice(atIdx + 1).trim().toLowerCase();
    if (!VALID_EFFORTS.has(effRaw)) {
      throw new Error(`Invalid reasoning effort '${effRaw}' in '${raw}' (expected low|medium|high|xhigh)`);
    }
    effort = effRaw as EffortLevel;
    spec = spec.slice(0, atIdx).trim();
  }

  const slashIdx = spec.indexOf("/");
  const harnessRaw = (slashIdx === -1 ? spec : spec.slice(0, slashIdx)).trim().toLowerCase();
  const modelRaw = slashIdx === -1 ? "" : spec.slice(slashIdx + 1).trim();

  if (!VALID_HARNESSES.includes(harnessRaw as HarnessKind)) {
    throw new Error(
      `Unsupported harness '${harnessRaw}' in '${raw}'. Supported: ${VALID_HARNESSES.join(", ")}`,
    );
  }

  const harness = harnessRaw as HarnessKind;
  const model = modelRaw || DEFAULT_MODELS[harness];
  return { id, name: displayName, harness, model, effort };
}

export function verifyHarnessesInstalled(players: readonly PlayerSpec[]): void {
  const checked = new Set<HarnessKind>();
  for (const p of players) {
    if (checked.has(p.harness)) continue;
    checked.add(p.harness);
    const resolved = Bun.which(p.harness);
    if (!resolved) {
      throw new Error(
        `Harness CLI '${p.harness}' required by player '${p.name}' is not installed or not on PATH`,
      );
    }
  }
}

/**
 * Escapes raw control characters inside JSON string literals so loosely formatted CLI envelopes
 * (e.g. raw newlines inside a JSON string field) still parse deterministically.
 */
export function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) {
          out += ch;
          escaped = false;
        } else if (ch === "\\") {
          out += ch;
          escaped = true;
        } else if (ch === '"') {
          out += ch;
          inString = false;
        } else if (ch === "\n") {
          out += "\\n";
        } else if (ch === "\r") {
          out += "\\r";
        } else if (ch === "\t") {
          out += "\\t";
        } else {
          out += ch;
        }
      } else {
        if (ch === '"') inString = true;
        out += ch;
      }
    }
    return JSON.parse(out);
  }
}

function asStringOrNull(val: unknown): string | null {
  if (typeof val !== "string") return null;
  let s = val.trim();
  // Some models double-encode multiline strings inside structured JSON tool calls (`"\"line1\\nline2\""`).
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      const unwrapped = JSON.parse(s);
      if (typeof unwrapped === "string") s = unwrapped.trim();
    } catch {
      // keep literal quoted string
    }
  }
  return s.length > 0 ? s : null;
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeAgentResponse(obj: unknown): AgentTurnResponse {
  if (!obj || typeof obj !== "object") {
    throw new Error(`Expected JSON object for agent response, got ${typeof obj}`);
  }
  const r = obj as Record<string, unknown>;
  return {
    say: asStringOrNull(r.say),
    commands: asStringArray(r.commands),
    inspect: asStringArray(r.inspect),
    why: asStringOrNull(r.why),
    strategy: asStringOrNull(r.strategy),
    memory: asStringOrNull(r.memory),
    report: asStringOrNull(r.report),
  };
}

export function extractJsonObjectFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty agent response text");

  // Direct JSON
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return parseLooseJson(trimmed);
  }

  // Fenced JSON block
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    return parseLooseJson(fence[1].trim());
  }

  // Outermost brace span
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return parseLooseJson(trimmed.slice(first, last + 1));
  }

  throw new Error(`Could not locate JSON object in response: ${trimmed.slice(0, 240)}`);
}

export type HarnessCommandSpec = {
  argv: string[];
  stdin?: string;
};

export function buildHarnessCommand(params: {
  harness: HarnessKind;
  model: string;
  effort: EffortLevel;
  sessionId: string | null;
  newSessionUuid?: string;
  systemPrompt?: string;
  prompt: string;
  codexSchemaPath?: string;
}): HarnessCommandSpec {
  const { harness, model, effort, sessionId, systemPrompt, prompt } = params;

  switch (harness) {
    case "claude": {
      const args = [
        "claude",
        "-p",
        "--model",
        model,
        "--effort",
        effort,
        "--tools",
        "",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--output-format",
        "json",
        "--json-schema",
        AGENT_RESPONSE_SCHEMA_JSON,
      ];
      if (sessionId) {
        args.push("--resume", sessionId);
      } else {
        args.push("--session-id", params.newSessionUuid ?? randomUUID());
        if (systemPrompt) args.push("--system-prompt", systemPrompt);
      }
      return { argv: args, stdin: prompt };
    }

    case "codex": {
      const schemaPath = params.codexSchemaPath ?? ensureCodexSchemaFile();
      const fullPrompt =
        !sessionId && systemPrompt
          ? `${systemPrompt}\n\n---\n\n${prompt}`
          : prompt;
      if (sessionId) {
        return {
          argv: [
            "codex",
            "exec",
            "resume",
            sessionId,
            "-",
            "-m",
            model,
            "-c",
            `model_reasoning_effort="${effort}"`,
            "--ignore-user-config",
            "--output-schema",
            schemaPath,
            "--json",
            "--skip-git-repo-check",
          ],
          stdin: fullPrompt,
        };
      }
      return {
        argv: [
          "codex",
          "exec",
          "-",
          "-m",
          model,
          "-c",
          `model_reasoning_effort="${effort}"`,
          "--ignore-user-config",
          "--output-schema",
          schemaPath,
          "--json",
          "--skip-git-repo-check",
        ],
        stdin: fullPrompt,
      };
    }

    case "agy": {
      const fullPrompt =
        !sessionId && systemPrompt
          ? `${systemPrompt}\n\n---\n\n${prompt}`
          : prompt;
      const safePrompt = fullPrompt.startsWith("-") ? `GAME UPDATE\n${fullPrompt}` : fullPrompt;
      const args = [
        "agy",
        "-p",
        safePrompt,
        "--model",
        model,
        "--disable-slash-commands",
        "--output-format",
        "json",
        "--json-schema",
        AGENT_RESPONSE_SCHEMA_JSON,
      ];
      if (!/(?:^|-)(?:low|medium|high|xhigh|max)$/.test(model)) {
        args.push("--effort", effort);
      }
      if (sessionId) {
        args.push("--resume", sessionId);
      }
      return { argv: args };
    }

    case "grok": {
      const safePrompt = prompt.startsWith("-") ? `GAME UPDATE\n${prompt}` : prompt;
      const args = [
        "grok",
        "-p",
        safePrompt,
        "-m",
        model,
        "--effort",
        effort,
        "--tools",
        "",
        "--no-memory",
        "--no-subagents",
        "--no-plan",
        "--disable-web-search",
        "--output-format",
        "json",
        "--json-schema",
        AGENT_RESPONSE_SCHEMA_JSON,
      ];
      if (sessionId) {
        args.push("--resume", sessionId);
      } else {
        args.push("--session-id", params.newSessionUuid ?? randomUUID());
        if (systemPrompt) args.push("--system-prompt-override", systemPrompt);
      }
      return { argv: args };
    }
  }
}

export function parseHarnessStdout(
  harness: HarnessKind,
  stdout: string,
  fallbackSessionId: string,
): {
  response: AgentTurnResponse;
  rawText: string;
  sessionId: string;
  usage: TokenUsage;
} {
  const zeroUsage = (): TokenUsage => ({
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  });

  if (harness === "codex") {
    let threadId = fallbackSessionId;
    let lastMessage = "";
    const usage = zeroUsage();
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) continue;
      let ev: Record<string, unknown>;
      try {
        ev = parseLooseJson(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (ev.type === "thread.started" && typeof ev.thread_id === "string") {
        threadId = ev.thread_id;
      } else if (ev.type === "item.completed" && ev.item && typeof ev.item === "object") {
        const item = ev.item as Record<string, unknown>;
        if (item.type === "agent_message" && typeof item.text === "string") {
          lastMessage = item.text;
        }
      } else if (ev.type === "turn.completed" && ev.usage && typeof ev.usage === "object") {
        const u = ev.usage as Record<string, number>;
        usage.inputTokens += u.input_tokens ?? 0;
        usage.cacheReadTokens += u.cached_input_tokens ?? 0;
        usage.cacheWriteTokens += u.cache_write_input_tokens ?? 0;
        usage.outputTokens += u.output_tokens ?? 0;
      } else if (ev.type === "error" && typeof ev.message === "string") {
        throw new Error(`Codex error: ${ev.message}`);
      }
    }
    if (!lastMessage) {
      throw new Error(`Codex produced no agent_message. Output: ${stdout.slice(0, 300)}`);
    }
    const parsed = extractJsonObjectFromText(lastMessage);
    return {
      response: normalizeAgentResponse(parsed),
      rawText: lastMessage,
      sessionId: threadId,
      usage,
    };
  }

  // Claude, Agy, Grok emit a single JSON envelope (find last JSON object if logs preceded it)
  const rawEnvelope = extractJsonObjectFromText(stdout) as Record<string, unknown>;

  if (rawEnvelope.is_error === true || rawEnvelope.type === "error") {
    const msg =
      (typeof rawEnvelope.result === "string" && rawEnvelope.result) ||
      (typeof rawEnvelope.message === "string" && rawEnvelope.message) ||
      JSON.stringify(rawEnvelope);
    throw new Error(`${harness} returned error: ${msg}`);
  }

  const sessionId =
    (typeof rawEnvelope.session_id === "string" && rawEnvelope.session_id) ||
    (typeof rawEnvelope.sessionId === "string" && rawEnvelope.sessionId) ||
    (typeof rawEnvelope.conversation_id === "string" && rawEnvelope.conversation_id) ||
    fallbackSessionId;

  const usage = zeroUsage();
  if (rawEnvelope.usage && typeof rawEnvelope.usage === "object") {
    const u = rawEnvelope.usage as Record<string, number>;
    usage.inputTokens = u.input_tokens ?? 0;
    usage.cacheReadTokens = u.cache_read_input_tokens ?? u.cache_read_tokens ?? 0;
    usage.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
    usage.outputTokens = u.output_tokens ?? 0;
  }
  if (typeof rawEnvelope.total_cost_usd === "number") {
    usage.costUsd = rawEnvelope.total_cost_usd;
  }

  if (rawEnvelope.structured_output && typeof rawEnvelope.structured_output === "object") {
    const resp = normalizeAgentResponse(rawEnvelope.structured_output);
    return {
      response: resp,
      rawText: JSON.stringify(rawEnvelope.structured_output),
      sessionId,
      usage,
    };
  }

  const textPayload =
    (typeof rawEnvelope.result === "string" && rawEnvelope.result) ||
    (typeof rawEnvelope.response === "string" && rawEnvelope.response) ||
    (typeof rawEnvelope.text === "string" && rawEnvelope.text) ||
    "";

  if (!textPayload) {
    throw new Error(`${harness} returned no structured_output or text: ${stdout.slice(0, 300)}`);
  }

  const parsed = extractJsonObjectFromText(textPayload);
  return {
    response: normalizeAgentResponse(parsed),
    rawText: textPayload,
    sessionId,
    usage,
  };
}

export type ThreadStats = {
  playerId: string;
  name: string;
  harness: HarnessKind;
  model: string;
  effort: EffortLevel;
  sessionId: string | null;
  turns: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
  totalDurationMs: number;
};

export class AgentThread {
  readonly spec: PlayerSpec;
  private readonly cwd: string;
  private readonly systemPrompt: string;
  private sessionId: string | null = null;
  private turns = 0;
  private inputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;
  private totalDurationMs = 0;

  constructor(spec: PlayerSpec, systemPrompt: string, cwd: string) {
    this.spec = spec;
    this.systemPrompt = systemPrompt;
    this.cwd = cwd;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  getStats(): ThreadStats {
    return {
      playerId: this.spec.id,
      name: this.spec.name,
      harness: this.spec.harness,
      model: this.spec.model,
      effort: this.spec.effort,
      sessionId: this.sessionId,
      turns: this.turns,
      inputTokens: this.inputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      outputTokens: this.outputTokens,
      costUsd: this.costUsd,
      totalDurationMs: this.totalDurationMs,
    };
  }

  async sendTurn(prompt: string, timeoutMs = 120_000): Promise<HarnessTurnResult> {
    const plannedUuid = this.sessionId ?? randomUUID();
    const cmdSpec = buildHarnessCommand({
      harness: this.spec.harness,
      model: this.spec.model,
      effort: this.spec.effort,
      sessionId: this.sessionId,
      newSessionUuid: plannedUuid,
      systemPrompt: this.systemPrompt,
      prompt,
    });

    const t0 = performance.now();
    const proc = Bun.spawn(cmdSpec.argv, {
      cwd: this.cwd,
      stdin: cmdSpec.stdin !== undefined ? new TextEncoder().encode(cmdSpec.stdin) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    const durationMs = Math.round(performance.now() - t0);

    if (timedOut) {
      throw new Error(
        `Harness '${this.spec.harness}' timed out after ${timeoutMs}ms for player '${this.spec.name}'`,
      );
    }

    if (exitCode !== 0 && !stdout.trim()) {
      throw new Error(
        `Harness '${this.spec.harness}' exited ${exitCode} for '${this.spec.name}': ${stderr.trim().slice(0, 400)}`,
      );
    }

    let parsed: ReturnType<typeof parseHarnessStdout>;
    try {
      parsed = parseHarnessStdout(this.spec.harness, stdout, plannedUuid);
    } catch (err) {
      const extra = stderr.trim() ? ` | stderr: ${stderr.trim().slice(0, 300)}` : "";
      throw new Error(`${String(err)} (exit ${exitCode})${extra}`);
    }

    const prevCost = this.costUsd;
    const isCumulativeCost = this.spec.harness === "claude";
    const turnCost = isCumulativeCost
      ? Math.max(0, parsed.usage.costUsd - prevCost)
      : parsed.usage.costUsd;

    this.sessionId = parsed.sessionId;
    this.turns += 1;
    this.inputTokens += parsed.usage.inputTokens;
    this.cacheReadTokens += parsed.usage.cacheReadTokens;
    this.cacheWriteTokens += parsed.usage.cacheWriteTokens;
    this.outputTokens += parsed.usage.outputTokens;
    this.costUsd = isCumulativeCost
      ? Math.max(prevCost, parsed.usage.costUsd)
      : prevCost + parsed.usage.costUsd;
    this.totalDurationMs += durationMs;

    return {
      response: parsed.response,
      rawText: parsed.rawText,
      sessionId: parsed.sessionId,
      usage: { ...parsed.usage, costUsd: turnCost },
      durationMs,
    };
  }
}
