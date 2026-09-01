import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DataStats, DataView, TimeWindow } from "../types";

const TIME_WINDOWS: { id: TimeWindow; label: string; hours?: number }[] = [
  { id: "1h", label: "Last 1 hour", hours: 1 },
  { id: "2h", label: "Last 2 hours", hours: 2 },
  { id: "3h", label: "Last 3 hours", hours: 3 },
  { id: "today", label: "Today", hours: 24 },
  { id: "all", label: "All active", hours: undefined },
];

type Props = {
  view: DataView;
  timeWindow: TimeWindow;
  onViewChange: (v: DataView) => void;
  onTimeWindowChange: (w: TimeWindow) => void;
  onChanged?: () => void;
  compact?: boolean;
};

export function DataControls({
  view,
  timeWindow,
  onViewChange,
  onTimeWindowChange,
  onChanged,
  compact = false,
}: Props) {
  const [stats, setStats] = useState<DataStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStats = useCallback(() => {
    api.getDataStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, 5000);
    return () => clearInterval(id);
  }, [refreshStats]);

  async function archive(mode: "all_active" | "older_than_hours", hours?: number) {
    const label = mode === "all_active" ? "all active records" : `everything older than ${hours}h`;
    if (!confirm(`Move ${label} to Archive? Dashboard will only show recent active data.`)) return;
    setBusy("archive");
    setMessage(null);
    try {
      const res = await api.archiveData({ mode, since_hours: hours });
      setMessage(`Archived ${res.archived} transactions`);
      refreshStats();
      onChanged?.();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function restoreAll() {
    if (!confirm("Restore all archived transactions back to active view?")) return;
    setBusy("restore");
    setMessage(null);
    try {
      const res = await api.unarchiveData({ mode: "all" });
      setMessage(`Restored ${res.restored} transactions`);
      refreshStats();
      onChanged?.();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
    }
  }

  const hoursForWindow = TIME_WINDOWS.find((w) => w.id === timeWindow)?.hours;

  return (
    <section className="card card-signature" style={{ padding: compact ? "16px" : "20px" }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-section-label">Demo data view</p>
          <p className="text-body-sm mt-1 text-[var(--color-text-secondary)]">
            Hide old hackathon runs — show only what you need on stage.
            {stats && (
              <span className="ml-1 text-[var(--color-text-muted)]">
                ({stats.active} active · {stats.archived} archived)
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onViewChange("active")}
          className={`btn ${view === "active" ? "btn-primary" : "btn-ghost"}`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => onViewChange("archived")}
          className={`btn ${view === "archived" ? "btn-primary" : "btn-ghost"}`}
        >
          Archive / History
        </button>
      </div>

      {view === "active" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onTimeWindowChange(w.id)}
              className={`btn text-xs ${
                timeWindow === w.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "btn-ghost"
              }`}
            >
              {w.label}
              {stats && w.hours === 1 && ` (${stats.active_last_1h})`}
              {stats && w.hours === 2 && ` (${stats.active_last_2h})`}
              {stats && w.hours === 3 && ` (${stats.active_last_3h})`}
              {stats && w.hours === 24 && ` (${stats.active_today})`}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => archive("older_than_hours", hoursForWindow ?? 3)}
          className="btn btn-secondary text-xs"
        >
          {busy === "archive" ? "Archiving…" : timeWindow === "all" ? "Archive all except recent" : `Archive older than ${hoursForWindow ?? 3}h`}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => archive("all_active")}
          className="btn btn-secondary text-xs"
        >
          Archive all active
        </button>
        <button
          type="button"
          disabled={!!busy || !stats?.archived}
          onClick={restoreAll}
          className="btn btn-ghost text-xs"
        >
          {busy === "restore" ? "Restoring…" : "Restore from archive"}
        </button>
      </div>

      {message && (
        <p className="text-body-sm mt-3 text-[var(--color-accent)]">{message}</p>
      )}
    </section>
  );
}

export function timeWindowToHours(w: TimeWindow): number | undefined {
  const found = TIME_WINDOWS.find((t) => t.id === w);
  return found?.hours;
}
