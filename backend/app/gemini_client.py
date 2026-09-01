import os
import json
from pathlib import Path
from typing import AsyncGenerator
from dotenv import load_dotenv

import httpx

# Load .env from backend directory
backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv()

SYSTEM_PROMPT = (
    "You are a helpful, friendly AI assistant. Format answers with Markdown "
    "(headings, lists, and fenced code blocks with a language tag) whenever "
    "that improves readability."
)


class GeminiError(Exception):
    pass


async def _stream_openrouter(api_key: str, messages: list[dict]) -> AsyncGenerator[str, None]:
    model = os.getenv("OPENROUTER_MODEL") or os.getenv("AI_MODEL", "openrouter/auto")
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://tharikai.netlify.app",
        "X-Title": "TharikAI",
    }

    contents = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in messages:
        role = "assistant" if m.get("role") in ("assistant", "model") else "user"
        contents.append({"role": role, "content": m.get("content", "")})

    payload = {
        "model": model,
        "messages": contents,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                raw_err = body.decode(errors="ignore")
                try:
                    err_json = json.loads(raw_err)
                    msg = err_json.get("error", {}).get("message", raw_err)
                    raise GeminiError(f"OpenRouter API error ({response.status_code}): {msg}")
                except json.JSONDecodeError:
                    raise GeminiError(f"OpenRouter API error ({response.status_code}): {raw_err}")

            async for line in response.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[len("data: "):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except json.JSONDecodeError:
                    continue


async def _stream_gemini(api_key: str, messages: list[dict]) -> AsyncGenerator[str, None]:
    model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip() or "gemini-3.6-flash"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:streamGenerateContent?alt=sse&key={api_key}"
    )

    contents = []
    for m in messages:
        role = "user" if m.get("role") == "user" else "model"
        contents.append({
            "role": role,
            "parts": [{"text": m.get("content", "")}]
        })

    payload = {
        "systemInstruction": {
            "parts": [{"text": SYSTEM_PROMPT}]
        },
        "contents": contents,
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 4096,
        }
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream("POST", url, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                raw_err = body.decode(errors="ignore")
                try:
                    err_json = json.loads(raw_err)
                    err_detail = err_json.get("error", {})
                    msg = err_detail.get("message", raw_err)
                    if response.status_code == 429:
                        raise GeminiError(
                            "Gemini rate limit or quota exceeded. Free tier limit reached. Please retry in a moment."
                        )
                    elif response.status_code in (401, 403):
                        raise GeminiError(
                            "Gemini API key is invalid or unauthorized. Please verify your GEMINI_API_KEY."
                        )
                    else:
                        raise GeminiError(f"Gemini API error ({response.status_code}): {msg}")
                except (json.JSONDecodeError, KeyError):
                    raise GeminiError(f"Gemini API error {response.status_code}: {raw_err}")

            async for line in response.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[len("data: "):]
                try:
                    data = json.loads(data_str)
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            text = part.get("text")
                            if text:
                                yield text
                except json.JSONDecodeError:
                    continue


async def stream_chat_completion(messages: list[dict]) -> AsyncGenerator[str, None]:
    """
    Yields text chunks as they arrive from OpenRouter or Google Gemini.
    Automatically detects the provider based on the key format or env vars.
    """
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    generic_key = os.getenv("AI_API_KEY", "").strip()

    # Determine key and provider
    if openrouter_key:
        async for chunk in _stream_openrouter(openrouter_key, messages):
            yield chunk
        return

    key = gemini_key or generic_key
    if not key:
        raise GeminiError(
            "No AI API key is configured. Please add GEMINI_API_KEY or OPENROUTER_API_KEY in your Render dashboard."
        )

    # If the key has the OpenRouter prefix sk-or-, route to OpenRouter
    if key.startswith("sk-or-"):
        async for chunk in _stream_openrouter(key, messages):
            yield chunk
    else:
        async for chunk in _stream_gemini(key, messages):
            yield chunk
