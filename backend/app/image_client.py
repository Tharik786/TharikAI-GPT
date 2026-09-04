import os
import re
import base64
import httpx
from pathlib import Path
from dotenv import load_dotenv

backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv()

IMAGE_API_URL = os.getenv("IMAGE_API_URL", "https://image-api.tharik-official007.workers.dev/").strip()
IMAGE_API_KEY = os.getenv("IMAGE_API_KEY", "7f3a9c2e8b1d4f6a9e0c3b7d5a2f8e1c").strip()

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


def _build_pattern_regex(pattern_str: str) -> re.Pattern:
    escaped = re.escape(pattern_str).replace(r"\*", r"(.+)")
    return re.compile(
        rf"^\s*(?:can you\s+|could you\s+|please\s+|will you\s+|i want you to\s+|i want an?\s+)*{escaped}$",
        re.IGNORECASE,
    )


COMPILED_PATTERNS = [_build_pattern_regex(p) for p in IMAGE_GENERATION_CONFIG["patterns"]]

COMPILED_KEYWORDS = [
    re.compile(
        rf"^\s*(?:can you\s+|could you\s+|please\s+|will you\s+|i want you to\s+|i want an?\s+)*{re.escape(kw)}\s*(?:of|about|for|showing|depicting|with)?\s+(.+)$",
        re.IGNORECASE,
    )
    for kw in IMAGE_GENERATION_CONFIG["keywords"]
]

COMPILED_ADDITIONAL = [
    re.compile(r"^\s*/(?:imagine|image|draw|paint|img)\s+(.+)$", re.IGNORECASE),
    re.compile(r"^\s*(?:image|picture|photo|illustration|artwork|wallpaper)\s+(?:of|about|showing|with|for)\s+(.+)$", re.IGNORECASE),
    re.compile(r"^\s*(?:generate|create|render)\s+(.+)\s+(?:image|picture|photo|illustration)$", re.IGNORECASE),
]


def detect_image_prompt(query: str) -> str | None:
    """
    Checks if a user query matches the defined keywords or patterns for image generation.
    If yes, extracts and returns the clean prompt for the image generation API.
    """
    if not query or len(query.strip()) < 3:
        return None
    
    q = query.strip()
    
    # 1. Match specified patterns (with wildcard *)
    for r in COMPILED_PATTERNS:
        m = r.match(q)
        if m and m.group(1).strip():
            extracted = m.group(1).strip()
            if len(extracted) >= 2:
                return extracted

    # 2. Match specified keywords
    for r in COMPILED_KEYWORDS:
        m = r.match(q)
        if m and m.group(1).strip():
            extracted = m.group(1).strip()
            if len(extracted) >= 2:
                return extracted

    # 3. Match slash commands & additional variations
    for r in COMPILED_ADDITIONAL:
        m = r.match(q)
        if m and m.group(1).strip():
            extracted = m.group(1).strip()
            if len(extracted) >= 2:
                return extracted

    return None



async def generate_image_url(prompt: str) -> dict:
    """
    Generates an AI image using the Cloudflare Worker image generation endpoint.
    Converts binary response into a data URL for seamless frontend display.
    """
    clean_prompt = prompt.strip()
    headers = {
        "Authorization": f"Bearer {IMAGE_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "prompt": clean_prompt,
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(IMAGE_API_URL, headers=headers, json=payload)
        if response.status_code != 200:
            raise Exception(f"Image API returned HTTP {response.status_code}: {response.text[:200]}")
        
        content_type = response.headers.get("content-type", "image/jpeg")
        if not content_type.startswith("image/"):
            content_type = "image/jpeg"

        b64_data = base64.b64encode(response.content).decode("utf-8")
        data_url = f"data:{content_type};base64,{b64_data}"

        return {
            "success": True,
            "prompt": clean_prompt,
            "image_url": data_url,
            "content_type": content_type,
        }

