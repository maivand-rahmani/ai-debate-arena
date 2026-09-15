import { describe, expect, it } from "vitest";
import type { DebateStreamEvent } from "@/shared/api/debate-stream";
import {
  acceptStandardRevealEvent,
  initialStandardRevealGate,
  releaseNextStandardResponse,
} from "./use-debate-stream";

function phase(id: string, side: "A" | "B"): DebateStreamEvent {
  return { type: "phase", phase: id, side };
}

function toolStart(callId: string, side: "A" | "B"): DebateStreamEvent {
  return {
    type: "tool-start",
    tool: { callId, side, tool: "web_search", query: callId, createdAt: callId },
  };
}

function toolResult(callId: string, side: "A" | "B"): DebateStreamEvent {
  return {
    type: "tool-result",
    result: { callId, side, tool: "web_search", query: callId, ok: true, output: `${callId} result`, createdAt: callId },
  };
}

function failedToolResult(callId: string, side: "A" | "B"): DebateStreamEvent {
  return {
    type: "tool-result",
    result: {
      callId,
      side,
      tool: "web_search",
      query: callId,
      ok: false,
      output: "The public lookup failed",
      error: "Source unavailable",
      createdAt: callId,
    },
  };
}

function token(side: "A" | "B", text: string): DebateStreamEvent {
  return { type: "token", side, text };
}

function turn(id: string, side: "A" | "B"): DebateStreamEvent {
  return {
    type: "turn",
    turn: { id, side, phase: id, content: `${id} speech`, model: "model", createdAt: id },
  };
}

describe("Standard spectator reveal gate", () => {
  it("pauses immediately after a public turn seals", () => {
    const phaseDecision = acceptStandardRevealEvent(
      initialStandardRevealGate,
      phase("standard-a-opening", "A"),
    );
    const turnDecision = acceptStandardRevealEvent(
      phaseDecision.gate,
      turn("standard-a-opening", "A"),
    );
    const buffered = acceptStandardRevealEvent(
      turnDecision.gate,
      phase("standard-b-opening", "B"),
    );

    expect(turnDecision.visible.map((event) => event.type)).toEqual(["turn"]);
    expect(turnDecision.gate.paused).toBe(true);
    expect(buffered.visible).toEqual([phase("standard-b-opening", "B")]);
    expect(buffered.gate.buffered).toEqual([]);
  });

  it("keeps public tool activity visible while the next speech stays paused", () => {
    const gate = acceptStandardRevealEvent(
      acceptStandardRevealEvent(initialStandardRevealGate, turn("a", "A")).gate,
      phase("standard-b-round-1", "B"),
    ).gate;
    const started = acceptStandardRevealEvent(gate, toolStart("b-tool", "B"));
    const failed = acceptStandardRevealEvent(started.gate, failedToolResult("b-tool", "B"));
    const words = acceptStandardRevealEvent(failed.gate, token("B", "Public words"));

    expect(started.visible.map((event) => event.type)).toEqual(["tool-start"]);
    expect(failed.visible.map((event) => event.type)).toEqual(["tool-result"]);
    expect(failed.visible[0]?.type === "tool-result" && failed.visible[0].result.ok).toBe(false);
    expect(words.visible).toEqual([]);
    expect(words.gate.buffered).toEqual([token("B", "Public words")]);
  });

  it("flushes one complete response block in arrival order", () => {
    let gate = acceptStandardRevealEvent(initialStandardRevealGate, turn("a", "A")).gate;
    for (const event of [
      phase("standard-b-round-1", "B"),
      toolStart("b-tool", "B"),
      toolResult("b-tool", "B"),
      token("B", "Public words"),
      turn("standard-b-round-1", "B"),
    ]) {
      gate = acceptStandardRevealEvent(gate, event).gate;
    }

    const release = releaseNextStandardResponse(gate);
    expect(release.visible.map((event) => event.type)).toEqual(["token", "turn"]);
    expect(release.gate.buffered).toEqual([]);
    expect(release.gate.paused).toBe(true);
  });

  it("makes a single next-response activation release only one block", () => {
    let gate = acceptStandardRevealEvent(initialStandardRevealGate, turn("a", "A")).gate;
    for (const event of [
      phase("standard-b-round-1", "B"),
      turn("standard-b-round-1", "B"),
      phase("standard-a-round-2", "A"),
    ]) {
      gate = acceptStandardRevealEvent(gate, event).gate;
    }

    const first = releaseNextStandardResponse(gate);
    const second = releaseNextStandardResponse(first.gate);
    expect(first.visible.map((event) => event.type)).toEqual(["turn"]);
    expect(second.visible).toEqual([]);
    expect(second.gate.buffered).toEqual([]);
  });

  it("flushes buffered events when a terminal event arrives", () => {
    let gate = acceptStandardRevealEvent(initialStandardRevealGate, turn("a", "A")).gate;
    gate = acceptStandardRevealEvent(gate, phase("standard-b-round-1", "B")).gate;
    const terminal = acceptStandardRevealEvent(gate, { type: "error", message: "Provider stopped" });

    expect(terminal.visible.map((event) => event.type)).toEqual(["error"]);
    expect(terminal.gate).toEqual(initialStandardRevealGate);
    expect(acceptStandardRevealEvent(terminal.gate, { type: "done", terminal: "error" }).visible).toEqual([
      { type: "done", terminal: "error" },
    ]);
  });
});
