"""Tests for AI PDF parser (Ollama fallback) — written RED-first (TDD)."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from src.parsers.ai_parser import AiPdfParser


class TestAiPdfParserResponseParsing:
    """Test JSON response parsing from LLM output."""

    parser = AiPdfParser()

    def test_parse_valid_json_array(self):
        """Well-formed JSON array should extract transactions."""
        text = """[
            {"date": "2026-03-15", "description": "STARBUCKS", "amount": 5.75, "is_credit": false},
            {"date": "2026-03-16", "description": "PAYROLL", "amount": 3200.00, "is_credit": true}
        ]"""
        result = self.parser._parse_ai_response(text)
        assert len(result) == 2
        assert result[0].date == "2026-03-15"
        assert result[0].description == "STARBUCKS"
        assert result[0].amount_cents == 575
        assert result[0].is_credit is False
        assert result[1].amount_cents == 320000
        assert result[1].is_credit is True

    def test_parse_json_wrapped_in_text(self):
        """JSON array embedded in surrounding text should still be extracted."""
        text = """Here are the transactions I found:
        [{"date": "2026-03-15", "description": "AMAZON.COM", "amount": 29.99, "is_credit": false}]
        That's all I found."""
        result = self.parser._parse_ai_response(text)
        assert len(result) == 1
        assert result[0].description == "AMAZON.COM"

    def test_parse_empty_array(self):
        """Empty JSON array should return empty list."""
        result = self.parser._parse_ai_response("[]")
        assert result == []

    def test_parse_no_json(self):
        """Response with no JSON should return empty list."""
        result = self.parser._parse_ai_response("I could not find any transactions.")
        assert result == []

    def test_parse_invalid_json(self):
        """Malformed JSON should return empty list without raising."""
        result = self.parser._parse_ai_response("[{broken json")
        assert result == []

    def test_parse_skips_invalid_items(self):
        """Items missing required fields should be skipped."""
        text = """[
            {"date": "2026-03-15", "description": "VALID", "amount": 10.00, "is_credit": false},
            {"date": "", "description": "MISSING DATE", "amount": 5.00, "is_credit": false},
            {"description": "NO DATE FIELD", "amount": 5.00, "is_credit": false},
            {"date": "2026-03-15", "description": "", "amount": 5.00, "is_credit": false}
        ]"""
        result = self.parser._parse_ai_response(text)
        assert len(result) == 1
        assert result[0].description == "VALID"

    def test_parse_skips_zero_amount(self):
        """Transactions with zero or negative amount should be skipped."""
        text = '[{"date": "2026-03-15", "description": "ZERO", "amount": 0, "is_credit": false}]'
        result = self.parser._parse_ai_response(text)
        assert result == []

    def test_parse_non_dict_items_skipped(self):
        """Non-dict items in the JSON array should be silently skipped."""
        text = '[42, "string", {"date": "2026-03-15", "description": "VALID", "amount": 10.00, "is_credit": false}]'
        result = self.parser._parse_ai_response(text)
        assert len(result) == 1


@pytest.mark.asyncio
class TestAiPdfParserOllamaIntegration:
    """Test Ollama HTTP integration with mocked responses."""

    @pytest.fixture
    def parser(self):
        """Create parser with test Ollama URL."""
        p = AiPdfParser()
        p.ollama_url = "http://test-ollama:11434"
        p.model = "mistral:7b"
        return p

    async def test_extract_from_text_success(self, parser):
        """Successful Ollama call should return parsed transactions."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "response": '[{"date": "2026-03-15", "description": "STARBUCKS", "amount": 5.75, "is_credit": false}]'
        }

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await parser._extract_from_text("some PDF text", page_num=1)
            assert len(result) == 1
            assert result[0].description == "STARBUCKS"

    async def test_extract_from_text_timeout(self, parser):
        """Ollama timeout should return empty list."""
        import httpx

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await parser._extract_from_text("some PDF text", page_num=1)
            assert result == []

    async def test_extract_from_text_non_200(self, parser):
        """Non-200 Ollama response should return empty list."""
        mock_response = MagicMock()
        mock_response.status_code = 500

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await parser._extract_from_text("some PDF text", page_num=1)
            assert result == []
