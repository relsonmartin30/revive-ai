import type {
  AiCallLogEntry,
  AiHealth,
  DashboardSummary,
  DemoInfo,
  ImpactSummary,
  ImpactBreakdown,
  ExecutiveSummary,
  IssuerHealthEntry,
  StrategyPerformance,
  Transaction,
} from "./types";

const API = "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.json();
}

export const api = {
  generateBatch: (count = 40, spikeIssuer = false) =>
    request<{ created: number; ids: string[] }>(
      `/api/generate-batch?count=${count}${spikeIssuer ? "&spike_issuer=true" : ""}`,
      { method: "POST" }
    ),

  runRecovery: () =>
    request<{ queued: number; message: string }>("/api/run-recovery", {
      method: "POST",
    }),

  startDemo: (count = 40) =>
    request<{
      message: string;
      transactions_created: number;
      recovery_queued: number;
      next: string;
    }>(`/api/demo/start?count=${count}`, { method: "POST" }),

  getDemoInfo: () => request<DemoInfo>("/api/demo/info"),

  getAiHealth: (force = false) =>
    request<AiHealth>(`/api/ai-health${force ? "?force=true" : ""}`),

  getAiCallLog: (limit = 50) =>
    request<AiCallLogEntry[]>(`/api/ai-call-log?limit=${limit}`),

  getTransactions: (params?: {
    status?: string;
    view?: "active" | "archived" | "all";
    since_hours?: number;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.view) q.set("view", params.view);
    if (params?.since_hours != null) q.set("since_hours", String(params.since_hours));
    if (params?.limit != null) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Transaction[]>(`/api/transactions${qs ? `?${qs}` : ""}`);
  },

  getDataStats: () => request<import("./types").DataStats>("/api/data/stats"),

  archiveData: (body: { mode: string; since_hours?: number }) =>
    request<{ archived: number; mode: string }>("/api/data/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  unarchiveData: (body: { mode?: string }) =>
    request<{ restored: number; mode: string }>("/api/data/unarchive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getSampleImports: () =>
    request<import("./types").SampleImportFile[]>("/api/sample-imports"),

  getTransaction: (id: string) =>
    request<Transaction>(`/api/transactions/${id}`),

  negotiate: (id: string) =>
    request<{ status: string; transaction: Transaction }>(
      `/api/transactions/${id}/negotiate`,
      { method: "POST" }
    ),

  getDashboard: () => request<DashboardSummary>("/api/dashboard-summary"),

  getStrategyPerformance: () =>
    request<StrategyPerformance[]>("/api/strategy-performance"),

  simulateBaseline: (transactionIds?: string[]) =>
    request<{ simulated: number; impact_preview: ImpactSummary }>("/api/simulate-baseline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_ids: transactionIds ?? null }),
    }),

  getImpactSummary: () => request<ImpactSummary>("/api/impact-summary"),

  getImpactBreakdown: () => request<ImpactBreakdown>("/api/impact-breakdown"),

  getIssuerHealth: () => request<IssuerHealthEntry[]>("/api/issuer-health"),

  getExecutiveSummary: (force = false) =>
    request<ExecutiveSummary>(`/api/executive-summary${force ? "?force=true" : ""}`),

  importLogs: async (file: File, replace = true) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/api/import-logs?replace=${replace}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail =
          typeof body.detail === "string"
            ? body.detail
            : body.detail?.missing_fields
              ? `Missing columns: ${body.detail.missing_fields.join(", ")}`
              : JSON.stringify(body.detail);
      } catch {
        detail = await res.text();
      }
      throw new Error(detail || res.statusText);
    }
    return res.json() as Promise<{ job_id: string; total: number; message: string }>;
  },

  subscribeImportJob: (jobId: string, onEvent: (event: import("./types").ImportJobEvent) => void) => {
    const es = new EventSource(`${API}/api/import-jobs/${jobId}/stream`);
    es.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data));
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  },
};

export function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}
