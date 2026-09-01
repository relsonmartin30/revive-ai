# ReviveAI

AI-powered payment recovery PoC. Diagnoses why payments fail, selects tailored recovery strategies, and runs simulated AI negotiation for high-value cases.

## Quick start (Mac)

**Prerequisite:** [Homebrew](https://brew.sh) must be installed first (one-time). If your friend doesn't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then:

1. Unzip the folder and open Terminal inside it
2. Run: `./setup.sh` — one-time (~5–15 min). Installs Python, Node, Ollama, the AI model, and all project deps automatically via Homebrew + pip/npm
3. Run: `./start.sh` — every time you want to run it (opens browser automatically)
4. Press **Ctrl+C** in Terminal to stop everything

**Sending to someone else?** From the project folder run `./package-for-share.sh` — creates `ReviveAI.zip` next to the folder, without your local venv/database.

**Clean slate before Import Logs demo:** `./reset.sh` (asks for confirmation)

---

## Stack

- **Backend:** Python, FastAPI, SQLite (SQLModel), local Ollama (DeepSeek-R1)
- **Frontend:** React, Vite, TypeScript, Tailwind CSS

## Manual start (if you prefer)

### Backend

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm run dev
```

Open **http://localhost:5174**

## Demo flow

1. **Import logs** — upload `backend/sample_data/razorpay_sample_logs.csv` (6-row demo file)
2. Or click **Generate batch** on the Dashboard (40 transactions)
3. Click **Run recovery** — diagnoses, picks strategies, runs recovery
4. Open a **negotiation** case under Transactions — watch the live conversation
5. Check **Impact** and **Issuer health** in the sidebar

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/generate-batch?count=40` | Create sample failed payments |
| `POST /api/import-logs` | Upload Razorpay-style CSV/JSON |
| `POST /api/run-recovery` | One-click batch recovery |
| `GET /api/dashboard-summary` | Headline metrics |
| `GET /api/executive-summary` | AI leadership summary (Ollama) |
| `GET /api/impact-summary` | Baseline comparison |
| `GET /api/issuer-health` | Issuer anomaly radar |
| `GET /api/transactions` | List (optional `?status=`) |

Uses local Ollama — no cloud API key required.

## Architecture

```
Failed payment → Rule diagnosis → Strategy selection → Recovery
                                                      ↳ negotiation: dual Ollama agents
                                                      ↳ other: simulated outcome
→ StrategyOutcome (learning loop) → Dashboard
```

Sample transaction data only. Not connected to live payment processors.
