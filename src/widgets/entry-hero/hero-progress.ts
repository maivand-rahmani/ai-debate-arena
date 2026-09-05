/** Pure projection helpers for the bounded first-entry scroll runway. */
export function clampHeroProgress(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export interface HeroSceneProjection {
  readonly titleOpacity: number;
  readonly titleScale: number;
  readonly hudOpacity: number;
  readonly cameraLift: number;
  /** 1 until first user scroll intent, then 0 forever. */
  readonly enterHintOpacity: number;
}

const ENTER_HINT_THRESHOLD = 0.012;

/**
 * Scroll intent input: just the raw scroll fraction. The "has the user
 * scrolled at least once" sticky state is owned by {@link useHeroProgress}
 * and threads in here as `everScrolled`.
 */
export function projectHeroScene(
  progress: number,
  everScrolled: boolean,
): HeroSceneProjection {
  const p = clampHeroProgress(progress);
  return {
    titleOpacity: 1 - Math.min(1, p * 1.45),
    titleScale: 1 - p * 0.08,
    hudOpacity: Math.max(0, Math.min(1, (p - 0.38) / 0.45)),
    cameraLift: 1 - p,
    enterHintOpacity: !everScrolled && p <= ENTER_HINT_THRESHOLD ? 1 : 0,
  };
}

/**
 * Decide what the black intro overlay should look like right now.
 *
 * Time base: every argument is **elapsed-since-mount** in milliseconds.
 * `elapsedMs` and `canvasReadyAtMs` must share the same epoch (the moment
 * `useIntroClock` / `IntroOverlayManager` mounted); mixing absolute
 * `performance.now()` values with elapsed time silently stalls the reveal.
 */
export interface IntroOverlayProjection {
  /** 0 = full black, 1 = fully dissolved, leaving the canvas visible. */
  readonly overlayOpacity: number;
  /** 0 = hidden, 1 = fully revealed. */
  readonly titleRevealOpacity: number;
}

const TITLE_REVEAL_MS = 1100;
const TITLE_REVEAL_SANITY_CAP_MS = 2200;
const OVERLAY_FADE_MS = 650;
const POST_REVEAL_GRACE_MS = 120;

export function projectIntroOverlay(
  elapsedMs: number,
  canvasReadyAtMs: number | undefined,
  reducedMotion: boolean,
): IntroOverlayProjection {
  if (reducedMotion) {
    return { overlayOpacity: 1, titleRevealOpacity: 1 };
  }
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  // Resolve when the title starts its reveal. Default = mount time, advance
  // to canvas-ready if that signal lands earlier, otherwise clamp to the
  // sanity cap so a missing signal can't stall the reveal forever.
  let titleStartMs = 0;
  if (
    canvasReadyAtMs !== undefined &&
    Number.isFinite(canvasReadyAtMs) &&
    canvasReadyAtMs >= 0 &&
    canvasReadyAtMs < elapsed
  ) {
    titleStartMs = canvasReadyAtMs;
  }
  if (elapsed >= TITLE_REVEAL_SANITY_CAP_MS) {
    titleStartMs = Math.max(0, elapsed - TITLE_REVEAL_SANITY_CAP_MS);
  }
  const titleElapsed = Math.max(0, elapsed - titleStartMs);
  const titleT = clamp01(titleElapsed / TITLE_REVEAL_MS);
  const fadeT = clamp01(
    (elapsed - TITLE_REVEAL_MS - POST_REVEAL_GRACE_MS) / OVERLAY_FADE_MS,
  );
  return {
    overlayOpacity: 1 - fadeT,
    titleRevealOpacity: Math.max(0.35, easeOutCubic(titleT)),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function easeOutCubic(t: number): number {
  const c = 1 - t;
  return 1 - c * c * c;
}
