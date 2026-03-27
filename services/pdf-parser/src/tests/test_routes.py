"""Tests for FastAPI routes — written RED-first (TDD)."""

import pytest
from fastapi.testclient import TestClient
from src.main import app


client = TestClient(app)


class TestHealthEndpoint:
    """Test the /health endpoint."""

    def test_health_returns_ok(self):
        """Health endpoint should return status ok."""
        response = client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["service"] == "pdf-parser"

    def test_health_includes_ollama_field(self):
        """Health response should include ollama status."""
        response = client.get("/health")
        body = response.json()
        assert "ollama" in body


class TestParseEndpoint:
    """Test the POST /parse endpoint."""

    def test_parse_rejects_non_pdf(self):
        """Non-PDF files should be rejected with 400."""
        response = client.post(
            "/parse",
            files={"file": ("test.txt", b"not a pdf", "text/plain")},
        )
        assert response.status_code == 400
        assert "PDF" in response.json()["detail"]

    def test_parse_rejects_empty_file(self):
        """Empty PDF files should be rejected with 400."""
        response = client.post(
            "/parse",
            files={"file": ("test.pdf", b"", "application/pdf")},
        )
        assert response.status_code == 400
        assert "Empty" in response.json()["detail"]

    def test_parse_accepts_pdf(self):
        """Valid PDF should be processed and return ParseResponse shape."""
        from src.tests.fixtures import create_simple_pdf

        content = create_simple_pdf("Some bank statement text")
        response = client.post(
            "/parse",
            files={"file": ("statement.pdf", content, "application/pdf")},
        )
        assert response.status_code == 200
        body = response.json()
        assert "transactions" in body
        assert "errors" in body
        assert "pages_processed" in body
        assert "method" in body

    def test_parse_with_institution_hint(self):
        """Institution hint should be accepted as a multipart form field."""
        from src.tests.fixtures import create_simple_pdf

        content = create_simple_pdf("Bank of America statement")
        response = client.post(
            "/parse",
            files={"file": ("boa.pdf", content, "application/pdf")},
            data={"institution": "boa"},
        )
        assert response.status_code == 200

    def test_parse_corrupt_pdf(self):
        """Corrupt/invalid PDF data should be handled gracefully."""
        response = client.post(
            "/parse",
            files={"file": ("bad.pdf", b"this is not a real pdf", "application/pdf")},
        )
        # Should not crash — either 200 with errors or 422
        assert response.status_code in (200, 422)
