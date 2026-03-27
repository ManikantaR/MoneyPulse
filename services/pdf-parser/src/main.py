"""MoneyPulse PDF Parser — FastAPI microservice entry point.

Provides a REST API for parsing PDF bank statements into structured
transaction data. Supports BofA-specific parsing, generic table extraction,
and AI-powered fallback via Ollama.
"""

import os
import logging
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from .models import ParseResponse, ParseError
from .parsers.boa_pdf import BoaPdfParser
from .parsers.pdfplumber_parser import PdfPlumberParser
from .parsers.ai_parser import AiPdfParser

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="MoneyPulse PDF Parser", version="1.0.0")

# Parser instances
boa_parser = BoaPdfParser()
generic_parser = PdfPlumberParser()
ai_parser = AiPdfParser()


@app.get("/health")
async def health():
    """Health check endpoint — reports service status and Ollama connectivity."""
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    ollama_status = "unavailable"

    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{ollama_url}/api/tags")
            if response.status_code == 200:
                ollama_status = "connected"
    except Exception:
        pass

    return JSONResponse({
        "status": "ok",
        "service": "pdf-parser",
        "ollama": ollama_status,
    })


@app.post("/parse", response_model=ParseResponse)
async def parse_pdf(
    file: UploadFile = File(...),
    institution: str | None = Form(default=None),
):
    """Parse a PDF bank statement into structured transactions.

    Applies a cascading strategy:
    1. If institution is 'boa', try BofA-specific parser first
    2. Try generic pdfplumber table extraction
    3. Fall back to AI extraction via Ollama

    Args:
        file: Uploaded PDF file.
        institution: Optional institution hint (e.g., 'boa').

    Returns:
        ParseResponse with transactions, errors, and parsing metadata.

    Raises:
        HTTPException: 400 if file is not a PDF or is empty.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    logger.info(f"Parsing PDF: {file.filename} ({len(content)} bytes), institution={institution}")

    # Track the most informative fallback result across all strategies
    best_fallback: ParseResponse | None = None

    def _is_more_informative(candidate: ParseResponse, current: ParseResponse | None) -> bool:
        """Return True if candidate has more diagnostic value than current best."""
        if current is None:
            return True
        return candidate.pages_processed > current.pages_processed or len(candidate.errors) > len(current.errors)

    # Strategy 1: Bank-specific parser (BofA auto-detects via header text)
    if institution == "boa" or institution is None:
        result = boa_parser.parse(content)
        if result.transactions:
            logger.info(f"BofA parser extracted {len(result.transactions)} transactions")
            return result
        if _is_more_informative(result, best_fallback):
            best_fallback = result

    # Strategy 2: Generic pdfplumber table extraction
    result = generic_parser.parse(content)
    if result.transactions:
        logger.info(f"Generic parser extracted {len(result.transactions)} transactions")
        return result
    if _is_more_informative(result, best_fallback):
        best_fallback = result

    # Strategy 3: AI fallback
    logger.info("Rule-based parsing failed, trying AI extraction")
    result = await ai_parser.parse(content)
    if result.transactions:
        logger.info(f"AI parser extracted {len(result.transactions)} transactions")
        return result
    if _is_more_informative(result, best_fallback):
        best_fallback = result

    # Nothing worked — return the most informative failure metadata collected
    logger.warning(f"All parsers failed for {file.filename}")
    fallback_errors = list(best_fallback.errors) if best_fallback and best_fallback.errors else []
    fallback_errors += [ParseError(page=0, error="Could not extract transactions from this PDF", raw="")]
    return ParseResponse(
        transactions=[],
        errors=fallback_errors,
        detected_bank=best_fallback.detected_bank if best_fallback else None,
        pages_processed=best_fallback.pages_processed if best_fallback else 0,
        method="none",
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
