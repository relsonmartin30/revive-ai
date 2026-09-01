import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatInr } from "../api";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { StatusBadge } from "../components/StatusBadge";
import type { Transaction } from "../types";

function ConversationSourceBadge({ conversation }: { conversation: Transaction["conversation"] }) {
  if (!conversation.length) return null;
  const allLive = conversation.every((m) => m.source === "ollama");
  if (allLive) {
    return (
      <span className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
        AI LIVE — Ollama / DeepSeek-R1
      </span>
    );
  }
  const anyMock = conversation.some((m) => m.source === "mock");
  if (anyMock) {
    return (
      <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
        MOCK FALLBACK — Ollama offline
      </span>
    );
  }
  return null;
}

export default function TransactionDetail() {
  const { id } = useParams<{ id: string }>();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;

    const load = async () => {
      const data = await api.getTransaction(id);
      if (active) setTxn(data);

      if (
        data.strategy === "negotiation" &&
        data.status === "strategy_selected"
      ) {
        await api.negotiate(id);
      }
    };

    load().catch(console.error);
    const id_ = setInterval(load, 1500);
    return () => {
      active = false;
      clearInterval(id_);
    };
  }, [id]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [txn?.conversation?.length]);

  if (!txn) {
    return <p className="text-[var(--color-muted)]">Loading…</p>;
  }

  const banner =
    txn.status === "recovered"
      ? {
          cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
          text: `Recovered ${formatInr(txn.recovered_amount ?? 0)} · ${txn.payment_link}`,
        }
      : txn.status === "lost"
        ? {
            cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
            text: txn.strategy === "none"
              ? "Not pursued — low recoverability"
              : "Recovery unsuccessful — customer declined or max turns reached",
          }
        : null;

  return (
    <div className="space-y-8">
      <Link
        to="/transactions"
        className="text-sm text-[var(--color-muted)] hover:text-emerald-400"
      >
        ← Back to transactions
      </Link>

      {banner && (
        <div className={`rounded-xl border px-5 py-4 text-sm ${banner.cls}`}>
          {banner.text}
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
            Case Inspector
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{txn.customer_name}</h1>
          <p className="mt-1 text-[var(--color-muted)]">{txn.product_name}</p>
        </div>
        <StatusBadge status={txn.status} />
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Amount" value={formatInr(txn.amount)} />
        <Fact label="Decline" value={txn.decline_code.replace(/_/g, " ")} />
        <Fact label="Rule Diagnosis" value={txn.diagnosis ?? "—"} />
        <Fact
          label="Strategy"
          value={txn.strategy?.replace(/_/g, " ") ?? "—"}
        />
      </section>

      {txn.diagnosis_ai_note && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-medium">AI Risk Note</h2>
            {txn.diagnosis_ai_note_source === "ollama" ? (
              <span className="text-xs font-semibold text-emerald-400 border border-emerald-500/40 rounded-full px-2 py-0.5">
                ollama · local
              </span>
            ) : (
              <span className="text-xs font-semibold text-amber-400 border border-amber-500/40 rounded-full px-2 py-0.5">
                Ollama offline — rule-based fallback
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed">{txn.diagnosis_ai_note}</p>
        </section>
      )}

      {txn.analysis && <AnalysisPanel analysis={txn.analysis} />}

      {txn.customer_persona && (
        <p className="text-sm text-[var(--color-muted)]">
          Customer persona: <span className="text-[var(--color-text)]">{txn.customer_persona}</span>
        </p>
      )}

      {txn.strategy === "negotiation" && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-medium">Negotiation</h2>
            <ConversationSourceBadge conversation={txn.conversation} />
          </div>
          {txn.status === "recovering" && txn.conversation.length === 0 && (
            <p className="text-sm text-amber-400 animate-pulse">
              Local LLM agents are talking…
            </p>
          )}
          <div className="space-y-4 max-h-[480px] overflow-y-auto pr-2">
            {txn.conversation.map((msg, i) => (
              <div
                key={i}
                className={`msg-enter flex ${msg.role === "reviveai" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                    msg.role === "reviveai"
                      ? "bg-[var(--color-bg)] border border-[var(--color-border)]"
                      : "bg-emerald-600/20 border border-emerald-500/30"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-xs font-medium text-[var(--color-muted)]">
                      {msg.role === "reviveai" ? "ReviveAI" : "Customer"}
                    </p>
                    <span
                      className={`text-[10px] uppercase tracking-wide ${
                        msg.source === "ollama" ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {msg.source}
                    </span>
                  </div>
                  {msg.message}
                </div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 text-sm font-medium capitalize">{value}</p>
    </div>
  );
}
