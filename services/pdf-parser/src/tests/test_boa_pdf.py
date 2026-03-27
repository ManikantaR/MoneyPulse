"""Tests for BofA PDF parser — written RED-first (TDD)."""

import pytest
from src.parsers.boa_pdf import BoaPdfParser


class TestBoaPdfParserDateParsing:
    """Test date parsing helper."""

    parser = BoaPdfParser()

    def test_parse_date_mmddyy(self):
        """MM/DD/YY format should convert to YYYY-MM-DD."""
        assert self.parser._parse_date("03/15/26") == "2026-03-15"

    def test_parse_date_mmddyyyy(self):
        """MM/DD/YYYY format should convert to YYYY-MM-DD."""
        assert self.parser._parse_date("03/15/2026") == "2026-03-15"

    def test_parse_date_invalid_returns_none(self):
        """Invalid date strings should return None."""
        assert self.parser._parse_date("invalid") is None
        assert self.parser._parse_date("") is None

    def test_parse_date_edge_case_leap_year(self):
        """Leap year date should parse correctly."""
        assert self.parser._parse_date("02/29/24") == "2024-02-29"


class TestBoaPdfParserAmountParsing:
    """Test amount-to-cents conversion helper."""

    parser = BoaPdfParser()

    def test_parse_amount_with_commas(self):
        """Comma-separated amounts should convert to integer cents."""
        assert self.parser._parse_amount("1,234.56") == 123456

    def test_parse_amount_negative(self):
        """Negative amounts should preserve sign."""
        assert self.parser._parse_amount("-85.23") == -8523

    def test_parse_amount_with_dollar_sign(self):
        """Dollar sign prefix should be stripped."""
        assert self.parser._parse_amount("$3,200.00") == 320000

    def test_parse_amount_empty_returns_none(self):
        """Empty or invalid strings should return None."""
        assert self.parser._parse_amount("") is None
        assert self.parser._parse_amount(None) is None

    def test_parse_amount_invalid_returns_none(self):
        """Non-numeric string should return None."""
        assert self.parser._parse_amount("abc") is None

    def test_parse_amount_small_value(self):
        """Small amounts should be handled correctly."""
        assert self.parser._parse_amount("0.50") == 50


class TestBoaPdfParserMerchantCleaning:
    """Test merchant name extraction from description."""

    parser = BoaPdfParser()

    def test_clean_merchant_strips_store_number(self):
        """Trailing store numbers should be stripped."""
        assert self.parser._clean_merchant("WHOLE FOODS MARKET #10234") == "whole foods market"

    def test_clean_merchant_strips_reference_code(self):
        """Trailing star-codes (AMAZON.COM*XXX) should be stripped."""
        assert self.parser._clean_merchant("AMAZON.COM*M44KL2") == "amazon.com"

    def test_clean_merchant_strips_trailing_digits(self):
        """Trailing numeric identifiers should be stripped."""
        assert self.parser._clean_merchant("SHELL OIL 57442") == "shell oil"

    def test_clean_merchant_simple_name(self):
        """Simple merchant names should just be lowercased."""
        assert self.parser._clean_merchant("TARGET") == "target"


class TestBoaPdfParserFullParse:
    """Test full PDF parsing with synthetic content."""

    parser = BoaPdfParser()

    def test_parse_non_boa_pdf_returns_empty(self):
        """PDFs without 'Bank of America' text should return empty results."""
        from src.tests.fixtures import create_simple_pdf

        content = create_simple_pdf("Some other bank\nRandom content")
        result = self.parser.parse(content)
        assert result.transactions == []
        assert result.pages_processed == 1
        assert result.detected_bank is None

    def test_parse_boa_deposits(self):
        """BofA deposits section should extract credit transactions."""
        from src.tests.fixtures import create_boa_statement_pdf

        content = create_boa_statement_pdf()
        result = self.parser.parse(content)
        assert result.detected_bank == "boa"
        assert result.method == "rule_based"
        assert result.pages_processed >= 1

        # Should find transactions
        credits = [t for t in result.transactions if t.is_credit]
        debits = [t for t in result.transactions if not t.is_credit]
        assert len(credits) > 0 or len(debits) > 0

    def test_parse_empty_pdf_returns_empty(self):
        """Empty/blank PDFs should return no transactions."""
        from src.tests.fixtures import create_simple_pdf

        content = create_simple_pdf("Bank of America\n\n")
        result = self.parser.parse(content)
        assert result.transactions == []
        assert result.detected_bank == "boa"
