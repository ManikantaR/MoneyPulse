"""Generic PDF table parser using pdfplumber.

Attempts to extract tables from any PDF bank statement by detecting
header rows and parsing data rows based on column names. Works with
a variety of bank statement formats that use tabular layouts.
"""

import pdfplumber
import re
import io
import logging
from datetime import datetime
from ..models import ParsedTransaction, ParseError, ParseResponse

logger = logging.getLogger(__name__)


class PdfPlumberParser:
    """Generic PDF table parser using pdfplumber's table extraction.

    Identifies tables with recognizable financial headers (Date, Description,
    Amount/Debit/Credit) and parses individual rows into transactions.
    """

    DATE_PATTERN = re.compile(r"\d{1,2}/\d{1,2}/\d{2,4}")
    AMOUNT_PATTERN = re.compile(r"-?\$?[\d,]+\.\d{2}")

    def parse(self, content: bytes) -> ParseResponse:
        """Parse a PDF file by extracting tables and identifying transaction rows.

        Iterates through each page, extracts tables via pdfplumber, checks
        for financial headers, and parses matching data rows.

        Args:
            content: Raw PDF file bytes.

        Returns:
            ParseResponse with extracted transactions, errors, and metadata.
        """
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
        """Check if a table row looks like financial column headers.

        A valid header must contain a date-related column and at least one
        description-like and amount-like column.

        Args:
            row: List of cell values from a table's first row.

        Returns:
            True if the row matches expected financial header patterns.
        """
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
        """Parse a single table row using detected column headers.

        Maps header names to column indices, then extracts date, description,
        and amount fields. Handles both single-amount and split debit/credit layouts.

        Args:
            row: List of cell values from a data row.
            headers: List of header cell values from the table's first row.
            page_num: Page number for error reporting.

        Returns:
            ParsedTransaction if the row is valid, None otherwise.
        """
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
        """Find the column index matching one of the candidate header names.

        Args:
            header_map: Dict mapping lowercased header names to column indices.
            candidates: List of candidate header names to search for.

        Returns:
            Column index if found, None otherwise.
        """
        for c in candidates:
            if c in header_map:
                return header_map[c]
        return None

    def _parse_date(self, date_str: str) -> str | None:
        """Parse common date formats to YYYY-MM-DD ISO format.

        Supports MM/DD/YYYY, MM/DD/YY, YYYY-MM-DD, and DD/MM/YYYY.

        Args:
            date_str: Date string to parse.

        Returns:
            ISO date string (YYYY-MM-DD) or None if unparseable.
        """
        if not date_str or not date_str.strip():
            return None
        for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                dt = datetime.strptime(date_str.strip(), fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None

    def _parse_amount(self, amount_str: str) -> int | None:
        """Parse a dollar amount string to integer cents.

        Handles dollar signs, commas, negatives, and parenthesized negatives.

        Args:
            amount_str: Amount string like "$1,234.56", "(85.23)", or "-29.99".

        Returns:
            Amount in cents (integer, signed) or None if unparseable.
        """
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
