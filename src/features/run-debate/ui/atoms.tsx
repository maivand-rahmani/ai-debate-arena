"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

interface SparkProps {
  readonly className?: string;
}

export function Spark({ className = "" }: SparkProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 13.8 10l7.7 2-7.7 2-1.8 7.5-1.8-7.5-7.7-2 7.7-2L12 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface CaretProps {
  readonly className?: string;
}

export function Caret({ className = "" }: CaretProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[1em] w-[2px] translate-y-[2px] bg-current align-middle animate-caret-blink ${className}`}
    />
  );
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReduced(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getReducedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(reducedMotionQuery).matches;
}

function getReducedServerSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, getReducedSnapshot, getReducedServerSnapshot);
}

interface CountUpProps {
  readonly value: number;
  readonly duration?: number;
}

/**
 * Animates a numeric value from the previous value to `value` over `duration`
 * ms. Used by the verdict score reveal. When the user prefers reduced motion
 * the component simply renders `value` directly with no animation.
 */
export function CountUp({ value, duration = 1100 }: CountUpProps) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const previousRef = useRef(value);

  useEffect(() => {
    const from = previousRef.current;
    const to = value;
    if (from === to) return;
    if (reduced) {
      previousRef.current = to;
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previousRef.current = to;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, duration]);

  return <span aria-live="off">{reduced ? value : display}</span>;
}
