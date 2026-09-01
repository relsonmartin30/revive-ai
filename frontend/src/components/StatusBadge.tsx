import type { TransactionStatus } from "../types";

const config: Record<
  TransactionStatus,
  { dot: string; bg: string; text: string; pulse?: boolean }
> = {
  failed: {
    dot: "bg-red-400",
    bg: "bg-[var(--color-card)]",
    text: "text-red-400",
  },
  diagnosing: {
    dot: "bg-[var(--color-warning)]",
    bg: "bg-[var(--color-card)]",
    text: "text-[var(--color-warning)]",
  },
  strategy_selected: {
    dot: "bg-[var(--color-text-secondary)]",
    bg: "bg-[var(--color-card)]",
    text: "text-[var(--color-text-secondary)]",
  },
  recovering: {
    dot: "bg-[var(--color-warning)]",
    bg: "bg-[var(--color-card)]",
    text: "text-[var(--color-warning)]",
    pulse: true,
  },
  recovered: {
    dot: "bg-[var(--color-accent)]",
    bg: "bg-[var(--color-card)]",
    text: "text-[var(--color-accent)]",
  },
  lost: {
    dot: "bg-[var(--color-text-muted)]",
    bg: "bg-[var(--color-card)]",
    text: "text-[var(--color-text-muted)]",
  },
};

export function StatusBadge({ status }: { status: TransactionStatus }) {
  const c = config[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-medium capitalize ${c.bg} ${c.text}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${c.dot} ${c.pulse ? "status-dot-pulse" : ""}`}
        aria-hidden
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}
