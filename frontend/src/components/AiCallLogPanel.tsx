import { useEffect, useState } from "react";
import { api } from "../api";
import type { AiCallLogEntry } from "../types";

export function AiCallLogPanel() {
  const [logs, setLogs] = useState<AiCallLogEntry[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const load = () => api.getAiCallLog(30).then(setLogs).catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <h2 className="text-lg font-medium">Live AI Call Log</h2>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Proof of real Ollama API calls — timestamp, latency, tokens
          </p>
        </div>
        <span className="text-sm text-emerald-400">{logs.length} calls · {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-6 pb-6 overflow-x-auto">
          {logs.length === 0 ? (
            <p className="pt-4 text-sm text-[var(--color-muted)]">
              No API calls yet — run recovery to populate.
            </p>
          ) : (
            <table className="w-full text-left text-xs mt-4">
              <thead>
                <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Agent</th>
                  <th className="pb-2 pr-3">Latency</th>
                  <th className="pb-2 pr-3">Tokens</th>
                  <th className="pb-2">Response</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--color-border)]/40">
                    <td className="py-2 pr-3 whitespace-nowrap text-[var(--color-muted)]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2 pr-3 font-medium text-emerald-400">{log.agent}</td>
                    <td className="py-2 pr-3">{log.latency_ms.toFixed(0)}ms</td>
                    <td className="py-2 pr-3">
                      {log.input_tokens ?? "?"}→{log.output_tokens ?? "?"}
                    </td>
                    <td className="py-2 max-w-xs truncate">{log.response_preview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
