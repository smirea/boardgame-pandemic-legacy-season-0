import type { Command, Save } from "./engine";
import { createGameSession, parseSave } from "./engine";
import { phaseOf } from "./helpers";
import type { Phase } from "./state";

export type RecordedStep = {
  index: number;
  at: string;
  phaseBefore: Phase;
  phaseAfter: Phase;
  command: Command;
  logStart: number;
  logEnd: number;
};

export type GameRecording = {
  version: 1;
  initial: Save;
  steps: RecordedStep[];
};

export function createRecording(initial: Save): GameRecording {
  return {
    version: 1,
    initial: structuredClone(initial),
    steps: [],
  };
}

export function replayRecording(recording: GameRecording): {
  phase: Phase;
  world: Save["world"];
  stepCount: number;
} {
  const initialSave = parseSave(recording.initial);
  const session = createGameSession({ save: initialSave });
  for (const step of recording.steps) {
    const curPhase = phaseOf(session.state.world);
    const result = session.dispatch(step.command);
    if (!result.ok) {
      throw new Error(`Replay rejected at step ${step.index} (${curPhase}): ${result.error}`);
    }
  }
  return {
    phase: phaseOf(session.state.world),
    world: session.state.world,
    stepCount: recording.steps.length,
  };
}
