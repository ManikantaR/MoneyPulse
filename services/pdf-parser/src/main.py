import os
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(title="MoneyPulse PDF Parser", version="1.0.0")


@app.get("/health")
async def health():
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


@app.post("/parse")
async def parse_pdf():
    # Placeholder — implemented in Phase 4
    return JSONResponse(
        {"error": "Not implemented yet"},
        status_code=501,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
