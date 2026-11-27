import type { Draft } from "immer";
import { current, isDraft, produce } from "immer";

export type StackFrame = { readonly t: string };

function snapshotFrame<F extends StackFrame>(frame: F): F {
  return isDraft(frame) ? (current(frame as Draft<F>) as F) : frame;
}

type ActiveScope = {
  stack: StackFrame[];
  batch: StackFrame[];
};

const activeScopes: ActiveScope[] = [];

function findActiveScope(stack: StackFrame[]): ActiveScope | undefined {
  for (let i = activeScopes.length - 1; i >= 0; i--) {
    if (activeScopes[i]!.stack === stack) return activeScopes[i]!;
  }
  return undefined;
}

/** Pushes `sequence` so `sequence[0]` sits on top of `stack` and executes first. */
export function pushSequence<F extends StackFrame>(stack: F[], sequence: readonly F[]): void {
  for (let i = sequence.length - 1; i >= 0; i--) {
    stack.push(sequence[i]!);
  }
}

/** Builds a new LIFO stack from a top-to-bottom execution sequence (`sequence[0]` runs first). */
export function stackFromSequence<F extends StackFrame>(...sequence: F[]): F[] {
  const stack: F[] = [];
  pushSequence(stack, sequence);
  return stack;
}

export function peekFrame<F extends StackFrame>(stack: readonly F[]): F | undefined {
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

export function popFrame<F extends StackFrame>(stack: F[]): F | undefined {
  return stack.pop();
}

export function hasFrame<F extends StackFrame>(
  stack: readonly F[],
  predicate: (frame: F) => boolean,
): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (predicate(stack[i]!)) return true;
  }
  return false;
}

export function findFrameTopDown<F extends StackFrame>(
  stack: readonly F[],
  predicate: (frame: F) => boolean,
): F | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    if (predicate(frame)) return frame;
  }
  return undefined;
}

/**
 * Buffers `emitFrames` calls made during `fn` in natural top-to-bottom FIFO order,
 * then flushes the whole batch onto the top of `stack` (LIFO relative to paused parents).
 */
export function withFrameScope<F extends StackFrame, R>(stack: F[], fn: () => R): R {
  const parent = findActiveScope(stack);
  const scope: ActiveScope = { stack, batch: [] };
  activeScopes.push(scope);
  let ok = false;
  try {
    const result = fn();
    ok = true;
    return result;
  } finally {
    activeScopes.pop();
    if (ok && scope.batch.length > 0) {
      if (parent) {
        parent.batch.push(...scope.batch);
      } else {
        pushSequence(stack, scope.batch as F[]);
      }
    }
  }
}

/**
 * Emits one or more frames to execute next. Inside `withFrameScope`, multiple emissions
 * preserve FIFO order within the same atomic step and preempt paused parent frames on exit.
 */
export function emitFrames<F extends StackFrame>(stack: F[], ...frames: F[]): void {
  if (frames.length === 0) return;
  const scope = findActiveScope(stack);
  if (scope) {
    scope.batch.push(...frames);
  } else {
    pushSequence(stack, frames);
  }
}

export type ResolveStackOptions<State, Frame extends StackFrame> = {
  getStack: (state: State) => Frame[];
  isWait: (frame: Frame) => boolean;
  runAuto: (draft: State, frame: Frame) => void;
  /** Optional preemption hook (e.g. instant game-over). Return true when it rewrote the stack. */
  interrupt?: (draft: State) => boolean;
  /** Optional pruning hook for wait frames whose stop condition is already met. */
  pruneWait?: (draft: State, frame: Frame) => boolean;
  maxSteps?: number;
};

/**
 * Pops and executes automatic frames until the top frame requires external input or the stack empties.
 * Returns the ordered trace of executed/pruned frames for debugging, logs, and animation sequencing.
 */
export function resolveStack<State, Frame extends StackFrame>(
  draft: State,
  options: ResolveStackOptions<State, Frame>,
): Frame[] {
  const maxSteps = options.maxSteps ?? 10_000;
  const trace: Frame[] = [];
  let steps = 0;

  while (true) {
    if (options.interrupt?.(draft)) {
      if (++steps > maxSteps) {
        throw new Error(`Effect stack exceeded ${maxSteps} steps (interrupt loop)`);
      }
      continue;
    }

    const stack = options.getStack(draft);
    const top = peekFrame(stack);
    if (!top) return trace;

    if (options.isWait(top)) {
      if (options.pruneWait?.(draft, top)) {
        if (++steps > maxSteps) {
          throw new Error(`Effect stack exceeded ${maxSteps} steps while pruning '${top.t}'`);
        }
        const pruned = stack.pop()!;
        trace.push(snapshotFrame(pruned));
        continue;
      }
      return trace;
    }

    if (++steps > maxSteps) {
      throw new Error(`Effect stack exceeded ${maxSteps} steps at frame '${top.t}'`);
    }

    const frame = stack.pop()!;
    trace.push(snapshotFrame(frame));
    withFrameScope(stack, () => {
      options.runAuto(draft, frame);
    });
  }
}

export type StackStepResult<State, Frame extends StackFrame, Ev, Cue> =
  | {
      ok: true;
      state: State;
      events: Ev[];
      cues: Cue[];
      trace: Frame[];
    }
  | {
      ok: false;
      error: string;
    };

export type StackTransition<State, Frame extends StackFrame, Cmd, Ev, Cue> = {
  command: Cmd;
  before: State;
  after: State;
  events: Ev[];
  cues: Cue[];
  trace: Frame[];
};

export type StackListener<State, Frame extends StackFrame, Cmd, Ev, Cue> = (
  transition: StackTransition<State, Frame, Cmd, Ev, Cue>,
) => void;

export type StackSession<State, Frame extends StackFrame, Cmd, Ev, Cue> = {
  readonly state: State;
  check: (cmd: Cmd) => string | null;
  dispatch: (cmd: Cmd) => StackStepResult<State, Frame, Ev, Cue>;
  subscribe: (listener: StackListener<State, Frame, Cmd, Ev, Cue>) => () => void;
  replaceState: (next: State) => void;
};

export type StackEngineConfig<State, Frame extends StackFrame, Cmd, Ev, Cue> = {
  getStack: (state: State) => Frame[];
  isWait: (frame: Frame) => boolean;
  runAuto: (draft: State, frame: Frame) => void;
  interrupt?: (draft: State) => boolean;
  pruneWait?: (draft: State, frame: Frame) => boolean;
  check: (state: State, cmd: Cmd) => string | null;
  apply: (draft: State, cmd: Cmd) => void;
  afterStep?: (before: State, after: State, cmd: Cmd, trace: readonly Frame[]) => State;
  deriveEvents?: (before: State, after: State, cmd: Cmd, trace: readonly Frame[]) => Ev[];
  deriveCues?: (before: State, after: State, cmd: Cmd, trace: readonly Frame[]) => Cue[];
  maxSteps?: number;
};

export type StackEngine<State, Frame extends StackFrame, Cmd, Ev, Cue> = {
  check: (state: State, cmd: Cmd) => string | null;
  step: (state: State, cmd: Cmd) => StackStepResult<State, Frame, Ev, Cue>;
  createSession: (initialState: State) => StackSession<State, Frame, Cmd, Ev, Cue>;
};

export function createStackEngine<
  State,
  Frame extends StackFrame,
  Cmd,
  Ev = never,
  Cue = never,
>(
  config: StackEngineConfig<State, Frame, Cmd, Ev, Cue>,
): StackEngine<State, Frame, Cmd, Ev, Cue> {
  const step = (state: State, cmd: Cmd): StackStepResult<State, Frame, Ev, Cue> => {
    const error = config.check(state, cmd);
    if (error !== null) return { ok: false, error };

    let trace: Frame[] = [];
    const produced = produce(state, (draft) => {
      const typedDraft = draft as State;
      withFrameScope(config.getStack(typedDraft), () => {
        config.apply(typedDraft, cmd);
      });
      trace = resolveStack(typedDraft, {
        getStack: config.getStack,
        isWait: config.isWait,
        runAuto: config.runAuto,
        interrupt: config.interrupt,
        pruneWait: config.pruneWait,
        maxSteps: config.maxSteps,
      });
    });

    const nextState = config.afterStep
      ? config.afterStep(state, produced, cmd, trace)
      : produced;
    const events = config.deriveEvents
      ? config.deriveEvents(state, nextState, cmd, trace)
      : [];
    const cues = config.deriveCues
      ? config.deriveCues(state, nextState, cmd, trace)
      : [];

    return { ok: true, state: nextState, events, cues, trace };
  };

  const createSession = (initialState: State): StackSession<State, Frame, Cmd, Ev, Cue> => {
    let current = initialState;
    const listeners = new Set<StackListener<State, Frame, Cmd, Ev, Cue>>();

    return {
      get state() {
        return current;
      },
      check(cmd) {
        return config.check(current, cmd);
      },
      dispatch(cmd) {
        const before = current;
        const result = step(before, cmd);
        if (!result.ok) return result;
        current = result.state;
        const transition: StackTransition<State, Frame, Cmd, Ev, Cue> = {
          command: cmd,
          before,
          after: current,
          events: result.events,
          cues: result.cues,
          trace: result.trace,
        };
        for (const listener of listeners) {
          listener(transition);
        }
        return result;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      replaceState(next) {
        current = next;
      },
    };
  };

  return {
    check: config.check,
    step,
    createSession,
  };
}
