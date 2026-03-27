"""Bank of America PDF Statement Parser.

Extracts transactions from BofA-formatted PDF statements using pdfplumber
text extraction and regex pattern matching. BofA statements have a consistent
layout with deposits and withdrawals in clearly labeled sections.
"""

import pdfplumber
import re
import io
import logging
from datetime import datetime
from ..models import ParsedTransaction, ParseError, ParseResponse

logger = logging.getLogger(__name__)


class BoaPdfParser:
    """Rule-based parser for Bank of America PDF statements.

    BofA statements follow a consistent table format:
    - Date | Description | Amount | Running Balance
    - Deposits/credits under "Deposits and other additions"
    - Withdrawals/debits under "Withdrawals and other subtractions"
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
        """Parse a BofA PDF statement into structured transactions.

        Reads each page, identifies deposit/withdrawal sections, and extracts
        transaction lines via regex. Returns early with empty results if the
        document is not a BofA statement.

        Args:
            content: Raw PDF file bytes.

        Returns:
            ParseResponse with extracted transactions, errors, and metadata.
        """
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

                    # Track section and extract transactions
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
        """Convert a regex match from a transaction line into a ParsedTransaction.

        Args:
            match: Regex match with groups (date, description, amount, balance).
            section: Current section context — 'deposits' or 'withdrawals'.
            page_num: Page number for error reporting.

        Returns:
            ParsedTransaction if valid, None if date/amount cannot be parsed.
        """
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
        """Parse MM/DD/YY or MM/DD/YYYY date string to YYYY-MM-DD ISO format.

        Args:
            date_str: Date string in MM/DD/YY or MM/DD/YYYY format.

        Returns:
            ISO date string (YYYY-MM-DD) or None if unparseable.
        """
        if not date_str:
            return None
        for fmt in ("%m/%d/%y", "%m/%d/%Y"):
            try:
                dt = datetime.strptime(date_str, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None

    def _parse_amount(self, amount_str: str | None) -> int | None:
        """Parse a dollar amount string to integer cents.

        Handles comma separators, dollar signs, and negatives.

        Args:
            amount_str: Amount string like "1,234.56", "-85.23", or "$3,200.00".

        Returns:
            Amount in cents (integer) or None if unparseable.
        """
        if not amount_str:
            return None
        cleaned = amount_str.replace(",", "").replace("$", "")
        try:
            return round(float(cleaned) * 100)
        except ValueError:
            return None

    def _clean_merchant(self, description: str) -> str:
        """Extract a clean merchant name from a transaction description.

        Strips trailing store numbers, reference codes, and identifiers
        commonly appended by banks.

        Args:
            description: Raw transaction description from the statement.

        Returns:
            Cleaned, lowercased merchant name.
        """
        cleaned = description.strip().lower()
        # Remove trailing store numbers like #10234
        cleaned = re.sub(r"\s*#?\d{4,}$", "", cleaned)
        # Remove trailing star-codes like *M44KL2
        cleaned = re.sub(r"\s*\*\w+$", "", cleaned)
        return cleaned.strip()
