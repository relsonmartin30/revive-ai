# ReviveAI — Architecture & Data Flow

This document describes how ReviveAI actually works today, based on the current code in `backend/main.py` and the React frontend. It is written in plain language for someone with no programming or AI background.

---

## 1. What This Project Does

When a customer tries to pay for something online and the payment fails, a business loses money and often does not know what to do next. ReviveAI is a demo tool that pretends to be a smart recovery assistant for those failed payments. It takes failed payment records (either made-up sample data or rows from a CSV file shaped like Razorpay payment logs), figures out *why* each payment probably failed using fixed rules, picks a recovery action (retry the card, send a reminder, start an AI conversation, or give up), and then simulates whether the money comes back. A dashboard shows totals, comparisons, and an AI-written summary — all running on a Mac using a local AI program called Ollama, with no cloud API keys required.

---

## 2. The Tech Stack

Everything below is what the project actually uses, taken from `backend/requirements.txt` and `frontend/package.json`.

### Backend (the server — runs on port 8000)

| Technology | What it is | Why it is used here |
|------------|------------|---------------------|
| **Python** | A programming language | Runs all the business logic |
| **FastAPI** | A tool for building web **APIs** (online request handlers that the frontend calls) | Exposes all `/api/...` endpoints |
| **Uvicorn** | A program that runs the FastAPI server | Keeps the backend listening for requests |
| **SQLModel** | A library that connects Python code to a database | Defines tables and reads/writes rows |
| **SQLite** | A small file-based database stored as `backend/reviveai.db` | Saves all transactions and results locally |
| **httpx** | A library for making HTTP requests | Talks to Ollama on the same computer |
| **python-dotenv** | Loads settings from a `.env` file | Reads Ollama URL and model name |
| **python-multipart** | Handles file uploads | Accepts CSV/JSON import files |
| **openpyxl** | Reads/writes Excel workbooks | Builds the 8-sheet sample import workbook |

### Frontend (the website — runs on port 5174)

| Technology | What it is | Why it is used here |
|------------|------------|---------------------|
| **React** | A library for building interactive web pages | Powers all screens (Dashboard, Transactions, etc.) |
| **TypeScript** | JavaScript with type checking | Catches errors while building the frontend |
| **Vite** | A fast development server and build tool | Serves the website during `./start.sh` |
| **React Router** | Handles different URLs (`/`, `/transactions`, etc.) | Navigation between pages |
| **Tailwind CSS** | A styling system | Colors, layout, and visual design |

### AI (local, not in the cloud)

| Technology | What it is | Why it is used here |
|------------|------------|---------------------|
| **Ollama** | A program that runs AI models on your Mac | Hosts the AI locally at `http://localhost:11434` |
| **DeepSeek-R1 8B** (`deepseek-r1:8b`) | A specific AI model | Writes diagnosis notes, negotiation messages, and executive summaries |

### Helper scripts (Mac only)

| Script | Purpose |
|--------|---------|
| `setup.sh` | One-time install: Python deps, npm packages, Ollama model |
| `start.sh` | Starts backend + frontend and opens the browser |
| `reset.sh` | Deletes the database for a clean demo |
| `package-for-share.sh` | Creates a clean zip file to send to someone else |

---

## 3. The Full Data Flow, Step by Step

A **transaction** is one failed payment record. Each transaction moves through **statuses**: `failed` → `diagnosing` → `strategy_selected` → `recovering` → `recovered` or `lost`.

There are **two ways** payments enter the system. Both paths merge at diagnosis.

---

### Path A — Generate Batch (Dashboard button: "Generate batch" or "Run full pipeline")

1. **User clicks a button** on the Dashboard (`frontend/src/pages/Dashboard.tsx`).
   - "Generate batch" calls `POST /api/generate-batch` (default: 40 transactions).
   - "Run full pipeline" calls `POST /api/demo/start`, which clears the database, generates a batch, *and* runs recovery automatically.

2. **`generate_batch`** (`backend/main.py`) creates fake failed payments one at a time.
   - Picks random Indian customer names, product names, amounts, decline reasons, bank (**issuer**), and payment method.
   - Every 5th transaction follows a fixed pattern (e.g. transaction 0 = insufficient funds, high amount).
   - Optional `spike_issuer=true` (used from Issuer Health page) forces the first 15 transactions to use "HDFC Bank" to trigger issuer anomaly detection.
   - Each new row starts with status `failed`.

3. **`auto_diagnose_transaction`** runs immediately for each new transaction:
   - Sets status to `diagnosing`.
   - **`diagnose_transaction`** — applies rule-based text diagnosis from decline code + customer history.
   - **`select_strategy_for`** — picks a recovery strategy from diagnosis + amount + score.
   - **`build_analysis`** — builds a JSON summary for the UI (signals, score, labels).
   - Sets status to `strategy_selected`.
   - **`generate_diagnosis_ai_note`** — asks Ollama (or a mock fallback) for a 1–2 sentence AI note; runs in the background during batch generation.

4. **`run_simulate_baseline`** — for each transaction, stores a "blind retry" expected recovery amount (probability × amount, not random).

5. **`compute_issuer_health`** — counts declines per bank; if any bank has more than 2× the average, marks it an anomaly and may **reroute** pending transactions to `smart_retry_delayed`.

6. **If user only generated a batch** — transactions stop at `strategy_selected`. User must click "Run recovery" or open individual negotiation cases.

7. **`run_recovery`** (`POST /api/run-recovery`) — processes every transaction still at `failed` or `strategy_selected`:
   - Re-runs **`apply_diagnosis_and_strategy`** (rules + sync AI note).
   - If strategy is **`none`** → status becomes `lost` immediately (not worth pursuing).
   - If strategy is **`negotiation`** → status becomes `recovering`, assigns a random customer persona, starts **`run_negotiation`** in the background (AI chat).
   - For all other strategies → **`simulate_simple_recovery`** rolls random success/failure, sets `recovered` or `lost`, stores a fake payment link on success, records outcome in **`StrategyOutcome`** table.

8. **Negotiation cases** (`run_negotiation`):
   - Up to 6 back-and-forth turns between two AI roles: "ReviveAI" (collector) and "customer" (simulated).
   - If customer message contains `[ACCEPT]` → `recovered` with full amount.
   - If `[DECLINE]` after turn 2 → `lost`.
   - Conversation saved as JSON on the transaction.

9. **Dashboard refreshes** every 3 seconds via `GET /api/dashboard-summary`, `GET /api/strategy-performance`, plus embedded Impact and Issuer Health panels.

10. **Executive summary** loads once via `GET /api/executive-summary` — Ollama writes a leadership paragraph from aggregated numbers.

---

### Path B — Import Logs (Import Logs page)

1. **User uploads a CSV or JSON file** (`frontend/src/pages/ImportLogs.tsx`) via `POST /api/import-logs`, **or clicks Import** on one of eight built-in sample scenarios.
   - File must include columns: `razorpay_payment_id`, `razorpay_order_id`, `customer_name`, `product_name`, `amount`, `currency`, `method`, `decline_code`, `customer_tenure_days`, `past_decline_count`, `created_at`. Optional: `issuer` (bank name).
   - **Sample files:** eight CSVs in `backend/sample_data/` (6–8 rows each), listed at `GET /api/sample-imports` and downloadable at `GET /api/sample-imports/{filename}`. One Excel workbook `ReviveAI_Sample_Imports.xlsx` (8 sheets, one per scenario) is also available for browsing — use individual CSVs for one-click import in the app.
   - By default `replace=true` — clears existing database first.

2. **Backend creates an import job** and processes rows one by one in **`_run_import_job`** (async, with deliberate delays of 0.3–0.5 seconds per row to simulate live webhook arrival).

3. **Per row:**
   - Creates a `Transaction` with status `failed` and Razorpay-style IDs.
   - Sends SSE event: `ingested`.
   - Sets status `diagnosing`, sends event: `diagnosing`.
   - Runs **`auto_diagnose_transaction`** with AI note filled synchronously.
   - Sends event: `diagnosed` with diagnosis, strategy, recoverability score, AI note.

4. **After all rows:** runs baseline simulation and issuer health check; sends `complete` event.

5. **Frontend redirects to Dashboard** after 2.5 seconds — but **does not auto-run recovery**. User must click "Run recovery" or "Run full pipeline" to simulate money coming back.

6. **Live progress table** on the Import page updates row-by-row from the SSE stream (`GET /api/import-jobs/{job_id}/stream`).

---

### Viewing transactions and managing demo data volume

After many hackathon runs, the database can hold hundreds of rows. **Demo data view** (`frontend/src/components/DataControls.tsx`) on the Dashboard and Transactions pages keeps the stage clean without deleting data.

1. **Active vs Archive / History** — toggle what you are browsing. Archived rows stay in SQLite but are hidden from dashboard stats, impact, issuer health, and executive summary.

2. **Time windows** (Active view only) — filter the transaction list to Last 1h, 2h, 3h, Today, or All active. Counts come from `GET /api/data/stats`.

3. **Archive actions** (`POST /api/data/archive`):
   - **Archive older than Xh** — moves active transactions older than the selected window to archive (default 3h when "All active" is selected).
   - **Archive all active** — moves every non-archived row to archive in one click.
   - **Restore from archive** (`POST /api/data/unarchive`) — sets `archived_at` back to null for all archived rows.

4. **Transactions page** (`GET /api/transactions`) supports query params: `view` (`active` | `archived` | `all`), `since_hours`, `status`, and `limit` (default 200). Polls every 3 seconds.

5. **Dashboard summary** (`GET /api/dashboard-summary`) always aggregates **non-archived** transactions only via `_load_visible_transactions()` — same for impact and issuer health endpoints.

6. **Transaction detail page** (`GET /api/transactions/{id}`) still works for any row, including archived ones. Polls every 1.5 seconds. If strategy is `negotiation` and status is still `strategy_selected`, the page automatically calls `POST /api/transactions/{id}/negotiate` to start the AI conversation. The analysis panel shows rule-based signals, AI diagnosis note, and conversation transcript with badges showing whether Ollama or mock text was used.

---

## 4. Every Feature, Explained Simply

### Diagnosis engine (rules, not AI)

- **What it is:** A fixed set of if/then rules that read the decline reason and customer facts and output a short diagnosis string.
- **What triggers it:** Every time a transaction is diagnosed — during batch generation, import, manual diagnose button, or recovery.
- **What it does:** Function **`diagnose_transaction`** checks the decline code (`insufficient_funds`, `expired_card`, etc.) plus `past_decline_count` and `customer_tenure_days`, and returns phrases like "recurring cash flow strain" or "card needs updating, high recoverability".
- **Why it matters:** This is the deterministic brain. The AI note adds color, but strategy selection always follows these rules first.

### Recoverability score

- **What it is:** A number from 0.05 to 0.95 estimating how likely recovery is.
- **What triggers it:** Calculated inside **`recoverability_score`** whenever diagnosis or strategy runs.
- **What it does:** Starts at 0.5, adjusts based on diagnosis keywords, adds +0.1 for customers over 365 days tenure, subtracts 0.2 for 4+ past declines.
- **Why it matters:** Drives strategy choice and recovery simulation odds.

### Strategy selection

- **What it is:** Picks one recovery action per transaction.
- **What triggers it:** **`select_strategy_for`** after diagnosis.
- **What it does (priority order):**
  1. Score below 0.2 → `none` (give up)
  2. Expired card → `card_update_nudge`
  3. Bank risk flags → `method_switch`
  4. Amount over ₹3,000 and score ≥ 0.4 → `negotiation`
  5. Amount under ₹800 and score ≥ 0.6 → `smart_retry`
  6. Mid amount ₹800–3,000 and moderate score → `soft_dunning`
  7. Otherwise falls through to smart_retry, soft_dunning, or none
- **Special case:** `smart_retry_delayed` is **never** chosen by rules alone — only by issuer anomaly rerouting.
- **Why it matters:** Different failure types get different treatment instead of retrying everything the same way.

### Recovery simulation (non-negotiation)

- **What it is:** A random roll deciding success or failure for simple strategies.
- **What triggers it:** **`simulate_simple_recovery`** during `run_recovery`.
- **What it does:** Combines recoverability score with a strategy-specific boost (e.g. card update nudge +0.25), caps at 95%, rolls random. Success = full amount recovered and a fake link `https://pay.reviveai.demo/{id}`.
- **Why it matters:** Lets the demo show recovered vs lost outcomes without real payment processing.

### Negotiation agent (AI conversation)

- **What it is:** A simulated chat between a recovery assistant and a fake customer, both powered by Ollama when available.
- **What triggers it:** Strategy = `negotiation` and recovery runs, or user opens a negotiation transaction detail page.
- **What it does:** **`run_negotiation`** runs up to 6 turns. ReviveAI opens with a product-specific message and can offer a 3-part installment plan (40% now, rest split over 2 weeks and 4 weeks). The customer AI replies in character and may end with `[ACCEPT]`, `[COUNTER]`, or `[DECLINE]`.
- **Why it matters:** Shows how high-value cases could get a personalized conversation instead of a blind retry.

### Issuer health radar

- **What it is:** A monitor that groups failed payments by bank (**issuer**) and flags unusual spikes.
- **What triggers it:** After batch generation, after import completes, and when the Issuer Health page loads (polls every 5 seconds).
- **What it does:** **`compute_issuer_health`** counts declines per issuer. If any issuer has more than **2× the average** decline count, it is marked `anomaly` with likely cause `infra-side`. **`apply_issuer_anomaly_reroutes`** then changes pending transactions from that bank to strategy `smart_retry_delayed` with an explanatory note.
- **Demo trick:** "Generate spike batch" on Issuer Health page calls generate-batch with `spike_issuer=true`, forcing 15 declines from HDFC Bank.
- **Why it matters:** Distinguishes "this customer's card is bad" from "this bank's systems might be having a bad day."

### Impact simulator (baseline comparison)

- **What it is:** Compares ReviveAI's simulated recovery results against a simple "blind retry" benchmark.
- **What triggers it:** Automatically after batch generation and import; displayed on Impact page (polls every 4 seconds) and compact panel on Dashboard.
- **What it does:**
  - **`baseline_recovery_probability`** assigns a fixed percentage per decline type (e.g. 25% for insufficient funds, 5% for expired card).
  - **`baseline_expected_amount`** = probability × transaction amount (deterministic, **not** a random simulation).
  - **`compute_impact_summary`** compares total recovered by ReviveAI vs total baseline expected, calculates lift percentage and extra rupees recovered.
  - **`compute_impact_breakdown`** groups results by decline type, strategy, and individual transaction.
- **Why it matters:** Answers "did smart strategies beat doing nothing intelligent?"

### Executive summary

- **What it is:** A one-paragraph AI-written overview for leadership.
- **What triggers it:** Dashboard loads **`ExecutiveSummaryCard`**, which calls `GET /api/executive-summary`. Regenerate button forces a fresh call.
- **What it does:** **`generate_executive_summary`** gathers impact numbers, issuer anomalies, top recovered and lost cases into a JSON snapshot, sends it to Ollama, caches result for 30 seconds. Falls back to rule-based text if Ollama is offline or response too short.
- **Why it matters:** Turns raw numbers into readable narrative without manual report writing.

### Log import (Razorpay-style)

- **What it is:** Upload a CSV or JSON file that looks like exported payment failure logs, or import a built-in sample scenario.
- **What triggers it:** User drops a file on the Import Logs page, or clicks **Import** on a sample card.
- **What it does:** Validates required columns, creates transactions row-by-row with artificial delays, diagnoses each, streams progress events to the browser. Does **not** connect to real Razorpay — it **simulates** what would happen if webhooks arrived live.
- **Sample scenarios (8 files):**

| File | Use case |
|------|----------|
| `01_decline_types_mix.csv` | One row per decline code — best first demo |
| `02_high_value_negotiation.csv` | ₹4k–₹12k amounts → AI negotiation |
| `03_loyal_customers.csv` | Long tenure, high recoverability |
| `04_repeat_decliners.csv` | Many past declines → likely skipped |
| `05_issuer_spike_hdfc.csv` | All HDFC → issuer health radar |
| `06_subscription_renewals.csv` | SaaS / subscription renewals |
| `07_upi_wallet_mix.csv` | UPI & wallet → method switch |
| `08_live_stage_demo.csv` | Recent timestamps for on-stage import |

- **Excel workbook:** `backend/sample_data/ReviveAI_Sample_Imports.xlsx` — one sheet per scenario (regenerate with `python backend/sample_data/build_workbook.py`).
- **Why it matters:** Demo path for "we already have failure logs" instead of generating fake data, with small curated sets for live presentations.

### Demo data archive & time filters

- **What it is:** A way to hide old hackathon runs without wiping the database.
- **What triggers it:** User clicks archive/restore buttons in **Demo data view** on Dashboard or Transactions.
- **What it does:** Sets `archived_at` on selected transactions. Dashboard, impact, issuer health, and executive summary ignore archived rows. Transaction list can show Active, Archive / History, or filter by time window (1h / 2h / 3h / today).
- **API:** `GET /api/data/stats`, `POST /api/data/archive`, `POST /api/data/unarchive`.
- **Why it matters:** Keeps on-stage demos focused on recent data (e.g. 7–40 rows) instead of 300+ accumulated test rows.

### AI health check

- **What it is:** A ping to see if Ollama is running and responding.
- **What triggers it:** Top banner polls `GET /api/ai-health` every 8 seconds; manual verify was removed in favor of automatic polling.
- **What it does:** **`run_ai_health_check`** tries to reach Ollama, sends a tiny test message ("Reply with the word CONNECTED"), returns connected status, model name, latency. Results cached 120 seconds unless `force=true`.
- **Why it matters:** User sees immediately if local AI is available; banner switches from amber warning to green live status.

### AI call log

- **What it is:** An audit trail of AI requests.
- **What triggers it:** Logged automatically whenever **`ai_reply`** successfully calls Ollama.
- **What it does:** Stores agent name, model, latency, token counts, and 200-character previews of prompt and response in the **`ai_call_logs`** table. Shown on Dashboard via **`AiCallLogPanel`**.
- **Why it matters:** Transparency into what the AI was asked and how long it took.

### Structured analysis panel

- **What it is:** A JSON bundle shown on transaction detail — signals, score label, strategy reason.
- **What triggers it:** Built by **`build_analysis`** during every diagnosis.
- **What it does:** Lists human-readable decline reason, tenure, past declines, amount tier; labels recoverability High/Moderate/Low; explains why the chosen strategy fits. Marked `"engine": "rule_based"` — no AI involved in this part.
- **Why it matters:** Shows the reasoning behind each decision in the UI.

### Demo banner and one-click demo

- **What it is:** Top-of-screen status bar plus optional info line about sample data.
- **What triggers it:** Loads on every page via `App.tsx`.
- **What it does:** Shows Ollama offline warning or green live status; notes that data is sample/local.
- **One-click demo (`POST /api/demo/start`):** Wipes database, creates 40 transactions, runs full recovery — the fastest way to populate the dashboard.

---

## 5. The Data Model

All tables live in SQLite file `backend/reviveai.db`.

### Table: `transactions`

The main record for each failed payment.

| Field | Plain meaning |
|-------|---------------|
| `id` | Unique ID (UUID string) |
| `customer_name` | Fake or imported customer name |
| `product_name` | What they tried to buy (subscription, box, etc.) |
| `amount` | Amount in rupees |
| `currency` | Usually `INR` |
| `decline_code` | Why the bank said no — one of: `insufficient_funds`, `do_not_honor`, `expired_card`, `risk_block`, `threeds_failure`, `currency_mismatch` |
| `customer_tenure_days` | How long they have been a customer |
| `past_decline_count` | How many times their payments failed before |
| `created_at` | When the failure happened |
| `status` | Where in the pipeline: `failed`, `diagnosing`, `strategy_selected`, `recovering`, `recovered`, `lost` |
| `diagnosis` | Rule-based explanation text |
| `strategy` | Chosen recovery action: `smart_retry`, `smart_retry_delayed`, `card_update_nudge`, `method_switch`, `soft_dunning`, `negotiation`, or `none` |
| `recovered_amount` | Rupees recovered (0 if lost) |
| `payment_link` | Fake demo link if recovered |
| `conversation` | JSON array of negotiation messages |
| `customer_persona` | Personality type for negotiation role-play |
| `analysis` | JSON blob for UI analysis panel |
| `is_demo` | Always `true` — marks sample data |
| `diagnosis_ai_note` | AI-written 1–2 sentence note |
| `diagnosis_ai_note_source` | `ollama` or `mock` |
| `razorpay_payment_id` | Payment ID from import (optional) |
| `razorpay_order_id` | Order ID from import (optional) |
| `payment_method` | `card`, `upi`, `netbanking`, or `wallet` |
| `issuer` | Bank name, e.g. "HDFC Bank" |
| `strategy_note` | Extra explanation, e.g. after issuer reroute |
| `archived_at` | When the row was moved to archive; `null` = visible in dashboard/demo views |

### Table: `baseline_outcomes`

Stores the "blind retry" benchmark for each transaction.

| Field | Plain meaning |
|-------|---------------|
| `transaction_id` | Links to one transaction |
| `baseline_recovered` | Whether expected value is greater than zero |
| `baseline_recovered_amount` | Expected rupees = probability × amount (not random) |
| `created_at` | When baseline was calculated |

### Table: `ai_call_logs`

Record of each Ollama call.

| Field | Plain meaning |
|-------|---------------|
| `id` | Auto-increment row number |
| `timestamp` | When the call happened |
| `agent` | Who was speaking: `diagnosis`, `reviveai`, `customer`, `executive_summary`, etc. |
| `transaction_id` | Related transaction, if any |
| `model` | AI model name used |
| `latency_ms` | How long the call took in milliseconds |
| `input_tokens` | Tokens sent (from Ollama response) |
| `output_tokens` | Tokens received |
| `source` | Always logged as `ollama` when persisted |
| `prompt_preview` | First 200 characters of the user message |
| `response_preview` | First 200 characters of the AI reply |

### Table: `strategyoutcome` (class `StrategyOutcome`)

Learning log of recovery attempts.

| Field | Plain meaning |
|-------|---------------|
| `id` | Auto-increment row number |
| `decline_code` | Decline type for this attempt |
| `strategy` | Strategy used |
| `success` | `true` if recovery succeeded |
| `created_at` | When recorded |

### In-memory only (not in database)

| Store | Plain meaning |
|-------|---------------|
| `IMPORT_JOBS` | Tracks running import jobs and SSE events |
| Health cache | Caches AI health check for 120 seconds |
| Executive summary cache | Caches summary for 30 seconds |

---

## 6. The AI Prompts Actually Used

Ollama is called via `POST http://localhost:11434/api/chat` with model `deepseek-r1:8b`, temperature 0.3, up to 400 tokens (except health check). If Ollama is unreachable, canned **mock** text is used instead and labeled `source: mock`.

### Prompt 1 — AI health check

**When:** `GET /api/ai-health` (via `run_ai_health_check`)

**User message only (no system prompt):**
> Reply with the word CONNECTED and nothing else.

**Purpose:** Confirm Ollama is alive. Temperature 0, max 16 tokens.

---

### Prompt 2 — Diagnosis AI note

**When:** After rule diagnosis, via `generate_diagnosis_ai_note` (background during batch, sync during import/recovery)

**System:**
> You are a payment recovery risk analyst. Write exactly 1-2 concise sentences explaining recovery likelihood. Be specific to the customer facts. No bullet points.

**User (filled with real transaction data):**
> Transaction facts:
> - Customer: {name}, tenure {days} days
> - Product: {product}, amount ₹{amount}
> - Decline code: {code}
> - Past declines: {count}
> - Rule-based diagnosis: {diagnosis}
>
> Write a natural-language risk/recovery note.

**Agent label in logs:** `diagnosis`

---

### Prompt 3 — Negotiation: ReviveAI (collector)

**When:** Each turn of `run_negotiation`, agent `reviveai`

**System (dynamic — includes real amounts and installment plan):**
> You are ReviveAI, a payment recovery assistant for {product_name}.
> Customer: {customer_name}, tenure {tenure} days, owes ₹{amount}.
> Diagnosis: {diagnosis}.
> Be empathetic, not pushy. Reference the actual product. If they show financial strain, offer installments: ₹{40%} now, ₹{half} in 2 weeks, ₹{rest} in 4 weeks.
> Adapt based on customer replies — smaller first payment if hesitant, one grace period if declining, then back off.

**User — turn 0:**
> Open the conversation with a helpful, product-specific first message.

**User — later turns:**
> Customer replied: "{last customer message}". Respond appropriately.

---

### Prompt 4 — Negotiation: simulated customer

**When:** Each turn of `run_negotiation`, agent `customer`

**System (dynamic):**
> You are {customer_name}, a simulated customer persona: {persona}.
> You owe ₹{amount} for {product_name}. Reply in 1-3 short sentences, stay in character.
> If offered fair installments matching your persona, you may ACCEPT, COUNTER with lower amounts, or DECLINE.
> End with [ACCEPT], [COUNTER], or [DECLINE] when making a final decision on an offer.

**User:**
> ReviveAI said: "{reviveai message}"

**Outcome parsing:** `[ACCEPT]` in reply → recovered. `[DECLINE]` after turn 2 → lost.

---

### Prompt 5 — Executive summary

**When:** `GET /api/executive-summary` (via `generate_executive_summary`)

**System:**
> You are writing a one-paragraph executive summary for a fintech leadership team reviewing a payment recovery system's performance. Write 3-4 sentences in plain English, no bullet points. Reference the actual numbers given. Be honest about underperformance if the data shows it — do not spin bad numbers as good. End with one concrete recommendation.

**User:**
> Data:
> {JSON snapshot with impact metrics, top recovered/lost cases, issuer anomalies}

**Agent label:** `executive_summary`

**Acceptance rule:** Response must come from Ollama, be longer than 80 characters, or else rule-based fallback text is used.

---

### Mock fallback (no Ollama)

When Ollama is offline, **`_mock_diagnosis_note`**, **`_mock_agent_reply`**, and **`_mock_executive_summary`** generate fixed template text. The UI badges show "mock" vs "ollama" so it is always clear which path was used.

---

## 7. Simple Text Diagram — Full Pipeline

```
  PAYMENT FAILS (synthetic or imported row)
           |
           v
  +---------------------+
  |  Create transaction |  POST /api/generate-batch  OR  POST /api/import-logs
  |  status: failed     |
  +---------------------+
           |
           v
  +---------------------+
  |  Rule diagnosis     |  diagnose_transaction()
  |  status: diagnosing |
  +---------------------+
           |
           v
  +---------------------+
  |  Pick strategy      |  select_strategy_for()
  |  + AI note (Ollama) |  generate_diagnosis_ai_note()
  |  status: strategy_  |
  |    selected         |
  +---------------------+
           |
           v
  +---------------------+
  |  Baseline benchmark |  run_simulate_baseline()
  |  Issuer health chk  |  compute_issuer_health()
  +---------------------+
           |
           v
  +---------------------+     (Import stops here until
  |  Run recovery       |      user clicks Run recovery)
  |  POST /api/run-     |
  |    recovery         |
  +---------------------+
           |
     +-----+-----+
     |           |
     v           v
 strategy     strategy
 = none       = negotiation
     |           |
     v           v
  LOST      AI chat (Ollama)
                 |
            ACCEPT / DECLINE
                 |
                 v
           RECOVERED or LOST
     |
     v
 other strategies
 (retry, nudge, etc.)
     |
     v
 simulate_simple_recovery()
 (random roll)
     |
     v
 RECOVERED or LOST
           |
           v
  +---------------------+
  |  Dashboard          |  GET /api/dashboard-summary (non-archived only)
  |  Impact page        |  GET /api/impact-summary
  |  Issuer radar       |  GET /api/issuer-health
  |  AI summary         |  GET /api/executive-summary
  |  Archive / filters  |  POST /api/data/archive · GET /api/data/stats
  +---------------------+
```

**Demo cleanup (optional, anytime):**

```
  User selects time window (1h / 2h / 3h / today)
           |
           v
  +---------------------+
  |  Archive old rows   |  POST /api/data/archive
  |  archived_at = now  |  (older_than_hours or all_active)
  +---------------------+
           |
           v
  Dashboard / Impact / Issuer show only active (non-archived) data
           |
           v
  Transactions page → "Archive / History" tab to browse archived rows
           |
           v
  Restore all → POST /api/data/unarchive
```

---

## 8. What's Real vs Simulated

### Simulated (fake demo data and outcomes)

| What | Details |
|------|---------|
| **Payment transactions** | Generated with random Indian names/products, or read from CSV — not from a real payment gateway |
| **Payment recovery** | No real money moves. Success/failure is a random roll or AI role-play outcome |
| **Payment links** | URLs like `https://pay.reviveai.demo/{id}` — not real checkout pages |
| **Razorpay import** | Parses file format only. Does not call Razorpay API or receive real webhooks |
| **Customer in negotiation** | AI pretending to be the customer, with a random persona from a fixed list |
| **Rule engine & baseline math** | Deterministic formulas — not trained machine learning |
| **`build_analysis` JSON** | Rule-based UI data, explicitly tagged `"engine": "rule_based"` |
| **Issuer health** | Counts declines in the local demo database — not live bank telemetry |

### Genuinely live (when Ollama is running)

| What | Endpoint / function |
|------|---------------------|
| **Diagnosis AI note** | `generate_diagnosis_ai_note` → Ollama |
| **Negotiation messages** (both sides) | `run_negotiation` → Ollama via `ai_reply` |
| **Executive summary paragraph** | `generate_executive_summary` → Ollama |
| **Health check ping** | `run_ai_health_check` → Ollama |
| **AI call logging** | Real rows in `ai_call_logs` when Ollama responds |
| **Database** | Real SQLite file persists between sessions |
| **Import streaming** | Real file upload, real row-by-row processing with SSE |

If Ollama is offline, all four AI features above fall back to mock template text — the app still runs, but AI badges show "mock fallback."

### What would need to change for production

| Gap | What would be needed |
|-----|------------------------|
| **Real payments** | Integration with Razorpay (or similar) webhooks for actual `payment.failed` events |
| **Real recovery actions** | API calls to retry charges, send SMS/email/WhatsApp, or generate real payment links |
| **Real customer messaging** | Outbound messages to actual customers, not simulated AI customers |
| **Real issuer data** | Live decline telemetry from payment networks, not local counting |
| **Security & auth** | Login, API keys, encryption — none exist today |
| **Cloud deployment** | Hosting, monitoring, scaling — today it runs only on localhost via `./start.sh` |
| **Model hosting** | Ollama on one Mac works for demo; production might use a managed AI service with SLAs |

---

## Frontend Pages (what the user sees)

| Page | URL | What it shows |
|------|-----|---------------|
| **Dashboard** | `/` | AI summary, stats, pipeline buttons, **demo data view** (archive + time filters), impact/issuer compact panels, strategy table, AI call log |
| **Transactions** | `/transactions` | Filterable list with **active/archive toggle**, time windows, status filters |
| **Transaction detail** | `/transactions/:id` | Full analysis, AI note, negotiation chat, recovery outcome |
| **Import logs** | `/import` | File upload, **8 sample scenario cards** (Import / Download), live import progress table |
| **Impact** | `/impact` | ReviveAI vs baseline comparison with expandable breakdown |
| **Issuer health** | `/issuer-health` | Per-bank decline counts, anomaly flags, spike batch button |

All pages share: left sidebar navigation, faint grid background, animated dot canvas, Ollama status banner at top.

### Key API endpoints (data & import)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/transactions` | GET | List rows; params: `view`, `since_hours`, `status`, `limit` |
| `/api/data/stats` | GET | Active/archived counts + rows in last 1h/2h/3h/today |
| `/api/data/archive` | POST | Move rows to archive (`mode`: `all_active`, `older_than_hours`, `outside_window`) |
| `/api/data/unarchive` | POST | Restore archived rows (`mode`: `all`) |
| `/api/sample-imports` | GET | List of 8 sample CSV scenarios |
| `/api/sample-imports/{filename}` | GET | Download CSV or `ReviveAI_Sample_Imports.xlsx` |

---

*Last aligned with codebase: ReviveAI backend `main.py`, frontend Vite + React 19 (includes archive/history, sample imports, DataControls). For setup instructions see README.md.*
