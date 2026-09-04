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
        f"You are a helpful, friendly, and highly intelligent AI assistant (TharikAI).\n"
        f"Format answers with clean Markdown (headings, lists, and fenced code blocks with language tags) "
        f"whenever that improves readability.\n"
        f"Multilingual Intelligence: You speak and understand all global languages fluently. "
        f"Always reply in the EXACT SAME LANGUAGE that the user speaks or writes in (e.g. English, Spanish, French, German, Hindi, Tamil, Telugu, Arabic, Japanese, Chinese, Russian, Italian, Portuguese, Korean, etc.). "
        f"Image Generation Capability: You have built-in AI image generation features. When asked to create or generate an image, describe what is being rendered or confirm visual generation.\n"
        f"Ensure your tone is natural, conversational, and culturally appropriate.\n"
        f"Current Date and Time: {now_str}.\n"
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


async def _stream_openrouter(
    api_key: str, messages: list[dict], system_prompt: str = SYSTEM_PROMPT
) -> AsyncGenerator[str, None]:
    model = os.getenv("OPENROUTER_MODEL") or os.getenv("AI_MODEL", "openrouter/auto")
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


async def _stream_gemini(
    api_key: str, messages: list[dict], system_prompt: str = SYSTEM_PROMPT
) -> AsyncGenerator[str, None]:
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:streamGenerateContent?alt=sse&key={api_key}"
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


async def stream_chat_completion(
    messages: list[dict],
    web_search_context: str = "",
) -> AsyncGenerator[str, None]:
    """
    Yields text chunks as they arrive from OpenRouter or Google Gemini.
    Automatically detects the provider based on the key format or env vars.
    Supports Multimodal Vision and Web Search grounding.
    """
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    generic_key = os.getenv("AI_API_KEY", "").strip()

    system_prompt = get_system_prompt()
    if web_search_context:
        system_prompt = f"{system_prompt}\n\n{web_search_context}"

    # Determine key and provider
    if openrouter_key:
        async for chunk in _stream_openrouter(openrouter_key, messages, system_prompt=system_prompt):
            yield chunk
        return

    key = gemini_key or generic_key
    if not key:
        raise GeminiError(
            "No AI API key is configured. Please add GEMINI_API_KEY or OPENROUTER_API_KEY in your Render dashboard."
        )

    # If the key has the OpenRouter prefix sk-or-, route to OpenRouter
    if key.startswith("sk-or-"):
        async for chunk in _stream_openrouter(key, messages, system_prompt=system_prompt):
            yield chunk
    else:
        async for chunk in _stream_gemini(key, messages, system_prompt=system_prompt):
            yield chunk


