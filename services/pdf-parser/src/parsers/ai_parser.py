"""AI-based PDF parser using Ollama (Mistral) as a fallback.

When rule-based and table extraction parsers fail, this parser sends
the extracted text from each PDF page to a local Ollama instance for
AI-powered transaction extraction.
"""

import pdfplumber
import httpx
import json
import io
import os
import re
import logging
from ..models import ParsedTransaction, ParseError, ParseResponse

logger = logging.getLogger(__name__)

# ── PII Sanitization ────────────────────────────────────────
# Mirrors the NestJS pii-sanitizer.ts — strips sensitive data before sending
# raw bank-statement text to the local LLM.
_PII_PATTERNS: list[tuple[re.Pattern, str]] = [
    # SSN: 123-45-6789
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    # Credit card: 4×4 (Visa/MC 16-digit) or 4-6-5 (Amex 15-digit)
    (re.compile(r"\b(?:\d{4}[\s-]?\d{6}[\s-]?\d{5}|\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b"), "[CARD]"),
    # Email
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[EMAIL]"),
    # US phone: (123) 456-7890 or 123-456-7890
    (re.compile(r"(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})"), "[PHONE]"),
    # Routing number: exactly 9 digits
    (re.compile(r"\b\d{9}\b"), "[ROUTING]"),
    # Account numbers: 10-18 consecutive digits
    (re.compile(r"\b\d{10,18}\b"), "[ACCT]"),
    # Street addresses (basic: number + street name + suffix)
    (re.compile(r"\b\d{1,6}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place|Cir|Circle)\b", re.IGNORECASE), "[ADDRESS]"),
]


def sanitize_text(text: str) -> str:
    """Strip PII from raw text before sending to the LLM."""
    result = text
    for pattern, replacement in _PII_PATTERNS:
        result = pattern.sub(replacement, result)
    return result


class AiPdfParser:
    """AI-based PDF parser using a local Ollama LLM instance.

    Extracts text from PDF pages via pdfplumber and sends it to Ollama
    (Mistral 7B by default) with a structured prompt for transaction extraction.
    The LLM returns JSON which is validated and converted to ParsedTransactions.
    """

    def __init__(self):
        """Initialize with Ollama URL and model from environment variables."""
        self.ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_MODEL", "mistral:7b")

    async def parse(self, content: bytes) -> ParseResponse:
        """Parse a PDF file by sending page text to Ollama for AI extraction.

        Iterates through each page, extracts text, and sends it to the LLM.
        Returns aggregated transactions from all pages.

        Args:
            content: Raw PDF file bytes.

        Returns:
            ParseResponse with AI-extracted transactions, errors, and metadata.
        """
        transactions: list[ParsedTransaction] = []
        errors: list[ParseError] = []
        pages_processed = 0

        try:
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    pages_processed += 1
                    text = page.extract_text() or ""

                    if not text.strip():
                        continue

                    # Send page text to Ollama
                    page_txns = await self._extract_from_text(text, page_num)
                    transactions.extend(page_txns)

        except Exception as e:
            logger.error(f"AI PDF parsing error: {e}")
            errors.append(ParseError(page=0, error=str(e), raw=""))

        return ParseResponse(
            transactions=transactions,
            errors=errors,
            detected_bank=None,
            pages_processed=pages_processed,
            method="ai_fallback",
        )

    async def _extract_from_text(
        self,
        text: str,
        page_num: int,
    ) -> list[ParsedTransaction]:
        """Send page text to Ollama and parse the LLM response into transactions.

        Constructs a structured prompt requesting JSON output, sends it to the
        Ollama generate API, and parses the response.

        Args:
            text: Extracted text from a single PDF page (truncated to 3000 chars).
            page_num: Page number for logging.

        Returns:
            List of ParsedTransactions extracted by the AI.
        """
        # Sanitize PII before sending to the LLM
        safe_text = sanitize_text(text[:3000])

        prompt = f"""Extract all financial transactions from the following bank statement page.
For each transaction, return a JSON object with:
- "date": date in YYYY-MM-DD format
- "description": the transaction description/merchant
- "amount": the dollar amount as a positive number (e.g., 85.23)
- "is_credit": true if money was deposited/credited, false if spent/debited

Return ONLY a JSON array of transactions. If no transactions found, return [].

Bank statement text:
---
{safe_text}
---

JSON array:"""

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.ollama_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.1,
                            "num_predict": 2000,
                        },
                    },
                )

                if response.status_code != 200:
                    logger.warning(f"Ollama returned {response.status_code}")
                    return []

                data = response.json()
                response_text = data.get("response", "")

                return self._parse_ai_response(response_text)

        except httpx.TimeoutException:
            logger.warning("Ollama request timed out")
            return []
        except Exception as e:
            logger.warning(f"Ollama error: {e}")
            return []

    def _parse_ai_response(self, text: str) -> list[ParsedTransaction]:
        """Parse a JSON array of transactions from an LLM text response.

        Extracts the first JSON array found in the response text, validates
        each item, and converts to ParsedTransaction objects. Invalid items
        (missing fields, zero amounts, non-dict) are silently skipped.

        Args:
            text: Raw text response from Ollama containing a JSON array.

        Returns:
            List of valid ParsedTransactions parsed from the response.
        """
        try:
            # Extract JSON array from response
            json_match = re.search(r"\[[\s\S]*?\]", text)
            if not json_match:
                return []

            items = json.loads(json_match.group())
            transactions = []

            for item in items:
                if not isinstance(item, dict):
                    continue

                date = str(item.get("date", ""))
                description = str(item.get("description", ""))
                amount = item.get("amount", 0)
                is_credit = bool(item.get("is_credit", False))

                if not date or not description:
                    continue

                # Convert amount to cents
                try:
                    amount_cents = round(float(amount) * 100)
                except (ValueError, TypeError):
                    continue

                if amount_cents <= 0:
                    continue

                transactions.append(ParsedTransaction(
                    date=date,
                    description=description,
                    amount_cents=amount_cents,
                    is_credit=is_credit,
                    merchant_name=description.lower().strip(),
                ))

            return transactions

        except json.JSONDecodeError:
            logger.warning("Failed to parse JSON from AI response")
            return []
