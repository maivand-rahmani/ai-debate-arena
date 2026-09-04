/**
 * Pure helpers for the match-creation form.
 *
 * Extracted from the React component so they are easy to unit-test and so the
 * UI can stay focused on presentation.
 */

import type { RedactedProvider } from "@/shared/api/providers";

export type Position = "FOR" | "AGAINST";
export type MatchMode = "quick" | "standard" | "hardcore";

export interface MatchDraft {
  readonly topic: string;
  readonly mode: MatchMode;
  readonly sideA: AgentDraft;
  readonly sideB: AgentDraft;
}

export interface AgentDraft {
  readonly providerId: string;
  readonly model: string;
  readonly position: Position;
}

export const TOPIC_MAX_LENGTH = 140;

export const MODE_OPTIONS: readonly { readonly id: MatchMode; readonly label: string; readonly hint: string; readonly enabled: boolean }[] = [
  { id: "quick", label: "Quick", hint: "Crisp single-round clash.", enabled: true },
  { id: "standard", label: "Standard", hint: "Longer turns, deeper context.", enabled: false },
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
  if (draft.mode !== "quick") {
    issues.push({ field: "mode", message: "Only Quick mode is available right now." });
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
  if (draft.sideA.providerId && draft.sideB.providerId && draft.sideA.providerId === draft.sideB.providerId && draft.sideA.model === draft.sideB.model) {
    issues.push({ field: "sameModel", message: "Two identical models rarely produce a debate. Pick a contrasting second voice." });
  }
  return issues;
}

export function isDraftReady(draft: MatchDraft): boolean {
  return validateDraft(draft).length === 0;
}
