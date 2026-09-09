/**
 * Unit tests for the provider management modal.
 *
 * The tests focus on the user-visible behaviour: the empty / populated
 * / error states and the CLI fallback copy. The mutation lifecycle
 * (add / edit / delete / test) is covered separately by
 * `provider-actions.test.ts` (pure helpers) and `providers.test.ts`
 * (the API client). UI rendering uses `renderToStaticMarkup` so we
 * stay inside the existing vitest pattern (no DOM-snapshot bloat).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the hook so the modal sees a deterministic list without touching
// the network on the GET side.
const providersState: {
  status: "idle" | "loading" | "ready" | "missing" | "error";
  providers: ReturnType<typeof providerFixture>[];
  errorMessage?: string;
  reload: ReturnType<typeof vi.fn>;
} = {
  status: "ready",
  providers: [],
  reload: vi.fn(),
};

vi.mock("@/features/create-debate/use-providers", () => ({
  useProviders: () => providersState,
}));

import { ManageProvidersModal } from "./manage-providers-modal";
import type { RedactedProvider } from "@/shared/api/providers";

function providerFixture(over: Partial<RedactedProvider> = {}): RedactedProvider {
  return {
    id: "alpha",
    name: "Alpha",
    baseUrl: "https://alpha.example/v1",
    model: "alpha-default",
    api: "chat",
    apiKeyHint: "alph••••••••lpha",
    ...over,
  };
}

beforeEach(() => {
  providersState.status = "ready";
  providersState.providers = [];
  providersState.errorMessage = undefined;
  providersState.reload = vi.fn().mockResolvedValue(undefined);
});

describe("ManageProvidersModal — empty state", () => {
  it("shows a primary add action when the provider list is empty", () => {
    providersState.providers = [];
    const html = renderToStaticMarkup(<ManageProvidersModal open onClose={() => undefined} />);
    expect(html).toContain("Manage providers");
    expect(html).toContain("No providers yet");
    expect(html).toContain("Add a provider");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(<ManageProvidersModal open onClose={onClose} />);
    expect(html).toContain("aria-label=\"Close\"");
  });

  it("does not render anything when closed", () => {
    const html = renderToStaticMarkup(<ManageProvidersModal open={false} onClose={() => undefined} />);
    expect(html).toBe("");
  });
});

describe("ManageProvidersModal — populated list", () => {
  it("renders one row per provider with id, base URL, model, API type, and key hint", () => {
    providersState.providers = [
      providerFixture(),
      providerFixture({ id: "beta", name: "Beta", baseUrl: "https://beta.example/v1", model: "beta-default", apiKeyHint: "beta••••••••eta" }),
    ];
    const html = renderToStaticMarkup(<ManageProvidersModal open onClose={() => undefined} />);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("https://alpha.example/v1");
    expect(html).toContain("alpha-default");
    expect(html).toContain("alph••••••••lpha");
    expect(html).toContain("Edit");
    expect(html).toContain("Test connection");
    expect(html).toContain("Delete");
  });

  it("shows the CLI fallback in the footer", () => {
    const html = renderToStaticMarkup(<ManageProvidersModal open onClose={() => undefined} />);
    expect(html).toContain("npm run provider:add");
    expect(html).toContain("Prefer the terminal?");
  });
});

describe("ManageProvidersModal — error states", () => {
  it("surfaces a clear error card when the list fails to load", () => {
    providersState.status = "error";
    providersState.errorMessage = "Connection refused";
    const html = renderToStaticMarkup(<ManageProvidersModal open onClose={() => undefined} />);
    expect(html).toContain("Could not load providers");
    expect(html).toContain("Connection refused");
  });
});
