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
        f"3. NO IMAGE GENERATION:\n"
        f"   - You do NOT support, generate, or create images or artwork. NEVER list, claim, or suggest image generation as one of your features or capabilities.\n"
        f"   - If a user asks to generate, create, or draw an image or art, politely let them know that you do not generate images, and assist them with text, research, coding, documents, spreadsheets, or web search instead.\n\n"
        f"4. REAL-TIME INTERNET SEARCH & CURRENT NEWS:\n"
        f"   - When live web search results are provided in your context, always ground your response in the real-time internet results.\n"
        f"   - Report current news, factual updates, and real-world information accurately as verified by authoritative web sources.\n"
        f"   - Cite sources naturally using markdown links e.g. [Source Title](URL) or [1], [2].\n\n"
        f"5. AI DOCUMENT, SPREADSHEET & PRESENTATION GENERATION (WORD DOCX, EXCEL XLSX, PPT, PDF, ALL):\n"
        f"   - TharikAI HAS full native capability to generate, render, and export downloadable Microsoft Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF (.pdf), and All-in-One (.zip) documents!\n"
        f"   - NEVER claim that you cannot create or send downloadable Word, Excel, PowerPoint, or PDF files. The user has direct 1-click download buttons for DOCX, XLSX, PPTX, PDF, and ZIP right on your response!\n"
        f"   - When asked to generate an Excel sheet, Word doc, PPT presentation, PDF, or all formats:\n"
        f"     1. Start with a clear Markdown H1 title (# Topic Name).\n"
        f"     2. Provide structured text sections (## Section Name) with in-depth analysis.\n"
        f"     3. Provide rich, detailed Markdown Tables (| Col 1 | Col 2 | Col 3 |) so the Excel exporter can generate a beautiful spreadsheet.\n"
        f"     4. Provide slide-by-slide breakdowns (e.g. ## Slide 1: Topic with bullet points) so the PowerPoint exporter can build clear slides.\n"
        f"     5. Deliver the content directly and professionally for the requested format without outputting generic download reminder disclaimers.\n\n"
        f"Tone: Natural, warm, polite, culturally appropriate, and concise.\n"
    )



SYSTEM_PROMPT = get_system_prompt()


class LLMProviderError(Exception):
    pass


_CLIENT_POOL: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _CLIENT_POOL
    if _CLIENT_POOL is None or _CLIENT_POOL.is_closed:
        _CLIENT_POOL = httpx.AsyncClient(
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50, keepalive_expiry=60.0),
            timeout=httpx.Timeout(connect=15.0, read=180.0, write=30.0, pool=15.0),
        )
    return _CLIENT_POOL


async def _stream_openrouter(
    api_key: str,
    messages: list[dict],
    system_prompt: str = SYSTEM_PROMPT,
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    target_model = model or os.getenv("OPENROUTER_MODEL", "openrouter/auto")
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
    try:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                raw_err = body.decode(errors="ignore")
                try:
                    err_json = json.loads(raw_err)
                    msg = err_json.get("error", {}).get("message", raw_err)
                    raise LLMProviderError(f"OpenRouter API error ({response.status_code}): {msg}")
                except json.JSONDecodeError:
                    raise LLMProviderError(f"OpenRouter API error ({response.status_code}): {raw_err}")

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
    except httpx.TimeoutException as e:
        raise LLMProviderError("OpenRouter timed out while generating a response. Please try again.") from e
    except httpx.HTTPError as e:
        raise LLMProviderError(f"Network error while connecting to OpenRouter: {str(e)}") from e


async def stream_chat_completion(
    messages: list[dict],
    web_search_context: str = "",
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream multimodal chat completions from OpenRouter."""
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not openrouter_key:
        raise LLMProviderError("OpenRouter API key is not configured. Please add OPENROUTER_API_KEY.")

    system_prompt = get_system_prompt()
    if web_search_context:
        system_prompt = f"{system_prompt}\n\n{web_search_context}"

    async for chunk in _stream_openrouter(
        openrouter_key,
        messages,
        system_prompt=system_prompt,
        model=model,
    ):
        yield chunk


