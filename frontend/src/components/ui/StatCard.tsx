import { CountUp } from "./CountUp";

type Accent = "positive" | "warning" | "neutral";

export function StatCard({
  label,
  value,
  format = "number",
  context,
  accent = "neutral",
  animate = true,
  resetKey,
}: {
  label: string;
  value: number;
  format?: "currency" | "percent" | "number";
  context?: string;
  accent?: Accent;
  animate?: boolean;
  resetKey?: string | number;
}) {
  const formatter = (n: number) => {
    if (format === "currency") {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);
    }
    if (format === "percent") return `${n.toFixed(1)}%`;
    return Math.round(n).toLocaleString("en-IN");
  };

  const valueColor =
    accent === "positive"
      ? "text-[var(--color-accent)]"
      : accent === "warning"
        ? "text-[var(--color-warning)]"
        : "text-[var(--color-text-primary)]";

  return (
    <div className="card card-interactive card-signature" style={{ padding: "20px" }}>
      <p className="text-section-label">{label}</p>
      <p
        className={`mt-3 font-bold tracking-tight ${valueColor}`}
        style={{ fontSize: "var(--text-stat)", lineHeight: 1.1 }}
      >
        {animate ? (
          <CountUp value={value} formatter={formatter} resetKey={resetKey} duration={800} />
        ) : (
          formatter(value)
        )}
      </p>
      {context && (
        <p className="text-body-sm mt-2 text-[var(--color-text-secondary)]">{context}</p>
      )}
    </div>
  );
}
