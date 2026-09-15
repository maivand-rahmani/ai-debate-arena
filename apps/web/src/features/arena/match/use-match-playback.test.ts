import { describe, expect, it } from "vitest";
import { shouldIgnorePlaybackShortcutTarget } from "./use-match-playback";

function targetFor(selector: string): Pick<HTMLElement, "closest"> {
  return { closest: (query: string) => query.includes(selector) ? {} as HTMLElement : null };
}

describe("playback keyboard target filtering", () => {
  it("leaves dialog keys to the open dialog", () => {
    expect(shouldIgnorePlaybackShortcutTarget(targetFor('[role="dialog"]'))).toBe(true);
  });

  it("still leaves form and editable control keys alone", () => {
    expect(shouldIgnorePlaybackShortcutTarget(targetFor("textarea"))).toBe(true);
    expect(shouldIgnorePlaybackShortcutTarget(targetFor("[contenteditable=\"true\"]"))).toBe(true);
  });

  it("handles the page surface when no target is available", () => {
    expect(shouldIgnorePlaybackShortcutTarget(null)).toBe(false);
  });
});
