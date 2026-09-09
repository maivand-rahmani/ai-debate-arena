/**
 * Render smoke tests for the new idle surface — covers the minimal
 * hero, the setup-modal shape, and the recent-matches rows. Keeps
 * the public markup contract testable without DOM snapshots.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IdleHero } from "./idle-hero";
import { SetupModal } from "./setup-modal";
import { RecentMatchesModal } from "./recent-matches-modal";

// Stub fetch so the recent-matches modal's mount-time fetch doesn't
// explode in the unit test environment.
beforeAll(() => {
  vi.stubGlobal("fetch", (async () =>
    new Response(JSON.stringify({ matches: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("IdleHero", () => {
  it("renders the title, CTA, and recent-matches link", () => {
    const html = renderToStaticMarkup(
      <IdleHero onStart={() => undefined} onOpenHistory={() => undefined} recentCount={3} />,
    );
    expect(html).toContain("AI Debate Arena");
    expect(html).toContain("Start new debate");
    expect(html).toContain("Recent matches");
    expect(html).toContain("Recent matches · 3");
  });

  it("hides the count when there are no recent matches", () => {
    const html = renderToStaticMarkup(
      <IdleHero onStart={() => undefined} onOpenHistory={() => undefined} recentCount={0} />,
    );
    expect(html).toContain("Recent matches");
    expect(html).not.toContain("Recent matches · 0");
  });
});

describe("SetupModal", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <SetupModal open={false} onClose={() => undefined} onStart={() => undefined} />,
    );
    expect(html).toBe("");
  });
});

describe("RecentMatchesModal", () => {
  it("renders the loading state immediately on open", () => {
    const html = renderToStaticMarkup(
      <RecentMatchesModal open onClose={() => undefined} />,
    );
    // The dialog chrome + the loading text.
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Loading recent matches");
  });
});
