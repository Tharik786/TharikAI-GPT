import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

# Robustly load .env and sys.path from backend directory regardless of working directory
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

load_dotenv(backend_dir / ".env")
load_dotenv()


import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.gemini_client import stream_chat_completion, GeminiError
from app.db import (
    init_db,
    get_db_connection,
    get_user,
    save_user,
    list_conversations,
    save_conversation,
    set_messages as db_set_messages,
    delete_conversation as db_delete_conversation,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize cloud PostgreSQL tables on startup
    init_db()
    yield


app = FastAPI(title="TharikAI API", lifespan=lifespan)

cors_env = os.getenv("CORS_ORIGINS", "*").strip()
if cors_env == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    origins = [o.strip() for o in cors_env.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatBody(BaseModel):
    messages: list[ChatMessage]


class RegisterBody(BaseModel):
    email: str
    name: str | None = None
    password_hash: str


class LoginBody(BaseModel):
    email: str
    password_hash: str


class ConversationBody(BaseModel):
    id: str
    email: str
    title: str = "New chat"
    createdAt: int
    updatedAt: int


class MessagesBody(BaseModel):
    id: str
    messages: list[dict]
    updatedAt: int


@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {"status": "ok", "message": "TharikAI API is running", "docs": "/docs"}


@app.api_route("/api/health", methods=["GET", "HEAD"])
async def health():

    db_status = "disconnected"
    try:
        con = get_db_connection()
        con.run("SELECT 1")
        con.close()
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"

    return {
        "status": "ok" if db_status == "connected" else "degraded",
        "database": db_status,
    }


@app.post("/api/auth/register")
async def register(body: RegisterBody):
    email = body.email.strip().lower()
    existing = get_user(email)
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    user = save_user(email, body.name or email.split("@")[0], body.password_hash)
    return {"success": True, "user": {"email": user["email"], "name": user["name"]}}


@app.post("/api/auth/login")
async def login(body: LoginBody):
    email = body.email.strip().lower()
    user = get_user(email)
    if not user or user.get("password_hash") != body.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    return {"success": True, "user": {"email": user["email"], "name": user["name"]}}


@app.get("/api/conversations")
async def get_user_conversations(email: str):
    email = email.strip().lower()
    convs = list_conversations(email)
    return {"conversations": convs}


@app.post("/api/conversations")
async def create_or_update_conversation(body: ConversationBody):
    save_conversation(body.id, body.email, body.title, body.createdAt, body.updatedAt)
    return {"success": True}


@app.post("/api/conversations/messages")
async def update_conversation_messages(body: MessagesBody):
    db_set_messages(body.id, body.messages, body.updatedAt)
    return {"success": True}


@app.delete("/api/conversations/{conv_id}")
async def remove_conversation(conv_id: str):
    db_delete_conversation(conv_id)
    return {"success": True}


@app.post("/api/extract-document")
async def extract_document(file: UploadFile = File(...)):
    """
    Extracts clean readable text from uploaded documents (PDF, DOCX, TXT, MD, CSV, code).
    Prevents binary byte corruption and enables AI models to read and analyze files.
    """
    filename = file.filename or "uploaded_file"
    ext = filename.lower().split(".")[-1] if "." in filename else ""
    content = await file.read()
    
    extracted_text = ""
    page_count = 1

    if ext == "pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content))
            page_count = len(reader.pages)
            pages_text = []
            for idx, page in enumerate(reader.pages):
                txt = page.extract_text() or ""
                if txt.strip():
                    pages_text.append(f"--- Page {idx + 1} ---\n{txt.strip()}")
            extracted_text = "\n\n".join(pages_text).strip()
            if not extracted_text:
                extracted_text = "[Notice: This PDF contains no extractable text. It may contain scanned images or protected content.]"
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read PDF: {str(e)}")

    elif ext in ("docx", "doc"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            for table in doc.tables:
                for row in table.rows:
                    row_text = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
                    if row_text:
                        paragraphs.append(row_text)
            extracted_text = "\n\n".join(paragraphs).strip()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read Word document: {str(e)}")

    else:
        # Plain text, Markdown, CSV, JSON, code files
        try:
            extracted_text = content.decode("utf-8")
        except UnicodeDecodeError:
            extracted_text = content.decode("latin-1", errors="ignore")

    return {
        "success": True,
        "filename": filename,
        "page_count": page_count,
        "size": len(content),
        "text": extracted_text,
    }


@app.post("/api/chat")
async def chat(body: ChatBody):
    """
    Fully stateless: the client sends the whole conversation (all prior
    messages) on every request, and this endpoint streams back the next
    assistant reply. Nothing is stored on the server -- the browser is
    the only place history lives (see frontend/src/storage.js).
    """
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    llm_messages = [{"role": m.role, "content": m.content} for m in body.messages]

    async def event_stream():
        try:
            async for chunk in stream_chat_completion(llm_messages):
                yield f"data: {json.dumps({'delta': chunk})}\n\n"
        except GeminiError as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            return
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
