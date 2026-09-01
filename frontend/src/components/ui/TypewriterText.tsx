import { useEffect, useRef, useState } from "react";

export function TypewriterText({
  text,
  duration = 1500,
  className = "",
}: {
  text: string;
  duration?: number;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState("");
  const reduced = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (reduced.current) {
      setDisplayed(text);
      return;
    }

    setDisplayed("");
    if (!text) return;

    const msPerChar = Math.max(12, duration / text.length);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, msPerChar);

    return () => window.clearInterval(id);
  }, [text, duration]);

  const typing = displayed.length < text.length;

  return (
    <p className={className}>
      {displayed}
      {typing && (
        <span
          className="ml-0.5 inline-block w-[2px] animate-pulse bg-[var(--color-accent)]"
          style={{ height: "1em", verticalAlign: "text-bottom" }}
          aria-hidden
        />
      )}
    </p>
  );
}
