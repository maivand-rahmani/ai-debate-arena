import type { DebateTurn } from "../../types";
import clearAData from "./clear-a.json";
import clearBData from "./clear-b.json";
import closeMatchData from "./close-match.json";
import contradictoryAgentData from "./contradictory-agent.json";
import irrelevantArgumentsData from "./irrelevant-arguments.json";
import truncatedEmptyData from "./truncated-empty.json";

/** Stable IDs for the six golden transcripts (v0.2 F3-08 / F9-09 / F7-12). */
export type GoldenFixtureId =
  | "clear-A"
  | "clear-B"
  | "close-match"
  | "contradictory-agent"
  | "irrelevant-arguments"
  | "truncated-empty";

/** Expected judge leaning for the transcript on its own (before fake outputs). */
export type FixtureExpected = "A" | "B" | "DRAW" | "<unjudgable>";

export interface GoldenTranscriptFixture {
  readonly id: GoldenFixtureId;
  readonly topic: string;
  readonly turns: readonly DebateTurn[];
  readonly expected: FixtureExpected;
  readonly notes: string;
}

interface RawTranscriptFile {
  readonly topic: string;
  readonly turns: readonly DebateTurn[];
}

function asTranscript(raw: unknown): RawTranscriptFile {
  return raw as RawTranscriptFile;
}

function defineFixture(
  id: GoldenFixtureId,
  raw: unknown,
  expected: FixtureExpected,
  notes: string,
): GoldenTranscriptFixture {
  const transcript = asTranscript(raw);
  return {
    id,
    topic: transcript.topic,
    turns: transcript.turns,
    expected,
    notes,
  };
}

export const GOLDEN_TRANSCRIPT_FIXTURES: readonly GoldenTranscriptFixture[] = [
  defineFixture(
    "clear-A",
    clearAData,
    "A",
    "Side A argues with data and direct rebuttals while Side B relies on slogans; a sound judge favors A.",
  ),
  defineFixture(
    "clear-B",
    clearBData,
    "B",
    "Side B argues with scale, comparative, and tradeoff evidence while Side A leans on analogy; a sound judge favors B.",
  ),
  defineFixture(
    "close-match",
    closeMatchData,
    "DRAW",
    "Both sides bring trials, mechanisms, and rebuttals; scores should land within the DRAW gap.",
  ),
  defineFixture(
    "contradictory-agent",
    contradictoryAgentData,
    "<unjudgable>",
    "Side A reverses its core economic premise mid-round (expensive pilot vs cheapest option); pins the contradiction, not a winner.",
  ),
  defineFixture(
    "irrelevant-arguments",
    irrelevantArgumentsData,
    "<unjudgable>",
    "Both sides dodge the car-ban topic entirely (pizza vs Mars colony); pins topic-evasion evidence, not a winner.",
  ),
  defineFixture(
    "truncated-empty",
    truncatedEmptyData,
    "<unjudgable>",
    "Capture ends abruptly after a single opening turn; pins truncated/missing-turn handling, not a winner.",
  ),
];

export function getGoldenFixture(id: GoldenFixtureId): GoldenTranscriptFixture {
  const fixture = GOLDEN_TRANSCRIPT_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown golden fixture: ${id}`);
  return fixture;
}
