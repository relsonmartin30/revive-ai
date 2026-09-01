export type TransactionStatus =
  | "failed"
  | "diagnosing"
  | "strategy_selected"
  | "recovering"
  | "recovered"
  | "lost";

export type Strategy =
  | "smart_retry"
  | "smart_retry_delayed"
  | "card_update_nudge"
  | "method_switch"
  | "soft_dunning"
  | "negotiation"
  | "none";

export interface ConversationMessage {
  role: "reviveai" | "customer";
  message: string;
  timestamp: string;
  source: "ollama" | "mock";
}

export interface AnalysisSignal {
  label: string;
  value: string;
  impact: "positive" | "negative" | "neutral" | "high_value" | "low_value";
}

export interface TransactionAnalysis {
  mode: string;
  engine: string;
  signals: AnalysisSignal[];
  recoverability_score: number;
  recoverability_label: string;
  diagnosis_summary: string;
  recommended_strategy: string | null;
  strategy_reason: string | null;
  note: string;
  simulated_outcome?: {
    result: string;
    amount?: number;
    payment_link?: string;
    method?: string;
    reason?: string;
  };
}

export interface Transaction {
  id: string;
  customer_name: string;
  product_name: string;
  amount: number;
  currency: string;
  decline_code: string;
  customer_tenure_days: number;
  past_decline_count: number;
  created_at: string;
  status: TransactionStatus;
  diagnosis: string | null;
  strategy: Strategy | null;
  recovered_amount: number | null;
  payment_link: string | null;
  conversation: ConversationMessage[];
  customer_persona: string | null;
  analysis: TransactionAnalysis | null;
  is_demo: boolean;
  diagnosis_ai_note: string | null;
  diagnosis_ai_note_source: "ollama" | "mock" | null;
  razorpay_payment_id?: string | null;
  razorpay_order_id?: string | null;
  payment_method?: string | null;
  issuer?: string | null;
  strategy_note?: string | null;
  archived_at?: string | null;
}

export type DataView = "active" | "archived";

export type TimeWindow = "1h" | "2h" | "3h" | "today" | "all";

export interface DataStats {
  total: number;
  active: number;
  archived: number;
  active_last_1h: number;
  active_last_2h: number;
  active_last_3h: number;
  active_today: number;
}

export interface SampleImportFile {
  filename: string;
  title: string;
  description: string;
  rows: number;
  use_case: string;
}

export interface DashboardSummary {
  total_recovered_inr: number;
  total_attempted: number;
  total_transactions: number;
  recovery_rate: number;
  cases_in_progress: number;
  cases_not_pursued: number;
  decline_breakdown: Record<string, number>;
  strategy_breakdown: Record<string, number>;
  not_pursued_cases: Array<{
    id: string;
    customer_name: string;
    amount: number;
    diagnosis: string | null;
    decline_code: string;
  }>;
}

export interface StrategyPerformance {
  decline_code: string;
  strategy: string;
  attempts: number;
  successes: number;
  success_rate: number;
}

export interface DemoInfo {
  mode: string;
  description: string;
  steps: string[];
  ai_mode: string;
  ai_connected: boolean;
  ai_model: string;
}

export interface AiHealth {
  connected: boolean;
  key_configured: boolean;
  rate_limited: boolean;
  model: string;
  latency_ms: number | null;
  response: string | null;
  error: string | null;
  provider: string;
}

export interface AiCallLogEntry {
  id: number;
  timestamp: string;
  agent: string;
  transaction_id: string | null;
  model: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  source: string;
  prompt_preview: string | null;
  response_preview: string | null;
}

export type ImportPhase = "pending" | "ingested" | "diagnosing" | "diagnosed";

export interface ImportJobEvent {
  event: "row_update" | "complete" | "error";
  phase?: ImportPhase;
  index?: number;
  total?: number;
  transaction_id?: string;
  customer_name?: string;
  product_name?: string;
  amount?: number;
  currency?: string;
  decline_code?: string;
  diagnosis?: string;
  recoverability_score?: number;
  recoverability_label?: string;
  diagnosis_ai_note?: string;
  message?: string;
}

export interface ImportRowState {
  index: number;
  total: number;
  phase: ImportPhase;
  transactionId?: string;
  customerName?: string;
  productName?: string;
  amount?: number;
  declineCode?: string;
  diagnosis?: string;
  recoverabilityScore?: number;
  recoverabilityLabel?: string;
  diagnosisAiNote?: string;
  message?: string;
}

export interface ImpactSummary {
  revive_recovery_rate: number;
  baseline_recovery_rate: number;
  lift_percentage: number;
  revive_recovered_total: number;
  baseline_recovered_total: number;
  extra_amount_recovered: number;
  cohort_size: number;
  attempted_count: number;
  total_amount?: number;
}

export interface ImpactDeclineRow {
  decline_code: string;
  transaction_count: number;
  revive_recovered_total: number;
  baseline_expected_total: number;
  difference_total: number;
}

export interface ImpactStrategyRow {
  strategy: string;
  transaction_count: number;
  revive_recovered_total: number;
  baseline_expected_total: number;
  difference_total: number;
}

export interface ImpactTransactionRow {
  id: string;
  customer_name: string;
  product_name: string;
  amount: number;
  decline_code: string;
  strategy: string;
  revive_actual: number;
  baseline_expected: number;
  difference: number;
  status: string;
}

export interface ImpactBreakdown extends ImpactSummary {
  by_decline_code: ImpactDeclineRow[];
  by_strategy: ImpactStrategyRow[];
  transactions: ImpactTransactionRow[];
}

export interface IssuerHealthEntry {
  issuer_name: string;
  decline_count: number;
  status: "normal" | "anomaly";
  likely_cause: "customer-side" | "infra-side";
  rerouted_count: number;
  average_decline_count: number;
}

export interface ExecutiveSummary {
  summary: string;
  timestamp: string;
  source: "ollama" | "mock";
  model: string;
}
