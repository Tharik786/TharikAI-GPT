import os
import re
import datetime
from pathlib import Path
from dotenv import load_dotenv
import httpx

backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv()

GREETING_PATTERNS = [
    r"^(hi+|hello+|hey+|hola+|namaste+|vanakkam+|sup|yo|good\s+(morning|afternoon|evening|night))[\s!.,?]*$",
    r"^(thank\s*you|thanks|thx|ok|okay|k|cool|great|awesome|nice|bye|goodbye)[\s!.,?]*$",
    r"^(who\s+are\s+you|what\s+is\s+your\s+name|how\s+are\s+you)[\s!.,?]*$",
]

IMAGE_GEN_PATTERNS = [
    r"^(generate|create|draw|make)\s+(an?\s+)?(image|photo|picture|drawing|artwork|portrait|wallpaper)",
    r"^(image|photo|picture)\s+of\b",
]

QUESTION_WORDS = {
    "what", "who", "when", "where", "why", "how", "which",
    "is", "are", "was", "were", "can", "could", "will", "would",
    "should", "do", "does", "did", "tell", "explain", "find",
    "search", "check", "news", "latest", "today", "yesterday",
    "current", "recent", "update", "price", "score", "weather",
    "stock", "movie", "match", "vs", "versus", "release",
    "who's", "what's", "where's", "when's", "how's"
}


def clean_query_for_search(raw_text: str) -> str:
    """
    Extracts a concise, focused search query from user prompt,
    stripping document attachments and redundant conversational prefixes.
    """
    if not raw_text:
        return ""

    # Remove attached document blocks
    cleaned = re.sub(r"---\s*Document Attached:[\s\S]*?---\s*End of Document\s*---", "", raw_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"---\s*Attached File:[\s\S]*?---\s*End of File\s*---", "", raw_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[Attached image:.*?\]", "", cleaned, flags=re.IGNORECASE)

    # Remove conversational prefixes like "please tell me", "can you search for", etc.
    cleaned = re.sub(r"^(please\s+)?(can\s+you\s+)?(tell\s+me\s+|search\s+for\s+|find\s+out\s+|look\s+up\s+)", "", cleaned.strip(), flags=re.IGNORECASE)

    # Clean whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:250]


def should_perform_web_search(user_text: str) -> bool:
    """
    Determines whether a user prompt represents an informational question
    or search topic that requires real-time web search grounding.
    """
    if not user_text or not user_text.strip():
        return False

    cleaned = clean_query_for_search(user_text)
    if not cleaned or len(cleaned) < 3:
        return False

    # Check against simple greetings / pleasantries
    for pattern in GREETING_PATTERNS:
        if re.match(pattern, cleaned.strip(), flags=re.IGNORECASE):
            return False

    # Check against image generation prompts
    for pattern in IMAGE_GEN_PATTERNS:
        if re.match(pattern, cleaned.strip(), flags=re.IGNORECASE):
            return False

    # 1. Contains a question mark
    if "?" in cleaned:
        return True

    # 2. Check for question words or search trigger words
    tokens = re.findall(r"[A-Za-z0-9'-]+", cleaned.lower())
    if not tokens:
        return False

    first_word = tokens[0]
    if first_word in QUESTION_WORDS:
        return True

    for t in tokens:
        if t in ("latest", "news", "today", "yesterday", "current", "recent", "update", "price", "score", "weather", "release"):
            return True

    # 3. Substantive query (e.g. "Paris Olympics 2026", "Gold rate Mumbai", "OpenAI model release")
    if len(tokens) >= 2 and len(cleaned) >= 8:
        return True

    return False


async def perform_web_search(query: str, max_results: int = 5) -> str:
    """
    Performs real-time internet search via AnySearch API (https://api.anysearch.com/v1/search)
    and formats the results into grounded context for the LLM.
    Supports both anonymous mode and authenticated mode (ANYSEARCH_API_KEY).
    """
    if not query or not query.strip():
        return ""

    clean_q = clean_query_for_search(query)
    if not clean_q:
        return ""

    anysearch_key = os.getenv("ANYSEARCH_API_KEY", "").strip()
    headers = {"Content-Type": "application/json"}
    if anysearch_key:
        headers["Authorization"] = f"Bearer {anysearch_key}"

    payload = {"query": clean_q}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0)) as client:
            resp = await client.post(
                "https://api.anysearch.com/v1/search",
                headers=headers,
                json=payload,
            )

            if resp.status_code != 200:
                print(f"[AnySearch] Returned status {resp.status_code}: {resp.text[:150]}")
                return ""

            data = resp.json()
            search_data = data.get("data", {})
            results = search_data.get("results", [])

            if not results:
                return ""

            now_str = datetime.datetime.now().strftime("%A, %B %d, %Y, %H:%M UTC")
            lines = [
                f"=== REAL-TIME INTERNET SEARCH RESULTS (Current: {now_str}) ===",
                f"User Search Query: {clean_q}\n"
            ]

            for idx, item in enumerate(results[:max_results], 1):
                title = item.get("title") or "Web Source"
                url = item.get("url") or ""
                snippet = item.get("snippet") or ""
                content = item.get("content") or ""

                text_body = snippet or content or ""
                lines.append(f"[{idx}] {title}")
                if url:
                    lines.append(f"Source URL: {url}")
                if text_body:
                    lines.append(f"Details: {text_body.strip()[:400]}")
                lines.append("")

            lines.append("=== END OF REAL-TIME SEARCH RESULTS ===")
            lines.append(
                "GROUNDING RULES:\n"
                "1. Always ground your response in the real-time search results above to provide the latest, factually accurate answer.\n"
                "2. Naturally cite sources using markdown links e.g. [Source Title](URL) where helpful.\n"
                "3. If the user addressed you in a specific language (e.g. Tamil, Malayalam, Hindi), provide the grounded answer fluently in that exact same language."
            )

            return "\n".join(lines)

    except Exception as e:
        print(f"[AnySearch] Search request failed gracefully: {e}")
        return ""
