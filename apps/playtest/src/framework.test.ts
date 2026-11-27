import { describe, expect, test } from "bun:test";
import { createGameSession, optionsFor, phaseOf } from "@repo/game";
import {
  buildHarnessCommand,
  DEFAULT_EFFORT,
  DEFAULT_HARNESS,
  DEFAULT_MODELS,
  parseHarnessStdout,
  parsePlayerSpec,
} from "./harnesses";
import { tokenizeCommandExpr } from "./host";
import { renderCompactState } from "./serialize";

describe("agent playtest framework contracts", () => {
  test("player specs default to latest claude haiku on medium reasoning and parse explicit harness, model, and effort", () => {
    expect(parsePlayerSpec("Maya")).toEqual({
      id: "maya",
      name: "Maya",
      harness: DEFAULT_HARNESS,
      model: DEFAULT_MODELS.claude,
      effort: DEFAULT_EFFORT,
    });

    expect(parsePlayerSpec("Devon:codex/gpt-6.2-sol@high")).toEqual({
      id: "devon",
      name: "Devon",
      harness: "codex",
      model: "gpt-6.2-sol",
      effort: "high",
    });

    expect(parsePlayerSpec("Sora:agy")).toEqual({
      id: "sora",
      name: "Sora",
      harness: "agy",
      model: DEFAULT_MODELS.agy,
      effort: "medium",
    });

    expect(parsePlayerSpec("Vex:grok@low")).toEqual({
      id: "vex",
      name: "Vex",
      harness: "grok",
      model: DEFAULT_MODELS.grok,
      effort: "low",
    });

    expect(() => parsePlayerSpec("Bad:openai/gpt-5")).toThrow(/Unsupported harness/);
    expect(() => parsePlayerSpec("Bad:claude/haiku@turbo")).toThrow(/Invalid reasoning effort/);
  });

  test("harness command builder creates isolated new threads on turn 1 and resumes the same thread on subsequent turns for all four harnesses", () => {
    const claude1 = buildHarnessCommand({
      harness: "claude",
      model: "haiku",
      effort: "medium",
      sessionId: null,
      newSessionUuid: "11111111-1111-1111-1111-111111111111",
      systemPrompt: "SYS",
      prompt: "T1",
    });
    expect(claude1.argv).toContain("--session-id");
    expect(claude1.argv).toContain("11111111-1111-1111-1111-111111111111");
    expect(claude1.argv).toContain("--system-prompt");
    expect(claude1.argv).toContain("--tools");

    const claude2 = buildHarnessCommand({
      harness: "claude",
      model: "haiku",
      effort: "medium",
      sessionId: "11111111-1111-1111-1111-111111111111",
      systemPrompt: "SYS",
      prompt: "T2",
    });
    expect(claude2.argv).toContain("--resume");
    expect(claude2.argv).not.toContain("--system-prompt");

    const codex2 = buildHarnessCommand({
      harness: "codex",
      model: "gpt-6-luna",
      effort: "medium",
      sessionId: "thread-abc",
      prompt: "T2",
      codexSchemaPath: "/tmp/schema.json",
    });
    expect(codex2.argv.slice(0, 4)).toEqual(["codex", "exec", "resume", "thread-abc"]);

    const agy1 = buildHarnessCommand({
      harness: "agy",
      model: "gemini-3.8-flash-medium",
      effort: "medium",
      sessionId: null,
      prompt: "T1",
    });
    expect(agy1.argv).not.toContain("--effort");
    expect(agy1.argv).toContain("--json-schema");

    const grok1 = buildHarnessCommand({
      harness: "grok",
      model: "grok-4.7-build-fast",
      effort: "medium",
      sessionId: null,
      newSessionUuid: "22222222-2222-2222-2222-222222222222",
      systemPrompt: "SYS",
      prompt: "T1",
    });
    expect(grok1.argv).toContain("--session-id");
    expect(grok1.argv).toContain("--system-prompt-override");
  });

  test("harness stdout parser recovers structured responses across claude, codex JSONL, grok, and agy envelopes with raw newlines", () => {
    const claude = parseHarnessStdout(
      "claude",
      JSON.stringify({
        session_id: "s-claude",
        structured_output: {
          say: "Meet in London?",
          commands: ["begin-turn", "drive:london"],
          inspect: [],
          why: "clear hotspot",
          strategy: null,
          memory: null,
          report: null,
        },
        total_cost_usd: 0.0012,
        usage: { input_tokens: 100, cache_read_input_tokens: 500, output_tokens: 40 },
      }),
      "fallback",
    );
    expect(claude.sessionId).toBe("s-claude");
    expect(claude.response.commands).toEqual(["begin-turn", "drive:london"]);
    expect(claude.usage.cacheReadTokens).toBe(500);

    const codex = parseHarnessStdout(
      "codex",
      [
        JSON.stringify({ type: "thread.started", thread_id: "t-codex" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({
              say: null,
              commands: ["end-actions"],
              inspect: ["board"],
              why: null,
              strategy: null,
              memory: null,
              report: null,
            }),
          },
        }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 900, cached_input_tokens: 600, output_tokens: 20 } }),
      ].join("\n"),
      "fallback",
    );
    expect(codex.sessionId).toBe("t-codex");
    expect(codex.response.inspect).toEqual(["board"]);

    // Agy occasionally emits raw unescaped newlines inside its `response` string field
    const agyRaw =
      '{"conversation_id":"c-agy","status":"SUCCESS","response":"{\\"commands\\":[\\"draw-cards\\"]}\n","structured_output":{"say":null,"commands":["draw-cards"],"inspect":[],"why":null,"strategy":null,"memory":null,"report":null},"usage":{"input_tokens":50,"output_tokens":10,"cache_read_tokens":20}}';
    const agy = parseHarnessStdout("agy", agyRaw, "fallback");
    expect(agy.sessionId).toBe("c-agy");
    expect(agy.response.commands).toEqual(["draw-cards"]);

    const grok = parseHarnessStdout(
      "grok",
      JSON.stringify({
        sessionId: "s-grok",
        text: '```json\n{"say":"ready","commands":["start-game"],"inspect":[],"why":null,"strategy":null,"memory":"\\"# Memory\\\\n\\\\n- line 1\\"","report":null}\n```',
        total_cost_usd: 0.01,
        usage: { input_tokens: 120, cache_read_input_tokens: 0, output_tokens: 30 },
      }),
      "fallback",
    );
    expect(grok.sessionId).toBe("s-grok");
    expect(grok.response.commands).toEqual(["start-game"]);
    expect(grok.response.memory).toBe("# Memory\n\n- line 1");
  });

  test("command tokenizer preserves quoted values and raw JSON commands", () => {
    expect(tokenizeCommandExpr('create-aliases allied black="Dr. Vance":clinic-planner')).toEqual([
      "create-aliases",
      "allied",
      "black=Dr. Vance:clinic-planner",
    ]);
    expect(tokenizeCommandExpr('raw {"type":"END_ACTIONS"}')).toEqual([
      "raw",
      '{"type":"END_ACTIONS"}',
    ]);
  });

  test("compact state serialization includes exact available options and full verbatim readings", () => {
    const session = createGameSession({ seed: 1962 });
    session.dispatch({ type: "JOIN", player: "maya", name: "Maya", seat: "seat-1" });
    session.dispatch({ type: "JOIN", player: "devon", name: "Devon", seat: "seat-2" });
    session.dispatch({ type: "BEGIN_JANUARY", player: "maya" });
    session.dispatch({ type: "START_GAME", player: "maya" });

    const world = session.state.world;
    expect(phaseOf(world)).toBe("setup.legacy");
    const legal = optionsFor(world, "maya", 0);
    const packet = renderCompactState(world, "maya", 0, {
      unreadReadings: world.campaign.readings,
      unreadChat: [],
      deltaLog: [],
      waitingFor: "Team (maya lead) to resolve 'create-aliases'",
      sessionGameFinished: false,
    });

    expect(packet.options.length).toBeGreaterThan(0);
    expect(packet.compactText).toContain(legal[0]!.key);
    expect(packet.compactText).toContain("VERBATIM");
    expect(packet.compactText).toContain("ACTIONS");
  });
});
