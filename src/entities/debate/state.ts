import { DebatePhase, type DebateState, type DebateTurn, type DebateVerdict } from "./types";

const NEXT_PHASE: Readonly<Record<DebatePhase, DebatePhase | undefined>> = {
  [DebatePhase.CREATED]: DebatePhase.OPENING_A,
  [DebatePhase.OPENING_A]: DebatePhase.OPENING_B,
  [DebatePhase.OPENING_B]: DebatePhase.REBUTTAL_A,
  [DebatePhase.REBUTTAL_A]: DebatePhase.REBUTTAL_B,
  [DebatePhase.REBUTTAL_B]: DebatePhase.JUDGING,
  [DebatePhase.JUDGING]: DebatePhase.FINISHED,
  [DebatePhase.FINISHED]: undefined,
};

export function nextDebatePhase(phase: DebatePhase): DebatePhase | undefined {
  return NEXT_PHASE[phase];
}

export function canTransition(from: DebatePhase, to: DebatePhase): boolean {
  return NEXT_PHASE[from] === to;
}

export function transitionPhase(state: DebateState, to: DebatePhase): DebateState {
  if (!canTransition(state.phase, to)) {
    throw new Error(`Invalid debate transition: ${state.phase} -> ${to}`);
  }
  return { ...state, phase: to };
}

export function advanceDebate(state: DebateState): DebateState {
  const next = nextDebatePhase(state.phase);
  if (!next) throw new Error("Debate is already finished");
  return transitionPhase(state, next);
}

export function createDebateState(): DebateState {
  return { phase: DebatePhase.CREATED, turns: [] };
}

export const getNextPhase = nextDebatePhase;

export function appendTurn(state: DebateState, turn: DebateTurn): DebateState {
  return { ...state, turns: [...state.turns, turn] };
}

export function attachVerdict(state: DebateState, verdict: DebateVerdict): DebateState {
  return { ...state, phase: DebatePhase.FINISHED, verdict };
}
