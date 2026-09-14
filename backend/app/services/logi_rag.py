"""
services/logi_rag.py
-----------------------
Port of V1's logi_rag.py. The retrieval mechanics are unchanged: chromadb
PersistentClient for local, on-disk vector storage (no cloud dependency,
matches "no paid cloud services"), incremental reindexing via a cheap
content-signature fingerprint (embeddings only recomputed when the
underlying data actually changed), keyword-based collection routing before
vector search, and top-k-only context (never dumps the whole database into
a prompt).

WHAT CHANGED: V1's chunk builders read from local SQLite tables (drivers,
helpers, vehicles, vacations, active_routes, draft_routes) via
sqlite3/pandas. These now query the same Postgres models the rest of V2
uses (Driver, Helper, Vehicle, Vacation, RouteAssignment) via SQLAlchemy.
V1's separate active_routes/draft_routes tables map onto RouteAssignment
rows filtered by status ("Confirmed" vs "Pending").
"""
import os
import json
import hashlib
import time

from sqlalchemy.orm import Session

try:
    import chromadb
    CHROMADB_OK = True
    CHROMADB_IMPORT_ERROR = None
except Exception as e:
    CHROMADB_OK = False
    CHROMADB_IMPORT_ERROR = str(e)

try:
    from sentence_transformers import SentenceTransformer
    EMBEDDER_OK = True
    EMBEDDER_IMPORT_ERROR = None
except Exception as e:
    EMBEDDER_OK = False
    EMBEDDER_IMPORT_ERROR = str(e)

from app.models.fleet import Driver, Helper, Vehicle, Vacation
from app.models.route_plan import RouteAssignment

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
TOP_K_DEFAULT = 4

COLLECTION_KEYWORDS = {
    "drivers":   ["driver", "delivery person", "code", "assigned"],
    "routes":    ["route", "area", "delivered", "delayed", "delivery", "dispatch"],
    "helpers":   ["helper", "assistant driver"],
    "vehicles":  ["vehicle", "truck", "van", "plate"],
    "vacations": ["vacation", "leave", "off today", "absent", "holiday"],
    "docs":      ["how do i", "how to", "guide", "feature", "documentation", "what is", "explain", "help with"],
}

_embedder_singleton = None
# BUGFIX (Issue 2 - "local search index isn't available" shown even when
# chromadb/sentence-transformers ARE installed): get_embedder() below was
# always correctly implemented, but nothing ever called it. RagStore's
# constructor takes an `embedder=` param that defaults to None and every
# call site (ai.py's module-level `_store = logi_rag.RagStore(...)`)
# constructs it with no embedder argument - so `self.embedder` was
# permanently None for the lifetime of the process, and `available()`
# (`... and self.embedder is not None`) could never return True no matter
# what was installed. Fixed below in `available()`/`_ensure_embedder()` by
# lazily initializing the singleton on first check, exactly like the
# `client` property already does for CHROMADB_OK - this was the actual
# bug, not missing packages.
_embedder_init_error = None  # populated if SentenceTransformer(...) construction itself fails (e.g. model download/network/permission issue) - distinct from "package not installed"


def get_embedder():
    """Loaded once per process, matching V1's @st.cache_resource intent -
    there's no Streamlit here, so a plain module-level singleton does the
    same job in a FastAPI process."""
    global _embedder_singleton, _embedder_init_error
    if _embedder_singleton is None and EMBEDDER_OK and _embedder_init_error is None:
        try:
            _embedder_singleton = SentenceTransformer(EMBEDDING_MODEL_NAME)
        except Exception as e:
            # Package imported fine, but the model itself couldn't be
            # constructed/downloaded/loaded - a genuinely different
            # problem than "not installed". Recorded so callers can show
            # the real reason instead of the generic "may not be
            # installed" message. Not retried every call (would hammer a
            # broken network/disk on every chat message); a process
            # restart (or a future explicit "retry embedder" admin
            # action, if one gets added) is what clears this.
            _embedder_init_error = str(e)
    return _embedder_singleton


class RagStore:
    def __init__(self, persist_dir, embedder=None):
        self.persist_dir = persist_dir
        os.makedirs(persist_dir, exist_ok=True)
        self.embedder = embedder
        self._client = None
        self._client_init_error = None
        self._fingerprint_path = os.path.join(persist_dir, "_fingerprints.json")
        self._fingerprints = self._load_fingerprints()

    @property
    def client(self):
        if self._client is None and CHROMADB_OK and self._client_init_error is None:
            try:
                self._client = chromadb.PersistentClient(path=self.persist_dir)
            except Exception as e:
                # e.g. a permissions problem on persist_dir, or a
                # corrupted existing index directory - genuinely
                # different from "chromadb isn't installed" and worth
                # surfacing as such (see unavailable_reason()).
                self._client_init_error = str(e)
        return self._client

    def _ensure_embedder(self):
        """Lazily resolve the shared embedder singleton if this instance
        wasn't constructed with one - this is the fix for the "always
        unavailable regardless of what's installed" bug described above
        get_embedder(). Cheap to call repeatedly: get_embedder() itself
        is a no-op once the singleton (or its init error) is set."""
        if self.embedder is None:
            self.embedder = get_embedder()

    def available(self):
        self._ensure_embedder()
        _ = self.client  # trigger lazy client init / capture its error too
        return CHROMADB_OK and EMBEDDER_OK and self.embedder is not None and self._client_init_error is None

    def unavailable_reason(self) -> str:
        """Item 6 (Issue 2): distinguishes "genuinely not installed" from
        "installed but failed to initialize" so the 503 the user sees
        actually reflects reality instead of always blaming missing
        packages. Only called when available() is False."""
        self._ensure_embedder()
        _ = self.client
        missing = []
        if not CHROMADB_OK:
            missing.append(f"chromadb ({CHROMADB_IMPORT_ERROR})")
        if not EMBEDDER_OK:
            missing.append(f"sentence-transformers ({EMBEDDER_IMPORT_ERROR})")
        if missing:
            return ("The AI assistant's local search index isn't available - the following "
                     "required package(s) are not installed: " + "; ".join(missing) +
                     ". See requirements.txt.")
        init_errors = []
        if _embedder_init_error:
            init_errors.append(f"embedding model failed to load ({_embedder_init_error})")
        if self._client_init_error:
            init_errors.append(f"chromadb index failed to open at '{self.persist_dir}' ({self._client_init_error})")
        if init_errors:
            return ("The AI assistant's local search index isn't available - chromadb and "
                     "sentence-transformers ARE installed, but initialization failed: " +
                     "; ".join(init_errors))
        return "The AI assistant's local search index isn't available for an unknown reason."

    def _load_fingerprints(self):
        try:
            with open(self._fingerprint_path, "r") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_fingerprints(self):
        try:
            with open(self._fingerprint_path, "w") as f:
                json.dump(self._fingerprints, f)
        except Exception:
            pass

    def _get_collection(self, name):
        return self.client.get_or_create_collection(name)

    def _fingerprint(self, text):
        return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()

    def needs_reindex(self, collection_name, content_signature):
        fp = self._fingerprint(content_signature)
        return self._fingerprints.get(collection_name) != fp

    def mark_indexed(self, collection_name, content_signature):
        self._fingerprints[collection_name] = self._fingerprint(content_signature)
        self._save_fingerprints()

    def index_chunks(self, collection_name, chunks, ids, metadatas=None):
        if not self.available() or not chunks:
            return
        coll = self._get_collection(collection_name)
        try:
            existing = coll.get()
            if existing and existing.get("ids"):
                coll.delete(ids=existing["ids"])
        except Exception:
            pass
        embeddings = self.embedder.encode(chunks, show_progress_bar=False).tolist()
        coll.add(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas or [{} for _ in chunks])

    def route_collections(self, question):
        q = question.lower()
        matched = [name for name, kws in COLLECTION_KEYWORDS.items() if any(kw in q for kw in kws)]
        return matched or list(COLLECTION_KEYWORDS.keys())

    def search(self, question, top_k=TOP_K_DEFAULT, collections=None):
        if not self.available():
            return []
        target_collections = collections or self.route_collections(question)
        q_emb = self.embedder.encode([question], show_progress_bar=False).tolist()
        results = []
        for cname in target_collections:
            try:
                coll = self._get_collection(cname)
                res = coll.query(query_embeddings=q_emb, n_results=top_k)
                docs = (res.get("documents") or [[]])[0]
                dists = (res.get("distances") or [[]])[0]
                for d, dist in zip(docs, dists):
                    results.append((d, cname, dist))
            except Exception:
                continue
        results.sort(key=lambda x: x[2])
        return results[:top_k]


# --- Chunk builders: now querying Postgres via SQLAlchemy instead of SQLite ---

def build_driver_chunks(db: Session):
    rows = db.query(Driver).all()
    sig = f"drivers:{len(rows)}"
    chunks, ids, metas = [], [], []
    for r in rows:
        text = (f"Driver {r.name} (code {r.code}) drives a {r.veh_type or '?'} vehicle, "
                f"anchor area {r.anchor_area or '-'}. Health card: {r.health_card}. Status: {r.status}.")
        chunks.append(text)
        ids.append(f"driver_{r.code}")
        metas.append({"type": "driver", "name": r.name})
    return chunks, ids, metas, sig


def build_route_chunks(db: Session):
    confirmed = db.query(RouteAssignment).filter(RouteAssignment.status == "Confirmed").all()
    pending = db.query(RouteAssignment).filter(RouteAssignment.status == "Pending").all()
    sig = f"routes:{len(confirmed)}|{len(pending)}"
    chunks, ids, metas = [], [], []
    for r in confirmed:
        text = (f"Active route: area {r.area_name} is served by driver {r.driver_name or '?'} "
                f"with helper {r.helper_name or '-'}, vehicle {r.vehicle_number or '-'}, "
                f"from {r.start_date} to {r.end_date}.")
        chunks.append(text)
        ids.append(f"active_route_{r.id}")
        metas.append({"type": "active_route", "area": r.area_name, "driver": r.driver_name or ""})
    for r in pending:
        text = (f"Draft (unconfirmed) route: area {r.area_name} planned for driver {r.driver_name or '?'}, "
                f"helper {r.helper_name or '-'}, vehicle {r.vehicle_number or '-'}.")
        chunks.append(text)
        ids.append(f"draft_route_{r.id}")
        metas.append({"type": "draft_route", "area": r.area_name})
    return chunks, ids, metas, sig


def build_vehicle_chunks(db: Session):
    rows = db.query(Vehicle).all()
    sig = f"vehicles:{len(rows)}"
    chunks, ids, metas = [], [], []
    for r in rows:
        text = f"Vehicle {r.number} is a {r.type} (status: {r.status})."
        chunks.append(text)
        ids.append(f"vehicle_{r.number}")
        metas.append({"type": "vehicle", "num": r.number})
    return chunks, ids, metas, sig


def build_helper_chunks(db: Session):
    rows = db.query(Helper).all()
    sig = f"helpers:{len(rows)}"
    chunks, ids, metas = [], [], []
    for r in rows:
        text = f"Helper {r.name} (code {r.code}), anchor area {r.anchor_area or '-'}. Status: {r.status}."
        chunks.append(text)
        ids.append(f"helper_{r.code}")
        metas.append({"type": "helper", "name": r.name})
    return chunks, ids, metas, sig


def build_vacation_chunks(db: Session):
    rows = db.query(Vacation).all()
    sig = f"vacations:{len(rows)}"
    chunks, ids, metas = [], [], []
    for r in rows:
        text = f"{r.person_name or r.person_code} is on vacation from {r.start_date} to {r.end_date}."
        chunks.append(text)
        ids.append(f"vacation_{r.id}")
        metas.append({"type": "vacation", "name": r.person_name or r.person_code})
    return chunks, ids, metas, sig


def build_docs_chunks(docs_folder):
    """Unchanged from V1 - chunks any .txt/.md user guide files placed in a docs folder."""
    chunks, ids, metas = [], [], []
    sig_parts = []
    if not docs_folder or not os.path.isdir(docs_folder):
        return [], [], [], "docs:0"
    for fname in sorted(os.listdir(docs_folder)):
        if not fname.lower().endswith((".txt", ".md")):
            continue
        fpath = os.path.join(docs_folder, fname)
        try:
            mtime = os.path.getmtime(fpath)
            size = os.path.getsize(fpath)
            sig_parts.append(f"{fname}:{mtime}:{size}")
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
            for j, p in enumerate(paragraphs):
                chunks.append(p)
                ids.append(f"doc_{fname}_{j}")
                metas.append({"type": "doc", "source": fname})
        except Exception:
            continue
    sig = "docs:" + "|".join(sig_parts)
    return chunks, ids, metas, sig


BUILDERS = {
    "drivers":   lambda db, docs_folder: build_driver_chunks(db),
    "routes":    lambda db, docs_folder: build_route_chunks(db),
    "vehicles":  lambda db, docs_folder: build_vehicle_chunks(db),
    "helpers":   lambda db, docs_folder: build_helper_chunks(db),
    "vacations": lambda db, docs_folder: build_vacation_chunks(db),
    "docs":      lambda db, docs_folder: build_docs_chunks(docs_folder),
}


def sync_index(store: RagStore, db: Session, docs_folder=None, timings=None):
    """Re-index only collections whose data changed - cheap to call on
    every chat request for an unchanged app (just fingerprint comparisons)."""
    if not store.available():
        return {"indexed": [], "skipped": list(BUILDERS.keys()), "reason": store.unavailable_reason()}

    t_start = time.time()
    indexed, skipped = [], []
    for name, builder in BUILDERS.items():
        chunks, ids, metas, sig = builder(db, docs_folder)
        if not store.needs_reindex(name, sig):
            skipped.append(name)
            continue
        store.index_chunks(name, chunks, ids, metas)
        store.mark_indexed(name, sig)
        indexed.append(name)
    if timings is not None:
        timings["index_sync_sec"] = time.time() - t_start
    return {"indexed": indexed, "skipped": skipped}


def build_context_for_question(store: RagStore, question: str, top_k=TOP_K_DEFAULT, timings=None):
    t0 = time.time()
    if not store.available():
        if timings is not None:
            timings["search_sec"] = time.time() - t0
        return "", []
    target_collections = store.route_collections(question)
    results = store.search(question, top_k=top_k, collections=target_collections)
    if timings is not None:
        timings["search_sec"] = time.time() - t0
    if not results:
        return "", target_collections
    context = "\n".join(f"- {text}" for text, _coll, _dist in results)
    return context, target_collections
