import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatInr } from "../api";
import { DataControls, timeWindowToHours } from "../components/DataControls";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/ui/PageHeader";
import type { DataView, TimeWindow, Transaction, TransactionStatus } from "../types";

const STATUSES: Array<TransactionStatus | "all"> = [
  "all",
  "failed",
  "recovering",
  "recovered",
  "lost",
  "strategy_selected",
];

export default function TransactionList() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<TransactionStatus | "all">("all");
  const [view, setView] = useState<DataView>("active");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("3h");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const load = () =>
      api
        .getTransactions({
          status: filter === "all" ? undefined : filter,
          view,
          since_hours: view === "active" ? timeWindowToHours(timeWindow) : undefined,
          limit: 200,
        })
        .then(setTxns)
        .catch(console.error);
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [filter, view, timeWindow, refreshKey]);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="ReviveAI · Cases" title="Transactions" />

      <DataControls
        view={view}
        timeWindow={timeWindow}
        onViewChange={setView}
        onTimeWindowChange={setTimeWindow}
        onChanged={() => setRefreshKey((k) => k + 1)}
        compact
      />

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`btn capitalize ${
              filter === s
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "btn-ghost"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <p className="text-body-sm text-[var(--color-text-muted)]">
        Showing {txns.length} {view === "archived" ? "archived" : "active"} record
        {txns.length === 1 ? "" : "s"}
        {view === "active" && timeWindow !== "all" ? ` · ${timeWindow} window` : ""}
      </p>

      <div className="card card-signature overflow-hidden" style={{ padding: 0 }}>
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Decline</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Strategy</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr
                key={t.id}
                className="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-card)]"
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/transactions/${t.id}`}
                    className="font-medium hover:underline"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {t.customer_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{t.product_name}</td>
                <td className="px-4 py-3">{formatInr(t.amount)}</td>
                <td className="px-4 py-3 capitalize text-[var(--color-text-secondary)]">
                  {t.decline_code.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-4 py-3 capitalize text-[var(--color-text-muted)]">
                  {t.strategy?.replace(/_/g, " ") ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {txns.length === 0 && (
          <p className="px-4 py-8 text-center text-body-sm text-[var(--color-text-muted)]">
            {view === "archived"
              ? "No archived transactions."
              : "No transactions in this time window. Try a wider filter or generate a batch."}
          </p>
        )}
      </div>
    </div>
  );
}
