"""ReviveAI — AI-powered payment recovery PoC backend."""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import random
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Annotated, Any, Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
import httpx
from sqlalchemy import inspect, text
from sqlmodel import Field, Session, SQLModel, create_engine, delete, select

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reviveai")

DATABASE_URL = "sqlite:///./reviveai.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "deepseek-r1:8b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "120"))

_health_cache: dict[str, Any] | None = None
_health_cache_at = 0.0
HEALTH_CACHE_TTL = 120

_executive_summary_cache: dict[str, Any] | None = None
_executive_summary_cache_at = 0.0
EXEC_SUMMARY_CACHE_TTL = 30

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class DeclineCode(str, Enum):
    insufficient_funds = "insufficient_funds"
    do_not_honor = "do_not_honor"
    expired_card = "expired_card"
    risk_block = "risk_block"
    threeds_failure = "threeds_failure"
    currency_mismatch = "currency_mismatch"


class TransactionStatus(str, Enum):
    failed = "failed"
    diagnosing = "diagnosing"
    strategy_selected = "strategy_selected"
    recovering = "recovering"
    recovered = "recovered"
    lost = "lost"


class Strategy(str, Enum):
    smart_retry = "smart_retry"
    smart_retry_delayed = "smart_retry_delayed"
    card_update_nudge = "card_update_nudge"
    method_switch = "method_switch"
    soft_dunning = "soft_dunning"
    negotiation = "negotiation"
    none = "none"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Transaction(SQLModel, table=True):
    __tablename__ = "transactions"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    customer_name: str
    product_name: str
    amount: float
    currency: str = "INR"
    decline_code: DeclineCode
    customer_tenure_days: int
    past_decline_count: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: TransactionStatus = TransactionStatus.failed
    diagnosis: Optional[str] = None
    strategy: Optional[Strategy] = None
    recovered_amount: Optional[float] = None
    payment_link: Optional[str] = None
    conversation: Optional[str] = None  # JSON array
    customer_persona: Optional[str] = None
    analysis: Optional[str] = None  # JSON — structured demo analysis
    is_demo: bool = True
    diagnosis_ai_note: Optional[str] = None
    diagnosis_ai_note_source: Optional[str] = None  # ollama | mock
    razorpay_payment_id: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    payment_method: Optional[str] = None
    issuer: Optional[str] = None
    strategy_note: Optional[str] = None
    archived_at: Optional[datetime] = None


class BaselineOutcome(SQLModel, table=True):
    __tablename__ = "baseline_outcomes"

    transaction_id: str = Field(primary_key=True, foreign_key="transactions.id")
    baseline_recovered: bool
    baseline_recovered_amount: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AiCallLog(SQLModel, table=True):
    __tablename__ = "ai_call_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    agent: str  # reviveai | customer | diagnosis | health_check
    transaction_id: Optional[str] = None
    model: str
    latency_ms: float
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    source: str = "ollama"
    prompt_preview: Optional[str] = None
    response_preview: Optional[str] = None


class StrategyOutcome(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    decline_code: DeclineCode
    strategy: Strategy
    success: bool
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Mock data
# ---------------------------------------------------------------------------

CUSTOMER_NAMES = [
    "Priya Sharma", "Arjun Mehta", "Sneha Reddy", "Rahul Kapoor",
    "Ananya Iyer", "Vikram Singh", "Kavya Nair", "Aditya Joshi",
    "Meera Patel", "Rohan Desai", "Ishita Gupta", "Karan Malhotra",
    "Divya Krishnan", "Nikhil Rao", "Pooja Verma", "Amit Shah",
]

PRODUCTS = [
    "FitBox Monthly", "CloudLedger Pro", "SpiceRoute Subscription",
    "StudyMate Premium", "HomeChef Weekly Box", "ZenFlow Yoga App",
    "BikeEMI Installment", "PixelCraft SaaS", "FreshBasket Groceries",
    "CodeCamp Annual", "MusicStream Family", "TravelPass Plus",
]

PERSONAS = [
    "willing but forgot — apologetic, will pay if reminded gently",
    "hesitant, tight on cash right now — open to installments if fair",
    "annoyed, wants to be left alone — needs empathy before agreeing",
    "confused about the charge — needs clarification then may accept",
    "loyal long-time customer — embarrassed about failure, wants to fix it",
    "price-sensitive — will negotiate installment amounts down",
]

# Weight decline codes so demo gets variety including high-value negotiation cases
DECLINE_WEIGHTS = [
    (DeclineCode.insufficient_funds, 30),
    (DeclineCode.expired_card, 15),
    (DeclineCode.do_not_honor, 15),
    (DeclineCode.risk_block, 10),
    (DeclineCode.threeds_failure, 15),
    (DeclineCode.currency_mismatch, 15),
]

ISSUERS = [
    "HDFC Bank",
    "SBI",
    "ICICI Bank",
    "Axis Bank",
    "Yes Bank",
    "Paytm Payments Bank",
    "Kotak Mahindra",
    "IDFC First Bank",
    "PhonePe UPI",
    "Federal Bank",
]

SPIKE_ISSUER_NAME = "HDFC Bank"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_json(raw: Optional[str]) -> Any:
    if not raw:
        return None
    return json.loads(raw)


def parse_conversation(raw: Optional[str]) -> list[dict[str, Any]]:
    data = parse_json(raw)
    return data if isinstance(data, list) else []


def build_analysis(txn: Transaction, diagnosis: str, strategy: Strategy | None) -> dict[str, Any]:
    """Structured dummy analysis shown in the UI — no external API needed."""
    score = recoverability_score(diagnosis, txn)
    if score >= 0.7:
        label = "High"
    elif score >= 0.4:
        label = "Moderate"
    else:
        label = "Low"

    decline_labels = {
        DeclineCode.insufficient_funds: "Customer account had insufficient balance",
        DeclineCode.do_not_honor: "Bank declined without specific reason",
        DeclineCode.expired_card: "Card on file has expired",
        DeclineCode.risk_block: "Payment blocked by issuer risk rules",
        DeclineCode.threeds_failure: "Customer failed 3DS authentication",
        DeclineCode.currency_mismatch: "Currency mismatch on cross-border attempt",
    }

    strategy_reasons = {
        Strategy.smart_retry: "Low amount + good recoverability → automatic retry",
        Strategy.smart_retry_delayed: "Issuer infra anomaly → delayed retry instead of customer-specific action",
        Strategy.card_update_nudge: "Expired card → prompt customer to update card",
        Strategy.method_switch: "Bank risk flag → suggest UPI or alternate method",
        Strategy.soft_dunning: "Mid value + uncertain signals → gentle reminder first",
        Strategy.negotiation: "High value + worth human-like conversation → AI negotiation",
        Strategy.none: "Low recoverability → not worth pursuing",
    }

    signals = [
        {
            "label": "Decline reason",
            "value": decline_labels.get(txn.decline_code, txn.decline_code.value),
            "impact": "negative",
        },
        {
            "label": "Customer tenure",
            "value": f"{txn.customer_tenure_days} days",
            "impact": "positive" if txn.customer_tenure_days >= 180 else "neutral",
        },
        {
            "label": "Past declines",
            "value": str(txn.past_decline_count),
            "impact": "negative" if txn.past_decline_count >= 3 else "neutral",
        },
        {
            "label": "Transaction amount",
            "value": f"₹{txn.amount:,.0f}",
            "impact": "high_value" if txn.amount > 3000 else "low_value",
        },
    ]

    analysis: dict[str, Any] = {
        "mode": "analysis",
        "engine": "rule_based",
        "signals": signals,
        "recoverability_score": round(score, 2),
        "recoverability_label": label,
        "diagnosis_summary": diagnosis,
        "recommended_strategy": strategy.value if strategy else None,
        "strategy_reason": strategy_reasons.get(strategy, "Pending analysis") if strategy else None,
        "note": "Sample transaction dataset — rule engine signals plus optional local LLM risk note.",
    }

    if txn.status == TransactionStatus.recovered:
        analysis["simulated_outcome"] = {
            "result": "recovered",
            "amount": txn.recovered_amount,
            "payment_link": txn.payment_link,
            "method": "recovery" if txn.strategy != Strategy.negotiation else "ai_negotiation",
        }
    elif txn.status == TransactionStatus.lost:
        analysis["simulated_outcome"] = {
            "result": "lost" if txn.strategy != Strategy.none else "not_pursued",
            "reason": diagnosis if txn.strategy == Strategy.none else "Recovery attempt did not succeed",
        }

    return analysis


def apply_diagnosis_and_strategy(session: Session, txn: Transaction) -> None:
    txn.diagnosis = diagnose_transaction(txn)
    txn.strategy = select_strategy_for(txn, txn.diagnosis)
    try:
        note = generate_diagnosis_ai_note(session, txn)
        txn.diagnosis_ai_note = note.text
        txn.diagnosis_ai_note_source = note.source
    except Exception:
        logger.exception("AI diagnosis note failed for transaction %s", txn.id)
        txn.diagnosis_ai_note = _mock_diagnosis_note(txn, txn.diagnosis)
        txn.diagnosis_ai_note_source = "mock"
    txn.analysis = json.dumps(build_analysis(txn, txn.diagnosis, txn.strategy))


def _fill_ai_diagnosis_note(txn_id: str) -> None:
    try:
        with Session(engine) as session:
            txn = session.get(Transaction, txn_id)
            if not txn or not txn.diagnosis:
                return
            note = generate_diagnosis_ai_note(session, txn)
            txn.diagnosis_ai_note = note.text
            txn.diagnosis_ai_note_source = note.source
            session.add(txn)
            session.commit()
    except Exception:
        logger.exception("AI diagnosis note failed for transaction %s", txn_id)
        try:
            with Session(engine) as session:
                txn = session.get(Transaction, txn_id)
                if not txn or txn.diagnosis_ai_note:
                    return
                txn.diagnosis_ai_note = _mock_diagnosis_note(txn, txn.diagnosis)
                txn.diagnosis_ai_note_source = "mock"
                session.add(txn)
                session.commit()
        except Exception:
            logger.exception("Failed to write fallback diagnosis note for transaction %s", txn_id)


def auto_diagnose_transaction(
    session: Session,
    txn: Transaction,
    *,
    fill_ai: bool = True,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Rules + strategy immediately; AI note sync or background."""
    txn_id = txn.id
    try:
        txn.status = TransactionStatus.diagnosing
        txn.diagnosis = diagnose_transaction(txn)
        txn.strategy = select_strategy_for(txn, txn.diagnosis)
        txn.analysis = json.dumps(build_analysis(txn, txn.diagnosis, txn.strategy))
        txn.status = TransactionStatus.strategy_selected
        session.add(txn)
        session.commit()
        session.refresh(txn)
    except Exception:
        logger.exception("Diagnosis pipeline failed for transaction %s", txn_id)
        session.rollback()
        txn = session.get(Transaction, txn_id)
        if not txn:
            return
        txn.diagnosis = diagnose_transaction(txn)
        txn.strategy = select_strategy_for(txn, txn.diagnosis)
        txn.status = TransactionStatus.strategy_selected
        txn.diagnosis_ai_note = _mock_diagnosis_note(txn, txn.diagnosis)
        txn.diagnosis_ai_note_source = "mock"
        txn.analysis = json.dumps(build_analysis(txn, txn.diagnosis, txn.strategy))
        session.add(txn)
        session.commit()

    if fill_ai:
        if background_tasks is not None:
            background_tasks.add_task(_fill_ai_diagnosis_note, txn_id)
        else:
            _fill_ai_diagnosis_note(txn_id)


def repair_undiagosed_transactions(session: Session, background_tasks: BackgroundTasks | None = None) -> int:
    stuck = session.exec(
        select(Transaction).where(
            Transaction.status == TransactionStatus.failed,
            Transaction.strategy == None,
        )
    ).all()
    for txn in stuck:
        logger.warning("Repairing undiagnosed transaction %s", txn.id)
        auto_diagnose_transaction(session, txn, fill_ai=True, background_tasks=background_tasks)
    return len(stuck)


def save_conversation(session: Session, txn: Transaction, messages: list[dict[str, Any]]) -> None:
    txn.conversation = json.dumps(messages)
    session.add(txn)
    session.commit()
    session.refresh(txn)


# ---------------------------------------------------------------------------
# Diagnosis & strategy
# ---------------------------------------------------------------------------

def diagnose_transaction(txn: Transaction) -> str:
    code = txn.decline_code
    if code == DeclineCode.insufficient_funds:
        if txn.past_decline_count >= 3:
            return "recurring cash flow strain"
        if txn.past_decline_count <= 1 and txn.customer_tenure_days >= 180:
            return "one-off temporary shortfall, loyal customer"
        return "temporary insufficient funds, moderate recoverability"
    if code in (DeclineCode.do_not_honor, DeclineCode.risk_block):
        return "bank-side risk flag, likely resolves with method switch"
    if code == DeclineCode.expired_card:
        return "card needs updating, high recoverability"
    if code == DeclineCode.threeds_failure:
        return "authentication friction, retry with clearer prompt"
    if code == DeclineCode.currency_mismatch:
        return "low recoverability, likely low priority"
    return "unknown decline pattern"


def recoverability_score(diagnosis: str, txn: Transaction) -> float:
    score = 0.5
    low = ("low recoverability", "currency_mismatch")
    high = ("high recoverability", "loyal customer", "expired_card", "one-off")
    if any(k in diagnosis for k in low):
        score = 0.15
    elif any(k in diagnosis for k in high):
        score = 0.85
    elif "moderate" in diagnosis:
        score = 0.55
    elif "recurring cash flow" in diagnosis:
        score = 0.25
    elif "method switch" in diagnosis:
        score = 0.7
    elif "authentication friction" in diagnosis:
        score = 0.65
    if txn.customer_tenure_days > 365:
        score += 0.1
    if txn.past_decline_count >= 4:
        score -= 0.2
    return max(0.05, min(0.95, score))


def select_strategy_for(txn: Transaction, diagnosis: str) -> Strategy:
    score = recoverability_score(diagnosis, txn)
    code = txn.decline_code

    if score < 0.2:
        return Strategy.none

    if code == DeclineCode.expired_card:
        return Strategy.card_update_nudge

    if code in (DeclineCode.do_not_honor, DeclineCode.risk_block):
        return Strategy.method_switch

    if txn.amount > 3000 and score >= 0.4:
        return Strategy.negotiation

    if txn.amount < 800 and score >= 0.6:
        return Strategy.smart_retry

    if 800 <= txn.amount <= 3000 and 0.35 <= score <= 0.65:
        return Strategy.soft_dunning

    if score >= 0.55:
        return Strategy.smart_retry

    if score >= 0.35:
        return Strategy.soft_dunning

    return Strategy.none


def installment_plan(amount: float, first_pct: float = 0.4) -> list[float]:
    first = round(amount * first_pct, 2)
    remainder = round(amount - first, 2)
    second = round(remainder / 2, 2)
    third = round(remainder - second, 2)
    return [first, second, third]


def simulate_simple_recovery(txn: Transaction, diagnosis: str) -> tuple[bool, float]:
    """Deterministic-ish recovery for non-negotiation strategies."""
    score = recoverability_score(diagnosis, txn)
    strategy = txn.strategy
    assert strategy and strategy != Strategy.negotiation and strategy != Strategy.none

    boost = {
        Strategy.smart_retry: 0.15,
        Strategy.smart_retry_delayed: 0.18,
        Strategy.card_update_nudge: 0.25,
        Strategy.method_switch: 0.1,
        Strategy.soft_dunning: 0.05,
    }.get(strategy, 0.0)

    effective = min(0.95, score + boost)
    success = random.random() < effective
    recovered = txn.amount if success else 0.0
    return success, recovered


def pick_issuer(spike: bool = False) -> str:
    if spike:
        return SPIKE_ISSUER_NAME
    return random.choice(ISSUERS)


def baseline_recovery_probability(decline_code: DeclineCode) -> float:
    code = decline_code.value
    if code in ("insufficient_funds", "wallet_insufficient_balance"):
        return 0.25
    if code in ("expired_card", "invalid_card_number", "lost_card", "stolen_card"):
        return 0.05
    if code in ("threeds_failure",) or any(k in code for k in ("otp", "3ds", "auth")):
        return 0.15
    if code in ("risk_block", "do_not_honor") or any(k in code for k in ("risk", "fraud")):
        return 0.10
    return 0.20


def baseline_expected_amount(txn: Transaction) -> float:
    prob = baseline_recovery_probability(txn.decline_code)
    return round(prob * txn.amount, 2)


def run_simulate_baseline(session: Session, transaction_ids: list[str] | None = None) -> dict[str, Any]:
    """Persist deterministic baseline expected values (probability × amount) per transaction."""
    if transaction_ids:
        txns = [session.get(Transaction, tid) for tid in transaction_ids]
        txns = [t for t in txns if t and t.archived_at is None]
    else:
        txns = _load_visible_transactions(session)

    for txn in txns:
        existing = session.get(BaselineOutcome, txn.id)
        if existing:
            session.delete(existing)

    simulated = 0
    for txn in txns:
        expected = baseline_expected_amount(txn)
        session.add(BaselineOutcome(
            transaction_id=txn.id,
            baseline_recovered=expected > 0,
            baseline_recovered_amount=expected,
        ))
        simulated += 1

    session.commit()
    return {
        "simulated": simulated,
        "message": f"Baseline expected values computed for {simulated} transactions",
    }


def compute_impact_summary(session: Session) -> dict[str, Any]:
    txns = _load_visible_transactions(session)
    if not txns:
        return {
            "revive_recovery_rate": 0.0,
            "baseline_recovery_rate": 0.0,
            "lift_percentage": 0.0,
            "revive_recovered_total": 0.0,
            "baseline_recovered_total": 0.0,
            "extra_amount_recovered": 0.0,
            "cohort_size": 0,
            "attempted_count": 0,
            "total_amount": 0.0,
        }

    total_amount = round(sum(t.amount for t in txns), 2)
    baseline_expected_total = round(sum(baseline_expected_amount(t) for t in txns), 2)

    attempted = [
        t for t in txns
        if t.strategy and t.strategy != Strategy.none
        and t.status in (TransactionStatus.recovered, TransactionStatus.lost)
    ]
    revive_recovered = [t for t in attempted if t.status == TransactionStatus.recovered]
    revive_total = round(sum(t.recovered_amount or 0 for t in revive_recovered), 2)

    revive_rate = revive_total / total_amount if total_amount else 0.0
    baseline_rate = baseline_expected_total / total_amount if total_amount else 0.0
    extra = round(revive_total - baseline_expected_total, 2)
    lift = round(((revive_rate - baseline_rate) / baseline_rate) * 100, 1) if baseline_rate > 0 else 0.0

    return {
        "revive_recovery_rate": round(revive_rate, 4),
        "baseline_recovery_rate": round(baseline_rate, 4),
        "lift_percentage": lift,
        "revive_recovered_total": revive_total,
        "baseline_recovered_total": baseline_expected_total,
        "extra_amount_recovered": extra,
        "cohort_size": len(txns),
        "attempted_count": len(attempted),
        "total_amount": total_amount,
    }


def compute_impact_breakdown(session: Session) -> dict[str, Any]:
    txns = _load_visible_transactions(session)

    by_decline: dict[str, dict[str, Any]] = {}
    by_strategy: dict[str, dict[str, Any]] = {}
    txn_rows: list[dict[str, Any]] = []

    for txn in txns:
        expected = baseline_expected_amount(txn)
        actual = round(txn.recovered_amount or 0, 2) if txn.status == TransactionStatus.recovered else 0.0
        diff = round(actual - expected, 2)
        decline_key = txn.decline_code.value
        strategy_key = txn.strategy.value if txn.strategy else "unassigned"

        bucket = by_decline.setdefault(decline_key, {
            "decline_code": decline_key,
            "transaction_count": 0,
            "revive_recovered_total": 0.0,
            "baseline_expected_total": 0.0,
            "difference_total": 0.0,
        })
        bucket["transaction_count"] += 1
        bucket["revive_recovered_total"] = round(bucket["revive_recovered_total"] + actual, 2)
        bucket["baseline_expected_total"] = round(bucket["baseline_expected_total"] + expected, 2)
        bucket["difference_total"] = round(bucket["difference_total"] + diff, 2)

        sbucket = by_strategy.setdefault(strategy_key, {
            "strategy": strategy_key,
            "transaction_count": 0,
            "revive_recovered_total": 0.0,
            "baseline_expected_total": 0.0,
            "difference_total": 0.0,
        })
        sbucket["transaction_count"] += 1
        sbucket["revive_recovered_total"] = round(sbucket["revive_recovered_total"] + actual, 2)
        sbucket["baseline_expected_total"] = round(sbucket["baseline_expected_total"] + expected, 2)
        sbucket["difference_total"] = round(sbucket["difference_total"] + diff, 2)

        txn_rows.append({
            "id": txn.id,
            "customer_name": txn.customer_name,
            "product_name": txn.product_name,
            "amount": txn.amount,
            "decline_code": decline_key,
            "strategy": strategy_key,
            "revive_actual": actual,
            "baseline_expected": expected,
            "difference": diff,
            "status": txn.status.value,
        })

    txn_rows.sort(key=lambda r: r["difference"], reverse=True)

    return {
        "by_decline_code": sorted(by_decline.values(), key=lambda x: -x["difference_total"]),
        "by_strategy": sorted(by_strategy.values(), key=lambda x: -x["difference_total"]),
        "transactions": txn_rows,
    }


def apply_issuer_anomaly_reroutes(session: Session, anomalous_issuers: list[str]) -> dict[str, int]:
    rerouted: dict[str, int] = {}
    for issuer in anomalous_issuers:
        note = (
            f"Rerouted: {issuer} showing anomalous decline rate, likely infra issue, "
            "not customer-specific."
        )
        txns = session.exec(
            select(Transaction).where(
                Transaction.issuer == issuer,
                Transaction.status.in_([
                    TransactionStatus.failed,
                    TransactionStatus.diagnosing,
                    TransactionStatus.strategy_selected,
                ]),
            )
        ).all()
        count = 0
        for txn in txns:
            if txn.strategy == Strategy.smart_retry_delayed and txn.strategy_note == note:
                continue
            txn.strategy = Strategy.smart_retry_delayed
            txn.strategy_note = note
            if txn.diagnosis and txn.strategy:
                txn.analysis = json.dumps(build_analysis(txn, txn.diagnosis, txn.strategy))
            session.add(txn)
            count += 1
        rerouted[issuer] = count
    session.commit()
    return rerouted


def compute_issuer_health(session: Session, apply_reroutes: bool = True) -> list[dict[str, Any]]:
    txns = _load_visible_transactions(session)
    issuer_counts: dict[str, int] = {}
    for txn in txns:
        if not txn.issuer:
            continue
        issuer_counts[txn.issuer] = issuer_counts.get(txn.issuer, 0) + 1

    if not issuer_counts:
        return []

    avg_declines = sum(issuer_counts.values()) / len(issuer_counts)
    anomalous = [name for name, count in issuer_counts.items() if count > avg_declines * 2]

    if apply_reroutes and anomalous:
        apply_issuer_anomaly_reroutes(session, anomalous)

    results: list[dict[str, Any]] = []
    for issuer, count in sorted(issuer_counts.items(), key=lambda x: (-x[1], x[0])):
        is_anomaly = issuer in anomalous
        rerouted_count = len(session.exec(
            select(Transaction).where(
                Transaction.issuer == issuer,
                Transaction.strategy == Strategy.smart_retry_delayed,
            )
        ).all())
        results.append({
            "issuer_name": issuer,
            "decline_count": count,
            "status": "anomaly" if is_anomaly else "normal",
            "likely_cause": "infra-side" if is_anomaly else "customer-side",
            "rerouted_count": rerouted_count,
            "average_decline_count": round(avg_declines, 1),
        })
    return results


def record_outcome(session: Session, txn: Transaction, success: bool) -> None:
    if not txn.strategy:
        return
    session.add(StrategyOutcome(
        decline_code=txn.decline_code,
        strategy=txn.strategy,
        success=success,
    ))
    session.commit()


# ---------------------------------------------------------------------------
# AI layer — local Ollama (DeepSeek-R1) or labeled mock fallback
# ---------------------------------------------------------------------------

@dataclass
class AiReply:
    text: str
    source: str  # ollama | mock


def _strip_thinking(text: str) -> str:
    """DeepSeek-R1 may emit reasoning blocks — strip for clean UI."""
    text = re.sub(
        r"<\s*think\s*>.*?<\s*/\s*think\s*>",
        "",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    return text.strip()


def _ollama_reachable() -> bool:
    try:
        r = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3.0)
        return r.status_code == 200
    except Exception:
        return False


def ai_is_live() -> bool:
    return _ollama_reachable()


def _mock_agent_reply(system: str, messages: list[dict[str, str]]) -> str:
    """Fallback when no API key — always labeled source=mock in callers."""
    is_customer = "simulated customer" in system.lower()
    turn = sum(1 for m in messages if m.get("role") == "assistant")

    if is_customer:
        if turn >= 3:
            return "That works for me, thank you. [ACCEPT]"
        if turn == 2:
            return "That's still a bit tight — could the first payment be smaller?"
        return "Oh, I didn't realize this was for my subscription. Can you explain the amount?"

    if turn == 0:
        return (
            "Hi — your recent payment didn't go through. I'm here to help you "
            "keep your subscription active. Would you like to settle today or split it?"
        )
    if turn >= 3:
        return (
            "Absolutely — let's do a smaller first installment and spread the rest. "
            "I'll send a secure link once you confirm."
        )
    return (
        "I understand — how about 40% now and the remainder over the next two weeks? "
        "No extra fees, and your access stays uninterrupted."
    )


def _mock_diagnosis_note(txn: Transaction, diagnosis: str) -> str:
    if "loyal" in diagnosis:
        return (
            f"{txn.customer_name} has {txn.customer_tenure_days} days tenure with only "
            f"{txn.past_decline_count} past declines — likely a temporary shortfall, "
            "high confidence this recovers with a short delay."
        )
    if "expired" in diagnosis:
        return (
            f"Card update needed for {txn.customer_name} — expired card declines "
            "typically recover quickly once the customer updates payment details."
        )
    if "low recoverability" in diagnosis:
        return (
            f"Low recovery priority for ₹{txn.amount:,.0f} — currency mismatch "
            "signals suggest pursuing other cases first."
        )
    return (
        f"Rule engine flagged '{diagnosis}' for {txn.customer_name} — "
        f"moderate recovery potential on ₹{txn.amount:,.0f}."
    )


def _log_ai_call(
    session: Session | None,
    *,
    agent: str,
    transaction_id: str | None,
    model: str,
    latency_ms: float,
    input_tokens: int | None,
    output_tokens: int | None,
    prompt_preview: str,
    response_preview: str,
) -> None:
    line = (
        f"🤖 OLLAMA LIVE | agent={agent} txn={transaction_id or 'n/a'} "
        f"model={model} latency={latency_ms:.0f}ms "
        f"in={input_tokens} out={output_tokens} "
        f"response={response_preview[:80]!r}"
    )
    logger.info(line)
    print(line)

    with Session(engine) as log_session:
        _persist_call_log(log_session, agent, transaction_id, model, latency_ms,
                          input_tokens, output_tokens, prompt_preview, response_preview)


def _persist_call_log(
    session: Session,
    agent: str,
    transaction_id: str | None,
    model: str,
    latency_ms: float,
    input_tokens: int | None,
    output_tokens: int | None,
    prompt_preview: str,
    response_preview: str,
) -> None:
    session.add(AiCallLog(
        agent=agent,
        transaction_id=transaction_id,
        model=model,
        latency_ms=round(latency_ms, 2),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        source="ollama",
        prompt_preview=prompt_preview[:200],
        response_preview=response_preview[:200],
    ))
    session.commit()


def ai_reply(
    *,
    system: str,
    user_prompt: str,
    agent: str,
    transaction_id: str | None = None,
    session: Session | None = None,
    history: list[dict[str, str]] | None = None,
) -> AiReply:
    if not _ollama_reachable():
        text = _mock_agent_reply(system, history or [])
        logger.warning(f"⚠️ MOCK AI | agent={agent} txn={transaction_id or 'n/a'} (Ollama offline)")
        return AiReply(text=text, source="mock")

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for msg in history or []:
        role = "user" if msg["role"] == "user" else "assistant"
        messages.append({"role": role, "content": msg["content"]})
    messages.append({"role": "user", "content": user_prompt})

    start = time.perf_counter()
    try:
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 400},
            },
            timeout=OLLAMA_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        text = _strip_thinking(data.get("message", {}).get("content", ""))
    except Exception as exc:
        logger.error(f"Ollama error agent={agent}: {exc}")
        return AiReply(text=_mock_agent_reply(system, history or []), source="mock")

    latency_ms = (time.perf_counter() - start) * 1000
    input_tokens = data.get("prompt_eval_count")
    output_tokens = data.get("eval_count")

    _log_ai_call(
        session,
        agent=agent,
        transaction_id=transaction_id,
        model=OLLAMA_MODEL,
        latency_ms=latency_ms,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        prompt_preview=user_prompt,
        response_preview=text,
    )
    return AiReply(text=text, source="ollama")


def generate_diagnosis_ai_note(session: Session, txn: Transaction) -> AiReply:
    diagnosis = txn.diagnosis or diagnose_transaction(txn)
    system = (
        "You are a payment recovery risk analyst. Write exactly 1-2 concise sentences "
        "explaining recovery likelihood. Be specific to the customer facts. No bullet points."
    )
    user_prompt = f"""Transaction facts:
- Customer: {txn.customer_name}, tenure {txn.customer_tenure_days} days
- Product: {txn.product_name}, amount ₹{txn.amount}
- Decline code: {txn.decline_code.value}
- Past declines: {txn.past_decline_count}
- Rule-based diagnosis: {diagnosis}

Write a natural-language risk/recovery note."""

    if not _ollama_reachable():
        return AiReply(text=_mock_diagnosis_note(txn, diagnosis), source="mock")

    return ai_reply(
        system=system,
        user_prompt=user_prompt,
        agent="diagnosis",
        transaction_id=txn.id,
        session=session,
    )


def run_ai_health_check(force: bool = False) -> dict[str, Any]:
    global _health_cache, _health_cache_at

    if not force and _health_cache and (time.monotonic() - _health_cache_at) < HEALTH_CACHE_TTL:
        return _health_cache

    if not _ollama_reachable():
        result = {
            "connected": False,
            "key_configured": False,
            "rate_limited": False,
            "model": OLLAMA_MODEL,
            "latency_ms": None,
            "response": None,
            "error": f"Ollama not running — start with: brew services start ollama",
            "provider": "ollama",
        }
        _health_cache = result
        _health_cache_at = time.monotonic()
        return result

    start = time.perf_counter()
    try:
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": "Reply with the word CONNECTED and nothing else."}],
                "stream": False,
                "options": {"num_predict": 16, "temperature": 0},
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        data = resp.json()
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        text = _strip_thinking(data.get("message", {}).get("content", "")).strip()

        result = {
            "connected": True,
            "key_configured": True,
            "rate_limited": False,
            "model": OLLAMA_MODEL,
            "latency_ms": latency_ms,
            "response": text,
            "error": None,
            "provider": "ollama",
        }
    except Exception as exc:
        result = {
            "connected": False,
            "key_configured": True,
            "rate_limited": False,
            "model": OLLAMA_MODEL,
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "response": None,
            "error": str(exc),
            "provider": "ollama",
        }

    _health_cache = result
    _health_cache_at = time.monotonic()
    return result


def run_negotiation(session: Session, txn_id: str) -> None:
    txn = session.get(Transaction, txn_id)
    if not txn or txn.strategy != Strategy.negotiation:
        return

    txn.status = TransactionStatus.recovering
    persona = txn.customer_persona or random.choice(PERSONAS)
    txn.customer_persona = persona
    messages: list[dict[str, Any]] = []
    save_conversation(session, txn, messages)

    plan = installment_plan(txn.amount)
    plan_text = f"₹{plan[0]} now, ₹{plan[1]} in 2 weeks, ₹{plan[2]} in 4 weeks"

    collector_system = f"""You are ReviveAI, a payment recovery assistant for {txn.product_name}.
Customer: {txn.customer_name}, tenure {txn.customer_tenure_days} days, owes ₹{txn.amount}.
Diagnosis: {txn.diagnosis}.
Be empathetic, not pushy. Reference the actual product. If they show financial strain, offer installments: {plan_text}.
Adapt based on customer replies — smaller first payment if hesitant, one grace period if declining, then back off."""

    customer_system = f"""You are {txn.customer_name}, a simulated customer persona: {persona}.
You owe ₹{txn.amount} for {txn.product_name}. Reply in 1-3 short sentences, stay in character.
If offered fair installments matching your persona, you may ACCEPT, COUNTER with lower amounts, or DECLINE.
End with [ACCEPT], [COUNTER], or [DECLINE] when making a final decision on an offer."""

    history_a: list[dict[str, str]] = []
    history_b: list[dict[str, str]] = []
    accepted = False
    declined = False
    max_turns = 6

    for turn in range(max_turns):
        if turn == 0:
            user_prompt = "Open the conversation with a helpful, product-specific first message."
        else:
            user_prompt = f"Customer replied: \"{history_b[-1]['content']}\". Respond appropriately."

        reply_a = ai_reply(
            system=collector_system,
            user_prompt=user_prompt,
            agent="reviveai",
            transaction_id=txn.id,
            session=session,
            history=history_a,
        )
        history_a.append({"role": "user", "content": user_prompt})
        history_a.append({"role": "assistant", "content": reply_a.text})
        messages.append({
            "role": "reviveai", "message": reply_a.text,
            "timestamp": utc_now_iso(), "source": reply_a.source,
        })
        save_conversation(session, txn, messages)

        cust_prompt = f"ReviveAI said: \"{reply_a.text}\""
        reply_b = ai_reply(
            system=customer_system,
            user_prompt=cust_prompt,
            agent="customer",
            transaction_id=txn.id,
            session=session,
            history=history_b,
        )
        history_b.append({"role": "user", "content": cust_prompt})
        history_b.append({"role": "assistant", "content": reply_b.text})
        messages.append({
            "role": "customer", "message": reply_b.text,
            "timestamp": utc_now_iso(), "source": reply_b.source,
        })
        save_conversation(session, txn, messages)

        upper = reply_b.text.upper()
        if "[ACCEPT]" in upper:
            accepted = True
            break
        if "[DECLINE]" in upper and turn >= 2:
            declined = True
            break

    if accepted:
        txn.status = TransactionStatus.recovered
        txn.recovered_amount = txn.amount
        txn.payment_link = f"https://pay.reviveai.demo/{txn.id}"
        record_outcome(session, txn, True)
    else:
        txn.status = TransactionStatus.lost
        txn.recovered_amount = 0.0
        record_outcome(session, txn, False)

    _refresh_analysis(session, txn)


def execute_recovery(session: Session, txn_id: str) -> Transaction:
    txn = session.get(Transaction, txn_id)
    if not txn:
        raise HTTPException(404, "Transaction not found")

    if txn.status not in (TransactionStatus.failed, TransactionStatus.strategy_selected):
        return txn

    txn.status = TransactionStatus.diagnosing
    session.add(txn)
    session.commit()

    apply_diagnosis_and_strategy(session, txn)
    txn.status = TransactionStatus.strategy_selected
    session.add(txn)
    session.commit()
    session.refresh(txn)

    if txn.strategy == Strategy.none:
        txn.status = TransactionStatus.lost
        _refresh_analysis(session, txn)
        return txn

    if txn.strategy == Strategy.negotiation:
        txn.status = TransactionStatus.recovering
        txn.customer_persona = random.choice(PERSONAS)
        session.add(txn)
        session.commit()
        run_negotiation(session, txn_id)
        session.refresh(txn)
        return txn

    txn.status = TransactionStatus.recovering
    session.add(txn)
    session.commit()

    success, recovered = simulate_simple_recovery(txn, txn.diagnosis)
    if success:
        txn.status = TransactionStatus.recovered
        txn.recovered_amount = recovered
        txn.payment_link = f"https://pay.reviveai.demo/{txn.id}"
    else:
        txn.status = TransactionStatus.lost
        txn.recovered_amount = 0.0

    record_outcome(session, txn, success)
    _refresh_analysis(session, txn)
    session.refresh(txn)
    return txn


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="ReviveAI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    SQLModel.metadata.create_all(engine)
    insp = inspect(engine)
    if insp.has_table("transactions"):
        cols = {c["name"] for c in insp.get_columns("transactions")}
        with engine.connect() as conn:
            for col, ddl in [
                ("analysis", "ALTER TABLE transactions ADD COLUMN analysis TEXT"),
                ("is_demo", "ALTER TABLE transactions ADD COLUMN is_demo BOOLEAN DEFAULT 1"),
                ("diagnosis_ai_note", "ALTER TABLE transactions ADD COLUMN diagnosis_ai_note TEXT"),
                ("diagnosis_ai_note_source", "ALTER TABLE transactions ADD COLUMN diagnosis_ai_note_source TEXT"),
                ("razorpay_payment_id", "ALTER TABLE transactions ADD COLUMN razorpay_payment_id TEXT"),
                ("razorpay_order_id", "ALTER TABLE transactions ADD COLUMN razorpay_order_id TEXT"),
                ("payment_method", "ALTER TABLE transactions ADD COLUMN payment_method TEXT"),
                ("issuer", "ALTER TABLE transactions ADD COLUMN issuer TEXT"),
                ("strategy_note", "ALTER TABLE transactions ADD COLUMN strategy_note TEXT"),
                ("archived_at", "ALTER TABLE transactions ADD COLUMN archived_at TEXT"),
            ]:
                if col not in cols:
                    conn.execute(text(ddl))
                    conn.commit()

    banner = "=" * 62
    print(f"\n{banner}")
    if ai_is_live():
        print("✅ AI MODE: LIVE (Ollama — local DeepSeek-R1)")
        print(f"   Model: {OLLAMA_MODEL}")
        print(f"   URL:   {OLLAMA_BASE_URL}")
    else:
        print("⚠️  AI MODE: MOCK FALLBACK — start Ollama: brew services start ollama")
    print(f"{banner}\n")


def get_session():
    with Session(engine) as session:
        yield session


# --- Response helpers ---

def txn_to_dict(txn: Transaction) -> dict[str, Any]:
    return {
        "id": txn.id,
        "customer_name": txn.customer_name,
        "product_name": txn.product_name,
        "amount": txn.amount,
        "currency": txn.currency,
        "decline_code": txn.decline_code.value,
        "customer_tenure_days": txn.customer_tenure_days,
        "past_decline_count": txn.past_decline_count,
        "created_at": txn.created_at.isoformat(),
        "status": txn.status.value,
        "diagnosis": txn.diagnosis,
        "strategy": txn.strategy.value if txn.strategy else None,
        "recovered_amount": txn.recovered_amount,
        "payment_link": txn.payment_link,
        "conversation": parse_conversation(txn.conversation),
        "customer_persona": txn.customer_persona,
        "analysis": parse_json(txn.analysis),
        "is_demo": txn.is_demo,
        "diagnosis_ai_note": txn.diagnosis_ai_note,
        "diagnosis_ai_note_source": txn.diagnosis_ai_note_source,
        "razorpay_payment_id": txn.razorpay_payment_id,
        "razorpay_order_id": txn.razorpay_order_id,
        "payment_method": txn.payment_method,
        "issuer": txn.issuer,
        "strategy_note": txn.strategy_note,
        "archived_at": txn.archived_at.isoformat() if txn.archived_at else None,
    }


def _refresh_analysis(session: Session, txn: Transaction) -> None:
    if txn.diagnosis and txn.strategy:
        txn.analysis = json.dumps(build_analysis(txn, txn.diagnosis, txn.strategy))
        session.add(txn)
        session.commit()


def _parse_archived_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _active_txn_clause():
    return Transaction.archived_at.is_(None)


def _since_dt(hours: float | None) -> datetime | None:
    if hours is None:
        return None
    return datetime.now(timezone.utc) - timedelta(hours=hours)


def _apply_txn_list_filters(
    stmt,
    *,
    view: str = "active",
    since_hours: float | None = None,
):
    if view == "archived":
        stmt = stmt.where(Transaction.archived_at.isnot(None))
    elif view == "active":
        stmt = stmt.where(_active_txn_clause())
    since = _since_dt(since_hours)
    if since is not None:
        stmt = stmt.where(Transaction.created_at >= since)
    return stmt


def _load_visible_transactions(session: Session, *, include_archived: bool = False) -> list[Transaction]:
    stmt = select(Transaction)
    if not include_archived:
        stmt = stmt.where(_active_txn_clause())
    return list(session.exec(stmt).all())

@app.post("/api/generate-batch")
def generate_batch(
    background_tasks: BackgroundTasks,
    count: int = Query(40, ge=1, le=100),
    spike_issuer: bool = Query(False, description="Spike ~15 declines from one issuer for anomaly detection"),
) -> dict[str, Any]:
    codes, weights = zip(*DECLINE_WEIGHTS)
    created_ids: list[str] = []
    spike_count = min(15, count) if spike_issuer else 0

    with Session(engine) as session:
        repaired = repair_undiagosed_transactions(session, background_tasks)
        if repaired:
            logger.info("Repaired %d previously undiagnosed transactions", repaired)

        for i in range(count):
            use_spike = spike_issuer and i < spike_count
            if i % 5 == 0:
                decline = DeclineCode.insufficient_funds
                amount = round(random.uniform(4000, 12000), 2)
                tenure = random.randint(200, 800)
                past_declines = random.randint(0, 1)
            elif i % 5 == 1:
                decline = DeclineCode.expired_card
                amount = round(random.uniform(1500, 8000), 2)
                tenure = random.randint(30, 600)
                past_declines = random.randint(0, 2)
            elif i % 5 == 2:
                decline = DeclineCode.do_not_honor
                amount = round(random.uniform(1000, 6000), 2)
                tenure = random.randint(60, 400)
                past_declines = random.randint(0, 3)
            else:
                decline = random.choices(list(codes), weights=list(weights))[0]
                roll = random.random()
                if roll < 0.35:
                    amount = round(random.uniform(3500, 15000), 2)
                elif roll < 0.65:
                    amount = round(random.uniform(800, 3500), 2)
                else:
                    amount = round(random.uniform(200, 800), 2)
                tenure = random.randint(7, 900)
                past_declines = random.randint(0, 6)

            txn = Transaction(
                customer_name=random.choice(CUSTOMER_NAMES),
                product_name=random.choice(PRODUCTS),
                amount=amount,
                decline_code=decline,
                customer_tenure_days=tenure,
                past_decline_count=past_declines,
                status=TransactionStatus.failed,
                issuer=pick_issuer(spike=use_spike),
                payment_method=random.choice(["card", "upi", "netbanking", "wallet"]),
            )
            session.add(txn)
            session.commit()
            session.refresh(txn)
            auto_diagnose_transaction(session, txn, fill_ai=True, background_tasks=background_tasks)
            created_ids.append(txn.id)

        baseline = run_simulate_baseline(session, created_ids)
        issuer_health = compute_issuer_health(session)

    return {
        "created": len(created_ids),
        "ids": created_ids,
        "spike_issuer": spike_issuer,
        "spike_issuer_name": SPIKE_ISSUER_NAME if spike_issuer else None,
        "baseline": baseline,
        "issuer_anomalies": [i for i in issuer_health if i["status"] == "anomaly"],
    }


def _clear_demo_data(session: Session) -> None:
    session.exec(delete(AiCallLog))
    session.exec(delete(StrategyOutcome))
    session.exec(delete(BaselineOutcome))
    session.exec(delete(Transaction))
    session.commit()


@app.get("/api/ai-health")
def ai_health(force: bool = Query(False)) -> dict[str, Any]:
    return run_ai_health_check(force=force)


@app.get("/api/ai-call-log")
def ai_call_log(limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    with Session(engine) as session:
        rows = session.exec(
            select(AiCallLog).order_by(AiCallLog.timestamp.desc()).limit(limit)
        ).all()
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat(),
            "agent": r.agent,
            "transaction_id": r.transaction_id,
            "model": r.model,
            "latency_ms": r.latency_ms,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "source": r.source,
            "prompt_preview": r.prompt_preview,
            "response_preview": r.response_preview,
        }
        for r in rows
    ]


@app.get("/api/demo/info")
def demo_info() -> dict[str, Any]:
    return {
        "mode": "sample",
        "description": "Sample transaction dataset. AI runs locally via Ollama + DeepSeek-R1.",
        "steps": [
            "Generate failed payment records",
            "Rule engine + local LLM risk note on each",
            "Pick recovery strategy (retry, nudge, negotiate, or skip)",
            "Negotiation uses live local DeepSeek-R1 agents",
        ],
        "ai_mode": "ollama_live" if ai_is_live() else "mock_fallback",
        "ai_connected": ai_is_live(),
        "ai_model": OLLAMA_MODEL,
    }


@app.post("/api/demo/start")
def demo_start(
    background_tasks: BackgroundTasks,
    count: int = Query(40, ge=5, le=100),
) -> dict[str, Any]:
    """One-click flow: clear → generate batch → run full recovery."""
    with Session(engine) as session:
        _clear_demo_data(session)

    batch = generate_batch(background_tasks=background_tasks, count=count)
    recovery = run_recovery(background_tasks)

    return {
        "message": "Started with sample transactions and analysis",
        "transactions_created": batch["created"],
        "recovery_queued": recovery["queued"],
        "next": "Watch dashboard fill in, then open a negotiation case in Transactions",
    }


@app.get("/api/transactions")
def list_transactions(
    status: Annotated[Optional[str], Query()] = None,
    view: Annotated[str, Query(description="active | archived | all")] = "active",
    since_hours: Annotated[Optional[float], Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[dict[str, Any]]:
    with Session(engine) as session:
        stmt = select(Transaction).order_by(Transaction.created_at.desc())
        stmt = _apply_txn_list_filters(stmt, view=view, since_hours=since_hours)
        if status:
            try:
                st = TransactionStatus(status)
                stmt = stmt.where(Transaction.status == st)
            except ValueError:
                pass
        rows = session.exec(stmt.limit(limit)).all()
        return [txn_to_dict(r) for r in rows]


@app.get("/api/data/stats")
def data_stats() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        all_txns = list(session.exec(select(Transaction)).all())
        active = [t for t in all_txns if t.archived_at is None]
        archived = [t for t in all_txns if t.archived_at is not None]

        def count_since(hours: float) -> int:
            cutoff = now - timedelta(hours=hours)
            return sum(1 for t in active if _as_utc(t.created_at) >= cutoff)

        return {
            "total": len(all_txns),
            "active": len(active),
            "archived": len(archived),
            "active_last_1h": count_since(1),
            "active_last_2h": count_since(2),
            "active_last_3h": count_since(3),
            "active_today": count_since(24),
        }


@app.post("/api/data/archive")
def archive_data(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Move transactions to archive (hidden from dashboard/demo views)."""
    body = body or {}
    mode = body.get("mode", "all_active")
    since_hours = body.get("since_hours")
    now = datetime.now(timezone.utc)

    with Session(engine) as session:
        txns = list(session.exec(select(Transaction).where(_active_txn_clause())).all())
        to_archive: list[Transaction] = []

        if mode == "all_active":
            to_archive = txns
        elif mode == "older_than_hours":
            hours = float(since_hours or 3)
            cutoff = now - timedelta(hours=hours)
            to_archive = [t for t in txns if _as_utc(t.created_at) < cutoff]
        elif mode == "outside_window":
            hours = float(since_hours or 3)
            cutoff = now - timedelta(hours=hours)
            to_archive = [t for t in txns if _as_utc(t.created_at) < cutoff]
        else:
            raise HTTPException(400, f"Unknown mode: {mode}")

        for txn in to_archive:
            txn.archived_at = now
            session.add(txn)
        session.commit()

    return {"archived": len(to_archive), "mode": mode}


@app.post("/api/data/unarchive")
def unarchive_data(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    mode = body.get("mode", "all")

    with Session(engine) as session:
        if mode == "all":
            txns = list(session.exec(select(Transaction).where(Transaction.archived_at.isnot(None))).all())
        else:
            txns = []
        for txn in txns:
            txn.archived_at = None
            session.add(txn)
        session.commit()

    return {"restored": len(txns), "mode": mode}


@app.get("/api/transactions/{txn_id}")
def get_transaction(txn_id: str) -> dict[str, Any]:
    with Session(engine) as session:
        txn = session.get(Transaction, txn_id)
        if not txn:
            raise HTTPException(404, "Transaction not found")
        return txn_to_dict(txn)


@app.post("/api/transactions/{txn_id}/diagnose")
def diagnose(txn_id: str) -> dict[str, Any]:
    with Session(engine) as session:
        txn = session.get(Transaction, txn_id)
        if not txn:
            raise HTTPException(404, "Transaction not found")
        txn.status = TransactionStatus.diagnosing
        session.add(txn)
        session.commit()
        apply_diagnosis_and_strategy(session, txn)
        txn.status = TransactionStatus.strategy_selected
        session.add(txn)
        session.commit()
        session.refresh(txn)
        return txn_to_dict(txn)


@app.post("/api/transactions/{txn_id}/select-strategy")
def select_strategy(txn_id: str) -> dict[str, Any]:
    with Session(engine) as session:
        txn = session.get(Transaction, txn_id)
        if not txn:
            raise HTTPException(404, "Transaction not found")
        apply_diagnosis_and_strategy(session, txn)
        txn.status = TransactionStatus.strategy_selected
        session.add(txn)
        session.commit()
        session.refresh(txn)
        return txn_to_dict(txn)


@app.post("/api/transactions/{txn_id}/negotiate")
def negotiate(txn_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    with Session(engine) as session:
        txn = session.get(Transaction, txn_id)
        if not txn:
            raise HTTPException(404, "Transaction not found")
        if txn.strategy != Strategy.negotiation:
            raise HTTPException(400, "Strategy is not negotiation")
        if txn.status == TransactionStatus.recovering:
            conv = parse_conversation(txn.conversation)
            if conv:
                return {"status": "in_progress", "transaction": txn_to_dict(txn)}
            # Stuck with empty conversation — restart below
        if txn.status in (TransactionStatus.recovered, TransactionStatus.lost):
            return {"status": "complete", "transaction": txn_to_dict(txn)}

        txn.status = TransactionStatus.recovering
        txn.customer_persona = txn.customer_persona or random.choice(PERSONAS)
        session.add(txn)
        session.commit()

    background_tasks.add_task(_negotiate_background, txn_id)
    with Session(engine) as session:
        txn = session.get(Transaction, txn_id)
        return {"status": "started", "transaction": txn_to_dict(txn)}


def _negotiate_background(txn_id: str) -> None:
    with Session(engine) as session:
        run_negotiation(session, txn_id)


@app.post("/api/run-recovery")
def run_recovery(background_tasks: BackgroundTasks) -> dict[str, Any]:
    with Session(engine) as session:
        pending = session.exec(
            select(Transaction).where(
                Transaction.status.in_([
                    TransactionStatus.failed,
                    TransactionStatus.strategy_selected,
                ])
            )
        ).all()
        ids = [t.id for t in pending]

    processed = 0
    for txn_id in ids:
        with Session(engine) as session:
            txn = session.get(Transaction, txn_id)
            if not txn or txn.status not in (
                TransactionStatus.failed,
                TransactionStatus.strategy_selected,
            ):
                continue

            apply_diagnosis_and_strategy(session, txn)
            txn.status = TransactionStatus.strategy_selected
            session.add(txn)
            session.commit()
            processed += 1

            if txn.strategy == Strategy.none:
                txn.status = TransactionStatus.lost
                _refresh_analysis(session, txn)
                continue

            if txn.strategy == Strategy.negotiation:
                txn.status = TransactionStatus.recovering
                txn.customer_persona = random.choice(PERSONAS)
                session.add(txn)
                session.commit()
                background_tasks.add_task(_negotiate_background, txn_id)
                continue

            txn.status = TransactionStatus.recovering
            session.add(txn)
            session.commit()

            success, recovered = simulate_simple_recovery(txn, txn.diagnosis)
            txn.status = TransactionStatus.recovered if success else TransactionStatus.lost
            txn.recovered_amount = recovered if success else 0.0
            if success:
                txn.payment_link = f"https://pay.reviveai.demo/{txn.id}"
            record_outcome(session, txn, success)
            _refresh_analysis(session, txn)

    return {"queued": processed, "message": "Recovery pipeline started"}


@app.get("/api/strategy-performance")
def strategy_performance() -> list[dict[str, Any]]:
    with Session(engine) as session:
        outcomes = session.exec(select(StrategyOutcome)).all()

    buckets: dict[tuple[str, str], list[bool]] = {}
    for o in outcomes:
        key = (o.decline_code.value, o.strategy.value)
        buckets.setdefault(key, []).append(o.success)

    result = []
    for (decline, strategy), vals in sorted(buckets.items()):
        result.append({
            "decline_code": decline,
            "strategy": strategy,
            "attempts": len(vals),
            "successes": sum(vals),
            "success_rate": round(sum(vals) / len(vals), 3) if vals else 0.0,
        })
    return result


@app.get("/api/dashboard-summary")
def dashboard_summary() -> dict[str, Any]:
    with Session(engine) as session:
        txns = _load_visible_transactions(session)

    total = len(txns)
    recovered_txns = [t for t in txns if t.status == TransactionStatus.recovered]
    total_recovered = sum(t.recovered_amount or 0 for t in recovered_txns)
    attempted = [t for t in txns if t.strategy and t.strategy != Strategy.none]
    in_progress = [t for t in txns if t.status == TransactionStatus.recovering]
    not_pursued = [t for t in txns if t.strategy == Strategy.none]

    decline_breakdown: dict[str, int] = {}
    strategy_breakdown: dict[str, int] = {}
    for t in txns:
        decline_breakdown[t.decline_code.value] = decline_breakdown.get(t.decline_code.value, 0) + 1
        if t.strategy:
            strategy_breakdown[t.strategy.value] = strategy_breakdown.get(t.strategy.value, 0) + 1

    return {
        "total_recovered_inr": round(total_recovered, 2),
        "total_attempted": len(attempted),
        "total_transactions": total,
        "recovery_rate": round(len(recovered_txns) / len(attempted), 3) if attempted else 0.0,
        "cases_in_progress": len(in_progress),
        "cases_not_pursued": len(not_pursued),
        "decline_breakdown": decline_breakdown,
        "strategy_breakdown": strategy_breakdown,
        "not_pursued_cases": [
            {
                "id": t.id,
                "customer_name": t.customer_name,
                "amount": t.amount,
                "diagnosis": t.diagnosis,
                "decline_code": t.decline_code.value,
            }
            for t in not_pursued
        ],
    }


def _build_executive_summary_payload(session: Session) -> dict[str, Any]:
    txns = _load_visible_transactions(session)
    impact = compute_impact_summary(session)
    issuers = compute_issuer_health(session, apply_reroutes=False)

    recovered = sorted(
        [t for t in txns if t.status == TransactionStatus.recovered],
        key=lambda t: t.recovered_amount or 0,
        reverse=True,
    )[:3]
    lost = sorted(
        [t for t in txns if t.status == TransactionStatus.lost],
        key=lambda t: t.amount,
        reverse=True,
    )[:3]
    anomalies = [i for i in issuers if i["status"] == "anomaly"]

    return {
        "total_transactions": len(txns),
        "total_recovered_inr": round(
            sum(t.recovered_amount or 0 for t in txns if t.status == TransactionStatus.recovered), 2
        ),
        "recovery_rate_pct": round(impact["revive_recovery_rate"] * 100, 1),
        "cases_in_progress": sum(1 for t in txns if t.status == TransactionStatus.recovering),
        "cases_not_pursued": sum(1 for t in txns if t.strategy == Strategy.none),
        "impact_lift_pct": impact["lift_percentage"],
        "extra_recovered_inr": impact["extra_amount_recovered"],
        "baseline_expected_inr": impact["baseline_recovered_total"],
        "issuer_anomalies": [
            {"issuer": a["issuer_name"], "decline_count": a["decline_count"], "rerouted": a["rerouted_count"]}
            for a in anomalies
        ],
        "top_recovered": [
            {"customer": t.customer_name, "amount_inr": t.recovered_amount or 0, "product": t.product_name}
            for t in recovered
        ],
        "top_lost": [
            {"customer": t.customer_name, "amount_inr": t.amount, "decline": t.decline_code.value}
            for t in lost
        ],
    }


def _mock_executive_summary(data: dict[str, Any]) -> str:
    rec = data["total_recovered_inr"]
    rate = data["recovery_rate_pct"]
    lift = data["impact_lift_pct"]
    extra = data["extra_recovered_inr"]
    if data["total_transactions"] == 0:
        return (
            "No payment recovery activity has been recorded yet. "
            "Generate a batch of failed transactions and run the recovery pipeline to produce metrics. "
            "Recommendation: start with a 40-transaction sample batch to establish a baseline performance read."
        )
    anomaly_note = ""
    if data["issuer_anomalies"]:
        names = ", ".join(a["issuer"] for a in data["issuer_anomalies"])
        anomaly_note = f" Issuer health flagged anomalies at {names}."
    perf = (
        f"ReviveAI recovered ₹{rec:,.0f} across the portfolio at a {rate:.1f}% recovery rate, "
        f"beating blind-retry expectations by {lift:+.1f}% (₹{extra:+,.0f} vs baseline)."
        if lift >= 0
        else f"ReviveAI recovered ₹{rec:,.0f} at a {rate:.1f}% rate, trailing blind-retry expectations "
        f"by {abs(lift):.1f}% (₹{extra:,.0f} vs baseline)."
    )
    return (
        f"{perf}{anomaly_note} "
        f"{data['cases_in_progress']} cases remain in progress and {data['cases_not_pursued']} were not pursued. "
        "Recommendation: prioritize high-value lost cases with negotiation-eligible decline codes next."
    )


def generate_executive_summary(session: Session, *, force: bool = False) -> dict[str, Any]:
    global _executive_summary_cache, _executive_summary_cache_at
    now = time.time()
    if (
        not force
        and _executive_summary_cache
        and now - _executive_summary_cache_at < EXEC_SUMMARY_CACHE_TTL
    ):
        return _executive_summary_cache

    data = _build_executive_summary_payload(session)
    data_json = json.dumps(data, indent=2)
    system = (
        "You are writing a one-paragraph executive summary for a fintech leadership team "
        "reviewing a payment recovery system's performance. Write 3-4 sentences in plain English, "
        "no bullet points. Reference the actual numbers given. Be honest about underperformance "
        "if the data shows it — do not spin bad numbers as good. End with one concrete recommendation."
    )
    user_prompt = f"Data:\n{data_json}"

    if _ollama_reachable():
        reply = ai_reply(
            system=system,
            user_prompt=user_prompt,
            agent="executive_summary",
            session=None,
        )
        if reply.source == "ollama" and reply.text and len(reply.text) > 80:
            summary_text = reply.text
            source = "ollama"
        else:
            logger.warning("Executive summary fell back to rule-based text (Ollama unavailable or empty)")
            summary_text = _mock_executive_summary(data)
            source = "mock"
    else:
        summary_text = _mock_executive_summary(data)
        source = "mock"

    result = {
        "summary": summary_text.strip(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "model": OLLAMA_MODEL if source == "ollama" else "rule_based_fallback",
        "data_snapshot": data,
    }
    _executive_summary_cache = result
    _executive_summary_cache_at = now
    return result


@app.get("/api/executive-summary")
def executive_summary(force: bool = Query(False)) -> dict[str, Any]:
    with Session(engine) as session:
        result = generate_executive_summary(session, force=force)
    return {
        "summary": result["summary"],
        "timestamp": result["timestamp"],
        "source": result["source"],
        "model": result["model"],
    }


# ---------------------------------------------------------------------------
# Impact simulator (baseline comparison)
# ---------------------------------------------------------------------------

@app.post("/api/simulate-baseline")
def simulate_baseline(body: dict[str, Any] | None = None) -> dict[str, Any]:
    txn_ids = (body or {}).get("transaction_ids")
    with Session(engine) as session:
        result = run_simulate_baseline(session, txn_ids)
        summary = compute_impact_summary(session)
    return {**result, "impact_preview": summary}


@app.get("/api/impact-summary")
def impact_summary() -> dict[str, Any]:
    with Session(engine) as session:
        return compute_impact_summary(session)


@app.get("/api/impact-breakdown")
def impact_breakdown() -> dict[str, Any]:
    with Session(engine) as session:
        summary = compute_impact_summary(session)
        breakdown = compute_impact_breakdown(session)
    return {**summary, **breakdown}


# ---------------------------------------------------------------------------
# Issuer health radar
# ---------------------------------------------------------------------------

@app.get("/api/issuer-health")
def issuer_health() -> list[dict[str, Any]]:
    with Session(engine) as session:
        return compute_issuer_health(session, apply_reroutes=True)


# ---------------------------------------------------------------------------
# Razorpay-style log import (simulated webhook replay)
# ---------------------------------------------------------------------------

REQUIRED_IMPORT_FIELDS = [
    "razorpay_payment_id",
    "razorpay_order_id",
    "customer_name",
    "product_name",
    "amount",
    "currency",
    "method",
    "decline_code",
    "customer_tenure_days",
    "past_decline_count",
    "created_at",
]

IMPORT_JOBS: dict[str, dict[str, Any]] = {}

SAMPLE_DATA_DIR = os.path.join(os.path.dirname(__file__), "sample_data")

SAMPLE_IMPORTS: list[dict[str, Any]] = [
    {
        "filename": "01_decline_types_mix.csv",
        "title": "All decline types",
        "description": "One row per decline code — best first import demo.",
        "use_case": "baseline_demo",
        "rows": 6,
    },
    {
        "filename": "02_high_value_negotiation.csv",
        "title": "High-value negotiation",
        "description": "Large amounts (₹4k–₹12k) to trigger AI negotiation strategy.",
        "use_case": "negotiation",
        "rows": 7,
    },
    {
        "filename": "03_loyal_customers.csv",
        "title": "Loyal customers",
        "description": "Long tenure, few past declines — high recoverability.",
        "use_case": "loyal_recovery",
        "rows": 7,
    },
    {
        "filename": "04_repeat_decliners.csv",
        "title": "Repeat decliners",
        "description": "Many past failures — low recoverability, likely skipped.",
        "use_case": "low_recovery",
        "rows": 7,
    },
    {
        "filename": "05_issuer_spike_hdfc.csv",
        "title": "HDFC issuer spike",
        "description": "All declines from HDFC Bank — triggers issuer health radar.",
        "use_case": "issuer_anomaly",
        "rows": 8,
    },
    {
        "filename": "06_subscription_renewals.csv",
        "title": "Subscription renewals",
        "description": "SaaS and box subscriptions with mixed decline reasons.",
        "use_case": "subscriptions",
        "rows": 7,
    },
    {
        "filename": "07_upi_wallet_mix.csv",
        "title": "UPI & wallet",
        "description": "Non-card payment methods — method switch strategies.",
        "use_case": "payment_methods",
        "rows": 7,
    },
    {
        "filename": "08_live_stage_demo.csv",
        "title": "Live stage demo",
        "description": "Balanced 7-row set with recent timestamps for on-stage import.",
        "use_case": "stage_demo",
        "rows": 7,
    },
]


@app.get("/api/sample-imports")
def list_sample_imports() -> list[dict[str, Any]]:
    return SAMPLE_IMPORTS


@app.get("/api/sample-imports/{filename}")
def download_sample_import(filename: str):
    safe = os.path.basename(filename)
    allowed = {s["filename"] for s in SAMPLE_IMPORTS}
    allowed.add("ReviveAI_Sample_Imports.xlsx")
    if safe not in allowed:
        raise HTTPException(404, "Sample file not found")
    path = os.path.join(SAMPLE_DATA_DIR, safe)
    if not os.path.isfile(path):
        raise HTTPException(404, "Sample file missing on disk")
    if safe.endswith(".xlsx"):
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=safe,
        )
    return FileResponse(path, media_type="text/csv", filename=safe)


def _normalize_header(name: str) -> str:
    return name.strip().lower().replace(" ", "_")


def _parse_created_at(value: str) -> datetime:
    raw = value.strip()
    if not raw:
        raise ValueError("created_at is empty")
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Invalid created_at: {value!r}")


def _coerce_import_row(raw: dict[str, Any], line: int) -> dict[str, Any]:
    row = {_normalize_header(k): (v.strip() if isinstance(v, str) else v) for k, v in raw.items()}
    missing = [f for f in REQUIRED_IMPORT_FIELDS if f not in row or row[f] in (None, "")]
    if missing:
        raise ValueError(f"Row {line}: missing fields: {', '.join(missing)}")

    try:
        decline = DeclineCode(row["decline_code"])
    except ValueError as exc:
        valid = ", ".join(c.value for c in DeclineCode)
        raise ValueError(
            f"Row {line}: invalid decline_code {row['decline_code']!r}. Expected one of: {valid}"
        ) from exc

    try:
        amount = float(row["amount"])
        tenure = int(row["customer_tenure_days"])
        past_declines = int(row["past_decline_count"])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Row {line}: amount, customer_tenure_days, and past_decline_count must be numeric") from exc

    method = str(row["method"]).lower()
    if method not in ("card", "upi", "netbanking", "wallet"):
        raise ValueError(f"Row {line}: method must be card, upi, netbanking, or wallet")

    return {
        "razorpay_payment_id": str(row["razorpay_payment_id"]),
        "razorpay_order_id": str(row["razorpay_order_id"]),
        "customer_name": str(row["customer_name"]),
        "product_name": str(row["product_name"]),
        "amount": amount,
        "currency": str(row["currency"]).upper(),
        "payment_method": method,
        "decline_code": decline,
        "customer_tenure_days": tenure,
        "past_decline_count": past_declines,
        "created_at": _parse_created_at(str(row["created_at"])),
        "issuer": str(row["issuer"]).strip() if row.get("issuer") not in (None, "") else None,
    }


def _parse_import_csv(content: bytes) -> tuple[list[dict[str, Any]], set[str]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV file has no header row")
    headers = {_normalize_header(h) for h in reader.fieldnames if h}
    missing = [f for f in REQUIRED_IMPORT_FIELDS if f not in headers]
    if missing:
        raise HTTPException(
            status_code=400,
            detail={"error": "Missing required columns", "missing_fields": missing, "found_columns": sorted(headers)},
        )
    rows: list[dict[str, Any]] = []
    for i, raw in enumerate(reader, start=2):
        if not any(v not in (None, "") for v in raw.values()):
            continue
        rows.append(_coerce_import_row(raw, i))
    return rows, headers


def _parse_import_json(content: bytes) -> tuple[list[dict[str, Any]], set[str]]:
    try:
        payload = json.loads(content.decode("utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if isinstance(payload, dict):
        records = payload.get("records") or payload.get("data") or payload.get("events")
        if records is None:
            raise ValueError("JSON must be an array or an object with a 'records' / 'data' / 'events' array")
    elif isinstance(payload, list):
        records = payload
    else:
        raise ValueError("JSON must be an array of records or an object wrapping an array")

    if not records:
        raise ValueError("JSON contains no records")

    headers = {_normalize_header(k) for k in records[0].keys()}
    missing = [f for f in REQUIRED_IMPORT_FIELDS if f not in headers]
    if missing:
        raise HTTPException(
            status_code=400,
            detail={"error": "Missing required fields", "missing_fields": missing, "found_fields": sorted(headers)},
        )

    rows: list[dict[str, Any]] = []
    for i, raw in enumerate(records, start=1):
        rows.append(_coerce_import_row(raw, i))
    return rows, headers


def _parse_import_file(content: bytes, filename: str) -> list[dict[str, Any]]:
    name = (filename or "").lower()
    if name.endswith(".json"):
        rows, _ = _parse_import_json(content)
    elif name.endswith(".csv"):
        rows, _ = _parse_import_csv(content)
    else:
        try:
            rows, _ = _parse_import_csv(content)
        except HTTPException:
            raise
        except ValueError:
            rows, _ = _parse_import_json(content)

    if not rows:
        raise HTTPException(status_code=400, detail="File contains no data rows")
    return rows


def _format_inr(amount: float) -> str:
    return f"₹{amount:,.0f}"


def _import_progress_message(index: int, total: int, row: dict[str, Any], phase: str) -> str:
    base = f"{row['customer_name']}, {_format_inr(row['amount'])}, {row['decline_code'].value}"
    if phase == "ingested":
        return f"Ingested {index}/{total} — {base}"
    if phase == "diagnosing":
        return f"Diagnosing {index}/{total} — {base}"
    return f"Reviewed {index}/{total} — {base}"


def _append_import_event(job_id: str, event: dict[str, Any]) -> None:
    job = IMPORT_JOBS.get(job_id)
    if not job:
        return
    job["events"].append(event)
    job["last_event"] = event
    if event.get("phase") == "diagnosed":
        job["processed"] = event.get("index", job["processed"])


async def _run_import_job(job_id: str, rows: list[dict[str, Any]], replace: bool) -> None:
    job = IMPORT_JOBS[job_id]
    total = len(rows)
    created_ids: list[str] = []

    try:
        if replace:
            with Session(engine) as session:
                _clear_demo_data(session)

        for index, row in enumerate(rows, start=1):
            await asyncio.sleep(random.uniform(0.3, 0.5))

            with Session(engine) as session:
                txn = Transaction(
                    razorpay_payment_id=row["razorpay_payment_id"],
                    razorpay_order_id=row["razorpay_order_id"],
                    customer_name=row["customer_name"],
                    product_name=row["product_name"],
                    amount=row["amount"],
                    currency=row["currency"],
                    payment_method=row["payment_method"],
                    decline_code=row["decline_code"],
                    customer_tenure_days=row["customer_tenure_days"],
                    past_decline_count=row["past_decline_count"],
                    created_at=row["created_at"],
                    status=TransactionStatus.failed,
                    is_demo=True,
                    issuer=row.get("issuer") or pick_issuer(),
                )
                session.add(txn)
                session.commit()
                session.refresh(txn)
                txn_id = txn.id
                created_ids.append(txn_id)

            ingested_event = {
                "event": "row_update",
                "phase": "ingested",
                "index": index,
                "total": total,
                "transaction_id": txn_id,
                "customer_name": row["customer_name"],
                "product_name": row["product_name"],
                "amount": row["amount"],
                "currency": row["currency"],
                "decline_code": row["decline_code"].value,
                "payment_method": row["payment_method"],
                "message": _import_progress_message(index, total, row, "ingested"),
            }
            _append_import_event(job_id, ingested_event)

            await asyncio.sleep(random.uniform(0.05, 0.15))

            with Session(engine) as session:
                txn = session.get(Transaction, txn_id)
                if not txn:
                    continue
                txn.status = TransactionStatus.diagnosing
                session.add(txn)
                session.commit()

            diagnosing_event = {
                **ingested_event,
                "phase": "diagnosing",
                "message": _import_progress_message(index, total, row, "diagnosing"),
            }
            _append_import_event(job_id, diagnosing_event)

            with Session(engine) as session:
                txn = session.get(Transaction, txn_id)
                if not txn:
                    continue
                auto_diagnose_transaction(session, txn, fill_ai=True)
                session.refresh(txn)
                analysis = parse_json(txn.analysis) or {}

            diagnosed_event = {
                **ingested_event,
                "phase": "diagnosed",
                "status": txn.status.value,
                "diagnosis": txn.diagnosis,
                "strategy": txn.strategy.value if txn.strategy else None,
                "recoverability_score": analysis.get("recoverability_score"),
                "recoverability_label": analysis.get("recoverability_label"),
                "diagnosis_ai_note": txn.diagnosis_ai_note,
                "diagnosis_ai_note_source": txn.diagnosis_ai_note_source,
                "message": _import_progress_message(index, total, row, "diagnosed"),
            }
            _append_import_event(job_id, diagnosed_event)

        job["status"] = "complete"
        job["transaction_ids"] = created_ids
        with Session(engine) as session:
            run_simulate_baseline(session, created_ids)
            compute_issuer_health(session)
        _append_import_event(
            job_id,
            {
                "event": "complete",
                "index": total,
                "total": total,
                "processed": total,
                "message": f"Import complete — {total} transactions ingested and reviewed",
            },
        )
    except Exception as exc:
        logger.exception("Import job %s failed", job_id)
        job["status"] = "error"
        job["error"] = str(exc)
        _append_import_event(job_id, {"event": "error", "message": str(exc)})


@app.post("/api/import-logs")
async def import_logs(
    file: UploadFile = File(...),
    replace: bool = Query(True, description="Clear existing demo data before import"),
) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        rows = _parse_import_file(content, file.filename or "upload.csv")
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job_id = str(uuid.uuid4())
    IMPORT_JOBS[job_id] = {
        "job_id": job_id,
        "status": "running",
        "total": len(rows),
        "processed": 0,
        "events": [],
        "error": None,
        "filename": file.filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    asyncio.create_task(_run_import_job(job_id, rows, replace))

    return {
        "job_id": job_id,
        "total": len(rows),
        "message": f"Import started — simulating {len(rows)} payment.failed webhook events",
        "stream_url": f"/api/import-jobs/{job_id}/stream",
        "poll_url": f"/api/import-jobs/{job_id}",
    }


@app.get("/api/import-jobs/{job_id}")
def get_import_job(job_id: str) -> dict[str, Any]:
    job = IMPORT_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    return {
        "job_id": job_id,
        "status": job["status"],
        "total": job["total"],
        "processed": job["processed"],
        "error": job.get("error"),
        "events": job["events"],
        "filename": job.get("filename"),
    }


@app.get("/api/import-jobs/{job_id}/stream")
async def stream_import_job(job_id: str) -> StreamingResponse:
    if job_id not in IMPORT_JOBS:
        raise HTTPException(status_code=404, detail="Import job not found")

    async def event_generator():
        cursor = 0
        while True:
            job = IMPORT_JOBS.get(job_id)
            if not job:
                yield f"data: {json.dumps({'event': 'error', 'message': 'Job not found'})}\n\n"
                break

            events = job["events"]
            while cursor < len(events):
                yield f"data: {json.dumps(events[cursor])}\n\n"
                cursor += 1

            if job["status"] in ("complete", "error"):
                break
            await asyncio.sleep(0.25)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
