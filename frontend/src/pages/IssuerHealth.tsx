import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { PageHeader } from "../components/ui/PageHeader";
import type { IssuerHealthEntry } from "../types";

export function IssuerHealthPanel({ compact = false }: { compact?: boolean }) {
  const [issuers, setIssuers] = useState<IssuerHealthEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await api.getIssuerHealth();
    setIssuers(data);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const id = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleSpikeBatch() {
    setLoading(true);
    setError(null);
    try {
      await api.generateBatch(20, true);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const anomalies = issuers.filter((i) => i.status === "anomaly");

  return (
    <section className="card card-signature" style={{ padding: "24px" }}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-section-label">Issuer health radar</p>
          <h2 className="mt-1 text-xl font-semibold">Decline rate by issuer</h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Flags issuers with decline counts &gt;2× average. Anomalies trigger delayed retry reroutes.
          </p>
        </div>
        {!compact && (
          <button
            onClick={handleSpikeBatch}
            disabled={loading}
            className="rounded-lg bg-amber-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate spike batch"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {issuers.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          No issuer data yet — generate a batch to populate decline counts.
        </p>
      ) : (
        <div className="space-y-3">
          {issuers.map((issuer) => (
            <div
              key={issuer.issuer_name}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-4 py-3"
            >
              <div>
                <p className="font-medium">{issuer.issuer_name}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {issuer.decline_count} declines · avg {issuer.average_decline_count} ·{" "}
                  {issuer.likely_cause === "infra-side" ? "likely infra-side" : "likely customer-side"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {issuer.status === "anomaly" && issuer.rerouted_count > 0 && (
                  <span className="text-xs text-[var(--color-muted)]">
                    {issuer.rerouted_count} rerouted to delayed retry
                  </span>
                )}
                <StatusBadge status={issuer.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {anomalies.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {anomalies.map((a) => (
            <p key={a.issuer_name}>
              <strong>{a.issuer_name}</strong>: {a.rerouted_count} transaction
              {a.rerouted_count === 1 ? "" : "s"} rerouted to delayed retry instead of negotiation.
            </p>
          ))}
        </div>
      )}

      {compact && (
        <Link to="/issuer-health" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
          View issuer health radar →
        </Link>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: "normal" | "anomaly" }) {
  if (status === "anomaly") {
    return (
      <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
        anomaly detected
      </span>
    );
  }
  return (
    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
      normal
    </span>
  );
}

export default function IssuerHealthPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="ReviveAI · Issuer radar" title="Issuer health" />
      <IssuerHealthPanel />
    </div>
  );
}
