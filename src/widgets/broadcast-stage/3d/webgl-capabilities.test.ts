import { describe, expect, it } from "vitest";
import { probeWebGLSupport, type ProbeCanvas } from "./webgl-capabilities";

function stubCanvas(contexts: Record<string, unknown>): ProbeCanvas {
  return {
    getContext(kind: string) {
      return Object.hasOwn(contexts, kind) ? contexts[kind] : null;
    },
  };
}

describe("probeWebGLSupport", () => {
  it("prefers webgl2 when both contexts are available", () => {
    const result = probeWebGLSupport(() =>
      stubCanvas({ webgl2: {}, webgl: {} }),
    );
    expect(result).toEqual({ supported: true, version: "webgl2" });
  });

  it("falls back to webgl when webgl2 is unavailable", () => {
    const result = probeWebGLSupport(() =>
      stubCanvas({ webgl2: null, webgl: {} }),
    );
    expect(result).toEqual({ supported: true, version: "webgl" });
  });

  it("reports unsupported when neither context is available", () => {
    const result = probeWebGLSupport(() =>
      stubCanvas({ webgl2: null, webgl: null }),
    );
    expect(result).toEqual({ supported: false, version: null });
  });

  it("reports unsupported when the factory returns null", () => {
    expect(probeWebGLSupport(() => null)).toEqual({
      supported: false,
      version: null,
    });
  });

  it("reports unsupported when getContext throws", () => {
    const exploding: ProbeCanvas = {
      getContext() {
        throw new Error("denied");
      },
    };
    expect(probeWebGLSupport(() => exploding)).toEqual({
      supported: false,
      version: null,
    });
  });

  it("reports unsupported without a DOM (node default factory)", () => {
    expect(probeWebGLSupport()).toEqual({ supported: false, version: null });
  });
});
