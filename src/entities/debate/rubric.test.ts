import { describe, expect, it } from "vitest";
import { AGENT_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "./prompt";
import { buildDebatePrompt, buildPromptContext } from "./prompt";
import { buildAgentSystemPrompt, buildJudgePrompt } from "./prompts";
import {
  buildCriteriaFieldList,
  buildRubricPhrase,
  JUDGE_RUBRIC_CRITERIA,
  RUBRIC_VERSION,
  RUBRIC_VERSIONS,
} from "./rubric";
import { DebatePhase, type DebateTurn } from "./types";
import { createDebateState } from "./state";

const TURNS: readonly DebateTurn[] = [
  {
    id: "t1",
    agentId: "A",
    side: "A",
    phase: DebatePhase.OPENING_A,
    content: "Regulation protects people.",
    model: "m1",
    createdAt: "2026-01-01T00:00:10.000Z",
  },
  {
    id: "t2",
    agentId: "B",
    side: "B",
    phase: DebatePhase.OPENING_B,
    content: "Regulation stifles progress.",
    model: "m2",
    createdAt: "2026-01-01T00:00:20.000Z",
  },
];

// Stored snapshot: the composed judge prompt must remain byte-identical.
// If wording changes intentionally, bump JUDGE_PROMPT_VERSION/RUBRIC_VERSION
// and update this snapshot in the same change.
const JUDGE_PROMPT_SNAPSHOT = [
  'You are the judge of a formal debate on the topic: "Should AI be regulated?".',
  "Full transcript:",
  "[A / OPENING_A]: Regulation protects people.\n\n[B / OPENING_B]: Regulation stifles progress.",
  "Compare both sides and score each side as an integer 0-100 for scoreA and scoreB using this rubric: argument quality, rebuttal quality, consistency, relevance.",
  "Also provide criteria as integers 0-100 each: argumentQualityA, argumentQualityB, rebuttalA, rebuttalB, consistencyA, consistencyB, relevanceA, relevanceB.",
  "Set winner from the scores: the higher score wins (A if scoreA is higher, B if scoreB is higher). Use DRAW only when the scores are within 2 points of each other.",
  "Never return 0 for any score unless the transcript is empty; a debated round must have non-zero scores that reflect the comparison.",
  "Respond with STRICT JSON only, no markdown, no extra text, matching this shape with concrete numbers, for example:",
  '{"winner":"A","scoreA":78,"scoreB":64,"criteria":{"argumentQualityA":80,"argumentQualityB":66,"rebuttalA":76,"rebuttalB":62,"consistencyA":79,"consistencyB":65,"relevanceA":78,"relevanceB":63},"reasoning":"..."}',
].join("\n\n");

describe("prompt/rubric versioning", () => {
  it("pins prompt and rubric versions to 1", () => {
    expect(AGENT_PROMPT_VERSION).toBe("1");
    expect(JUDGE_PROMPT_VERSION).toBe("1");
    expect(RUBRIC_VERSION).toBe("1");
  });

  it("builds the judge prompt byte-identically from the rubric", () => {
    expect(buildJudgePrompt("Should AI be regulated?", TURNS)).toBe(JUDGE_PROMPT_SNAPSHOT);
  });

  it("exposes the rubric criteria behind the composed sentences", () => {
    expect(buildRubricPhrase()).toBe("argument quality, rebuttal quality, consistency, relevance");
    expect(buildCriteriaFieldList()).toBe(
      "argumentQualityA, argumentQualityB, rebuttalA, rebuttalB, consistencyA, consistencyB, relevanceA, relevanceB",
    );
    expect(JUDGE_RUBRIC_CRITERIA.map((criterion) => criterion.key)).toEqual([
      "argumentQuality",
      "rebuttal",
      "consistency",
      "relevance",
    ]);
  });

  it("leaves the agent prompt builders untouched", () => {    const system = buildAgentSystemPrompt("A", "FOR", "Should AI be regulated?");
    expect(system).toContain('debater A');
    const state = createDebateState();
    const context = buildPromptContext(
      { topic: "T", agents: { A: { id: "A", name: "Agent A" }, B: { id: "B", name: "Agent B" } } },
      state,
      "A",
    );
    expect(buildDebatePrompt(context)).toContain("(no previous turns)");
  });
});

describe("versioned rubrics (F3-07/F9-07)", () => {
  it("exposes rubric generations 1 and 2 with default 1", () => {
    expect(RUBRIC_VERSION).toBe("1");
    expect(Object.keys(RUBRIC_VERSIONS).sort()).toEqual(["1", "2"]);
    expect(RUBRIC_VERSIONS["1"].extraGuidance).toEqual([]);
    expect(RUBRIC_VERSIONS["2"].extraGuidance.length).toBeGreaterThan(0);
  });

  it("builds the v1 prompt byte-identically, explicitly or by default", () => {
    const topic = "Should AI be regulated?";
    expect(buildJudgePrompt(topic, TURNS)).toBe(JUDGE_PROMPT_SNAPSHOT);
    expect(buildJudgePrompt(topic, TURNS, { rubricVersion: "1" })).toBe(JUDGE_PROMPT_SNAPSHOT);
  });

  it("renders v2 with band anchors, rebuttal emphasis, and the draw policy", () => {
    const prompt = buildJudgePrompt("Should AI be regulated?", TURNS, { rubricVersion: "2" });
    expect(prompt).toContain("90 or above means exceptional");
    expect(prompt).toContain("70-89 means solid");
    expect(prompt).toContain("50-69 means adequate");
    expect(prompt).toContain("below 50 means weak");
    expect(prompt).toContain("must score below 50 for rebuttal");
    expect(prompt).toContain("within 2 points of each other");
    expect(prompt).toContain("never award A or B on a gap of 2 or less");
    expect(prompt).not.toBe(JUDGE_PROMPT_SNAPSHOT);
  });
});
