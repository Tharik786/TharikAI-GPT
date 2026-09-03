import urllib.parse
import re

# Common patterns that trigger AI image generation
IMAGE_INTENT_PATTERNS = [
    r"^\s*(?:generate|create|draw|make|render|paint|design|produce)\s+(?:an?\s+)?(?:image|picture|photo|illustration|drawing|artwork|wallpaper|poster|render)\s+(?:of|about|with|showing|for)?\s+(.+)$",
    r"^\s*(?:image|picture|photo|illustration)\s+(?:of|about|showing)\s+(.+)$",
    r"^\s*/(?:imagine|image|draw|paint)\s+(.+)$",
    r"^\s*(?:draw|paint|sketch)\s+(?:me\s+)?(.+)$",
]

COMPILED_IMAGE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in IMAGE_INTENT_PATTERNS]


def detect_image_prompt(query: str) -> str | None:
    """
    Checks if a user query is asking to generate an image.
    If yes, extracts and returns the clean image description/prompt.
    """
    if not query or len(query.strip()) < 4:
        return None
    
    q = query.strip()
    for pattern in COMPILED_IMAGE_PATTERNS:
        match = pattern.match(q)
        if match:
            extracted = match.group(1).strip()
            if len(extracted) >= 3:
                return extracted
    return None


def generate_image_url(prompt: str, width: int = 1024, height: int = 1024, model: str = "flux") -> dict:
    """
    Generates a high-resolution AI image URL using Pollinations Flux engine.
    100% free, fast, and does not require third-party billing.
    """
    clean_prompt = prompt.strip()
    encoded = urllib.parse.quote(clean_prompt)
    
    # Pollinations AI Flux URL with HD rendering and no logo
    image_url = f"https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&model={model}&nologo=true&enhance=true"
    
    return {
        "success": True,
        "prompt": clean_prompt,
        "image_url": image_url,
        "width": width,
        "height": height,
        "model": model,
    }
