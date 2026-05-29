# Phase 4: PDF Parser Microservice — Implementation Spec

**Dependencies**: Phase 2 (ingestion pipeline) | **Can run parallel with Phase 3**

## Decisions Summary

| # | Decision | Choice |
|---|----------|--------|
| 1 | PDF library | pdfplumber (Python) |
| 2 | Bank PDF coverage | BofA rule-based + generic AI fallback |
| 3 | AI integration | Python calls Ollama directly (self-contained) |
| 4 | Transport | FastAPI HTTP (:5000), called by NestJS |
| 5 | Fallback | tabula-py for complex table layouts |

---

## File Inventory

### Python Service (services/pdf-parser/)

| # | File | Purpose |
|---|------|---------|
| 1 | `src/main.py` | FastAPI app + health check |
| 2 | `src/routes.py` | POST /parse endpoint |
| 3 | `src/parsers/pdfplumber_parser.py` | Rule-based extraction |
| 4 | `src/parsers/boa_pdf.py` | BofA-specific table extraction |
| 5 | `src/parsers/ai_parser.py` | Ollama AI fallback for unknown PDFs |
| 6 | `src/models.py` | Pydantic models |
| 7 | `pyproject.toml` | Python dependencies |
| 8 | `Dockerfile` | Container build |

### NestJS Integration (apps/api/)

| # | File | Purpose |
|---|------|---------|
| 9 | `src/ingestion/parsers/pdf-proxy.service.ts` | HTTP client to Python PDF service |

### Tests

| # | File | Purpose |
|---|------|---------|
| 10 | `services/pdf-parser/src/tests/test_boa_pdf.py` | BofA PDF parser tests |
| 11 | `services/pdf-parser/src/tests/test_routes.py` | API endpoint tests |
| 12 | `config/sample-data/boa-statement.pdf` | Test fixture (manual creation) |

---

## Dependencies (Python)

### `services/pdf-parser/pyproject.toml`

```toml
[project]
name = "moneypulse-pdf-parser"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "pdfplumber>=0.11.0",
    "tabula-py>=2.9.0",
    "httpx>=0.27.0",
    "pydantic>=2.10.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "httpx>=0.27.0",
]
```

---

## 1. Pydantic Models

### `services/pdf-parser/src/models.py`

```python
from pydantic import BaseModel
from typing import Optional


class ParsedTransaction(BaseModel):
    external_id: Optional[str] = None
    date: str  # YYYY-MM-DD
    description: str
    amount_cents: int  # always positive
    is_credit: bool
    merchant_name: Optional[str] = None
    running_balance_cents: Optional[int] = None


class ParseError(BaseModel):
    page: int
    error: str
    raw: str = ""


class ParseResponse(BaseModel):
    transactions: list[ParsedTransaction]
    errors: list[ParseError]
    detected_bank: Optional[str] = None
    pages_processed: int
    method: str  # "rule_based" | "ai_fallback" | "tabula"
```

---

## 2. FastAPI Main

### `services/pdf-parser/src/main.py`

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager
import os

app = FastAPI(title="MoneyPulse PDF Parser", version="1.0.0")


@app.get("/health")
async def health():
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    return {
        "status": "ok",
        "service": "pdf-parser",
        "ollama_url": ollama_url,
    }


# Import routes after app creation to avoid circular imports
from .routes import router  # noqa: E402
app.include_router(router)
```

---

## 3. Parse Routes

### `services/pdf-parser/src/routes.py`

```python
from fastapi import APIRouter, UploadFile, File, HTTPException
from .models import ParseResponse
from .parsers.pdfplumber_parser import PdfPlumberParser
from .parsers.boa_pdf import BoaPdfParser
from .parsers.ai_parser import AiPdfParser
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Parser instances
boa_parser = BoaPdfParser()
generic_parser = PdfPlumberParser()
ai_parser = AiPdfParser()


@router.post("/parse", response_model=ParseResponse)
async def parse_pdf(
    file: UploadFile = File(...),
    institution: str | None = None,
):
    """
    Parse a PDF bank statement into transactions.

    Strategy:
    1. If institution is 'boa', use BofA-specific parser
    2. Try generic pdfplumber table extraction
    3. Fall back to AI extraction via Ollama
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    logger.info(f"Parsing PDF: {file.filename} ({len(content)} bytes), institution={institution}")

    # Strategy 1: Bank-specific parser
    if institution == "boa":
        result = boa_parser.parse(content)
        if result.transactions:
            logger.info(f"BofA parser extracted {len(result.transactions)} transactions")
            return result

    # Strategy 2: Generic pdfplumber table extraction
    result = generic_parser.parse(content)
    if result.transactions:
        logger.info(f"Generic parser extracted {len(result.transactions)} transactions")
        return result

    # Strategy 3: AI fallback
    logger.info("Rule-based parsing failed, trying AI extraction")
    result = await ai_parser.parse(content)
    if result.transactions:
        logger.info(f"AI parser extracted {len(result.transactions)} transactions")
        return result

    # Nothing worked
    logger.warning(f"All parsers failed for {file.filename}")
    return ParseResponse(
        transactions=[],
        errors=[ParseError(page=0, error="Could not extract transactions from this PDF", raw="")],
        detected_bank=None,
        pages_processed=0,
        method="none",
    )
```

---

## 4. BofA PDF Parser

### `services/pdf-parser/src/parsers/boa_pdf.py`

```python
import pdfplumber
import re
import io
import logging
from datetime import datetime
from ..models import ParsedTransaction, ParseError, ParseResponse

logger = logging.getLogger(__name__)


class BoaPdfParser:
    """
    Bank of America PDF Statement Parser.

    BofA statements have a consistent table format:
    - Date | Description | Amount | Running Balance
    - Deposits/credits appear under "Deposits and other additions"
    - Withdrawals appear under "Withdrawals and other subtractions"
    - Date format: MM/DD/YY or MM/DD/YYYY
    """

    # Regex for BofA transaction lines
    # Pattern: MM/DD/YY  Description  Amount  Balance
    TXN_PATTERN = re.compile(
        r"(\d{2}/\d{2}/\d{2,4})\s+"  # Date
        r"(.+?)\s+"                     # Description (non-greedy)
        r"(-?[\d,]+\.\d{2})\s*"         # Amount
        r"(-?[\d,]+\.\d{2})?\s*$"       # Optional running balance
    )

    def parse(self, content: bytes) -> ParseResponse:
        transactions: list[ParsedTransaction] = []
        errors: list[ParseError] = []
        pages_processed = 0
        is_boa = False
        current_section = "unknown"  # 'deposits' or 'withdrawals'

        try:
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    pages_processed += 1
                    text = page.extract_text() or ""

                    # Check if this is a BofA statement
                    if page_num == 1:
                        if "bank of america" not in text.lower():
                            return ParseResponse(
                                transactions=[],
                                errors=[],
                                detected_bank=None,
                                pages_processed=1,
                                method="rule_based",
                            )
                        is_boa = True

                    # Track section
                    for line in text.split("\n"):
                        line_stripped = line.strip().lower()

                        if "deposits and other" in line_stripped or "additions" in line_stripped:
                            current_section = "deposits"
                            continue
                        elif "withdrawals and other" in line_stripped or "subtractions" in line_stripped:
                            current_section = "withdrawals"
                            continue
                        elif "daily ending balance" in line_stripped:
                            current_section = "unknown"
                            continue

                        # Try to match transaction line
                        match = self.TXN_PATTERN.match(line.strip())
                        if match:
                            try:
                                txn = self._parse_match(match, current_section, page_num)
                                if txn:
                                    transactions.append(txn)
                            except Exception as e:
                                errors.append(ParseError(
                                    page=page_num,
                                    error=str(e),
                                    raw=line.strip(),
                                ))

        except Exception as e:
            logger.error(f"BofA PDF parsing error: {e}")
            errors.append(ParseError(page=0, error=str(e), raw=""))

        return ParseResponse(
            transactions=transactions,
            errors=errors,
            detected_bank="boa" if is_boa else None,
            pages_processed=pages_processed,
            method="rule_based",
        )

    def _parse_match(
        self,
        match: re.Match,
        section: str,
        page_num: int,
    ) -> ParsedTransaction | None:
        date_str, description, amount_str, balance_str = match.groups()

        # Parse date
        date = self._parse_date(date_str)
        if not date:
            return None

        # Parse amount
        amount_cents = self._parse_amount(amount_str)
        if amount_cents is None:
            return None

        # Determine credit/debit from section
        is_credit = section == "deposits"

        # Parse balance
        balance_cents = self._parse_amount(balance_str) if balance_str else None

        return ParsedTransaction(
            date=date,
            description=description.strip(),
            amount_cents=abs(amount_cents),
            is_credit=is_credit,
            merchant_name=self._clean_merchant(description),
            running_balance_cents=balance_cents,
        )

    def _parse_date(self, date_str: str) -> str | None:
        """Parse MM/DD/YY or MM/DD/YYYY to YYYY-MM-DD."""
        for fmt in ("%m/%d/%y", "%m/%d/%Y"):
            try:
                dt = datetime.strptime(date_str, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None

    def _parse_amount(self, amount_str: str) -> int | None:
        """Parse dollar amount to cents."""
        if not amount_str:
            return None
        cleaned = amount_str.replace(",", "").replace("$", "")
        try:
            return round(float(cleaned) * 100)
        except ValueError:
            return None

    def _clean_merchant(self, description: str) -> str:
        """Clean up merchant name from description."""
        cleaned = description.strip().lower()
        # Remove trailing numbers/codes
        cleaned = re.sub(r"\s*#?\d{4,}$", "", cleaned)
        cleaned = re.sub(r"\s*\*\w+$", "", cleaned)
        return cleaned.strip()
```

---

## 5. Generic PDF Parser (pdfplumber tables)

### `services/pdf-parser/src/parsers/pdfplumber_parser.py`

```python
import pdfplumber
import re
import io
import logging
from datetime import datetime
from ..models import ParsedTransaction, ParseError, ParseResponse

logger = logging.getLogger(__name__)


class PdfPlumberParser:
    """
    Generic PDF table parser using pdfplumber.
    Attempts to extract tables and identify transaction-like rows.
    """

    DATE_PATTERN = re.compile(r"\d{1,2}/\d{1,2}/\d{2,4}")
    AMOUNT_PATTERN = re.compile(r"-?\$?[\d,]+\.\d{2}")

    def parse(self, content: bytes) -> ParseResponse:
        transactions: list[ParsedTransaction] = []
        errors: list[ParseError] = []
        pages_processed = 0

        try:
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    pages_processed += 1

                    # Try table extraction first
                    tables = page.extract_tables()
                    for table in tables:
                        if not table or len(table) < 2:
                            continue

                        # Check if first row looks like headers
                        headers = table[0]
                        if not self._looks_like_header(headers):
                            continue

                        # Parse data rows
                        for row_idx, row in enumerate(table[1:], 2):
                            try:
                                txn = self._parse_table_row(row, headers, page_num)
                                if txn:
                                    transactions.append(txn)
                            except Exception as e:
                                errors.append(ParseError(
                                    page=page_num,
                                    error=str(e),
                                    raw=str(row),
                                ))

        except Exception as e:
            logger.error(f"Generic PDF parsing error: {e}")
            errors.append(ParseError(page=0, error=str(e), raw=""))

        return ParseResponse(
            transactions=transactions,
            errors=errors,
            detected_bank=None,
            pages_processed=pages_processed,
            method="rule_based",
        )

    def _looks_like_header(self, row: list) -> bool:
        """Check if a row looks like table headers."""
        if not row:
            return False
        header_text = " ".join(str(cell or "").lower() for cell in row)
        return (
            "date" in header_text
            and ("description" in header_text or "memo" in header_text or "details" in header_text)
            and ("amount" in header_text or "debit" in header_text or "credit" in header_text)
        )

    def _parse_table_row(
        self,
        row: list,
        headers: list,
        page_num: int,
    ) -> ParsedTransaction | None:
        """Parse a single table row using detected headers."""
        if not row or len(row) < 3:
            return None

        # Map headers to indices
        header_map = {}
        for i, h in enumerate(headers):
            key = str(h or "").strip().lower()
            header_map[key] = i

        # Extract date
        date_idx = self._find_column(header_map, ["date", "transaction date", "post date", "posting date"])
        if date_idx is None:
            return None
        date = self._parse_date(str(row[date_idx] or ""))
        if not date:
            return None

        # Extract description
        desc_idx = self._find_column(header_map, ["description", "memo", "details", "payee"])
        if desc_idx is None:
            return None
        description = str(row[desc_idx] or "").strip()
        if not description:
            return None

        # Extract amount (single column or split debit/credit)
        amount_idx = self._find_column(header_map, ["amount"])
        debit_idx = self._find_column(header_map, ["debit", "withdrawal"])
        credit_idx = self._find_column(header_map, ["credit", "deposit"])

        amount_cents: int
        is_credit: bool

        if amount_idx is not None:
            raw = self._parse_amount(str(row[amount_idx] or ""))
            if raw is None:
                return None
            is_credit = raw > 0
            amount_cents = abs(raw)
        elif debit_idx is not None or credit_idx is not None:
            debit_val = self._parse_amount(str(row[debit_idx] or "")) if debit_idx is not None else None
            credit_val = self._parse_amount(str(row[credit_idx] or "")) if credit_idx is not None else None

            if debit_val and abs(debit_val) > 0:
                amount_cents = abs(debit_val)
                is_credit = False
            elif credit_val and abs(credit_val) > 0:
                amount_cents = abs(credit_val)
                is_credit = True
            else:
                return None
        else:
            return None

        return ParsedTransaction(
            date=date,
            description=description,
            amount_cents=amount_cents,
            is_credit=is_credit,
            merchant_name=description.lower().strip(),
        )

    def _find_column(self, header_map: dict, candidates: list[str]) -> int | None:
        for c in candidates:
            if c in header_map:
                return header_map[c]
        return None

    def _parse_date(self, date_str: str) -> str | None:
        if not date_str:
            return None
        for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                dt = datetime.strptime(date_str.strip(), fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None

    def _parse_amount(self, amount_str: str) -> int | None:
        if not amount_str or not amount_str.strip():
            return None
        cleaned = amount_str.strip().replace("$", "").replace(",", "")
        # Handle parentheses for negatives
        paren = re.match(r"^\((.+)\)$", cleaned)
        if paren:
            cleaned = "-" + paren.group(1)
        try:
            return round(float(cleaned) * 100)
        except ValueError:
            return None
```

---

## 6. AI PDF Parser (Ollama Fallback)

### `services/pdf-parser/src/parsers/ai_parser.py`

```python
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
    """
    AI-based PDF parser using Ollama.
    Extracts text from PDF pages and sends to LLM for transaction extraction.
    Python calls Ollama directly (self-contained microservice).
    """

    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

    async def parse(self, content: bytes) -> ParseResponse:
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
        """Send page text to Ollama for transaction extraction."""
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
        """Parse JSON array from Ollama response."""
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
```

---

## 7. Dockerfile

### `services/pdf-parser/Dockerfile`

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install Java for tabula-py
RUN apt-get update && \
    apt-get install -y --no-install-recommends default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY src/ src/

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')"

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "5000"]
```

---

## 8. NestJS PDF Proxy Service

### `apps/api/src/ingestion/parsers/pdf-proxy.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';

interface PdfParseResponse {
  transactions: Array<{
    external_id: string | null;
    date: string;
    description: string;
    amount_cents: number;
    is_credit: boolean;
    merchant_name: string | null;
    running_balance_cents: number | null;
  }>;
  errors: Array<{
    page: number;
    error: string;
    raw: string;
  }>;
  detected_bank: string | null;
  pages_processed: number;
  method: string;
}

@Injectable()
export class PdfProxyService {
  private readonly logger = new Logger(PdfProxyService.name);
  private readonly pdfServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    this.pdfServiceUrl = this.config.get<string>('PDF_PARSER_URL') || 'http://localhost:5000';
  }

  /**
   * Send a PDF to the Python parser service and convert the response
   * to our standard ParsedTransaction format.
   */
  async parsePdf(
    buffer: Buffer,
    filename: string,
    institution?: string,
  ): Promise<{ transactions: ParsedTransaction[]; errors: FileUploadError[] }> {
    try {
      const formData = new FormData();
      formData.append('file', new Blob([buffer]), filename);
      if (institution) {
        formData.append('institution', institution);
      }

      const response = await fetch(`${this.pdfServiceUrl}/parse`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PDF parser returned ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as PdfParseResponse;

      // Convert to standard format
      const transactions: ParsedTransaction[] = data.transactions.map((t) => ({
        externalId: t.external_id,
        date: t.date,
        description: t.description,
        amountCents: t.amount_cents,
        isCredit: t.is_credit,
        merchantName: t.merchant_name,
        runningBalanceCents: t.running_balance_cents,
      }));

      const errors: FileUploadError[] = data.errors.map((e) => ({
        row: e.page,
        error: e.error,
        raw: e.raw,
      }));

      this.logger.log(
        `PDF parsed: ${transactions.length} transactions, ${errors.length} errors, method: ${data.method}`,
      );

      return { transactions, errors };
    } catch (err: any) {
      this.logger.error(`PDF proxy error: ${err.message}`);
      return {
        transactions: [],
        errors: [{ row: 0, error: `PDF parser service error: ${err.message}`, raw: '' }],
      };
    }
  }

  /**
   * Check if the PDF parser service is healthy.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.pdfServiceUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

---

## 9. Integration with Ingestion Processor

### Modify `src/jobs/ingestion.processor.ts` — PDF handling

Replace the PDF `else if` block:

```typescript
} else if (fileType === 'pdf') {
  // Forward to Python PDF parser service
  const pdfResult = await this.pdfProxyService.parsePdf(
    buffer,
    job.data.filePath,
    account.institution,
  );

  if (pdfResult.transactions.length === 0 && pdfResult.errors.length > 0) {
    await this.ingestionService.updateUploadStatus(uploadId, {
      status: 'failed',
      errorLog: pdfResult.errors,
    });
    return;
  }

  // Continue with standard dedup + insert pipeline
  const dedupResult = await this.dedupService.dedup(accountId, pdfResult.transactions);

  if (dedupResult.newTransactions.length > 0) {
    await this.insertTransactions(dedupResult.newTransactions, accountId, userId, uploadId);
  }

  await this.ingestionService.updateUploadStatus(uploadId, {
    status: 'completed',
    rowsImported: dedupResult.newTransactions.length,
    rowsSkipped: dedupResult.skippedCount,
    rowsErrored: pdfResult.errors.length,
    errorLog: pdfResult.errors,
  });
  return;
}
```

Add `PdfProxyService` to processor constructor injection.

---

## 10. Docker Compose Addition

### Add to `docker-compose.yml`

```yaml
  pdf-parser:
    build: ./services/pdf-parser
    container_name: moneypulse-pdf-parser
    ports:
      - "5000:5000"
    environment:
      - OLLAMA_URL=http://ollama:11434
      - OLLAMA_MODEL=llama3.2:3b
    depends_on:
      - ollama
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
```

### Add env var to API service

```yaml
  api:
    environment:
      - PDF_PARSER_URL=http://pdf-parser:5000
```

---

## 11. Python Tests

### `services/pdf-parser/src/tests/test_boa_pdf.py`

```python
import pytest
from ..parsers.boa_pdf import BoaPdfParser


class TestBoaPdfParser:
    parser = BoaPdfParser()

    def test_parse_date_mmddyy(self):
        assert self.parser._parse_date("03/15/26") == "2026-03-15"

    def test_parse_date_mmddyyyy(self):
        assert self.parser._parse_date("03/15/2026") == "2026-03-15"

    def test_parse_date_invalid(self):
        assert self.parser._parse_date("invalid") is None

    def test_parse_amount(self):
        assert self.parser._parse_amount("1,234.56") == 123456
        assert self.parser._parse_amount("-85.23") == -8523
        assert self.parser._parse_amount("$3,200.00") == 320000

    def test_parse_amount_invalid(self):
        assert self.parser._parse_amount("") is None
        assert self.parser._parse_amount("abc") is None

    def test_clean_merchant(self):
        assert self.parser._clean_merchant("WHOLE FOODS MARKET #10234") == "whole foods market"
        assert self.parser._clean_merchant("AMAZON.COM*M44KL2") == "amazon.com"
        assert self.parser._clean_merchant("SHELL OIL 57442") == "shell oil"
```

### `services/pdf-parser/src/tests/test_routes.py`

```python
import pytest
from fastapi.testclient import TestClient
from ..main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_parse_non_pdf():
    response = client.post(
        "/parse",
        files={"file": ("test.txt", b"not a pdf", "text/plain")},
    )
    assert response.status_code == 400


def test_parse_empty_file():
    response = client.post(
        "/parse",
        files={"file": ("test.pdf", b"", "application/pdf")},
    )
    assert response.status_code == 400
```

---

## Implementation Order

```
Step 1:  Create pyproject.toml
Step 2:  Create Pydantic models
Step 3:  Create FastAPI main.py + routes
Step 4:  Create BofA PDF parser
Step 5:  Create generic pdfplumber parser
Step 6:  Create AI PDF parser (Ollama)
Step 7:  Create Dockerfile
Step 8:  Create NestJS PDF proxy service
Step 9:  Add PdfProxyService to ingestion module
Step 10: Modify ingestion processor to handle PDF files
Step 11: Update docker-compose.yml
Step 12: Write Python tests
Step 13: Build container (podman build)
Step 14: Run Python tests
Step 15: Manual test: BofA PDF → verify extraction
Step 16: Integration test: upload PDF via API → verify pipeline
Step 17: Git commit
```

---

## API Endpoints Summary (Python Service)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/parse` | Parse PDF file → JSON transactions |

---

## PDF Parsing Strategy Diagram

```
PDF File Uploaded
       │
       ▼
┌──────────────────┐
│ NestJS API       │
│ (ingestion proc) │
│                  │
│ fileType = 'pdf' │
│     │            │
│     ▼            │
│ PdfProxyService  │──── POST /parse ───→┌──────────────────┐
│                  │                      │ Python FastAPI   │
│                  │                      │ (pdf-parser:5000)│
│                  │                      │                  │
│                  │                      │ 1. BofA parser?  │
│                  │                      │    ↓ yes → done  │
│                  │                      │    ↓ no          │
│                  │                      │ 2. Generic table │
│                  │                      │    ↓ found → done│
│                  │                      │    ↓ no          │
│                  │                      │ 3. Ollama AI     │
│                  │                      │    ↓ extract     │
│                  │                      │                  │
│                  │←── JSON response ────│                  │
│                  │                      └──────────────────┘
│     │            │
│     ▼            │
│ Dedup + Insert   │
│ (same as CSV)    │
│     │            │
│     ▼            │
│ Categorize       │
│ (Phase 3 rules)  │
└──────────────────┘
```

---

## Implementation Notes (Completed)

**Status: ✅ Phase 4 Complete**

### Deviations from Original Spec

1. **Routes consolidated into `main.py`** — Instead of a separate `routes.py`, all routes are defined in `main.py` to keep the service simple and avoid circular imports. The service has only 2 endpoints.

2. **`institution` parameter requires `Form()` annotation** — FastAPI needs explicit `Form(default=None)` when mixing `File()` and form fields in multipart requests. A bare `str | None = None` receives `None` silently.

3. **BofA auto-detection on all requests** — The cascade tries BofA parser first even without an institution hint (`institution is None`). BofA parser self-detects via "bank of america" header text and returns empty if not a match, so this is safe and provides better UX.

4. **Ollama model changed to `mistral:7b`** — Per user preference, using `mistral:7b` instead of `llama3.2:3b` for better extraction quality.

5. **Synthetic test fixtures via fpdf2** — Instead of manual PDF creation, tests use `fpdf2` to programmatically generate BofA statements and tabular PDFs. This makes tests fully self-contained with no external fixture files.

6. **`python-multipart` dependency required** — FastAPI file uploads require this package at runtime even though it's not a direct import.

### Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| Python (parsers + routes) | 57 | ✅ All pass |
| NestJS (PdfProxyService) | 9 | ✅ All pass |
| **Total** | **66** | ✅ |

### Files Created/Modified

| File | Action |
|------|--------|
| `services/pdf-parser/src/models.py` | Created |
| `services/pdf-parser/src/main.py` | Modified (was stub) |
| `services/pdf-parser/src/parsers/boa_pdf.py` | Created |
| `services/pdf-parser/src/parsers/pdfplumber_parser.py` | Created |
| `services/pdf-parser/src/parsers/ai_parser.py` | Created |
| `services/pdf-parser/src/tests/fixtures.py` | Created |
| `services/pdf-parser/src/tests/test_boa_pdf.py` | Created |
| `services/pdf-parser/src/tests/test_pdfplumber_parser.py` | Created |
| `services/pdf-parser/src/tests/test_ai_parser.py` | Created |
| `services/pdf-parser/src/tests/test_routes.py` | Created |
| `services/pdf-parser/pyproject.toml` | Modified |
| `services/pdf-parser/Dockerfile` | Modified |
| `apps/api/src/ingestion/parsers/pdf-proxy.service.ts` | Created |
| `apps/api/src/ingestion/parsers/__tests__/pdf-proxy.service.spec.ts` | Created |
| `apps/api/src/ingestion/ingestion.module.ts` | Modified |
| `apps/api/src/jobs/ingestion.processor.ts` | Modified |
| `.env.example` | Modified |
| `docker-compose.yml` | Modified |
| `.github/workflows/ci.yml` | Modified |
