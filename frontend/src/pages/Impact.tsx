import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatInr } from "../api";
import { CountUp } from "../components/ui/CountUp";
import { PageHeader } from "../components/ui/PageHeader";
import type { ImpactBreakdown, ImpactSummary } from "../types";

export function ImpactPanel({ compact = false }: { compact?: boolean }) {
  const [impact, setImpact] = useState<ImpactSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    const data = await api.getImpactSummary();
    setImpact(data);
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const id = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(id);
  }, [refresh]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!impact) {
    return <p className="text-sm text-[var(--color-muted)]">Loading impact data…</p>;
  }

  const revivePct = impact.revive_recovery_rate * 100;
  const baselinePct = impact.baseline_recovery_rate * 100;
  const maxBar = Math.max(revivePct, baselinePct, 1);
  const liftLabel =
    impact.lift_percentage > 0
      ? `${impact.lift_percentage.toFixed(1)}% more`
      : impact.lift_percentage < 0
        ? `${Math.abs(impact.lift_percentage).toFixed(1)}% less`
        : "the same as";

  return (
    <section className="card card-interactive card-signature" style={{ padding: "24px" }}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-section-label">Impact simulator</p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
            ReviveAI recovers{" "}
            <span
              className={
                impact.extra_amount_recovered >= 0
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-warning)]"
              }
            >
              {liftLabel}
            </span>{" "}
            than blind retry
          </h2>
          <p className="mt-2 text-body-sm text-[var(--color-text-secondary)]">
            Baseline = deterministic expected recovery (decline-code probability × amount). ReviveAI =
            actual recovered totals after strategy execution.
          </p>
        </div>
        {!compact && (
          <Link to="/" className="text-body-sm hover:underline" style={{ color: "var(--color-accent)" }}>
            ← Dashboard
          </Link>
        )}
      </div>

      {impact.attempted_count === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-muted)]">
          {impact.cohort_size > 0
            ? "Batch ready — run recovery to compare ReviveAI vs baseline expected value."
            : "Generate a batch or import logs to begin baseline comparison."}
        </p>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <Metric
              label="Extra recovered vs baseline"
              value={formatInr(impact.extra_amount_recovered)}
              highlight
              positive={impact.extra_amount_recovered >= 0}
            />
            <Metric label="ReviveAI total recovered" value={formatInr(impact.revive_recovered_total)} />
            <Metric label="Baseline expected total" value={formatInr(impact.baseline_recovered_total)} />
          </div>

          <div className="space-y-4">
            <BarRow label="ReviveAI recovery rate (₹ basis)" pct={revivePct} max={maxBar} color="emerald" resetKey={refreshTick} />
            <BarRow label="Blind retry expected rate" pct={baselinePct} max={maxBar} color="zinc" resetKey={refreshTick} />
          </div>
        </>
      )}

      {compact && (
        <Link to="/impact" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
          View full impact analysis →
        </Link>
      )}
    </section>
  );
}

function ImpactBreakdownSection() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ImpactBreakdown | null>(null);
  const [visibleRows, setVisibleRows] = useState(10);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data) return;
    api
      .getImpactBreakdown()
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [open, data]);

  return (
    <section className="card card-signature overflow-hidden" style={{ padding: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <h2 className="text-section-label">Show breakdown</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Audit by decline type, strategy, and individual transaction
          </p>
        </div>
        <span className="text-sm text-[var(--color-muted)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-8 border-t border-[var(--color-border)] px-6 pb-6 pt-6">
          {error && <p className="text-sm text-red-300">{error}</p>}
          {!data && !error && <p className="text-sm text-[var(--color-muted)]">Loading breakdown…</p>}

          {data && (
            <>
              <BreakdownTable
                title="By decline type"
                headers={["Decline type", "Count", "ReviveAI ₹", "Baseline expected ₹", "Difference ₹"]}
                rows={data.by_decline_code.map((r) => [
                  r.decline_code.replace(/_/g, " "),
                  String(r.transaction_count),
                  formatInr(r.revive_recovered_total),
                  formatInr(r.baseline_expected_total),
                  formatDiff(r.difference_total),
                ])}
              />

              <BreakdownTable
                title="By strategy"
                headers={["Strategy", "Count", "ReviveAI ₹", "Baseline expected ₹", "Difference ₹"]}
                rows={data.by_strategy.map((r) => [
                  r.strategy.replace(/_/g, " "),
                  String(r.transaction_count),
                  formatInr(r.revive_recovered_total),
                  formatInr(r.baseline_expected_total),
                  formatDiff(r.difference_total),
                ])}
              />

              <div>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--color-muted)]">
                  By transaction (largest gain first)
                </h3>
                <BreakdownTable
                  title=""
                  headers={[
                    "Customer",
                    "Product",
                    "Amount",
                    "Decline",
                    "Strategy",
                    "ReviveAI",
                    "Baseline",
                    "Diff",
                  ]}
                  rows={data.transactions.slice(0, visibleRows).map((r) => [
                    r.customer_name,
                    r.product_name,
                    formatInr(r.amount),
                    r.decline_code.replace(/_/g, " "),
                    r.strategy.replace(/_/g, " "),
                    formatInr(r.revive_actual),
                    formatInr(r.baseline_expected),
                    formatDiff(r.difference),
                  ])}
                />
                {visibleRows < data.transactions.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleRows((n) => n + 10)}
                    className="mt-4 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-white/[0.03]"
                  >
                    Show more ({data.transactions.length - visibleRows} remaining)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function BreakdownTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <div>
      {title && <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--color-muted)]">{title}</h3>}
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-[var(--color-border)] bg-white/[0.02] text-xs uppercase tracking-wider text-[var(--color-muted)]">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--color-border)]/50 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDiff(n: number) {
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatInr(n)}`;
}

function Metric({
  label,
  value,
  highlight,
  positive = true,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-4 py-3">
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold ${
          highlight ? (positive ? "text-emerald-400" : "text-red-400") : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function BarRow({
  label,
  pct,
  max,
  color,
  resetKey,
}: {
  label: string;
  pct: number;
  max: number;
  color: "emerald" | "zinc";
  resetKey?: number;
}) {
  const width = Math.max(4, (pct / max) * 100);
  const barColor = color === "emerald" ? "bg-emerald-500" : "bg-zinc-500";
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">
          <CountUp value={pct} formatter={(n) => `${n.toFixed(2)}%`} resetKey={resetKey} duration={800} />
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function ImpactPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="ReviveAI · Impact" title="Baseline comparison" />
      <ImpactPanel />
      <ImpactBreakdownSection />
    </div>
  );
}
