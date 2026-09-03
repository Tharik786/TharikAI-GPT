import os
import re
import datetime
from pathlib import Path
from dotenv import load_dotenv
import httpx

# Load .env
backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv()

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# Common keywords/patterns indicating time-sensitive or live real-time queries
TIME_SENSITIVE_PATTERNS = [
    r"\b(today|tonight|yesterday|tomorrow|this week|this month|this year|now|right now)\b",
    r"\b(latest|current|currently|recent|recently|breaking|news|updates?|newest|headlines?)\b",
    r"\b(weather|temperature|forecast|rain|climate|humidity)\b",
    r"\b(stock|price|prices|shares?|crypto|bitcoin|btc|ethereum|eth|market|rate|usd|inr|eur|currency|valuation|market cap)\b",
    r"\b(who is|who won|who is the|who are|election|olympics|championship|tournament|league|ipl|fifa|world cup)\b",
    r"\b(score|scores|live score|match|vs\b|game score)\b",
    r"\b(release date|launch date|schedule|what time|whats the time|what date|when is|when will)\b",
    r"\b(ceo of|president of|prime minister of|founder of|net worth)\b",
    r"\b(search for|lookup|look up|find out|what happened in|tell me the news)\b",
    r"\b(2024|2025|2026|2027)\b",
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in TIME_SENSITIVE_PATTERNS]


def should_auto_search(query: str) -> bool:
    """
    Checks if a query likely requires real-time web search.
    """
    if not query or len(query.strip()) < 3:
        return False
    q = query.strip()
    return any(pattern.search(q) for pattern in COMPILED_PATTERNS)


async def search_tavily(query: str, max_results: int = 5) -> dict:
    """
    Executes a web search query against the Tavily AI search API.
    Returns structured results including AI summary answer and verified web sources.
    """
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        return {
            "success": False,
            "error": "Tavily API key is not configured.",
            "results": [],
            "answer": None,
        }

    clean_query = query.strip()
    if not clean_query:
        return {"success": False, "error": "Query is empty.", "results": [], "answer": None}

    payload = {
        "api_key": api_key,
        "query": clean_query,
        "search_depth": "basic",
        "include_answer": False,
        "include_images": False,
        "max_results": min(max_results, 3),
    }

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.post(TAVILY_SEARCH_URL, json=payload)
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Tavily returned HTTP {response.status_code}",
                    "results": [],
                    "answer": None,
                }

            data = response.json()
            raw_results = data.get("results", [])
            answer = data.get("answer") or ""

            formatted_results = []
            for item in raw_results:
                title = (item.get("title") or "Web Page").strip()
                url = (item.get("url") or "").strip()
                content = (item.get("content") or "").strip()
                score = item.get("score", 0)

                # Extract domain name for friendly display
                domain = ""
                if url:
                    try:
                        from urllib.parse import urlparse
                        domain = urlparse(url).netloc.replace("www.", "")
                    except Exception:
                        domain = ""

                if url and content:
                    formatted_results.append({
                        "title": title,
                        "url": url,
                        "domain": domain or url,
                        "content": content[:1200],  # keep content concise for token efficiency
                        "score": score,
                    })

            return {
                "success": True,
                "query": clean_query,
                "answer": answer,
                "results": formatted_results,
            }

    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "Tavily web search timed out.",
            "results": [],
            "answer": None,
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Web search error: {str(e)}",
            "results": [],
            "answer": None,
        }


def format_search_context(search_data: dict) -> str:
    """
    Formats the search results into a clean system prompt injection
    giving the AI accurate real-time grounding and citation links.
    """
    if not search_data or not search_data.get("success"):
        return ""

    results = search_data.get("results", [])
    answer = search_data.get("answer")
    query = search_data.get("query", "")
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")

    lines = [
        f"--- REAL-TIME WEB SEARCH RESULTS FOR: '{query}' ---",
        f"Timestamp: {now_str}",
    ]

    if answer:
        lines.append(f"Web Summary: {answer}")

    if results:
        lines.append("\nVerified Sources:")
        for idx, r in enumerate(results, 1):
            lines.append(f"[{idx}] {r['title']} ({r.get('domain', '')})")
            lines.append(f"URL: {r['url']}")
            lines.append(f"Content: {r['content']}\n")

    lines.append(
        "CRITICAL INSTRUCTIONS FOR AI ASSISTANT:\n"
        "- Use the fresh, real-time web search results above to answer the user's question accurately.\n"
        "- Do NOT claim that your knowledge is cut off or that you cannot browse the internet.\n"
        "- Cite sources naturally with markdown links, e.g. [Source Title](URL) or numbered references [1], [2] when stating factual claims.\n"
        "--- END OF REAL-TIME SEARCH RESULTS ---"
    )

    return "\n".join(lines)
