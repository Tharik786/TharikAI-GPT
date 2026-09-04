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


HF_TOKEN = os.getenv("HF_TOKEN", os.getenv("HUGGINGFACE_API_KEY", "")).strip()
HF_FLUX_MODEL = os.getenv("HF_FLUX_MODEL", "black-forest-labs/FLUX.1-dev").strip()


async def _generate_huggingface_flux(prompt: str, token: str) -> dict:
    """
    Generates an image via Hugging Face FLUX.1 inference API.
    """
    model = HF_FLUX_MODEL or "black-forest-labs/FLUX.1-dev"
    url = f"https://router.huggingface.co/hf-inference/models/{model}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "inputs": prompt,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code != 200:
            # Fallback to legacy inference endpoint
            legacy_url = f"https://api-inference.huggingface.co/models/{model}"
            response = await client.post(legacy_url, headers=headers, json=payload)
            if response.status_code != 200:
                raise Exception(f"Hugging Face FLUX API returned HTTP {response.status_code}: {response.text[:200]}")

        # Detect format
        if response.content.startswith(b"\x89PNG"):
            content_type = "image/png"
        elif response.content.startswith(b"\xff\xd8\xff"):
            content_type = "image/jpeg"
        elif response.content.startswith(b"RIFF") and b"WEBP" in response.content[:16]:
            content_type = "image/webp"
        else:
            content_type = response.headers.get("content-type", "image/jpeg")
            if not content_type.startswith("image/"):
                content_type = "image/jpeg"

        b64_data = base64.b64encode(response.content).decode("utf-8")
        data_url = f"data:{content_type};base64,{b64_data}"

        return {
            "success": True,
            "provider": f"huggingface/{model}",
            "prompt": prompt,
            "image_url": data_url,
            "content_type": content_type,
        }


async def generate_image_url(prompt: str) -> dict:
    """
    Generates an AI image using Hugging Face FLUX.1 if HF_TOKEN is configured,
    or falls back to the Cloudflare Worker image generation endpoint.
    Converts binary response into a data URL for seamless frontend display.
    """
    clean_prompt = prompt.strip()

    # 1. Try Hugging Face FLUX.1 if HF token is configured
    if HF_TOKEN:
        try:
            return await _generate_huggingface_flux(clean_prompt, HF_TOKEN)
        except Exception as hf_err:
            print(f"Hugging Face FLUX.1 error, falling back to default worker: {hf_err}")

    # 2. Default Cloudflare Worker Image API
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
        
        # Determine image format by magic bytes
        if response.content.startswith(b"\x89PNG"):
            content_type = "image/png"
        elif response.content.startswith(b"\xff\xd8\xff"):
            content_type = "image/jpeg"
        elif response.content.startswith(b"RIFF") and b"WEBP" in response.content[:16]:
            content_type = "image/webp"
        else:
            content_type = response.headers.get("content-type", "image/jpeg")
            if not content_type.startswith("image/"):
                content_type = "image/jpeg"

        b64_data = base64.b64encode(response.content).decode("utf-8")
        data_url = f"data:{content_type};base64,{b64_data}"

        return {
            "success": True,
            "provider": "cloudflare/flux",
            "prompt": clean_prompt,
            "image_url": data_url,
            "content_type": content_type,
        }
