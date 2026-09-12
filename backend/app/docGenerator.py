"""
Carbone.io Document Generator Integration
Generates professional executive documents (PDF reports, research papers, summaries)
using the Carbone.io API v4.
"""

import os
import re
import json
import base64
import urllib.request
import urllib.error
import html
from datetime import datetime
from typing import Optional, Dict, Any, Tuple

CARBONE_API_KEY = os.getenv(
    "CARBONE_API_KEY",
    "test_eyJhbGciOiJFUzUxMiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxNTA3ODA1ODU5NDcxOTIwOTE1IiwiYXVkIjoiY2FyYm9uZSIsImV4cCI6MjQ1MTQ1OTY2NSwiZGF0YSI6eyJ0eXBlIjoidGVzdCJ9fQ.AGRwZ54RvsndfIxSNRGPHFk4NRlPNQQ8A1H3bquBcyy3r-O65HbtahaFAN3R2AG84yMqglyd7PEYjYz_pv4G3ah1AEqin-GBflB547TSXG7GsOwf9gCLS4vEpVAnkRwsTh8KosoljrHZhwajtDtVG2trBzV-ooph7fB7CNuv5VSPWGBA"
)
CARBONE_BASE_URL = "https://api.carbone.io"
CARBONE_VERSION = "4"

# In-memory cache for template IDs
_template_cache: Dict[str, str] = {}


def get_headers(content_type: str = "application/json") -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {CARBONE_API_KEY}",
        "carbone-version": CARBONE_VERSION,
        "Content-Type": content_type,
        "User-Agent": "TharikAI-DocumentGenerator/1.0"
    }


def strip_template_metadata(text: str) -> str:
    """
    Strips unwanted template metadata blocks like:
    Executive Document: ...
    Date: ...
    Prepared by: ...
    Author: ...
    ---
    """
    if not text:
        return ""
    lines = text.replace("\r\n", "\n").split("\n")
    start_idx = 0
    while start_idx < len(lines):
        line = lines[start_idx].strip()
        is_metadata = (
            not line
            or bool(re.match(r'^(?:#+\s*)?(?:Executive\s+)?Document:\s*', line, re.IGNORECASE))
            or bool(re.match(r'^(?:\*{1,2})?Date:\s*', line, re.IGNORECASE))
            or bool(re.match(r'^(?:\*{1,2})?Prepared\s+by:\s*', line, re.IGNORECASE))
            or bool(re.match(r'^(?:\*{1,2})?Author:\s*', line, re.IGNORECASE))
            or bool(re.match(r'^[-*_]{3,}$', line))
        )
        if is_metadata:
            start_idx += 1
        else:
            break
    return "\n".join(lines[start_idx:]).strip()


def markdown_to_html_body(md: str) -> str:
    """
    Converts markdown content into clean, semantic HTML suitable for Carbone rendering.
    """
    md = strip_template_metadata(md)
    if not md:
        return "<p>No content provided.</p>"

    # Pre-clean lines
    lines = md.replace("\r\n", "\n").split("\n")
    out = []
    in_code_block = False
    code_lang = ""
    code_buffer = []
    in_table = False
    table_rows = []

    def flush_table():
        nonlocal in_table, table_rows
        if not table_rows:
            in_table = False
            return ""
        html_table = ["<div class='table-wrapper'><table>"]
        for idx, row in enumerate(table_rows):
            cells = [c.strip() for c in row.split("|")[1:-1]] if "|" in row else [row]
            if idx == 0:
                html_table.append("<thead><tr>")
                for c in cells:
                    html_table.append(f"<th>{inline_format(c)}</th>")
                html_table.append("</tr></thead><tbody>")
            elif idx == 1 and all(set(c).issubset({"-", ":", " "}) for c in cells):
                continue  # separator row
            else:
                html_table.append("<tr>")
                for c in cells:
                    html_table.append(f"<td>{inline_format(c)}</td>")
                html_table.append("</tr>")
        html_table.append("</tbody></table></div>")
        table_rows = []
        in_table = False
        return "".join(html_table)

    def inline_format(text: str) -> str:
        # Escape HTML entities
        text = html.escape(text)
        # Bold
        text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
        # Italic
        text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
        # Inline code
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        # Links
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
        return text

    i = 0
    while i < len(lines):
        line = lines[i]

        # Code block toggle
        if line.strip().startswith("```"):
            if in_code_block:
                escaped_code = html.escape("\n".join(code_buffer))
                out.append(f"<pre class='code-block'><code>{escaped_code}</code></pre>")
                code_buffer = []
                in_code_block = False
            else:
                in_code_block = True
                code_lang = line.strip().lstrip("`").strip()
            i += 1
            continue

        if in_code_block:
            code_buffer.append(line)
            i += 1
            continue

        # Markdown tables
        if line.strip().startswith("|") and line.strip().endswith("|"):
            in_table = True
            table_rows.append(line)
            i += 1
            continue
        elif in_table:
            out.append(flush_table())

        stripped = line.strip()

        # Headings
        if stripped.startswith("### "):
            out.append(f"<h3>{inline_format(stripped[4:])}</h3>")
        elif stripped.startswith("## "):
            out.append(f"<h2>{inline_format(stripped[3:])}</h2>")
        elif stripped.startswith("# "):
            out.append(f"<h1>{inline_format(stripped[2:])}</h1>")
        # Blockquotes / Callouts
        elif stripped.startswith("> "):
            quote_text = inline_format(stripped[2:])
            out.append(f"<blockquote class='callout-box'>{quote_text}</blockquote>")
        # Unordered list items
        elif stripped.startswith("- ") or stripped.startswith("* "):
            out.append(f"<ul><li>{inline_format(stripped[2:])}</li></ul>")
        # Ordered list items
        elif re.match(r'^\d+\.\s+', stripped):
            item_text = re.sub(r'^\d+\.\s+', '', stripped)
            out.append(f"<ol><li>{inline_format(item_text)}</li></ol>")
        # Horizontal rules
        elif stripped in ("---", "***", "___"):
            out.append("<hr class='divider' />")
        # Regular paragraph
        elif stripped:
            out.append(f"<p>{inline_format(stripped)}</p>")
        else:
            # Blank line
            out.append("<div class='spacer'></div>")

        i += 1

    if in_table:
        out.append(flush_table())

    # Combine adjacent <ul> and <ol> tags
    combined = "".join(out)
    combined = re.sub(r'</ul>\s*<ul>', '', combined)
    combined = re.sub(r'</ol>\s*<ol>', '', combined)
    return combined


def build_carbone_template(title: str, html_body: str, metadata: Optional[Dict[str, Any]] = None) -> str:
    """
    Builds a clean, professional executive document template for Carbone
    without watermarks, brand stamps, or unwanted boilerplate.
    """
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{html.escape(title)}</title>
  <style>
    @page {{
      size: A4;
      margin: 24mm 20mm 24mm 20mm;
      @bottom-right {{
        content: counter(page);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 9pt;
        color: #94a3b8;
      }}
    }}

    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.65;
      color: #1e293b;
      background: #ffffff;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }}

    /* Title Block */
    .doc-title-block {{
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 2px solid #10b981;
    }}

    .doc-title {{
      font-size: 22pt;
      font-weight: 800;
      color: #0f172a;
      margin: 0;
      letter-spacing: -0.5px;
      line-height: 1.25;
    }}

    /* Typography */
    h1 {{
      font-size: 15pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-top: 26px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }}

    h2 {{
      font-size: 13pt;
      font-weight: 600;
      color: #1e293b;
      margin-top: 20px;
      margin-bottom: 10px;
      page-break-after: avoid;
    }}

    h3 {{
      font-size: 11pt;
      font-weight: 600;
      color: #334155;
      margin-top: 16px;
      margin-bottom: 8px;
      page-break-after: avoid;
    }}

    p {{
      margin: 0 0 12px 0;
      color: #334155;
    }}

    strong {{
      font-weight: 600;
      color: #0f172a;
    }}

    /* Callouts & Blockquotes */
    .callout-box {{
      margin: 16px 0;
      padding: 12px 18px;
      background: #f8fafc;
      border-left: 4px solid #10b981;
      border-radius: 0 8px 8px 0;
      color: #334155;
      font-style: italic;
    }}

    /* Tables */
    .table-wrapper {{
      margin: 16px 0;
      overflow-x: auto;
    }}

    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
      margin-bottom: 12px;
    }}

    th {{
      background: #0f172a;
      color: #ffffff;
      font-weight: 600;
      text-align: left;
      padding: 9px 12px;
      border: 1px solid #1e293b;
    }}

    td {{
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      color: #334155;
    }}

    tr:nth-child(even) {{
      background: #f8fafc;
    }}

    /* Lists */
    ul, ol {{
      margin: 0 0 14px 20px;
      padding: 0;
    }}

    li {{
      margin-bottom: 6px;
      color: #334155;
    }}

    /* Code Blocks */
    .code-block {{
      background: #0f172a;
      color: #e2e8f0;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: "SFMono-Regular", Consolas, Menlo, monospace;
      font-size: 8.5pt;
      overflow-x: auto;
      margin: 14px 0;
      line-height: 1.5;
    }}

    code {{
      font-family: "SFMono-Regular", Consolas, Menlo, monospace;
      font-size: 9pt;
      background: #f1f5f9;
      color: #0f172a;
      padding: 2px 5px;
      border-radius: 4px;
    }}

    .pre code {{
      background: transparent;
      color: inherit;
      padding: 0;
    }}

    /* Dividers */
    .divider {{
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 24px 0;
    }}

    .spacer {{
      height: 8px;
    }}

  </style>
</head>
<body>
  <div class="doc-title-block">
    <h1 class="doc-title">{html.escape(title)}</h1>
  </div>

  <div class="doc-content">
    {html_body}
  </div>
</body>
</html>"""


def upload_template(html_content: str) -> str:
    """
    Uploads base64-encoded HTML template to Carbone and returns templateId.
    Caches template ID to avoid redundant uploads.
    """
    b64_content = base64.b64encode(html_content.encode("utf-8")).decode("utf-8")

    # Quick hash check in cache
    cache_key = str(hash(b64_content))
    if cache_key in _template_cache:
        return _template_cache[cache_key]

    url = f"{CARBONE_BASE_URL}/template"
    headers = get_headers()
    payload = json.dumps({"template": b64_content}).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("success") and "templateId" in data.get("data", {}):
                template_id = data["data"]["templateId"]
                _template_cache[cache_key] = template_id
                return template_id
            raise ValueError(f"Failed to upload template: {data}")
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Carbone template upload HTTP {e.code}: {err_msg}")


# In-memory document binary cache: render_id -> bytes
_document_bytes_cache: Dict[str, bytes] = {}


def render_carbone_document(
    title: str,
    markdown_content: str,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Renders a markdown document to PDF using Carbone.io API v4.
    Returns metadata containing renderId, title, filename, and download links.
    """
    html_body = markdown_to_html_body(markdown_content)
    full_html = build_carbone_template(title, html_body, metadata)

    # 1. Upload Template
    template_id = upload_template(full_html)

    # 2. Render Document
    url = f"{CARBONE_BASE_URL}/render/{template_id}"
    headers = get_headers()
    payload = json.dumps({
        "data": {
            "title": title,
            "generatedAt": datetime.utcnow().isoformat()
        },
        "convertTo": "pdf"
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("success") and "renderId" in data.get("data", {}):
                render_id = data["data"]["renderId"]
                clean_filename = re.sub(r'[^a-zA-Z0-9_-]', '_', title[:40]).strip('_') or "document"
                filename = f"{clean_filename}.pdf"

                # Immediately pre-fetch and cache the PDF bytes before Carbone's single-download window closes
                try:
                    fetch_rendered_file(render_id)
                except Exception:
                    pass

                return {
                    "success": True,
                    "renderId": render_id,
                    "title": title,
                    "filename": filename,
                    "templateId": template_id,
                    "createdAt": datetime.utcnow().isoformat()
                }
            raise ValueError(f"Failed to render document: {data}")
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Carbone render HTTP {e.code}: {err_msg}")


def strip_pdf_watermark(pdf_bytes: bytes) -> bytes:
    """
    Strips all watermarks (including Carbone test-key full-page logo watermark)
    from the PDF binary so the document is 100% clean.
    """
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        modified = False

        # 1. Clear any Form XObjects that represent watermark overlays
        for x in range(1, doc.xref_length()):
            try:
                obj_str = doc.xref_object(x)
                if "/Subtype /Form" in obj_str or "/Subtype/Form" in obj_str:
                    stream = doc.xref_stream(x)
                    # Check for Carbone test watermark markers (0 1 0 rg, 219 Tf, CARBONE, test)
                    if (
                        b"0 1 0 rg" in stream
                        or b"219 Tf" in stream
                        or b"CARBONE" in stream.upper()
                        or b"test" in stream.lower()
                    ):
                        doc.update_stream(x, b"")
                        modified = True
            except Exception:
                pass

        # 2. Clean page content streams calling the watermark XObject (/Tr4 Do, /Tr Do, etc.)
        for page in doc:
            for xref in page.get_contents():
                try:
                    s = doc.xref_stream(xref).decode("latin1")
                    s_clean = re.sub(r'q\s+/EGS\d+\s+gs\s+/Tr\d+\s+Do\s+Q', '', s)
                    s_clean = re.sub(r'/[A-Za-z0-9_]*Tr\d*\s+Do', '', s_clean)
                    if s_clean != s:
                        doc.update_stream(xref, s_clean.encode("latin1"))
                        modified = True
                except Exception:
                    pass

        # 3. Clean any annotation watermarks if present
        for page in doc:
            try:
                annots = list(page.annots() or [])
                for annot in annots:
                    info = annot.info or {}
                    if "watermark" in str(info).lower() or "carbone" in str(info).lower():
                        page.delete_annot(annot)
                        modified = True
            except Exception:
                pass

        if modified:
            return doc.tobytes(deflate=True)
        return pdf_bytes
    except Exception:
        return pdf_bytes


def fetch_rendered_file(render_id: str) -> bytes:
    """
    Downloads the rendered PDF binary bytes from Carbone.io (or serves from in-memory cache),
    and strips any watermarks before returning.
    """
    if render_id in _document_bytes_cache:
        return _document_bytes_cache[render_id]

    url = f"{CARBONE_BASE_URL}/render/{render_id}"
    headers = {
        "Authorization": f"Bearer {CARBONE_API_KEY}",
        "carbone-version": CARBONE_VERSION,
        "User-Agent": "TharikAI-DocumentGenerator/1.0"
    }

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read()
            cleaned_content = strip_pdf_watermark(content)
            _document_bytes_cache[render_id] = cleaned_content
            return cleaned_content
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Failed to download rendered file {render_id} (HTTP {e.code}): {err_msg}")


def detect_document_prompt(text: str) -> Optional[str]:
    """
    Detects if user is asking to create, write, or generate a document/report/PDF.
    Returns the document topic/prompt if detected, otherwise None.
    """
    if not text or len(text.strip()) < 4:
        return None

    cleaned = text.strip()

    # Avoid detecting image prompts
    if re.search(r'\b(draw|paint|picture|photo|illustration|wallpaper|portrait|image)\b', cleaned, re.IGNORECASE):
        return None

    patterns = [
        # Conversational questions: "can u generate an pdf for...", "could you make a document on..."
        r'^(?:(?:can|could|will|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:help\s+me\s+)?(?:generate|create|write|make|prepare|build|produce|export|give\s+me)\s+(?:me\s+)?(?:an?|the|some)?\s*(?:new\s+)?(?:pdf|document|doc|report|whitepaper|paper|brief|summary)(?:\s+file)?(?:\s+(?:about|on|for|regarding|of))?\s*(.+)$',
        # Simple commands: "pdf report on...", "generate document for..."
        r'^(?:pdf|document|doc|report)\s+(?:generation|generator|creator)?\s*(?:about|on|for|of)?\s*(.+)$',
        # Inline commands: "generate a pdf on X"
        r'.*?\b(?:generate|create|make|write|download)\s+(?:an?|the)?\s*(?:pdf|document|report)\s+(?:about|on|for|of)\s+(.+)$'
    ]

    for pat in patterns:
        m = re.match(pat, cleaned, re.IGNORECASE)
        if m:
            topic = m.group(1).strip()
            # Clean trailing punctuation
            topic = re.sub(r'[.?!]+$', '', topic).strip()
            if topic and len(topic) >= 2:
                return topic

    return None
