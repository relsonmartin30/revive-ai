import { useEffect, useRef, useState } from "react";

export function CountUp({
  value,
  duration = 800,
  formatter,
  resetKey,
}: {
  value: number;
  duration?: number;
  formatter: (n: number) => string;
  /** Bump to force re-animation from zero (e.g. on each data refresh) */
  resetKey?: string | number;
}) {
  const [display, setDisplay] = useState(0);
  const reduced = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (reduced.current) {
      setDisplay(value);
      return;
    }

    setDisplay(0);
    const start = 0;
    const delta = value - start;
    if (delta === 0) return;

    const t0 = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(start + delta * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, resetKey]);

  return <>{formatter(display)}</>;
}
