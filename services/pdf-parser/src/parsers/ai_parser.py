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
        prompt = f"""Extract all financial transactions from the following bank statement page.
For each transaction, return a JSON object with:
- "date": date in YYYY-MM-DD format
- "description": the transaction description/merchant
- "amount": the dollar amount as a positive number (e.g., 85.23)
- "is_credit": true if money was deposited/credited, false if spent/debited

Return ONLY a JSON array of transactions. If no transactions found, return [].

Bank statement text:
---
{text[:3000]}
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
