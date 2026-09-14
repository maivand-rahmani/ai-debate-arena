/**
 * Pure helpers for the match-creation form.
 *
 * Extracted from the React component so they are easy to unit-test and so the
 * UI can stay focused on presentation.
 */

import type { RedactedProvider } from "@/shared/api/providers";
import type { DebateStreamRequest } from "@/shared/api/debate-stream";
import type { StandardLimitsInput } from "@arena/debate-engine";
import type { MatchMode } from "@arena/types";

export type { MatchMode };

export type Position = "FOR" | "AGAINST";

/**
 * Standard-only budget controls collected in the setup form. Tool timeout is
 * kept in milliseconds for the UI; {@link toDebateRequest} converts it to the
 * shared engine's whole-second wire field.
 */
export interface StandardLimitsDraft {
  readonly startingCredits?: number;
  readonly maxToolsPerMove?: number;
  readonly toolTimeoutMs?: number;
}

export interface MatchDraft {
  readonly topic: string;
  readonly mode: MatchMode;
  readonly sideA: AgentDraft;
  readonly sideB: AgentDraft;
  /** Present only for a configured Standard match; otherwise server defaults. */
  readonly standard?: StandardLimitsDraft;
}

export interface AgentDraft {
  readonly providerId: string;
  readonly model: string;
  readonly position: Position;
}

export const TOPIC_MAX_LENGTH = 140;

export const MODE_OPTIONS: readonly { readonly id: MatchMode; readonly label: string; readonly hint: string; readonly enabled: boolean }[] = [
  { id: "quick", label: "Quick", hint: "Six focused turns. Start watching right away.", enabled: true },
  { id: "standard", label: "Standard", hint: "Open-ended play. Agents research, adapt, and show evidence.", enabled: true },
  { id: "hardcore", label: "Hardcore", hint: "Strict budget, no slack.", enabled: false },
];

export function emptyDraft(): MatchDraft {
  return {
    topic: "",
    mode: "quick",
    sideA: { providerId: "", model: "", position: "FOR" },
    sideB: { providerId: "", model: "", position: "AGAINST" },
  };
}

export function providerFor(providers: readonly RedactedProvider[], id: string): RedactedProvider | undefined {
  return providers.find((provider) => provider.id === id);
}

/** A same-model matchup is a useful control case, not a validation error. */
export function isSameModelMatchup(draft: MatchDraft): boolean {
  return Boolean(
    draft.sideA.providerId &&
      draft.sideB.providerId &&
      draft.sideA.providerId === draft.sideB.providerId &&
      draft.sideA.model.trim() &&
      draft.sideA.model === draft.sideB.model,
  );
}

/**
 * When the user changes a side's position, auto-mirror the opposite side. The
 * caller can opt out by passing `mirror: false` (e.g. when re-syncing after a
 * provider change).
 */
export function applyPositionChange(draft: MatchDraft, side: "A" | "B", position: Position, mirror = true): MatchDraft {
  if (side === "A") {
    const nextB = mirror && position === "FOR" ? "AGAINST" : mirror && position === "AGAINST" ? "FOR" : draft.sideB.position;
    return {
      ...draft,
      sideA: { ...draft.sideA, position },
      sideB: { ...draft.sideB, position: nextB },
    };
  }
  const nextA = mirror && position === "FOR" ? "AGAINST" : mirror && position === "AGAINST" ? "FOR" : draft.sideA.position;
  return {
    ...draft,
    sideB: { ...draft.sideB, position },
    sideA: { ...draft.sideA, position: nextA },
  };
}

export function applyProviderChange(
  draft: MatchDraft,
  side: "A" | "B",
  providerId: string,
  providers: readonly RedactedProvider[],
): MatchDraft {
  const target = side === "A" ? draft.sideA : draft.sideB;
  const provider = providerFor(providers, providerId);
  const previous = providerFor(providers, target.providerId);
  // Only overwrite the model when it is empty or merely the previous
  // provider's auto-filled default. A user-typed model must survive
  // provider dropdown changes.
  const isCustomModel =
    target.model.trim().length > 0 && (previous === undefined || target.model !== previous.model);
  const nextModel = isCustomModel ? target.model : provider?.model ?? target.model;
  if (side === "A") {
    return { ...draft, sideA: { ...target, providerId, model: nextModel } };
  }
  return { ...draft, sideB: { ...target, providerId, model: nextModel } };
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export function validateDraft(draft: MatchDraft): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (draft.topic.trim().length === 0) {
    issues.push({ field: "topic", message: "Pick a motion for the agents to argue." });
  }
  if (draft.topic.length > TOPIC_MAX_LENGTH) {
    issues.push({ field: "topic", message: `Keep it under ${TOPIC_MAX_LENGTH} characters.` });
  }
  if (draft.mode === "hardcore") {
    issues.push({ field: "mode", message: "Hardcore mode is not available yet." });
  }
  for (const side of ["A", "B"] as const) {
    const agent = side === "A" ? draft.sideA : draft.sideB;
    if (!agent.providerId) {
      issues.push({ field: `side${side}.providerId`, message: `Agent ${side} needs a provider.` });
    }
    if (!agent.model.trim()) {
      issues.push({ field: `side${side}.model`, message: `Agent ${side} needs a model.` });
    }
  }
  return issues;
}

/**
 * Builds the `POST /api/debate` request for a draft.
 *
 * Standard budget overrides are attached only for Standard, and only the
 * fields the shared engine understands: the engine contract takes whole
 * seconds, so the UI's milliseconds are converted here. Quick and Hardcore
 * request bodies stay exactly as before.
 */
export function toDebateRequest(draft: MatchDraft): DebateStreamRequest {
  return {
    topic: draft.topic.trim(),
    mode: draft.mode,
    agentA: {
      providerId: draft.sideA.providerId,
      model: draft.sideA.model,
      position: draft.sideA.position,
    },
    agentB: {
      providerId: draft.sideB.providerId,
      model: draft.sideB.model,
      position: draft.sideB.position,
    },
    ...(draft.mode === "standard" && draft.standard ? { standardLimits: toStandardLimits(draft.standard) } : {}),
  };
}

/** Maps the UI's millisecond timeout onto the engine's whole-second field. */
function toStandardLimits(standard: StandardLimitsDraft): StandardLimitsInput {
  const limits: {
    startingCredits?: number;
    maxToolsPerMove?: number;
    toolTimeoutSeconds?: number;
  } = {};
  if (typeof standard.startingCredits === "number") limits.startingCredits = standard.startingCredits;
  if (typeof standard.maxToolsPerMove === "number") limits.maxToolsPerMove = standard.maxToolsPerMove;
  if (typeof standard.toolTimeoutMs === "number") {
    limits.toolTimeoutSeconds = Math.round(standard.toolTimeoutMs / 1_000);
  }
  return limits;
}

export function isDraftReady(draft: MatchDraft): boolean {
  return validateDraft(draft).length === 0;
}
