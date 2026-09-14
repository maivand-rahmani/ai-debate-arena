/** Render smoke tests for the public idle and setup entry points. */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IdleHero } from "./idle-hero";
import { SetupModal } from "./setup-modal";
import { RecentMatchesModal } from "./recent-matches-modal";

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
  it("renders the title, CTA, and history link", () => {
    const html = renderToStaticMarkup(
      <IdleHero onStart={() => undefined} onOpenHistory={() => undefined} recentCount={3} />,
    );
    expect(html).toContain("AI Debate Arena");
    expect(html).toContain("Start match");
    expect(html).toContain("Open history");
    expect(html).toContain("Open history · 3");
  });

  it("hides the count when there are no recent matches", () => {
    const html = renderToStaticMarkup(
      <IdleHero onStart={() => undefined} onOpenHistory={() => undefined} recentCount={0} />,
    );
    expect(html).toContain("Open history");
    expect(html).not.toContain("Open history · 0");
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
    const html = renderToStaticMarkup(<RecentMatchesModal open onClose={() => undefined} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Loading recent matches");
  });
});
