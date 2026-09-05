"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clampHeroProgress,
  projectHeroScene,
  projectIntroOverlay,
  type HeroSceneProjection,
  type IntroOverlayProjection,
} from "./hero-progress";

interface EntryHeroProps {
  readonly progress: number;
  readonly reducedMotion: boolean;
  readonly scrolled: boolean;
  /** When true, the lockup + hint + index fade in cleanly from CSS. */
  readonly introSettled: boolean;
}

export function EntryHero({
  progress,
  reducedMotion,
  scrolled,
  introSettled,
}: EntryHeroProps) {
  const projection = projectHeroScene(progress, scrolled);
  return (
    <div
      className="entry-hero"
      aria-hidden={reducedMotion || undefined}
      data-entry-hero
      data-intro-settled={introSettled || undefined}
    >
      <div className="entry-hero__hairline" />
      <div
        className="entry-hero__lockup"
        style={{
          opacity: projection.titleOpacity,
          transform: `scale(${projection.titleScale})`,
        }}
      >
        <span className="entry-hero__kicker">A LIVE ARGUMENT, COMPOSED</span>
        <h1>AI DEBATE ARENA</h1>
        <p>Two minds. One question. Let them argue.</p>
      </div>
      <div
        className="entry-hero__enter"
        style={{ opacity: projection.enterHintOpacity }}
      >
        <span className="entry-hero__enter-line" />
        <span>SCROLL TO ENTER</span>
      </div>
      <div className="entry-hero__index">01 <span>/</span> 03</div>
    </div>
  );
}

interface IntroOverlayManagerProps {
  readonly reducedMotion: boolean;
  /**
   * Mutable ref the manager installs its canvas-ready bridge into. The
   * parent's `ArenaFrame.onFirstFrame` callback calls this ref so the
   * manager learns the canvas's first rendered frame without re-rendering
   * the surrounding tree.
   */
  readonly markCanvasReadyRef: React.MutableRefObject<() => void>;
  /** Fired exactly once when the staged reveal settles. */
  readonly onSettledChange: (settled: boolean) => void;
}

/**
 * Self-contained intro overlay mount. Owns its own RAF loop, latches when
 * the staged reveal completes, then unmounts itself. Re-rendering this
 * component is intentionally confined to the small subset of the tree that
 * sits inside it; the surrounding ArenaFrame, ArenaHud, and CanvasGate
 * tree is never re-rendered during the intro.
 *
 * Time-base: every value here is **elapsed-since-mount** in ms. The
 * canvas-ready callback lands on the same epoch via the `bridgeCanvasReady`
 * helper installed on `onFirstFrameRef.current`; this prevents the prior
 * absolute-vs-elapsed mismatch that stalled the title reveal at the 0.35
 * floor.
 *
 * Render discipline: this component stores the latest projection in
 * state, mutated only inside the RAF callback. Refs are read/written only
 * inside `useLayoutEffect` (for ref keeping) and the RAF loop. The render
 * path itself only reads state.
 */
export function IntroOverlayManager({
  reducedMotion,
  markCanvasReadyRef,
  onSettledChange,
}: IntroOverlayManagerProps) {
  const [projection, setProjection] = useState<IntroOverlayProjection>({
    overlayOpacity: 1,
    titleRevealOpacity: 0.35,
  });
  const [settled, setSettled] = useState(reducedMotion);
  // Refs for: startedAt stamp, RAF handle, canvas-ready elapsed timestamp,
  // and a "settled" sentinel read inside the RAF loop. They are read /
  // mutated only inside the RAF loop and `useLayoutEffect` — never during
  // render.
  const startedAtRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const canvasReadyAtMsRef = useRef<number | undefined>(undefined);
  const settledFlagRef = useRef(reducedMotion);

  // Keep the parent-supplied callbacks current without retriggering the
  // RAF setup. The settled-change callback is assigned inside a layout
  // effect so the mutation never happens during render.
  const onSettledChangeRef = useRef(onSettledChange);
  useLayoutEffect(() => {
    onSettledChangeRef.current = onSettledChange;
  });

  useEffect(() => {
    if (reducedMotion) {
      if (!settledFlagRef.current) {
        settledFlagRef.current = true;
        onSettledChangeRef.current(true);
      }
      return;
    }
    let cancelled = false;
    const start = performance.now();
    startedAtRef.current = start;
    settledFlagRef.current = false;
    canvasReadyAtMsRef.current = undefined;

    let safetyTimer: number | undefined;

    const settle = () => {
      if (settledFlagRef.current) return;
      settledFlagRef.current = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (safetyTimer !== undefined) {
        window.clearTimeout(safetyTimer);
        safetyTimer = undefined;
      }
      setSettled(true);
      setProjection({ overlayOpacity: 0, titleRevealOpacity: 1 });
      onSettledChangeRef.current(true);
    };

    const bridgeCanvasReady = () => {
      if (canvasReadyAtMsRef.current !== undefined) return;
      canvasReadyAtMsRef.current = performance.now() - start;
      setProjection((prev) => ({ ...prev }));
    };
    markCanvasReadyRef.current = bridgeCanvasReady;

    safetyTimer = window.setTimeout(bridgeCanvasReady, 600);

    const tickFrame = (now: number) => {
      if (cancelled || settledFlagRef.current) {
        frameRef.current = null;
        return;
      }
      const elapsed = now - start;
      const next = projectIntroOverlay(
        elapsed,
        canvasReadyAtMsRef.current,
        reducedMotion,
      );
      if (next.overlayOpacity <= 0) {
        settle();
        return;
      }
      setProjection(next);
      frameRef.current = window.requestAnimationFrame(tickFrame);
    };
    frameRef.current = window.requestAnimationFrame(tickFrame);

    return () => {
      cancelled = true;
      settledFlagRef.current = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      window.clearTimeout(safetyTimer);
      markCanvasReadyRef.current = () => {};
    };
    // `markCanvasReadyRef` is a stable parent ref; not listed so the
    // RAF setup isn't torn down on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  if (reducedMotion || settled) return null;

  return (
    <div
      className="entry-intro-overlay"
      data-intro-phase="staged"
      style={{ opacity: projection.overlayOpacity }}
    >
      <div
        className="entry-intro-title"
        style={{ opacity: projection.titleRevealOpacity }}
      >
        <span className="entry-intro-title__bar" />
        <h1>AI DEBATE ARENA</h1>
        <span className="entry-intro-title__bar" />
      </div>
    </div>
  );
}

interface HeroProgressState {
  readonly progress: number;
  readonly scrolledAtLeastOnce: boolean;
}

/**
 * Bounded scroll progress for the first-entry runway. Uses RAF coalescing
 * so the page only re-renders once per frame regardless of how many wheel
 * events fire.
 */
export function useHeroProgress(reducedMotion: boolean): HeroProgressState {
  const initial = reducedMotion ? 1 : 0;
  const progressRef = useRef(initial);
  const renderedRef = useRef(initial);
  const frameRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(initial);
  const [scrolledAtLeastOnce, setScrolledAtLeastOnce] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      progressRef.current = 1;
      return;
    }
    const update = () => {
      frameRef.current = null;
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const next = clampHeroProgress(window.scrollY / max);
      progressRef.current = next;
      if (Math.abs(next - renderedRef.current) > 0.002) {
        renderedRef.current = next;
        setProgress(next);
      }
      if (next > 0.012) setScrolledAtLeastOnce(true);
    };
    const onScroll = () => {
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [reducedMotion]);

  return { progress, scrolledAtLeastOnce };
}

export type { HeroSceneProjection, IntroOverlayProjection };
