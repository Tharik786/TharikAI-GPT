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

import datetime


def get_system_prompt() -> str:
    now_str = datetime.datetime.now().strftime("%A, %B %d, %Y, %H:%M:%S UTC")
    return (
        f"You are a helpful, friendly, empathetic, and highly intelligent AI assistant (TharikAI).\n\n"
        f"=== STRICT MULTILINGUAL VOICE & LANGUAGE MIRRORING RULES ===\n"
        f"1. INSTANT LANGUAGE MIRRORING (CRITICAL):\n"
        f"   - ALWAYS respond in the EXACT SAME LANGUAGE the user speaks or writes in!\n"
        f"   - If the user speaks or writes in TAMIL (தமிழ் or Tanglish):\n"
        f"     You MUST reply completely in TAMIL (தமிழ்) with warm, natural Tamil phrasing (e.g. 'வணக்கம்! நான் உங்களுக்கு எப்படி உதவ முடியும்?').\n"
        f"   - If the user speaks or writes in MALAYALAM (മലയാളം or Manglish):\n"
        f"     You MUST reply completely in MALAYALAM (മലയാളം) with natural Malayalam phrasing (e.g. 'നമസ്കാരം! ഞാൻ നിങ്ങളെ എങ്ങനെയാണ് സഹായിക്കേണ്ടത്?').\n"
        f"   - If the user speaks or writes in ENGLISH:\n"
        f"     You MUST reply in ENGLISH.\n"
        f"   - If the user speaks or writes in HINDI (हिन्दी):\n"
        f"     You MUST reply in HINDI (हिन्दी) (e.g. 'नमस्ते! मैं आपकी कैसे सहायता कर सकता हूँ?').\n"
        f"   - If the user speaks in Telugu, Kannada, Bengali, Arabic, Spanish, French, or any other language, reply in that exact same language!\n"
        f"   - NEVER reply in English when the user addresses you in Tamil, Malayalam, or another regional language.\n\n"
        f"2. VOICE-FRIENDLY & CONVERSATIONAL RESPONSES:\n"
        f"   - Keep spoken voice explanations natural, concise, and conversational so the native Text-to-Speech voice engine can pronounce every word smoothly.\n"
        f"   - Avoid raw symbols or long complex markdown tables during voice mode.\n\n"
        f"3. AI IMAGE GENERATION:\n"
        f"   - When asked to generate an image or art, describe the visual creation politely.\n\n"
        f"4. REAL-TIME INTERNET SEARCH & CURRENT NEWS:\n"
        f"   - When live web search results are provided in your context, always ground your response in the real-time internet results.\n"
        f"   - Report current news, factual updates, and real-world information accurately as verified by authoritative web sources.\n"
        f"   - Cite sources naturally using markdown links e.g. [Source Title](URL) or [1], [2].\n\n"
        f"5. AI DOCUMENT & PDF GENERATION (POWERED BY CARBONE.IO):\n"
        f"   - TharikAI HAS full capability to generate, render, and provide downloadable PDF executive documents and reports via integrated Carbone.io!\n"
        f"   - NEVER claim that you cannot create or send downloadable PDF files.\n"
        f"   - When asked to write or create a document/report/PDF, provide a comprehensive, executive-level structured report with clear sections, bullet points, and tables.\n\n"
        f"Tone: Natural, warm, polite, culturally appropriate, and concise.\n"
    )



SYSTEM_PROMPT = get_system_prompt()


class GeminiError(Exception):
    pass


def _extract_base64_and_mime(data_url: str):
    """Extracts mimeType and raw base64 string from a data URL."""
    if not data_url or not data_url.startswith("data:"):
        return "image/jpeg", ""
    try:
        header, base64_data = data_url.split(";base64,", 1)
        mime_type = header.replace("data:", "").strip()
        return mime_type or "image/jpeg", base64_data.strip()
    except Exception:
        return "image/jpeg", ""


_CLIENT_POOL: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _CLIENT_POOL
    if _CLIENT_POOL is None or _CLIENT_POOL.is_closed:
        _CLIENT_POOL = httpx.AsyncClient(
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50, keepalive_expiry=30.0),
            timeout=httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=10.0),
        )
    return _CLIENT_POOL


async def _stream_openrouter(
    api_key: str,
    messages: list[dict],
    system_prompt: str = SYSTEM_PROMPT,
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    target_model = model or os.getenv("OPENROUTER_MODEL") or os.getenv("AI_MODEL", "openrouter/auto")
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://tharikai.netlify.app",
        "X-Title": "TharikAI",
    }

    contents = [{"role": "system", "content": system_prompt}]
    for m in messages:
        role = "assistant" if m.get("role") in ("assistant", "model") else "user"
        msg_text = m.get("content", "")
        images = m.get("images", [])
        if images and role == "user":
            user_content = [{"type": "text", "text": msg_text}]
            for img in images:
                data_url = img if isinstance(img, str) else img.get("dataUrl") or img.get("data")
                if data_url:
                    user_content.append({"type": "image_url", "image_url": {"url": data_url}})
            contents.append({"role": role, "content": user_content})
        else:
            contents.append({"role": role, "content": msg_text})

    payload = {
        "model": target_model,
        "messages": contents,
        "stream": True,
    }

    client = _get_http_client()
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
                delta = data.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "") if isinstance(delta, dict) else str(delta or "")
                if content:
                    yield content
            except json.JSONDecodeError:
                continue


async def _stream_gemini(
    api_key: str,
    messages: list[dict],
    system_prompt: str = SYSTEM_PROMPT,
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    target_model = model or os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{target_model}:streamGenerateContent?alt=sse&key={api_key}"
    )

    contents = []
    for m in messages:
        role = "user" if m.get("role") == "user" else "model"
        parts = []
        text_content = m.get("content", "")
        if text_content:
            parts.append({"text": text_content})
        
        # Add any vision image parts
        images = m.get("images", [])
        for img in images:
            if isinstance(img, str) and img.startswith("data:"):
                mime, b64 = _extract_base64_and_mime(img)
                if b64:
                    parts.append({"inlineData": {"mimeType": mime, "data": b64}})
            elif isinstance(img, dict):
                data_url = img.get("dataUrl") or img.get("data")
                if data_url and data_url.startswith("data:"):
                    mime, b64 = _extract_base64_and_mime(data_url)
                    if b64:
                        parts.append({"inlineData": {"mimeType": mime, "data": b64}})
                elif img.get("base64"):
                    parts.append({
                        "inlineData": {
                            "mimeType": img.get("mimeType", "image/jpeg"),
                            "data": img.get("base64"),
                        }
                    })

        if not parts:
            parts.append({"text": ""})

        contents.append({
            "role": role,
            "parts": parts,
        })

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": contents,
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 4096,
        }
    }

    client = _get_http_client()
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


async def _stream_huggingface_chat(
    token: str, model_id: str, messages: list[dict], system_prompt: str = SYSTEM_PROMPT
) -> AsyncGenerator[str, None]:
    """
    Streams chat completion from Hugging Face Inference API for models like SHSLab/Kimi-K3-Abliterated.
    """
    url = f"https://router.huggingface.co/hf-inference/models/{model_id}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    contents = [{"role": "system", "content": system_prompt}]
    for m in messages:
        role = "assistant" if m.get("role") in ("assistant", "model") else "user"
        contents.append({"role": role, "content": m.get("content", "")})

    payload = {
        "model": model_id,
        "messages": contents,
        "stream": True,
        "max_tokens": 4096,
        "temperature": 0.7,
    }

    client = _get_http_client()
    async with client.stream("POST", url, headers=headers, json=payload) as response:
        if response.status_code != 200:
            # Fallback legacy URL
            legacy_url = f"https://api-inference.huggingface.co/models/{model_id}/v1/chat/completions"
            async with client.stream("POST", legacy_url, headers=headers, json=payload) as leg_resp:
                if leg_resp.status_code != 200:
                    body = await leg_resp.aread()
                    raise GeminiError(f"Hugging Face API error ({leg_resp.status_code}): {body.decode(errors='ignore')}")
                async for line in leg_resp.aiter_lines():
                    if line.startswith("data: ") and line[6:].strip() != "[DONE]":
                        try:
                            chunk_data = json.loads(line[6:].strip())
                            delta = chunk_data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if delta:
                                yield delta
                        except Exception:
                            continue
                return

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


async def stream_chat_completion(
    messages: list[dict],
    web_search_context: str = "",
    model: str | None = None,
    provider: str | None = None,
) -> AsyncGenerator[str, None]:
    """
    Yields text chunks as they arrive from OpenRouter, Hugging Face, or Google Gemini.
    Automatically routes based on provider/model selection, key format, or env vars.
    Supports Multimodal Vision and Web Search grounding.
    """
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    generic_key = os.getenv("AI_API_KEY", "").strip()

    system_prompt = get_system_prompt()
    if web_search_context:
        system_prompt = f"{system_prompt}\n\n{web_search_context}"

    req_provider = (provider or "").lower().strip()
    req_model = (model or "").strip()

    # 1. Explicit OpenRouter / Ask AI Efficient request
    if req_provider in ("openrouter", "efficient") or req_model.startswith("openrouter/") or (req_model and "/" in req_model):
        if openrouter_key:
            async for chunk in _stream_openrouter(openrouter_key, messages, system_prompt=system_prompt, model=req_model or None):
                yield chunk
            return
        elif not gemini_key and not generic_key:
            raise GeminiError("OpenRouter API key is not configured. Please add OPENROUTER_API_KEY in backend .env.")

    # 2. Explicit Gemini request
    if req_provider == "gemini" or req_model.startswith("gemini"):
        key = gemini_key or generic_key
        if key:
            async for chunk in _stream_gemini(key, messages, system_prompt=system_prompt, model=req_model or None):
                yield chunk
            return
        elif not openrouter_key:
            raise GeminiError("Gemini API key is not configured. Please add GEMINI_API_KEY in backend .env.")

    # 3. OpenRouter provider (default efficient provider)
    if openrouter_key and req_provider != "gemini":
        async for chunk in _stream_openrouter(openrouter_key, messages, system_prompt=system_prompt, model=req_model or None):
            yield chunk
        return

    # 5. Gemini / Default provider fallback
    key = gemini_key or generic_key
    if not key:
        raise GeminiError(
            "No AI API key is configured. Please add GEMINI_API_KEY or OPENROUTER_API_KEY in backend .env or Render dashboard."
        )

    # If the key has the OpenRouter prefix sk-or-, route to OpenRouter
    if key.startswith("sk-or-"):
        async for chunk in _stream_openrouter(key, messages, system_prompt=system_prompt, model=req_model or None):
            yield chunk
    else:
        async for chunk in _stream_gemini(key, messages, system_prompt=system_prompt, model=req_model or None):
            yield chunk


