import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceCapturePanel } from "./source-capture-panel";
import type { MatchRecord } from "@/shared/api/matches";

describe("SourceCapturePanel", () => {
  it("keeps capture explicit and explains its untrusted provenance", () => {
    const html = renderToStaticMarkup(<SourceCapturePanel record={{ matchId: "m-1" } as MatchRecord} onCaptured={vi.fn()} />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("HTTPS source");
    expect(html).toContain("fetched once");
    expect(html).toContain("untrusted and unverified");
    expect(html).toContain("Snapshot-only capture");
  });
});
