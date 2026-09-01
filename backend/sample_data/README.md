# Sample import files (Razorpay-style CSV)

Open any `.csv` in **Excel** — each file is one demo scenario with **6–8 rows**.

| File | Use case |
|------|----------|
| `01_decline_types_mix.csv` | One row per decline code — start here |
| `02_high_value_negotiation.csv` | ₹4k–₹12k amounts → AI negotiation |
| `03_loyal_customers.csv` | Long tenure, high recoverability |
| `04_repeat_decliners.csv` | Many past declines → likely skipped |
| `05_issuer_spike_hdfc.csv` | All HDFC → issuer health radar |
| `06_subscription_renewals.csv` | SaaS / subscription renewals |
| `07_upi_wallet_mix.csv` | UPI & wallet → method switch |
| `08_live_stage_demo.csv` | Recent timestamps for on-stage import |

**Excel workbook (all sheets):** run `python build_workbook.py` → `ReviveAI_Sample_Imports.xlsx`

Import from the app: **Import logs** page → click **Import** on any sample card.
