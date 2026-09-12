import os
import re
import base64
import httpx
from fastapi import HTTPException
from pathlib import Path
from dotenv import load_dotenv

backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv()
import asyncio
import json

KIE_API_KEY = (os.getenv("KIE_API_KEY") or os.getenv("IMAGE_API_KEY") or "4aff298a28497a189e641f7242fc5ddd").strip()
KIE_API_BASE_URL = os.getenv("KIE_API_BASE_URL", "https://api.kie.ai").strip().rstrip("/")
KIE_IMAGE_MODEL = os.getenv("KIE_IMAGE_MODEL", "gpt-image-2-5-flare-text-to-image").strip()

# User-Defined Image Generation Keywords & Patterns Configuration
IMAGE_GENERATION_CONFIG = {
    "keywords": [
        "generate image",
        "create image",
        "make image",
        "draw image",
        "generate picture",
        "create picture",
        "generate photo",
        "create artwork",
        "create illustration",
        "design a poster",
        "create a logo",
        "generate a portrait",
    ],
    "patterns": [
        "generate an image of *",
        "create an image of *",
        "make a picture of *",
        "draw *",
        "generate a photo of *",
        "create artwork showing *",
    ],
}

# Universal prefix regex covering natural language variations (e.g., "can u", "can you", "please", "i want", etc.)
PREFIX_PATTERN = r"(?:(?:can|could|would|will)\s+(?:you|u|ya)\s+(?:please\s+|pls\s+|plz\s+)?|(?:please|pls|plz)\s+|(?:i\s+(?:want|need|would like)(?:\s+you)?\s+(?:to\s+)?)|(?:help\s+me\s+(?:to\s+)?)|(?:kindly\s+)|(?:do\s+you\s+mind\s+(?:to\s+)?))?"
VERBS_PATTERN = r"(?:generate|create|make|draw|paint|render|design|produce|sketch|give\s+me|show\s+me|craft)"
ARTICLES_PATTERN = r"(?:(?:\s+me|\s+us)?\s+(?:an?|the|some))?"
NOUNS_PATTERN = r"(?:images?|pictures?|pics?|photos?|photographs?|artworks?|illustrations?|posters?|logos?|portraits?|drawings?|wallpapers?|visuals?|graphics?|paintings?|sketch(?:es)?)"
CONNECTORS_PATTERN = r"(?:of|for|about|showing|depicting|with|where|representing|based\s+on|featuring|like|that\s+shows|that\s+has|illustrating)"

# Regex 1: Action + Noun (e.g., "Can u create an image for...", "generate a photo of...", "make picture showing...")
RE_IMAGE_ACTION_NOUN = re.compile(
    rf"^\s*{PREFIX_PATTERN}\s*{VERBS_PATTERN}{ARTICLES_PATTERN}\s+{NOUNS_PATTERN}\s+(?:{CONNECTORS_PATTERN}\s+)?(.+?)[.!?]?\s*$",
    re.IGNORECASE,
)

# Regex 2: Direct drawing/rendering verbs (e.g., "draw a tiger", "can u paint the sunset", "sketch an astronaut")
RE_DIRECT_DRAW = re.compile(
    rf"^\s*{PREFIX_PATTERN}\s*(?:draw|paint|sketch|render)\s+(?:(?:me|us)\s+)?(?:an?|the|some)?\s*(.+?)[.!?]?\s*$",
    re.IGNORECASE,
)

# Regex 3: Slash commands (/imagine, /image, /draw, /img)
RE_SLASH_IMAGE = re.compile(
    r"^\s*/(?:imagine|image|draw|img|paint)\s+(.+?)[.!?]?\s*$",
    re.IGNORECASE,
)

# Regex 4: Noun first (e.g., "image of a cat", "photo of Eiffel tower", "wallpaper showing cyberpunk city")
RE_NOUN_FIRST = re.compile(
    rf"^\s*{PREFIX_PATTERN}\s*{NOUNS_PATTERN}\s+(?:{CONNECTORS_PATTERN}\s+)(.+?)[.!?]?\s*$",
    re.IGNORECASE,
)

# Regex 5: Suffix image requests (e.g., "futuristic cyberpunk city in 4k image", "cat riding bicycle picture")
RE_SUFFIX_IMAGE = re.compile(
    rf"^\s*(.+?)\s+(?:image|picture|pic|photo|wallpaper|artwork)\s*$",
    re.IGNORECASE,
)

# Regex 6: Multilingual Image Generation phrases (Hindi, Tamil, Spanish, French, German)
RE_MULTILINGUAL = [
    # Spanish: crea/generar/dibuja una imagen de ...
    re.compile(r"^\s*(?:por\s+favor\s+)?(?:crea|crear|genera|generar|dibuja|dibujar|haz|hacer)\s+(?:una?\s+)?(?:imagen|foto|dibujo|cuadro)\s+(?:de|para|con|mostrando)\s+(.+?)[.!?]?\s*$", re.IGNORECASE),
    # French: crée/génère/dessine une image de ...
    re.compile(r"^\s*(?:s'il\s+vous\s+pla[iî]t\s+)?(?:cr[ée]e|cr[ée]er|g[ée]n[èe]re|g[ée]n[ée]rer|dessine|dessiner)\s+(?:une?\s+)?(?:image|photo|dessin)\s+(?:de|pour|avec|montrant)\s+(.+?)[.!?]?\s*$", re.IGNORECASE),
    # German: erstelle/generiere/zeichne ein Bild von ...
    re.compile(r"^\s*(?:bitte\s+)?(?:erstelle|erstellen|generiere|generieren|zeichne|zeichnen)\s+(?:ein\s+)?(?:bild|foto|zeichnung)\s+(?:von|f[uü]r|mit)\s+(.+?)[.!?]?\s*$", re.IGNORECASE),
    # Hindi: ... ki tasveer banao / tasveer banao ...
    re.compile(r"^\s*(?:kripya\s+)?(?:tasveer|chitra|photo)\s+(?:banao|banaiye|generate\s+karo)\s+(?:ki\s+|for\s+)?(.+?)[.!?]?\s*$", re.IGNORECASE),
    re.compile(r"^\s*(.+?)\s+ki\s+(?:tasveer|chitra|photo)\s+(?:banao|banaiye|generate\s+karo)[.!?]?\s*$", re.IGNORECASE),
    # Tamil: ... padam varai / padam uruvaakku ...
    re.compile(r"^\s*(.+?)\s+(?:padam|photo|picture)\s+(?:varai|varaiyavum|uruvaakku)[.!?]?\s*$", re.IGNORECASE),
]


def _clean_extracted_prompt(p: str) -> str:
    if not p:
        return ""
    cleaned = p.strip()
    # Strip leading artifacts like "me for ", "for me ", "me of ", "for ", "of "
    cleaned = re.sub(
        r"^(?:(?:for\s+)?(?:me|us)\s+(?:for|of|about|showing|with)\s+|me\s+for\s+|for\s+me\s+|me\s+|us\s+|for\s+|of\s+|about\s+|showing\s+)",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or p.strip()


def detect_image_prompt(query: str) -> str | None:
    """
    Checks if a user query requests image generation across all natural language variations,
    keywords, wildcards, connectors, and multi-language expressions.
    If matched, extracts and returns the clean visual prompt for the image generation API.
    """
    if not query or len(query.strip()) < 2:
        return None
    
    q = query.strip()
    
    # 1. Action + Noun Match (e.g. "Can u create an image for the men behind standing in the train")
    m = RE_IMAGE_ACTION_NOUN.match(q)
    if m and m.group(1).strip():
        res = _clean_extracted_prompt(m.group(1))
        if len(res) >= 2:
            return res

    # 2. Direct Draw/Paint Match (e.g. "draw an astronaut on Mars")
    m = RE_DIRECT_DRAW.match(q)
    if m and m.group(1).strip():
        res = _clean_extracted_prompt(m.group(1))
        if len(res) >= 2:
            return res

    # 3. Slash command match (/imagine, /image, /draw)
    m = RE_SLASH_IMAGE.match(q)
    if m and m.group(1).strip():
        res = _clean_extracted_prompt(m.group(1))
        if len(res) >= 2:
            return res

    # 4. Noun first match ("image of a dragon flying over city")
    m = RE_NOUN_FIRST.match(q)
    if m and m.group(1).strip():
        res = _clean_extracted_prompt(m.group(1))
        if len(res) >= 2:
            return res

    # 5. Multilingual matches (Spanish, French, German, Hindi, Tamil)
    for pattern in RE_MULTILINGUAL:
        m = pattern.match(q)
        if m and m.group(1).strip():
            res = _clean_extracted_prompt(m.group(1))
            if len(res) >= 2:
                return res

    # 6. Suffix match ("cyberpunk street in rain image")
    m = RE_SUFFIX_IMAGE.match(q)
    if m and m.group(1).strip():
        res = _clean_extracted_prompt(m.group(1))
        # Avoid false positives for very short single words
        if len(res.split()) >= 2:
            return res

    return None


async def create_kie_image_task(
    prompt: str,
    aspect_ratio: str = "auto",
    resolution: str = "1K",
    background: str = "auto",
) -> str:
    """
    Submits an asynchronous text-to-image generation task to Kie.ai (GPT Image 2.5 Flare).
    Returns the generated taskId string.
    """
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="Image prompt cannot be empty.")

    url = f"{KIE_API_BASE_URL}/api/v1/jobs/createTask"
    headers = {
        "Authorization": f"Bearer {KIE_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": KIE_IMAGE_MODEL,
        "input": {
            "prompt": clean_prompt,
            "aspect_ratio": aspect_ratio or "auto",
            "resolution": resolution or "1K",
            "background": background or "auto",
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Unable to connect to Kie.ai Image API: {str(e)}",
            )

        if response.status_code != 200:
            error_detail = response.text[:300] if response.text else f"HTTP {response.status_code}"
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Kie.ai createTask API error ({response.status_code}): {error_detail}",
            )

        data = response.json()
        task_id = (
            data.get("data", {}).get("taskId")
            or data.get("taskId")
            or data.get("data", {}).get("recordId")
            or data.get("recordId")
        )

        if not task_id:
            raise HTTPException(
                status_code=502,
                detail=f"Kie.ai did not return a valid taskId: {response.text[:200]}",
            )

        return str(task_id)


async def poll_kie_task(
    task_id: str,
    timeout_seconds: float = 120.0,
    poll_interval: float = 2.0,
) -> dict:
    """
    Polls Kie.ai /api/v1/jobs/recordInfo?taskId=... until state is 'success' or 'failed'.
    Returns dictionary with task info and result URLs.
    """
    url = f"{KIE_API_BASE_URL}/api/v1/jobs/recordInfo"
    headers = {
        "Authorization": f"Bearer {KIE_API_KEY}",
    }
    params = {"taskId": task_id}

    start_time = asyncio.get_event_loop().time()

    async with httpx.AsyncClient(timeout=20.0) as client:
        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > timeout_seconds:
                raise HTTPException(
                    status_code=504,
                    detail=f"Image generation timed out after {int(timeout_seconds)}s. Please try again.",
                )

            try:
                response = await client.get(url, headers=headers, params=params)
            except httpx.RequestError as e:
                # Brief network retry
                await asyncio.sleep(poll_interval)
                continue

            if response.status_code != 200:
                error_detail = response.text[:200] if response.text else f"HTTP {response.status_code}"
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Kie.ai recordInfo error ({response.status_code}): {error_detail}",
                )

            res_data = response.json()
            task_info = res_data.get("data", {})
            state = str(task_info.get("state") or "").lower()

            if state == "success":
                result_urls = []
                # 1. Parse resultJson if string
                result_json_raw = task_info.get("resultJson")
                if result_json_raw:
                    if isinstance(result_json_raw, str):
                        try:
                            parsed_json = json.loads(result_json_raw)
                            result_urls = parsed_json.get("resultUrls", [])
                        except Exception:
                            pass
                    elif isinstance(result_json_raw, dict):
                        result_urls = result_json_raw.get("resultUrls", [])

                # 2. Check response object
                if not result_urls:
                    resp_obj = task_info.get("response") or {}
                    if isinstance(resp_obj, dict):
                        result_urls = resp_obj.get("resultUrls", [])

                # 3. Check data.resultUrls
                if not result_urls and "resultUrls" in task_info:
                    result_urls = task_info.get("resultUrls", [])

                if not result_urls:
                    raise HTTPException(
                        status_code=502,
                        detail="Kie.ai task reported success but no image URLs were found in response.",
                    )

                return {
                    "taskId": task_id,
                    "state": state,
                    "resultUrls": result_urls,
                    "primaryUrl": result_urls[0],
                    "raw": task_info,
                }

            elif state in ("fail", "failed", "error"):
                fail_msg = task_info.get("failMsg") or task_info.get("failCode") or "Image generation failed"
                raise HTTPException(
                    status_code=502,
                    detail=f"Kie.ai image generation failed: {fail_msg}",
                )

            # Still in progress (generating, waiting, pending)
            await asyncio.sleep(poll_interval)


async def fetch_image_bytes(image_url: str) -> tuple[bytes, str]:
    """
    Downloads raw image bytes from the image host (e.g. Kie.ai storage or CDN).
    Returns (raw_binary_bytes, content_type).
    """
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        try:
            resp = await client.get(image_url)
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to retrieve generated image asset from {image_url}: {str(e)}",
            )

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Unable to download generated image asset (HTTP {resp.status_code})",
            )

        content = resp.content

        # Detect format via magic bytes
        if content.startswith(b"\x89PNG"):
            content_type = "image/png"
        elif content.startswith(b"\xff\xd8\xff"):
            content_type = "image/jpeg"
        elif content.startswith(b"RIFF") and b"WEBP" in content[:16]:
            content_type = "image/webp"
        else:
            ct = resp.headers.get("content-type", "image/png")
            content_type = ct if ct.startswith("image/") else "image/png"

        return content, content_type


async def generate_image_bytes(
    prompt: str,
    aspect_ratio: str = "auto",
    resolution: str = "1K",
    background: str = "auto",
) -> tuple[bytes, str]:
    """
    Full pipeline to generate an AI image via Kie.ai GPT Image 2.5 Flare and return raw binary bytes & MIME type.
    """
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="Image prompt cannot be empty.")

    task_id = await create_kie_image_task(
        prompt=clean_prompt,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        background=background,
    )

    poll_result = await poll_kie_task(task_id=task_id)
    image_url = poll_result["primaryUrl"]

    return await fetch_image_bytes(image_url)


async def generate_kie_image(
    prompt: str,
    aspect_ratio: str = "auto",
    resolution: str = "1K",
    background: str = "auto",
) -> dict:
    """
    Full pipeline to generate an AI image via Kie.ai GPT Image 2.5 Flare and return structured metadata.
    """
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="Image prompt cannot be empty.")

    task_id = await create_kie_image_task(
        prompt=clean_prompt,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        background=background,
    )

    poll_result = await poll_kie_task(task_id=task_id)
    image_url = poll_result["primaryUrl"]

    return {
        "success": True,
        "provider": "kie/gpt-image-2-5-flare",
        "model": KIE_IMAGE_MODEL,
        "prompt": clean_prompt,
        "image_url": image_url,
        "result_urls": poll_result["resultUrls"],
        "task_id": task_id,
    }


async def generate_image_url(prompt: str) -> dict:
    """
    Generates an AI image via Kie.ai GPT Image 2.5 Flare and returns structured result with base64 data URL.
    Maintained for backward compatibility.
    """
    res = await generate_kie_image(prompt)
    raw_bytes, content_type = await fetch_image_bytes(res["image_url"])
    b64_data = base64.b64encode(raw_bytes).decode("utf-8")
    data_url = f"data:{content_type};base64,{b64_data}"

    return {
        "success": True,
        "provider": "kie/gpt-image-2-5-flare",
        "model": KIE_IMAGE_MODEL,
        "prompt": prompt.strip(),
        "image_url": data_url,
        "remote_url": res["image_url"],
        "content_type": content_type,
    }
