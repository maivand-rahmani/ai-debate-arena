import { describe, expect, it } from "vitest";
import {
  CONTENDER_POSES,
  JUDGE_POSES,
  VERDICT_REACTIONS,
  blendPoseOffsets,
} from "./character-poses";
import type { ContenderMood, JudgeMood } from "@/widgets/broadcast-stage/mood";

describe("CONTENDER_POSES", () => {
  const MOODS: ContenderMood[] = [
    "thinking",
    "speaking",
    "listening",
    "confident",
    "heated",
    "confused",
    "impressed",
    "victorious",
    "defeated",
    "panicking",
  ];

  it("covers every contender mood", () => {
    for (const mood of MOODS) {
      expect(CONTENDER_POSES[mood]).toBeDefined();
      expect(CONTENDER_POSES[mood].label).toBe(mood);
    }
  });

  it("speaking has the largest mouth pulse amplitude", () => {
    const amp = (m: ContenderMood) => CONTENDER_POSES[m].mouthAmp;
    const hz = (m: ContenderMood) => CONTENDER_POSES[m].mouthPulseHz;
    expect(amp("speaking")).toBeGreaterThanOrEqual(amp("thinking"));
    expect(amp("speaking")).toBeGreaterThanOrEqual(amp("listening"));
    expect(hz("speaking")).toBeGreaterThan(hz("listening"));
  });

  it("listening tilts the head (non-zero tilt)", () => {
    expect(CONTENDER_POSES.listening.headTilt).not.toBe(0);
    expect(CONTENDER_POSES.speaking.headTilt).toBe(0);
  });

  it("victorious slumps down and defeated lifts the head to read in silhouette", () => {
    expect(CONTENDER_POSES.victorious.headYOffset).toBeLessThan(0);
    expect(CONTENDER_POSES.defeated.headYOffset).toBeGreaterThan(0);
  });

  it("heated brows (negative lift) are lower than calm", () => {
    expect(CONTENDER_POSES.heated.browLift).toBeLessThan(0);
    expect(CONTENDER_POSES.speaking.browLift).toBe(0);
  });
});

describe("JUDGE_POSES", () => {
  const MOODS: JudgeMood[] = [
    "standing-by",
    "evaluating",
    "revealed",
    "impressed",
    "not-impressed",
    "stoic",
    "dismayed",
  ];

  it("covers every judge mood", () => {
    for (const mood of MOODS) {
      expect(JUDGE_POSES[mood]).toBeDefined();
      expect(JUDGE_POSES[mood].label).toBe(mood);
    }
  });

  it("evaluating has a meaningful brow furrow (working mood)", () => {
    expect(JUDGE_POSES.evaluating.browFurrow).toBeGreaterThan(JUDGE_POSES["standing-by"].browFurrow);
  });

  it("dismayed is the heaviest brow + largest head offset among negative moods", () => {
    expect(JUDGE_POSES.dismayed.browFurrow).toBeGreaterThan(JUDGE_POSES.stoic.browFurrow);
    expect(JUDGE_POSES.dismayed.headYOffset).toBeGreaterThan(JUDGE_POSES.stoic.headYOffset);
  });
});

describe("VERDICT_REACTIONS", () => {
  it("winner bounces up (down Y offset + high breath + loud mouth)", () => {
    expect(VERDICT_REACTIONS.winner.headYOffset).toBeLessThan(0);
    expect(VERDICT_REACTIONS.winner.breathScale).toBeGreaterThan(1.5);
    expect(VERDICT_REACTIONS.winner.mouthAmp).toBeGreaterThan(1.0);
  });

  it("loser slumps down (positive Y, low breath, quiet mouth)", () => {
    expect(VERDICT_REACTIONS.loser.headYOffset).toBeGreaterThan(0);
    expect(VERDICT_REACTIONS.loser.breathScale).toBeLessThan(0.5);
    expect(VERDICT_REACTIONS.loser.mouthAmp).toBe(0);
  });

  it("draw sits between the two extremes", () => {
    const d = VERDICT_REACTIONS.draw;
    expect(d.headYOffset).toBeGreaterThan(VERDICT_REACTIONS.winner.headYOffset);
    expect(d.headYOffset).toBeLessThan(VERDICT_REACTIONS.loser.headYOffset);
  });
});

describe("blendPoseOffsets", () => {
  const base = { headYOffset: 0.01, browLift: 0.0 };
  const burst = VERDICT_REACTIONS.winner;

  it("at t=0 returns the base pose", () => {
    const blend = blendPoseOffsets(base, burst, 0);
    expect(blend.headYOffset).toBeCloseTo(base.headYOffset, 5);
    expect(blend.browLift).toBeCloseTo(base.browLift, 5);
  });

  it("at t=1 returns the burst pose", () => {
    const blend = blendPoseOffsets(base, burst, 1);
    expect(blend.headYOffset).toBeCloseTo(burst.headYOffset, 5);
    expect(blend.browLift).toBeCloseTo(burst.browLift, 5);
  });

  it("clamps t into the 0..1 range", () => {
    const over = blendPoseOffsets(base, burst, 2);
    expect(over.headYOffset).toBeCloseTo(burst.headYOffset, 5);
    const under = blendPoseOffsets(base, burst, -1);
    expect(under.headYOffset).toBeCloseTo(base.headYOffset, 5);
  });
});
