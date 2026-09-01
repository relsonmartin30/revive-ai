import type { TransactionAnalysis } from "../types";

const impactColors: Record<string, string> = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  neutral: "text-[var(--color-muted)]",
  high_value: "text-amber-400",
  low_value: "text-[var(--color-muted)]",
};

export function AnalysisPanel({ analysis }: { analysis: TransactionAnalysis }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-5">
      <div>
        <h2 className="text-lg font-medium">Recovery analysis</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Rule-based engine · {analysis.engine.replace(/_/g, " ")}
        </p>
      </div>

      <p className="text-sm text-[var(--color-muted)]">{analysis.note}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {analysis.signals.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[var(--color-border)] px-4 py-3"
          >
            <p className="text-xs text-[var(--color-muted)]">{s.label}</p>
            <p className={`mt-1 text-sm font-medium ${impactColors[s.impact] ?? ""}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] px-4 py-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-muted)]">Recoverability</span>
          <span className="font-semibold text-emerald-400">
            {analysis.recoverability_label} ({(analysis.recoverability_score * 100).toFixed(0)}%)
          </span>
        </div>
        <div className="h-2 rounded-full bg-[var(--color-bg)] overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${analysis.recoverability_score * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <p>
          <span className="text-[var(--color-muted)]">Diagnosis: </span>
          {analysis.diagnosis_summary}
        </p>
        {analysis.strategy_reason && (
          <p>
            <span className="text-[var(--color-muted)]">Strategy: </span>
            {analysis.strategy_reason}
          </p>
        )}
      </div>

      {analysis.simulated_outcome && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            analysis.simulated_outcome.result === "recovered"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
          }`}
        >
          <p className="font-medium capitalize">
            Recovery outcome: {analysis.simulated_outcome.result.replace(/_/g, " ")}
          </p>
          {analysis.simulated_outcome.amount != null && (
            <p className="mt-1">Amount: ₹{analysis.simulated_outcome.amount.toLocaleString("en-IN")}</p>
          )}
          {analysis.simulated_outcome.payment_link && (
            <p className="mt-1 truncate">{analysis.simulated_outcome.payment_link}</p>
          )}
          {analysis.simulated_outcome.reason && (
            <p className="mt-1">{analysis.simulated_outcome.reason}</p>
          )}
        </div>
      )}
    </section>
  );
}
