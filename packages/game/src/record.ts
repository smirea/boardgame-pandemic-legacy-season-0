import type { Command, Phase, Save } from "./machine";
import { createGameActor, phaseOf, reject } from "./machine";

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
  const actor = createGameActor({ save: recording.initial });
  for (const step of recording.steps) {
    const snap = actor.getSnapshot();
    const curPhase = phaseOf(snap.value);
    const err = reject(snap.context.world, curPhase, step.command, snap.context.undo.length);
    if (err) {
      throw new Error(`Replay rejected at step ${step.index} (${curPhase}): ${err}`);
    }
    actor.send(step.command);
  }
  const finalSnap = actor.getSnapshot();
  return {
    phase: phaseOf(finalSnap.value),
    world: finalSnap.context.world,
    stepCount: recording.steps.length,
  };
}
