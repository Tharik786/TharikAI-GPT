import os
import re
import base64
import random
import urllib.parse
import httpx
from fastapi import HTTPException
from pathlib import Path
from dotenv import load_dotenv

backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv()
import asyncio
import json

IMAGE_PROVIDER = os.getenv("IMAGE_PROVIDER", "flux").strip().lower()
IMAGE_API_BASE_URL = os.getenv("IMAGE_API_BASE_URL", "https://image.pollinations.ai").strip().rstrip("/")
DEFAULT_IMAGE_MODEL = os.getenv("IMAGE_MODEL", "flux").strip()

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


def get_dimensions_for_aspect_ratio(aspect_ratio: str = "auto", resolution: str = "1K") -> tuple[int, int]:
    """
    Computes optimal pixel width and height based on aspect ratio.
    """
    ar = (aspect_ratio or "auto").strip().lower()

    if ar in ("16:9", "landscape", "wide"):
        return (1280, 720)
    elif ar in ("9:16", "portrait", "story"):
        return (720, 1280)
    elif ar in ("4:3",):
        return (1024, 768)
    elif ar in ("3:4",):
        return (768, 1024)
    elif ar in ("3:2",):
        return (1080, 720)
    elif ar in ("2:3",):
        return (720, 1080)
    else:
        # Default 1:1 square
        return (1024, 1024)


async def generate_image_bytes(
    prompt: str,
    aspect_ratio: str = "auto",
    resolution: str = "1K",
    background: str = "auto",
) -> tuple[bytes, str]:
    """
    Generates high-definition AI image bytes using FLUX.1 (with automatic SDXL Turbo fallback).
    Returns (raw_binary_bytes, content_type).
    """
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="Image prompt cannot be empty.")

    width, height = get_dimensions_for_aspect_ratio(aspect_ratio, resolution)
    seed = random.randint(1, 99999999)
    encoded_prompt = urllib.parse.quote(clean_prompt)

    # 1. Primary Attempt: FLUX.1 model (state of the art photorealism & prompt comprehension)
    flux_url = f"{IMAGE_API_BASE_URL}/prompt/{encoded_prompt}?width={width}&height={height}&model=flux&nologo=true&seed={seed}"

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        try:
            resp = await client.get(flux_url)
            if resp.status_code == 200 and len(resp.content) > 1000:
                ct = resp.headers.get("content-type", "image/jpeg")
                content_type = ct if ct.startswith("image/") else "image/jpeg"
                return resp.content, content_type
        except Exception:
            # Fall through to fast fallback
            pass

        # 2. Fast Fallback Attempt: SDXL Turbo model (ultra-fast, renders in 1-2 seconds)
        turbo_url = f"{IMAGE_API_BASE_URL}/prompt/{encoded_prompt}?width={width}&height={height}&model=turbo&nologo=true&seed={seed}"
        try:
            resp = await client.get(turbo_url)
            if resp.status_code == 200 and len(resp.content) > 1000:
                ct = resp.headers.get("content-type", "image/jpeg")
                content_type = ct if ct.startswith("image/") else "image/jpeg"
                return resp.content, content_type
            else:
                raise HTTPException(
                    status_code=502,
                    detail=f"Image generation service returned status {resp.status_code}: {resp.text[:150]}",
                )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Failed to connect to Image generation service: {str(e)}",
            )


async def generate_ai_image(
    prompt: str,
    aspect_ratio: str = "auto",
    resolution: str = "1K",
    background: str = "auto",
) -> dict:
    """
    Full pipeline to generate an AI image using FLUX.1 and return structured metadata.
    """
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="Image prompt cannot be empty.")

    width, height = get_dimensions_for_aspect_ratio(aspect_ratio, resolution)
    seed = random.randint(1, 99999999)
    encoded_prompt = urllib.parse.quote(clean_prompt)
    public_url = f"{IMAGE_API_BASE_URL}/prompt/{encoded_prompt}?width={width}&height={height}&model=flux&nologo=true&seed={seed}&enhance=true"

    return {
        "success": True,
        "provider": "flux.1-pollinations",
        "model": "flux.1-schnell",
        "prompt": clean_prompt,
        "image_url": public_url,
        "result_urls": [public_url],
        "task_id": f"img_{seed}",
    }


# Backwards compatibility alias
generate_kie_image = generate_ai_image


async def generate_image_url(prompt: str) -> dict:
    """
    Generates an AI image and returns structured result with base64 data URL.
    """
    raw_bytes, content_type = await generate_image_bytes(prompt)
    b64_data = base64.b64encode(raw_bytes).decode("utf-8")
    data_url = f"data:{content_type};base64,{b64_data}"

    return {
        "success": True,
        "provider": "flux.1-pollinations",
        "model": "flux.1-schnell",
        "prompt": prompt.strip(),
        "image_url": data_url,
        "content_type": content_type,
    }
