import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchActions } from "./match-actions";

describe("MatchActions", () => {
  it("keeps export failures separate from re-judge failures", () => {
    const html = renderToStaticMarkup(
      <MatchActions
        matchId="match-1"
        rejudgeStatus="idle"
        canRejudge
        exportError="The saved record could not be downloaded."
        onExportJson={() => undefined}
        onRejudge={() => undefined}
      />,
    );
    expect(html).toContain("Could not export: The saved record could not be downloaded.");
    expect(html).not.toContain("Could not re-judge:");
  });

  it("reports a refresh failure without claiming re-judge failed", () => {
    const html = renderToStaticMarkup(
      <MatchActions
        matchId="match-1"
        rejudgeStatus="idle"
        canRejudge
        refreshError="The refreshed record is unavailable."
        onExportJson={() => undefined}
        onRejudge={() => undefined}
      />,
    );
    expect(html).toContain("Re-judge succeeded, but the refreshed match could not be loaded");
    expect(html).not.toContain("Could not re-judge:");
  });

  it("keeps export busy state independent from re-judge status", () => {
    const html = renderToStaticMarkup(
      <MatchActions
        matchId="match-1"
        rejudgeStatus="idle"
        exportStatus="flying"
        canRejudge
        onExportJson={() => undefined}
        onRejudge={() => undefined}
      />,
    );
    expect(html).toContain("Exporting…");
    expect(html).toContain("disabled");
    expect(html).toContain("Re-judge");
  });
});
