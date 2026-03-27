"""Pydantic data models for the PDF parser microservice."""

from pydantic import BaseModel
from typing import Optional


class ParsedTransaction(BaseModel):
    """A single transaction extracted from a PDF bank statement."""

    external_id: Optional[str] = None
    date: str  # YYYY-MM-DD
    description: str
    amount_cents: int  # always positive
    is_credit: bool
    merchant_name: Optional[str] = None
    running_balance_cents: Optional[int] = None


class ParseError(BaseModel):
    """An error encountered while parsing a specific page."""

    page: int
    error: str
    raw: str = ""


class ParseResponse(BaseModel):
    """Aggregate response from the PDF parser containing extracted transactions and errors."""

    transactions: list[ParsedTransaction]
    errors: list[ParseError]
    detected_bank: Optional[str] = None
    pages_processed: int
    method: str  # "rule_based" | "ai_fallback" | "tabula" | "none"
