import { describe, expect, test } from "bun:test";
import type { StackFrame } from "./stack";
import { createStackEngine, emitFrames, stackFromSequence } from "./stack";

type DemoFrame =
  | { t: "step"; label: string }
  | { t: "spawn-children"; id: string }
  | { t: "wait"; id: string }
  | { t: "loop" }
  | { t: "game-over" };

type DemoState = {
  stack: DemoFrame[];
  log: string[];
  hp: number;
  skipWait: boolean;
};

type DemoCmd =
  | { type: "CONTINUE" }
  | { type: "HURT"; amount: number }
  | { type: "SKIP_WAIT" }
  | { type: "TRIGGER_LOOP" };

function makeDemoEngine() {
  return createStackEngine<DemoState, DemoFrame, DemoCmd, string, { cue: string }>({
    getStack: (s) => s.stack,
    isWait: (f) => f.t === "wait" || f.t === "game-over",
    interrupt: (draft) => {
      if (draft.hp <= 0 && draft.stack[draft.stack.length - 1]?.t !== "game-over") {
        draft.stack = [{ t: "game-over" }];
        draft.log.push("interrupt:game-over");
        return true;
      }
      return false;
    },
    pruneWait: (draft, frame) => frame.t === "wait" && draft.skipWait,
    runAuto: (draft, frame) => {
      if (frame.t === "step") {
        draft.log.push(`step:${frame.label}`);
      } else if (frame.t === "spawn-children") {
        draft.log.push(`enter:${frame.id}`);
        emitFrames(
          draft.stack,
          { t: "step", label: `${frame.id}-1` },
          { t: "step", label: `${frame.id}-2` },
        );
      } else if (frame.t === "loop") {
        emitFrames(draft.stack, { t: "loop" });
      }
    },
    check: (state, cmd) => {
      const top = state.stack[state.stack.length - 1];
      if (cmd.type === "CONTINUE" && top?.t !== "wait") return "Not waiting";
      return null;
    },
    apply: (draft, cmd) => {
      if (cmd.type === "CONTINUE") {
        draft.stack.pop();
      } else if (cmd.type === "HURT") {
        draft.hp -= cmd.amount;
        emitFrames(draft.stack, { t: "step", label: "after-hurt" });
      } else if (cmd.type === "SKIP_WAIT") {
        draft.skipWait = true;
      } else if (cmd.type === "TRIGGER_LOOP") {
        emitFrames(draft.stack, { t: "loop" });
      }
    },
    deriveEvents: (before, after) => after.log.slice(before.log.length),
    deriveCues: (before, after) =>
      after.log.slice(before.log.length).map((entry) => ({ cue: entry })),
    maxSteps: 50,
  });
}

describe("Effect Stack primitives", () => {
  test("frames emitted in one step run FIFO while nested child steps preempt paused parents LIFO", () => {
    const engine = makeDemoEngine();
    const initial: DemoState = {
      stack: stackFromSequence(
        { t: "wait", id: "start" },
        { t: "spawn-children", id: "A" },
        { t: "spawn-children", id: "B" },
        { t: "step", label: "done" },
      ),
      log: [],
      hp: 10,
      skipWait: false,
    };

    const res = engine.step(initial, { type: "CONTINUE" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // A's children preempt B; within A and within B, children run in natural FIFO order
    expect(res.state.log).toEqual([
      "enter:A",
      "step:A-1",
      "step:A-2",
      "enter:B",
      "step:B-1",
      "step:B-2",
      "step:done",
    ]);
    expect(res.trace.map((f: StackFrame) => f.t)).toEqual([
      "spawn-children",
      "step",
      "step",
      "spawn-children",
      "step",
      "step",
      "step",
    ]);
  });

  test("interrupt preempts queued frames and pruneWait clears satisfied waits automatically", () => {
    const engine = makeDemoEngine();
    const s1: DemoState = {
      stack: stackFromSequence({ t: "wait", id: "w" }, { t: "step", label: "never-runs" }),
      log: [],
      hp: 3,
      skipWait: false,
    };

    const hurt = engine.step(s1, { type: "HURT", amount: 5 });
    expect(hurt.ok).toBe(true);
    if (!hurt.ok) return;
    expect(hurt.state.stack).toEqual([{ t: "game-over" }]);
    expect(hurt.state.log).toEqual(["interrupt:game-over"]);

    const s2: DemoState = {
      stack: stackFromSequence({ t: "wait", id: "w" }, { t: "step", label: "after-prune" }),
      log: [],
      hp: 10,
      skipWait: false,
    };
    const pruned = engine.step(s2, { type: "SKIP_WAIT" });
    expect(pruned.ok).toBe(true);
    if (!pruned.ok) return;
    expect(pruned.state.log).toEqual(["step:after-prune"]);
    expect(pruned.state.stack).toEqual([]);
  });

  test("session rejects illegal commands without mutating state, notifies subscribers with cues, and throws on runaway loops", () => {
    const engine = makeDemoEngine();
    const session = engine.createSession({
      stack: stackFromSequence({ t: "wait", id: "w" }, { t: "step", label: "finished" }),
      log: [],
      hp: 10,
      skipWait: false,
    });

    const seen: { events: string[]; cues: { cue: string }[] }[] = [];
    const unsubscribe = session.subscribe((tr) => {
      seen.push({ events: tr.events, cues: tr.cues });
    });

    const ok = session.dispatch({ type: "CONTINUE" });
    expect(ok.ok).toBe(true);
    expect(seen).toEqual([{ events: ["step:finished"], cues: [{ cue: "step:finished" }] }]);

    const bad = session.dispatch({ type: "CONTINUE" });
    expect(bad).toEqual({ ok: false, error: "Not waiting" });
    expect(seen).toHaveLength(1);

    unsubscribe();
    expect(() => session.dispatch({ type: "TRIGGER_LOOP" })).toThrow(/exceeded 50 steps/);
  });
});
