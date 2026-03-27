"""Tests for generic pdfplumber parser — written RED-first (TDD)."""

import pytest
from src.parsers.pdfplumber_parser import PdfPlumberParser


class TestPdfPlumberParserDateParsing:
    """Test date format detection and parsing."""

    parser = PdfPlumberParser()

    def test_parse_date_mmddyyyy(self):
        """MM/DD/YYYY date format should convert to YYYY-MM-DD."""
        assert self.parser._parse_date("03/15/2026") == "2026-03-15"

    def test_parse_date_mmddyy(self):
        """MM/DD/YY date format should convert to YYYY-MM-DD."""
        assert self.parser._parse_date("03/15/26") == "2026-03-15"

    def test_parse_date_iso_format(self):
        """ISO YYYY-MM-DD format should pass through."""
        assert self.parser._parse_date("2026-03-15") == "2026-03-15"

    def test_parse_date_invalid(self):
        """Invalid date strings should return None."""
        assert self.parser._parse_date("") is None
        assert self.parser._parse_date("not-a-date") is None

    def test_parse_date_with_whitespace(self):
        """Leading/trailing whitespace should be trimmed."""
        assert self.parser._parse_date("  03/15/2026  ") == "2026-03-15"


class TestPdfPlumberParserAmountParsing:
    """Test amount parsing and sign handling."""

    parser = PdfPlumberParser()

    def test_parse_amount_simple(self):
        """Simple dollar amount should convert to cents."""
        assert self.parser._parse_amount("85.23") == 8523

    def test_parse_amount_with_dollar_sign(self):
        """Dollar sign should be stripped."""
        assert self.parser._parse_amount("$1,234.56") == 123456

    def test_parse_amount_parentheses_negative(self):
        """Parenthesized amounts should be treated as negative."""
        assert self.parser._parse_amount("(85.23)") == -8523

    def test_parse_amount_empty_returns_none(self):
        """Empty or whitespace-only strings should return None."""
        assert self.parser._parse_amount("") is None
        assert self.parser._parse_amount("   ") is None

    def test_parse_amount_invalid_returns_none(self):
        """Non-numeric strings should return None."""
        assert self.parser._parse_amount("abc") is None


class TestPdfPlumberParserHeaderDetection:
    """Test table header recognition."""

    parser = PdfPlumberParser()

    def test_looks_like_header_valid(self):
        """Row with date, description, amount columns should be recognized."""
        assert self.parser._looks_like_header(["Date", "Description", "Amount"])

    def test_looks_like_header_with_debit_credit(self):
        """Row with date, details, debit columns should be recognized."""
        assert self.parser._looks_like_header(["Date", "Details", "Debit", "Credit"])

    def test_looks_like_header_with_memo(self):
        """Row with date, memo, amount should be recognized."""
        assert self.parser._looks_like_header(["Date", "Memo", "Amount"])

    def test_looks_like_header_missing_date(self):
        """Row without date column should not be recognized."""
        assert not self.parser._looks_like_header(["Description", "Amount"])

    def test_looks_like_header_empty(self):
        """Empty row should not be recognized."""
        assert not self.parser._looks_like_header([])

    def test_looks_like_header_none_values(self):
        """Row with None values should be handled without error."""
        assert not self.parser._looks_like_header([None, None])


class TestPdfPlumberParserTableRow:
    """Test single table row parsing."""

    parser = PdfPlumberParser()

    def test_parse_table_row_single_amount(self):
        """Row with a single amount column should parse correctly."""
        headers = ["Date", "Description", "Amount"]
        row = ["03/15/2026", "WHOLE FOODS MARKET", "-85.23"]
        result = self.parser._parse_table_row(row, headers, page_num=1)
        assert result is not None
        assert result.date == "2026-03-15"
        assert result.description == "WHOLE FOODS MARKET"
        assert result.amount_cents == 8523
        assert result.is_credit is False

    def test_parse_table_row_split_debit_credit(self):
        """Row with separate debit/credit columns should parse correctly."""
        headers = ["Date", "Description", "Debit", "Credit"]
        row = ["03/15/2026", "PAYROLL DEPOSIT", "", "3200.00"]
        result = self.parser._parse_table_row(row, headers, page_num=1)
        assert result is not None
        assert result.amount_cents == 320000
        assert result.is_credit is True

    def test_parse_table_row_missing_date_returns_none(self):
        """Row without a parseable date should return None."""
        headers = ["Date", "Description", "Amount"]
        row = ["", "STARBUCKS", "5.75"]
        result = self.parser._parse_table_row(row, headers, page_num=1)
        assert result is None

    def test_parse_table_row_too_few_columns_returns_none(self):
        """Rows with fewer than 3 columns should return None."""
        headers = ["Date", "Description", "Amount"]
        row = ["03/15/2026"]
        result = self.parser._parse_table_row(row, headers, page_num=1)
        assert result is None


class TestPdfPlumberParserFullParse:
    """Test full PDF table extraction."""

    parser = PdfPlumberParser()

    def test_parse_tabular_pdf(self):
        """PDF with a proper table should extract transactions."""
        from src.tests.fixtures import create_tabular_pdf

        content = create_tabular_pdf()
        result = self.parser.parse(content)
        assert result.method == "rule_based"
        assert result.pages_processed >= 1
        assert len(result.transactions) > 0

    def test_parse_empty_pdf(self):
        """Empty PDF should return empty results."""
        from src.tests.fixtures import create_simple_pdf

        content = create_simple_pdf("")
        result = self.parser.parse(content)
        assert result.transactions == []
