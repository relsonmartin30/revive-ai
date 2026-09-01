import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatInr } from "../api";
import { AiCallLogPanel } from "../components/AiCallLogPanel";
import { PipelineFlow } from "../components/PipelineFlow";
import { DataControls } from "../components/DataControls";
import { ExecutiveSummaryCard } from "../components/ExecutiveSummaryCard";
import { CountUp } from "../components/ui/CountUp";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";
import { ImpactPanel } from "./Impact";
import { IssuerHealthPanel } from "./IssuerHealth";
import type { DashboardSummary, StrategyPerformance } from "../types";

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [performance, setPerformance] = useState<StrategyPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [dataView, setDataView] = useState<import("../types").DataView>("active");
  const [timeWindow, setTimeWindow] = useState<import("../types").TimeWindow>("3h");

  const refresh = useCallback(async () => {
    const [s, p] = await Promise.all([
      api.getDashboard(),
      api.getStrategyPerformance(),
    ]);
    setSummary(s);
    setPerformance(p);
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const id = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleStartDemo() {
    setRunning(true);
    setError(null);
    try {
      await api.startDemo(40);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      await api.generateBatch(40);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRunRecovery() {
    setRunning(true);
    setError(null);
    try {
      await api.runRecovery();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="ReviveAI · Payment recovery"
        title="Dashboard"
        actions={
          <>
            <button
              onClick={handleStartDemo}
              disabled={loading || running}
              className="btn btn-primary"
            >
              {running ? "Running…" : "Run full pipeline"}
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading || running}
              className="btn btn-ghost"
            >
              {loading ? "Generating…" : "Generate batch"}
            </button>
            <button
              onClick={handleRunRecovery}
              disabled={loading || running}
              className="btn btn-ghost"
            >
              Run recovery
            </button>
          </>
        }
      />

      <DataControls
        view={dataView}
        timeWindow={timeWindow}
        onViewChange={setDataView}
        onTimeWindowChange={setTimeWindow}
        onChanged={refresh}
        compact
      />

      <ExecutiveSummaryCard />

      {!summary?.total_transactions && !running && (
        <>
          <PipelineFlow />
          <p className="text-center text-body-sm text-[var(--color-text-secondary)]">
            Click <strong style={{ color: "var(--color-accent)" }}>Run full pipeline</strong> to
            generate sample transactions, run analysis, and execute recovery.
          </p>
        </>
      )}

      {error && (
        <div
          className="card card-accent-warning text-body-sm"
          style={{ color: "var(--color-warning)" }}
        >
          {error}
        </div>
      )}

      {summary && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total recovered"
              value={summary.total_recovered_inr}
              format="currency"
              accent="positive"
              context={`${summary.total_attempted} recovery attempts`}
              resetKey={refreshTick}
            />
            <StatCard
              label="Recovery rate"
              value={summary.recovery_rate * 100}
              format="percent"
              accent={summary.recovery_rate > 0 ? "positive" : "neutral"}
              context="Of attempted recoveries"
              resetKey={refreshTick}
            />
            <StatCard
              label="In progress"
              value={summary.cases_in_progress}
              format="number"
              accent={summary.cases_in_progress > 0 ? "warning" : "neutral"}
              context="Active recovery cases"
              resetKey={refreshTick}
            />
            <StatCard
              label="Not pursued"
              value={summary.cases_not_pursued}
              format="number"
              accent={summary.cases_not_pursued > 0 ? "warning" : "neutral"}
              context="Low recoverability skips"
              resetKey={refreshTick}
            />
          </section>

          <ImpactPanel compact />
          <IssuerHealthPanel compact />

          <section className="card card-signature" style={{ padding: "24px" }}>
            <h2 className="text-section-label mb-4">Strategy performance</h2>
            {performance.length === 0 ? (
              <p className="text-body-sm text-[var(--color-text-secondary)]">
                Run recovery to populate learning data.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                      <th className="pb-3 pr-4 font-medium">Decline type</th>
                      <th className="pb-3 pr-4 font-medium">Strategy</th>
                      <th className="pb-3 pr-4 font-medium">Attempts</th>
                      <th className="pb-3 font-medium">Success rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((row) => (
                      <tr
                        key={`${row.decline_code}-${row.strategy}`}
                        className="border-b border-[var(--color-border)]"
                      >
                        <td className="py-3 pr-4 capitalize text-[var(--color-text-primary)]">
                          {row.decline_code.replace(/_/g, " ")}
                        </td>
                        <td className="py-3 pr-4 capitalize text-[var(--color-text-secondary)]">
                          {row.strategy.replace(/_/g, " ")}
                        </td>
                        <td className="py-3 pr-4">{row.attempts}</td>
                        <td className="py-3 font-medium" style={{ color: "var(--color-accent)" }}>
                          <CountUp
                            value={row.success_rate * 100}
                            formatter={(n) => `${Math.round(n)}%`}
                            resetKey={refreshTick}
                            duration={800}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <AiCallLogPanel />

          <section className="card card-signature overflow-hidden" style={{ padding: 0 }}>
            <button
              onClick={() => setShowLeft(!showLeft)}
              className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-[var(--color-card)]"
            >
              <h2 className="text-section-label">Left on the table</h2>
              <span className="text-body-sm text-[var(--color-text-muted)]">
                {summary.not_pursued_cases.length} cases · {showLeft ? "▲" : "▼"}
              </span>
            </button>
            {showLeft && summary.not_pursued_cases.length > 0 && (
              <div className="border-t border-[var(--color-border)] px-6 pb-6">
                <ul className="space-y-3 pt-4">
                  {summary.not_pursued_cases.map((c) => (
                    <li
                      key={c.id}
                      className="card card-inner flex flex-wrap items-center justify-between gap-2 text-body-sm"
                    >
                      <div>
                        <span className="font-medium text-[var(--color-text-primary)]">
                          {c.customer_name}
                        </span>
                        <span className="mx-2 text-[var(--color-text-muted)]">·</span>
                        <span>{formatInr(c.amount)}</span>
                      </div>
                      <span className="text-[var(--color-text-secondary)]">{c.diagnosis}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}

      <p className="text-body-sm text-[var(--color-text-muted)]">
        <Link to="/transactions" style={{ color: "var(--color-accent)" }} className="hover:underline">
          View all transactions →
        </Link>
      </p>
    </div>
  );
}
