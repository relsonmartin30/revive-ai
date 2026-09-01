import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatInr } from "../api";
import { PageHeader } from "../components/ui/PageHeader";
import type { ImportJobEvent, ImportRowState, SampleImportFile } from "../types";

const API = "http://localhost:8000";

function emptyRow(index: number, total: number): ImportRowState {
  return { index, total, phase: "pending" };
}

function applyEvent(rows: Map<number, ImportRowState>, event: ImportJobEvent): Map<number, ImportRowState> {
  const next = new Map(rows);
  if (event.event === "row_update" && event.index != null) {
    const prev = next.get(event.index) ?? emptyRow(event.index, event.total ?? 0);
    next.set(event.index, {
      ...prev,
      index: event.index,
      total: event.total ?? prev.total,
      phase: event.phase ?? prev.phase,
      transactionId: event.transaction_id ?? prev.transactionId,
      customerName: event.customer_name ?? prev.customerName,
      productName: event.product_name ?? prev.productName,
      amount: event.amount ?? prev.amount,
      declineCode: event.decline_code ?? prev.declineCode,
      diagnosis: event.diagnosis ?? prev.diagnosis,
      recoverabilityScore: event.recoverability_score ?? prev.recoverabilityScore,
      recoverabilityLabel: event.recoverability_label ?? prev.recoverabilityLabel,
      diagnosisAiNote: event.diagnosis_ai_note ?? prev.diagnosisAiNote,
      message: event.message ?? prev.message,
    });
  }
  return next;
}

export default function ImportLogs() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Map<number, ImportRowState>>(new Map());
  const [complete, setComplete] = useState(false);
  const [samples, setSamples] = useState<SampleImportFile[]>([]);

  useEffect(() => {
    api.getSampleImports().then(setSamples).catch(() => {});
  }, []);

  const startImport = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      setComplete(false);
      setRows(new Map());
      setProcessed(0);
      setStatusMessage(null);

      try {
        const { job_id, total: rowTotal } = await api.importLogs(file);
        setTotal(rowTotal);
        setUploading(false);
        setStreaming(true);

        await new Promise<void>((resolve, reject) => {
          const close = api.subscribeImportJob(job_id, (event) => {
            if (event.message) setStatusMessage(event.message);
            if (event.event === "row_update" && event.index != null) {
              setRows((prev) => applyEvent(prev, event));
              if (event.phase === "diagnosed") {
                setProcessed((p) => Math.max(p, event.index ?? p));
              }
            }
            if (event.event === "complete") {
              setComplete(true);
              setStreaming(false);
              setProcessed(rowTotal);
              setStatusMessage(event.message ?? "Import complete");
              close();
              setTimeout(() => navigate("/"), 2500);
              resolve();
            }
            if (event.event === "error") {
              setStreaming(false);
              close();
              reject(new Error(event.message ?? "Import failed"));
            }
          });
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setUploading(false);
        setStreaming(false);
      }
    },
    [navigate]
  );

  function onFileSelected(file: File | null) {
    if (!file || uploading || streaming) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".csv") && !ext.endsWith(".json")) {
      setError("Please upload a .csv or .json file");
      return;
    }
    startImport(file);
  }

  async function importSample(filename: string) {
    if (uploading || streaming) return;
    setError(null);
    try {
      const res = await fetch(`${API}/api/sample-imports/${filename}`);
      if (!res.ok) throw new Error("Could not load sample file");
      const blob = await res.blob();
      const file = new File([blob], filename, { type: "text/csv" });
      await startImport(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const rowList = Array.from(rows.values()).sort((a, b) => a.index - b.index);
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="ReviveAI · Log import"
        title="Import transaction logs"
      />
      <p className="-mt-4 mb-2 max-w-2xl text-body-sm text-[var(--color-text-secondary)]">
        Simulates live <code className="text-[var(--color-accent)]">payment.failed</code> webhook
        events for this workflow. Upload a CSV or JSON file shaped like exported webhook payloads
        — not connected to Razorpay production.
      </p>

      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFileSelected(e.dataTransfer.files[0] ?? null);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`card card-signature cursor-pointer border-2 border-dashed px-8 py-14 text-center transition-colors ${
          dragOver
            ? "border-emerald-400 bg-emerald-400/5"
            : "border-[var(--color-border)] hover:border-emerald-400/50"
        } ${uploading || streaming ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.json"
          className="hidden"
          onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
        />
        <p className="text-lg font-medium">
          {uploading ? "Uploading…" : streaming ? "Processing webhook replay…" : "Drop Razorpay-style log file here"}
        </p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          or click to browse · CSV or JSON · 8 sample scenarios below
        </p>
      </div>

      {samples.length > 0 && (
        <section className="card card-signature" style={{ padding: "20px" }}>
          <p className="text-section-label">Sample import files</p>
          <p className="text-body-sm mt-1 mb-4 text-[var(--color-text-secondary)]">
            Each file is 6–8 rows for a different demo scenario. Opens in Excel. Click Import to
            load live, or Download to save.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {samples.map((s) => (
              <div
                key={s.filename}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
              >
                <p className="font-medium text-[var(--color-text-primary)]">{s.title}</p>
                <p className="text-body-sm mt-1 text-[var(--color-text-muted)]">{s.description}</p>
                <p className="text-xs mt-2 text-[var(--color-text-muted)]">{s.rows} rows</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={uploading || streaming}
                    onClick={() => importSample(s.filename)}
                    className="btn btn-primary text-xs"
                  >
                    Import
                  </button>
                  <a
                    href={`${API}/api/sample-imports/${s.filename}`}
                    download={s.filename}
                    className="btn btn-ghost text-xs"
                  >
                    Download CSV
                  </a>
                </div>
              </div>
            ))}
          </div>
          <p className="text-body-sm mt-4 text-[var(--color-text-muted)]">
            Multi-sheet Excel workbook:{" "}
            <a
              href={`${API}/api/sample-imports/ReviveAI_Sample_Imports.xlsx`}
              className="text-[var(--color-accent)] hover:underline"
            >
              ReviveAI_Sample_Imports.xlsx
            </a>{" "}
            (one sheet per scenario — use individual CSVs for import)
          </p>
        </section>
      )}

      {(streaming || complete) && total > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              Processing {processed} of {total} transactions
            </span>
            <span className="text-[var(--color-muted)]">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {statusMessage && (
            <p className="font-mono text-xs text-emerald-400/90">{statusMessage}</p>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {complete && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
          <span>All transactions ingested and AI-reviewed.</span>
          <Link to="/" className="font-medium text-emerald-400 hover:underline">
            View dashboard →
          </Link>
          <span className="text-[var(--color-muted)]">(redirecting in a moment…)</span>
        </div>
      )}

      {rowList.length > 0 && (
        <div className="card card-signature overflow-x-auto" style={{ padding: 0 }}>
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-white/[0.02] text-xs uppercase tracking-wider text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Decline</th>
                <th className="px-4 py-3">AI diagnosis</th>
                <th className="px-4 py-3">Recoverability</th>
              </tr>
            </thead>
            <tbody>
              {rowList.map((row) => (
                <tr
                  key={row.index}
                  className="border-b border-[var(--color-border)]/60 last:border-0"
                >
                  <td className="px-4 py-3 text-[var(--color-muted)]">{row.index}</td>
                  <td className="px-4 py-3">{row.customerName ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{row.productName ?? "—"}</td>
                  <td className="px-4 py-3">{row.amount != null ? formatInr(row.amount) : "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.declineCode ?? "—"}</td>
                  <td className="max-w-xs px-4 py-3">
                    {row.phase === "diagnosing" && (
                      <span className="inline-flex items-center gap-2 text-amber-400">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
                        Diagnosing…
                      </span>
                    )}
                    {row.phase === "ingested" && (
                      <span className="text-[var(--color-muted)]">Ingested</span>
                    )}
                    {row.phase === "diagnosed" && (
                      <span className="line-clamp-2" title={row.diagnosisAiNote ?? row.diagnosis ?? ""}>
                        {row.diagnosisAiNote ?? row.diagnosis ?? "—"}
                      </span>
                    )}
                    {row.phase === "pending" && "—"}
                  </td>
                  <td className="px-4 py-3">
                    {row.phase === "diagnosed" && row.recoverabilityScore != null ? (
                      <span
                        className={
                          row.recoverabilityScore >= 0.7
                            ? "text-emerald-400"
                            : row.recoverabilityScore >= 0.4
                              ? "text-amber-400"
                              : "text-red-400"
                        }
                      >
                        {Math.round(row.recoverabilityScore * 100)}%
                        {row.recoverabilityLabel ? ` · ${row.recoverabilityLabel}` : ""}
                      </span>
                    ) : row.phase === "diagnosing" ? (
                      <span className="text-[var(--color-muted)]">…</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
