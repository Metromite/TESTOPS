"""
api/routes/ai.py
-------------------
Wires together logi_rag.py (retrieval) and logi_providers.py (chat) behind
config (Admin-only), chat (any authenticated user), and a manual reindex
trigger.

Retrieval runs inline before every chat call - sync_index() is cheap when
nothing changed (just fingerprint comparisons per V1's own design), so
there's no separate background job needed for this part.

FALLBACK CHAIN: chat() cascades through a full ordered list of fallback
providers (not just one) - if the primary hits a quota/rate limit, it
tries fallback #1, then #2, then #3, etc., stopping at the first one that
succeeds. logi_providers.chat() itself only knows about a single
primary+fallback pair (kept as a faithful port of V1's function), so the
cascade loop lives here, calling it repeatedly.
"""
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user, require_roles
from app.models.user import Role, User
from app.models.ai_config import AIProviderConfig
from app.services import logi_rag, logi_providers as lp, ai_tools

router = APIRouter(prefix="/api/ai", tags=["ai"])

_RAG_PERSIST_DIR = os.path.join(settings.IMPORT_FOLDER, "..", "rag_index")
_DOCS_FOLDER = os.path.join(settings.IMPORT_FOLDER, "..", "docs")
_store = logi_rag.RagStore(_RAG_PERSIST_DIR)


def _get_config(db: Session) -> AIProviderConfig:
    cfg = db.get(AIProviderConfig, 1)
    if not cfg:
        cfg = AIProviderConfig(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _get_fallback_chain(cfg: AIProviderConfig) -> list[dict]:
    """Returns the ordered fallback chain. Falls back to the single
    legacy fallback_provider/model/key fields if no chain has been set,
    so existing configs from before this feature keep working unchanged."""
    if not cfg.fallback_enabled:
        return []
    try:
        chain = json.loads(cfg.fallback_chain_json or "[]")
        if chain:
            return chain
    except (json.JSONDecodeError, TypeError):
        pass
    if cfg.fallback_provider:
        return [{"provider": cfg.fallback_provider, "model": cfg.fallback_model, "api_key": cfg.fallback_key}]
    return []


@router.get("/providers", dependencies=[Depends(get_current_user)])
def providers():
    """List available providers - safe for any authenticated user to see (no keys exposed)."""
    return {"providers": [{"key": k, **v} for k, v in lp.PROVIDER_REGISTRY.items()]}


@router.get("/config", dependencies=[Depends(require_roles(Role.ADMIN))])
def get_config(db: Session = Depends(get_db)):
    cfg = _get_config(db)
    chain = _get_fallback_chain(cfg)
    return {
        "provider": cfg.provider, "model": cfg.model,
        "api_key_set": bool(cfg.api_key),  # never return the actual key to the browser
        "fallback_enabled": cfg.fallback_enabled,
        "fallback_chain": [{"provider": c["provider"], "model": c.get("model", ""), "api_key_set": bool(c.get("api_key"))} for c in chain],
    }


class FallbackEntry(BaseModel):
    provider: str
    model: str = ""
    api_key: str = ""  # blank means "leave unchanged" for an existing chain entry at this position


class ConfigUpdate(BaseModel):
    provider: str
    model: str = ""
    api_key: str = ""  # blank means "leave unchanged" if api_key_set was already true
    fallback_enabled: bool = False
    fallback_chain: list[FallbackEntry] = []


@router.put("/config", dependencies=[Depends(require_roles(Role.ADMIN))])
def update_config(payload: ConfigUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = _get_config(db)
    cfg.provider = payload.provider
    cfg.model = payload.model
    if payload.api_key:  # only overwrite if a new one was actually typed
        cfg.api_key = payload.api_key
    cfg.fallback_enabled = payload.fallback_enabled

    if payload.fallback_chain:
        # Preserve existing keys for entries where a blank key means "keep as-is".
        existing_chain = []
        try:
            existing_chain = json.loads(cfg.fallback_chain_json or "[]")
        except (json.JSONDecodeError, TypeError):
            pass
        new_chain = []
        for i, entry in enumerate(payload.fallback_chain):
            api_key = entry.api_key
            if not api_key and i < len(existing_chain) and existing_chain[i].get("provider") == entry.provider:
                api_key = existing_chain[i].get("api_key", "")
            new_chain.append({"provider": entry.provider, "model": entry.model, "api_key": api_key})
        cfg.fallback_chain_json = json.dumps(new_chain)
        if new_chain:  # keep legacy fields in sync with entry #1, for older code paths
            cfg.fallback_provider = new_chain[0]["provider"]
            cfg.fallback_model = new_chain[0]["model"]
            cfg.fallback_key = new_chain[0]["api_key"]

    cfg.updated_by = user.username
    db.commit()
    return {"ok": True}


@router.get("/ollama/models", dependencies=[Depends(require_roles(Role.ADMIN))])
def ollama_models(endpoint: str = lp.OLLAMA_DEFAULT_ENDPOINT):
    return {"running": lp.is_ollama_running(endpoint), "models": lp.list_ollama_models(endpoint)}


@router.get("/groq/models", dependencies=[Depends(require_roles(Role.ADMIN))])
def groq_models(db: Session = Depends(get_db)):
    cfg = _get_config(db)
    models, error = lp.list_groq_models(cfg.api_key)
    return {"models": models, "error": error}


@router.post("/reindex", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def reindex(db: Session = Depends(get_db)):
    timings = {}
    result = logi_rag.sync_index(_store, db, docs_folder=_DOCS_FOLDER, timings=timings)
    available = _store.available()
    return {
        **result, "timings": timings, "rag_available": available,
        # additive field, item 6: lets Admins see *why* it's unavailable
        # (missing package vs. installed-but-failed-to-init) straight from
        # the Reindex button instead of only from a failed chat attempt.
        "rag_unavailable_reason": None if available else _store.unavailable_reason(),
    }


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []  # [{"role": "user"|"assistant", "content": "..."}]


def _build_system_prompt() -> str:
    return (
        "You are LOGI, the AI assistant inside Dispatch OPS, a logistics dispatch "
        "management application. Answer using only the context provided below - if the "
        "context doesn't contain the answer, say so rather than guessing. Be concise.\n\n"
        "You can also PERFORM ACTIONS in the app when the user asks you to (add/edit/remove "
        "a driver, helper, vehicle, or area; add a vacation; generate a route plan). "
        "Available actions:\n" + ai_tools.describe_tools_for_prompt() + "\n\n"
        "When the user's message is a request to DO one of these actions (not just a question), "
        "respond with ONLY a single JSON object in this exact shape, and nothing else - no "
        "other text before or after it:\n"
        '{"action": {"tool": "<tool_name>", "params": {...}}, "summary": "<one short sentence '
        'describing what you are about to do, for the user to confirm>"}\n\n'
        "If the user is just asking a question (not requesting an action), answer normally in "
        "plain conversational text - do not output JSON for questions."
    )


def _try_parse_action(reply: str) -> dict | None:
    text = reply.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    if not (text.startswith("{") and text.endswith("}")):
        return None
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
    if isinstance(data, dict) and "action" in data and isinstance(data["action"], dict) and "tool" in data["action"]:
        return data
    return None


@router.post("/chat", dependencies=[Depends(get_current_user)])
def chat(payload: ChatRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = _get_config(db)
    if not cfg.provider or (lp.PROVIDER_REGISTRY.get(cfg.provider, {}).get("needs_key") and not cfg.api_key):
        raise HTTPException(status_code=400, detail="AI assistant isn't configured yet - an Admin needs to set a provider and API key in AI Settings.")

    # BUGFIX (issue: "AI assistant's local search index isn't available -
    # chromadb and sentence-transformers may not be installed" shown on
    # EVERY chat message, with no way to talk to the assistant at all):
    # this used to `raise HTTPException(503, ...)` right here whenever
    # `_store.available()` was False, before ever calling the configured
    # LLM provider - so a missing/broken local semantic-search index took
    # down the entire assistant, not just the "search my data" part of it.
    # Semantic search (RagStore/chromadb/sentence-transformers) and
    # chatting with the configured LLM provider (logi_providers.chat) are
    # two independent capabilities; only the first one needs the index.
    # Now: if the index isn't available, `context` simply stays empty (no
    # retrieved driver/route/vehicle/vacation/docs snippets get added to
    # the system prompt) and the assistant still answers using the LLM
    # directly - a real, non-fabricated answer, just without the extra
    # local-data grounding. `rag_available`/`rag_unavailable_reason` are
    # surfaced in the response so the UI can show why answers about
    # specific drivers/routes/etc. might be less precise, without
    # blocking the conversation entirely.
    rag_available = _store.available()
    context, collections_used = "", []
    if rag_available:
        # Keep the index fresh - cheap when nothing's changed (fingerprint check only).
        logi_rag.sync_index(_store, db, docs_folder=_DOCS_FOLDER)
        context, collections_used = logi_rag.build_context_for_question(_store, payload.message)

    system_content = _build_system_prompt()
    if context:
        system_content += f"\n\nRelevant context:\n{context}"
    elif not rag_available:
        # Told to the model, not hidden from it: an honest answer that
        # can't look up a specific driver/route/vehicle right now is
        # better than one that silently guesses.
        system_content += ("\n\nNote: local semantic search over live driver/route/vehicle/vacation "
                            "data is temporarily unavailable, so no retrieved records are included "
                            "below. If the user's question needs a specific record you don't already "
                            "know, say the lookup isn't available right now rather than guessing.")

    messages = [{"role": "system", "content": system_content}]
    messages.extend(payload.history[-10:])  # keep prompts small - last 10 turns only
    messages.append({"role": "user", "content": payload.message})

    # Try the primary, then walk the fallback chain in order - stops at
    # the first success. Each attempt reuses logi_providers.chat()'s
    # single primary+fallback signature by treating "primary" as
    # whichever provider we're currently trying and passing no fallback,
    # so the retry/error-classification logic inside stays untouched.
    chain = [{"provider": cfg.provider, "model": cfg.model, "api_key": cfg.api_key}] + _get_fallback_chain(cfg)
    last_error = None
    for attempt in chain:
        try:
            reply, provider_used, elapsed = lp.chat(
                messages, attempt["provider"], attempt.get("model", ""), attempt.get("api_key", ""),
            )
            parsed_action = _try_parse_action(reply)
            base = {
                "provider_used": provider_used, "elapsed_seconds": round(elapsed, 2),
                "collections_searched": collections_used, "fallback_used": provider_used != cfg.provider,
                "rag_available": rag_available,
                "rag_unavailable_reason": None if rag_available else _store.unavailable_reason(),
            }
            if parsed_action and (user.role.value in ("admin", "dispatcher")):
                # A Viewer can chat, but never gets to propose/confirm a
                # mutating action - matches "Viewer: read-only" everywhere else.
                return {**base, "reply": parsed_action["summary"], "pending_action": parsed_action["action"]}
            if parsed_action:
                return {**base, "reply": parsed_action["summary"] + " (You need Dispatcher or Admin access to confirm actions.)", "pending_action": None}
            return {**base, "reply": reply, "pending_action": None}
        except lp.ProviderError as e:
            last_error = e
            continue

    raise HTTPException(
        status_code=502,
        detail=f"All configured providers failed. Last error: {last_error.debug_str() if last_error else 'unknown'}",
    )


class ExecuteActionRequest(BaseModel):
    tool: str
    params: dict = {}


@router.post("/execute-action", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def execute_action(payload: ExecuteActionRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Runs a tool the AI proposed, only after the person has explicitly
    confirmed it in the UI - this endpoint is never called automatically
    from /chat. Every execution goes through the same audit log as a
    manual Fleet edit, so it shows up in the Audit Log page and can be
    reverted with the same Undo Last Change button.
    """
    result = ai_tools.execute_tool(db, user.username, payload.tool, payload.params)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Action failed"))
    return result
