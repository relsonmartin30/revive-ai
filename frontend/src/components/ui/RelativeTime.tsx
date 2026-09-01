import { useEffect, useState } from "react";

export function RelativeTime({ timestamp }: { timestamp: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function update() {
      const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
      if (seconds < 5) setLabel("Generated just now");
      else if (seconds < 60) setLabel(`Generated ${seconds} seconds ago`);
      else if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        setLabel(`Generated ${m} minute${m === 1 ? "" : "s"} ago`);
      } else {
        setLabel(`Generated ${new Date(timestamp).toLocaleString()}`);
      }
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timestamp]);

  return (
    <p className="text-[12px] text-[var(--color-text-muted)]" style={{ fontSize: "12px" }}>
      {label}
    </p>
  );
}
