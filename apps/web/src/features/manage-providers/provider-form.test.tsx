/**
 * Form-level tests for the provider add/edit flow.
 *
 * The form is rendered through `renderToStaticMarkup` to keep the test
 * environment DOM-free (matching the rest of the suite). The tests
 * focus on the user-visible contract: required labels, error rendering
 * for each field, and the payload that gets emitted.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderForm } from "./provider-form";
import { draftFromProvider, emptyProviderDraft } from "./provider-actions";
import type { RedactedProvider } from "@/shared/api/providers";

const stub: RedactedProvider = {
  id: "alpha",
  name: "Alpha",
  baseUrl: "https://alpha.example/v1",
  model: "alpha-default",
  api: "chat",
  apiKeyHint: "alph••••••••lpha",
};

describe("ProviderForm (create)", () => {
  it("renders the id field only on create", () => {
    const createHtml = renderToStaticMarkup(
      <ProviderForm
        mode="create"
        initial={emptyProviderDraft()}
        submitLabel="Connect"
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(createHtml).toContain("Id");
    expect(createHtml).toContain("Display name");
    expect(createHtml).toContain("Base URL");
    expect(createHtml).toContain("Default model");
    expect(createHtml).toContain("API type");
    expect(createHtml).toContain("API key");
    expect(createHtml).not.toContain("Leave empty to keep the current key");
  });

  it("does not allow submit when the draft is incomplete (button is disabled)", () => {
    const html = renderToStaticMarkup(
      <ProviderForm
        mode="create"
        initial={emptyProviderDraft()}
        submitLabel="Connect"
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    // The button is rendered with a `disabled` attribute when the form
    // is not ready; submitting an empty draft should be blocked.
    expect(html).toMatch(/<button[^>]+disabled[^>]*>\s*<span>Connect<\/span>/);
  });
});

describe("ProviderForm (edit)", () => {
  it("hides the id field and shows the keep-current key affordance", () => {
    const html = renderToStaticMarkup(
      <ProviderForm
        mode="edit"
        initial={draftFromProvider(stub)}
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    // The id input should not be rendered in edit mode.
    expect(html).not.toMatch(/<label[^>]*>\s*<span>Id<\/span>/);
    // The "leave empty" hint should be present.
    expect(html).toContain("Leave empty to keep the current key");
    // Pre-populated values from the redacted record.
    expect(html).toContain("Alpha");
    expect(html).toContain("https://alpha.example/v1");
    expect(html).toContain("alpha-default");
  });

  it("shows server-side issues next to the matching field", () => {
    const html = renderToStaticMarkup(
      <ProviderForm
        mode="edit"
        initial={draftFromProvider(stub)}
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() => undefined}
        serverIssues={[
          { field: "baseUrl", message: "baseUrl must use http or https" },
          { field: "ghost", message: "Unknown field" },
        ]}
      />,
    );
    expect(html).toContain("baseUrl must use http or https");
    // Generic issues (unrecognised field) are still surfaced somewhere.
    expect(html).toContain("Unknown field");
  });
});
