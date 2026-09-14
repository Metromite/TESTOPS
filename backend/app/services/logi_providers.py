"""
services/logi_providers.py
-----------------------------
DIRECT PORT of V1's logi_providers.py. Every provider call, every error
classification (retryable vs not), the Cloudflare bot-fingerprint
workaround for Groq, and the "any failure triggers fallback if one is
configured" behavior are unchanged. This file has zero dependency on how
the app stores its data, so nothing needed to change for the Postgres
migration - it's the same abstraction V1 used, verbatim.
"""
import time
import json
import logging

try:
    import requests
except ImportError:
    requests = None

DEFAULT_TIMEOUT = 30
OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434"
OLLAMA_DEFAULT_MODEL = "qwen2.5:3b"

log = logging.getLogger("logi_providers")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [logi_providers] %(levelname)s %(message)s", "%H:%M:%S"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)

_CF_SAFE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

PROVIDER_REGISTRY = {
    "groq":       {"label": "Groq",       "needs_key": True,  "default_model": "llama-3.1-8b-instant"},
    "ollama":     {"label": "Ollama",     "needs_key": False, "default_model": OLLAMA_DEFAULT_MODEL},
    "gemini":     {"label": "Gemini",     "needs_key": True,  "default_model": "gemini-2.0-flash"},
    "openai":     {"label": "OpenAI",     "needs_key": True,  "default_model": "gpt-4o-mini"},
    "claude":     {"label": "Claude",     "needs_key": True,  "default_model": "claude-sonnet-4-6"},
    "openrouter": {"label": "OpenRouter", "needs_key": True,  "default_model": "openai/gpt-4o-mini"},
}


class ProviderError(Exception):
    def __init__(self, message, provider=None, retryable=True, status_code=None, model=None, endpoint=None):
        super().__init__(message)
        self.provider = provider
        self.retryable = retryable
        self.status_code = status_code
        self.model = model
        self.endpoint = endpoint

    def debug_str(self):
        parts = [f"provider={self.provider}"]
        if self.status_code is not None:
            parts.append(f"http_status={self.status_code}")
        if self.model:
            parts.append(f"model={self.model}")
        if self.endpoint:
            parts.append(f"endpoint={self.endpoint}")
        return f"{self} ({', '.join(parts)})"


def list_providers():
    return list(PROVIDER_REGISTRY.keys())


def is_ollama_running(endpoint=OLLAMA_DEFAULT_ENDPOINT, timeout=2):
    try:
        r = requests.get(f"{endpoint.rstrip('/')}/api/tags", timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False


def list_ollama_models(endpoint=OLLAMA_DEFAULT_ENDPOINT, timeout=3):
    try:
        r = requests.get(f"{endpoint.rstrip('/')}/api/tags", timeout=timeout)
        r.raise_for_status()
        data = r.json()
        return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def _call_groq(messages, model, api_key, timeout=DEFAULT_TIMEOUT, stream_cb=None, **kw):
    if not api_key:
        raise ProviderError("No Groq API key configured.", "groq", retryable=False)
    url = "https://api.groq.com/openai/v1/chat/completions"
    used_model = model or PROVIDER_REGISTRY["groq"]["default_model"]
    headers = {**_CF_SAFE_HEADERS, "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    payload = {"model": used_model, "messages": messages, "max_tokens": 700, "temperature": 0.5, "stream": bool(stream_cb)}
    if stream_cb:
        return _stream_openai_style(url, headers, payload, stream_cb, timeout)
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    except requests.exceptions.ConnectionError as e:
        raise ProviderError(f"Could not connect to Groq: {e}", "groq", retryable=True, model=used_model, endpoint=url)
    except requests.exceptions.Timeout:
        raise ProviderError("Groq request timed out.", "groq", retryable=True, model=used_model, endpoint=url)

    if r.status_code == 403 and "1010" in r.text:
        raise ProviderError(
            "Groq request was blocked by Cloudflare (error 1010) before reaching the API. "
            "This is a bot-fingerprint block, not an invalid API key.",
            "groq", retryable=True, status_code=403, model=used_model, endpoint=url)
    if r.status_code == 401:
        raise ProviderError("Groq API key is invalid or revoked.", "groq", retryable=False, status_code=401, model=used_model, endpoint=url)
    if r.status_code == 404:
        raise ProviderError(f"Groq model '{used_model}' not found or decommissioned. Pick a different model.",
                             "groq", retryable=False, status_code=404, model=used_model, endpoint=url)
    if r.status_code == 429:
        raise ProviderError("Groq rate limit / quota exceeded.", "groq", retryable=True, status_code=429, model=used_model, endpoint=url)
    if not r.ok:
        raise ProviderError(f"Groq error {r.status_code}: {r.text[:300]}", "groq", retryable=True, status_code=r.status_code, model=used_model, endpoint=url)
    data = r.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


def list_groq_models(api_key, timeout=10):
    fallback = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"]
    if not api_key or requests is None:
        return fallback, None
    url = "https://api.groq.com/openai/v1/models"
    headers = {**_CF_SAFE_HEADERS, "Authorization": f"Bearer {api_key}"}
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        if not r.ok:
            return fallback, f"Groq model list fetch failed: HTTP {r.status_code}"
        data = r.json()
        ids = [m["id"] for m in data.get("data", []) if "id" in m]
        ids = [i for i in ids if "whisper" not in i.lower() and "tts" not in i.lower()]
        return (sorted(ids) if ids else fallback), None
    except Exception as e:
        return fallback, f"Groq model list fetch failed: {e}"


def _call_ollama(messages, model, api_key, timeout=60, stream_cb=None, **kw):
    endpoint = (api_key or OLLAMA_DEFAULT_ENDPOINT).rstrip("/")
    url = f"{endpoint}/api/chat"
    payload = {"model": model or OLLAMA_DEFAULT_MODEL, "messages": messages, "stream": bool(stream_cb)}
    try:
        if stream_cb:
            with requests.post(url, json=payload, timeout=timeout, stream=True) as r:
                if r.status_code == 404:
                    raise ProviderError(f"Model '{model}' not found. Run: ollama pull {model}", "ollama", retryable=False)
                if not r.ok:
                    raise ProviderError(f"Ollama error {r.status_code}", "ollama", retryable=True)
                full = ""
                for line in r.iter_lines():
                    if not line:
                        continue
                    chunk = json.loads(line)
                    piece = chunk.get("message", {}).get("content", "")
                    if piece:
                        full += piece
                        stream_cb(piece)
                    if chunk.get("done"):
                        break
                return full
        r = requests.post(url, json=payload, timeout=timeout)
        if r.status_code == 404:
            raise ProviderError(f"Model '{model}' not found. Run: ollama pull {model}", "ollama", retryable=False)
        if not r.ok:
            raise ProviderError(f"Ollama error {r.status_code}: {r.text[:150]}", "ollama", retryable=True)
        data = r.json()
        return data.get("message", {}).get("content", "")
    except requests.exceptions.ConnectionError:
        raise ProviderError("Ollama is not running. Please start Ollama and try again.", "ollama", retryable=False)
    except requests.exceptions.Timeout:
        raise ProviderError("Ollama timed out.", "ollama", retryable=True)


def _call_gemini(messages, model, api_key, timeout=DEFAULT_TIMEOUT, stream_cb=None, **kw):
    if not api_key:
        raise ProviderError("No Gemini API key configured.", "gemini", retryable=False)
    model = model or PROVIDER_REGISTRY["gemini"]["default_model"]
    sys_text = next((m["content"] for m in messages if m["role"] == "system"), "")
    user_text = "\n".join(m["content"] for m in messages if m["role"] != "system")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {"contents": [{"parts": [{"text": f"{sys_text}\nUser: {user_text}"}]}],
               "generationConfig": {"maxOutputTokens": 700, "temperature": 0.7}}
    r = requests.post(url, json=payload, timeout=timeout)
    if not r.ok:
        raise ProviderError(f"Gemini error {r.status_code}: {r.text[:200]}", "gemini", retryable=True)
    data = r.json()
    if "error" in data:
        raise ProviderError(data["error"].get("message", "Gemini error"), "gemini", retryable=True)
    cands = data.get("candidates", [])
    if cands and cands[0].get("content"):
        return cands[0]["content"]["parts"][0].get("text", "")
    return ""


def _call_openai(messages, model, api_key, timeout=DEFAULT_TIMEOUT, stream_cb=None, **kw):
    if not api_key:
        raise ProviderError("No OpenAI API key configured.", "openai", retryable=False)
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    payload = {"model": model or PROVIDER_REGISTRY["openai"]["default_model"], "messages": messages,
               "max_tokens": 700, "stream": bool(stream_cb)}
    if stream_cb:
        return _stream_openai_style(url, headers, payload, stream_cb, timeout)
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    if not r.ok:
        raise ProviderError(f"OpenAI error {r.status_code}: {r.text[:200]}", "openai", retryable=True)
    data = r.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


def _call_claude(messages, model, api_key, timeout=DEFAULT_TIMEOUT, stream_cb=None, **kw):
    if not api_key:
        raise ProviderError("No Claude API key configured.", "claude", retryable=False)
    sys_text = next((m["content"] for m in messages if m["role"] == "system"), "")
    chat_msgs = [m for m in messages if m["role"] != "system"]
    url = "https://api.anthropic.com/v1/messages"
    headers = {"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"}
    payload = {"model": model or PROVIDER_REGISTRY["claude"]["default_model"], "max_tokens": 700,
               "system": sys_text, "messages": chat_msgs}
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    if not r.ok:
        raise ProviderError(f"Claude error {r.status_code}: {r.text[:200]}", "claude", retryable=True)
    data = r.json()
    content = data.get("content", [])
    return content[0].get("text", "") if content else ""


def _call_openrouter(messages, model, api_key, timeout=DEFAULT_TIMEOUT, stream_cb=None, **kw):
    if not api_key:
        raise ProviderError("No OpenRouter API key configured.", "openrouter", retryable=False)
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}", "HTTP-Referer": "http://localhost"}
    payload = {"model": model or PROVIDER_REGISTRY["openrouter"]["default_model"], "messages": messages,
               "max_tokens": 700, "stream": bool(stream_cb)}
    if stream_cb:
        return _stream_openai_style(url, headers, payload, stream_cb, timeout)
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    if not r.ok:
        raise ProviderError(f"OpenRouter error {r.status_code}: {r.text[:200]}", "openrouter", retryable=True)
    data = r.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


def _stream_openai_style(url, headers, payload, stream_cb, timeout):
    full = ""
    with requests.post(url, headers=headers, json=payload, timeout=timeout, stream=True) as r:
        if not r.ok:
            raise ProviderError(f"HTTP {r.status_code}: {r.text[:200]}", retryable=True)
        for line in r.iter_lines():
            if not line:
                continue
            line = line.decode("utf-8", errors="ignore")
            if not line.startswith("data: "):
                continue
            data_str = line[6:]
            if data_str.strip() == "[DONE]":
                break
            try:
                chunk = json.loads(data_str)
                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                if delta:
                    full += delta
                    stream_cb(delta)
            except Exception:
                continue
    return full


_DISPATCH = {
    "groq": _call_groq, "ollama": _call_ollama, "gemini": _call_gemini,
    "openai": _call_openai, "claude": _call_claude, "openrouter": _call_openrouter,
}


def chat(messages, provider, model, api_key, fallback_provider=None,
         fallback_model=None, fallback_key=None, timeout=DEFAULT_TIMEOUT,
         stream_cb=None, on_fallback=None):
    t0 = time.time()
    used_model = model or PROVIDER_REGISTRY.get(provider, {}).get("default_model")
    log.info("REQUEST provider=%s model=%s fallback=%s", provider, used_model, fallback_provider)

    if requests is None:
        err = ProviderError("The 'requests' package is not installed.", provider, retryable=False)
        log.error("FAILED provider=%s reason=%s", provider, err)
        raise err

    fn = _DISPATCH.get(provider)
    if fn is None:
        err = ProviderError(f"Unknown provider: {provider}", provider, retryable=False)
        log.error("FAILED provider=%s reason=%s", provider, err)
        raise err

    try:
        reply = fn(messages, model, api_key, timeout=timeout, stream_cb=stream_cb)
        elapsed = time.time() - t0
        log.info("SUCCESS provider=%s model=%s elapsed=%.2fs fallback_used=False", provider, used_model, elapsed)
        return reply, provider, elapsed
    except ProviderError as e:
        log.warning("FAILED provider=%s model=%s status=%s retryable=%s reason=%s", provider, used_model, e.status_code, e.retryable, e)
        primary_err = e
        if not fallback_provider:
            log.error("NO FALLBACK configured -- raising original error to caller")
            raise
        if not e.retryable:
            log.warning("Error marked non-retryable, but attempting fallback anyway")
    except Exception as e:
        log.warning("UNEXPECTED ERROR provider=%s model=%s error=%s: %s", provider, used_model, type(e).__name__, e)
        primary_err = ProviderError(f"Unexpected {type(e).__name__}: {e}", provider, retryable=True)
        if not fallback_provider:
            log.error("NO FALLBACK configured -- raising original error to caller")
            raise primary_err

    if on_fallback:
        try:
            on_fallback(provider, fallback_provider, str(primary_err))
        except Exception:
            pass

    fb_fn = _DISPATCH.get(fallback_provider)
    if fb_fn is None:
        log.error("FALLBACK provider=%s is not a known provider -- raising original error", fallback_provider)
        raise primary_err

    fb_model = fallback_model or PROVIDER_REGISTRY.get(fallback_provider, {}).get("default_model")
    if fallback_provider == "ollama" and not is_ollama_running(fallback_key or OLLAMA_DEFAULT_ENDPOINT):
        err = ProviderError(
            f"Ollama is not reachable at {fallback_key or OLLAMA_DEFAULT_ENDPOINT}.",
            "ollama", retryable=False, endpoint=fallback_key or OLLAMA_DEFAULT_ENDPOINT)
        log.error("FALLBACK HEALTH CHECK FAILED provider=ollama endpoint=%s", fallback_key or OLLAMA_DEFAULT_ENDPOINT)
        raise err

    log.info("FALLBACK SWITCHING from=%s to=%s model=%s reason=%s", provider, fallback_provider, fb_model, primary_err)
    t1 = time.time()
    try:
        reply = fb_fn(messages, fallback_model, fallback_key, timeout=timeout, stream_cb=stream_cb)
    except ProviderError:
        log.error("FALLBACK ALSO FAILED provider=%s model=%s", fallback_provider, fb_model)
        raise
    except Exception as e2:
        log.error("FALLBACK ALSO FAILED (unexpected) provider=%s model=%s error=%s: %s", fallback_provider, fb_model, type(e2).__name__, e2)
        raise ProviderError(f"Fallback provider {fallback_provider} also failed: {e2}", fallback_provider, retryable=False)
    elapsed = time.time() - t0
    log.info("SUCCESS provider=%s model=%s elapsed=%.2fs fallback_used=True (primary=%s failed in %.2fs)",
              fallback_provider, fb_model, elapsed, provider, t1 - t0)
    return reply, fallback_provider, elapsed
