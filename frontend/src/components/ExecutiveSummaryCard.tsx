import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ExecutiveSummary } from "../types";
import { RelativeTime } from "./ui/RelativeTime";
import { TypewriterText } from "./ui/TypewriterText";

export function ExecutiveSummaryCard() {
  const [data, setData] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeKey, setTypeKey] = useState(0);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getExecutiveSummary(force);
      setData(result);
      setTypeKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <section className="card-hero">
      <div className="card-hero__glow" aria-hidden />
      <div className="card card-hero__inner">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-section-label">AI summary</p>
            {data && (
              <span className="text-body-sm mt-1 inline-block text-[var(--color-text-muted)]">
                {data.source === "ollama" ? "Ollama" : "Rule-based fallback"} · {data.model}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="btn btn-ghost"
            title="Regenerate summary"
            aria-label="Regenerate summary"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="space-y-3">
            <div className="skeleton-shimmer h-4 rounded" style={{ width: "100%" }} />
            <div className="skeleton-shimmer h-4 rounded" style={{ width: "92%" }} />
            <div className="skeleton-shimmer h-4 rounded" style={{ width: "78%" }} />
            <div className="skeleton-shimmer h-4 rounded" style={{ width: "65%" }} />
          </div>
        )}

        {!loading && error && (
          <p className="text-body-sm text-[var(--color-warning)]">{error}</p>
        )}

        {!loading && data && (
          <>
            <TypewriterText
              key={typeKey}
              text={data.summary}
              className="text-editorial"
              duration={1500}
            />
            <div className="mt-4">
              <RelativeTime timestamp={data.timestamp} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
