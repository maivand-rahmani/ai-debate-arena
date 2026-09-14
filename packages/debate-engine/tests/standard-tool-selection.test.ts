import { describe, expect, it } from "vitest";
import { createDebateState } from "../src/state";
import { buildStandardAgentActionPrompt, buildStandardAgentSystemPrompt } from "../src/prompts/agent-prompt";
import {
  parseStandardAgentAction,
  standardAgentActionSchema,
  standardToolInputFor,
} from "../src/standard";
import { runDebate } from "../src/runner";

const verdictJson = JSON.stringify({
  winner: "A",
  scoreA: 82,
  scoreB: 74,
  criteria: {
    argumentQualityA: 85,
    argumentQualityB: 75,
    rebuttalA: 80,
    rebuttalB: 72,
    consistencyA: 83,
    consistencyB: 74,
    relevanceA: 84,
    relevanceB: 73,
  },
  reasoning: "A had stronger arguments",
});

const noopSave = async (): Promise<void> => {};

describe("Standard action parsing for all tools", () => {
  it("accepts web_search, fetch_url, and run_code actions", () => {
    expect(parseStandardAgentAction('{"action":"tool","tool":"web_search","query":"housing data"}')).toMatchObject({
      tool: "web_search",
      query: "housing data",
    });
    expect(parseStandardAgentAction('{"action":"tool","tool":"fetch_url","query":"https://example.com/report"}')).toMatchObject({
      tool: "fetch_url",
      query: "https://example.com/report",
    });
    expect(parseStandardAgentAction('{"action":"tool","tool":"run_code","language":"python","query":"print(6*7)"}')).toMatchObject({
      tool: "run_code",
      language: "python",
      query: "print(6*7)",
    });
  });

  it("requires a supported language for run_code", () => {
    expect(standardAgentActionSchema.safeParse({ action: "tool", tool: "run_code", query: "print(1)" }).success).toBe(false);
    expect(
      standardAgentActionSchema.safeParse({ action: "tool", tool: "run_code", language: "ruby", query: "print(1)" }).success,
    ).toBe(false);
  });

  it("maps actions onto executor inputs, keeping language for run_code only", () => {
    const web = parseStandardAgentAction('{"action":"tool","tool":"web_search","query":"housing data"}');
    if (web.action !== "tool") throw new Error("expected tool action");
    expect(standardToolInputFor(web)).toEqual({ query: "housing data" });

    const run = parseStandardAgentAction('{"action":"tool","tool":"run_code","language":"javascript","query":"1+1"}');
    if (run.action !== "tool") throw new Error("expected tool action");
    expect(standardToolInputFor(run)).toEqual({ query: "1+1", language: "javascript" });
  });
});

describe("Standard agent prompt tool loadout", () => {
  it("advertises web_search, fetch_url, and run_code as tools with an internal speak termination", () => {
    const system = buildStandardAgentSystemPrompt("A", "FOR", "Should cities restrict short-term rentals?");
    expect(system).toContain("web_search");
    expect(system).toContain("fetch_url");
    expect(system).toContain("run_code");
    expect(system).toContain("speak tool");

    const prompt = buildStandardAgentActionPrompt(
      "Should cities restrict short-term rentals?",
      createDebateState(),
      "A",
      "FOR",
      [],
      { credits: 12, maxToolCalls: 2 },
    );
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("fetch_url");
    expect(prompt).toContain("run_code");
    expect(prompt).toContain("speak tool");
    // Tool-use instructions must not fall back to JSON action shapes.
    expect(prompt).not.toContain('"action":"tool"');
  });

  it("directs a forced speak to the speak tool without tool options", () => {
    const prompt = buildStandardAgentActionPrompt(
      "Topic",
      createDebateState(),
      "A",
      "FOR",
      [],
      { credits: 1, maxToolCalls: 0, forceSpeak: true },
    );
    expect(prompt).toContain("Call the speak tool now");
    expect(prompt).not.toContain('"action":"tool"');
  });
});

describe("Quick is unaffected by the Standard tool wiring", () => {
  it("keeps the fixed six-turn Quick event order", async () => {
    const types: string[] = [];
    for await (const event of runDebate(
      {
        topic: "Should AI be regulated?",
        mode: "quick",
        agentA: { providerId: "p1", model: "m1", position: "FOR" },
        agentB: { providerId: "p2", model: "m2", position: "AGAINST" },
      },
      {
        saveMatch: noopSave,
        callModel: async (args) => {
          if (args.kind === "judge") return { text: verdictJson, chunks: [] };
          return { text: "quick speech", chunks: ["chunk"] };
        },
      },
    )) {
      types.push(event.type);
    }
    expect(types.filter((type) => type === "turn")).toHaveLength(6);
    expect(types.at(-1)).toBe("done");
  });
});
