import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AiHealth, DemoInfo } from "../types";

const POLL_MS = 8000;

export function DemoBanner() {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [checked, setChecked] = useState(false);

  const poll = useCallback(async () => {
    try {
      const [h, demo] = await Promise.all([api.getAiHealth(), api.getDemoInfo()]);
      setHealth(h);
      setInfo(demo);
    } catch {
      setHealth({
        connected: false,
        key_configured: false,
        rate_limited: false,
        model: "",
        latency_ms: null,
        response: null,
        error: "unreachable",
        provider: "ollama",
      });
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const ollamaLive = health?.connected === true;
  const ollamaOffline = checked && !ollamaLive;

  return (
    <>
      {!checked && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-panel)]/80 px-6 py-2">
          <div className="text-xs text-[var(--color-text-muted)]">Checking Ollama connection…</div>
        </div>
      )}

      {ollamaOffline && (
        <div className="border-b border-amber-500/50 bg-amber-500/15 px-6 py-3">
          <div className="mx-auto text-sm font-medium text-amber-200">
            ⚠️ Ollama offline — run:{" "}
            <code className="text-amber-100">brew services start ollama</code> then{" "}
            <code className="text-amber-100">ollama pull deepseek-r1:8b</code>
          </div>
        </div>
      )}

      {ollamaLive && (
        <div className="border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="font-semibold text-emerald-300">
              ✅ AI LIVE — Ollama / DeepSeek-R1 ({info?.ai_model ?? health?.model ?? "local"})
            </span>
            <span className="text-[var(--color-text-muted)]">
              {health?.latency_ms != null ? `${Math.round(health.latency_ms)}ms · ` : ""}
              local, no rate limits
            </span>
          </div>
        </div>
      )}

      {info && checked && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-panel)]/50 px-6 py-2">
          <div className="text-xs text-[var(--color-text-muted)]">
            Sample transaction dataset · AI runs 100% locally via Ollama — no cloud API keys
          </div>
        </div>
      )}
    </>
  );
}
