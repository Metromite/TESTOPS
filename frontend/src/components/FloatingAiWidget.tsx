import { useState, useRef, useEffect, FormEvent } from "react";
import { api } from "../api/client";

interface PendingAction { tool: string; params: Record<string, any>; }
interface Msg { role: "user" | "assistant"; content: string; meta?: string; pendingAction?: PendingAction; actionResult?: string; }

export default function FloatingAiWidget() {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    setError("");
    const userMsg: Msg = { role: "user", content: input };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const data = await api.post("/ai/chat", { message: userMsg.content, history });
      const metaParts = [`${data.provider_used}${data.fallback_used ? " (fallback)" : ""}`, `${data.elapsed_seconds}s`];
      if (data.rag_available === false) metaParts.push("local data lookup unavailable");
      setMessages((m) => [...m, { role: "assistant", content: data.reply, meta: metaParts.join(" · "), pendingAction: data.pending_action || undefined }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction(msgIndex: number, action: PendingAction) {
    setLoading(true);
    try {
      const result = await api.post("/ai/execute-action", action);
      setMessages((m) => m.map((msg, i) =>
        i === msgIndex ? { ...msg, pendingAction: undefined, actionResult: `✅ Done: ${JSON.stringify(result)}` } : msg
      ));
    } catch (e: any) {
      setMessages((m) => m.map((msg, i) =>
        i === msgIndex ? { ...msg, pendingAction: undefined, actionResult: `❌ Failed: ${e.message}` } : msg
      ));
    } finally {
      setLoading(false);
    }
  }

  function cancelAction(msgIndex: number) {
    setMessages((m) => m.map((msg, i) => (i === msgIndex ? { ...msg, pendingAction: undefined, actionResult: "Cancelled." } : msg)));
  }

  return (
    <div className="floating-ai-widget">
      {open && (
        <div
          className="glass-card modal-pop"
          style={{
            position: "fixed", bottom: 128, right: 24, width: 380, height: 520,
            display: "flex", flexDirection: "column", zIndex: 200, padding: 0, overflow: "hidden",
            boxShadow: "var(--elevation-2)",
          }}
        >
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/logi-active.png" alt="LOGI" width={24} height={24} style={{ borderRadius: 6 }} /> LOGI Assistant
            </strong>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", background: "var(--navy3)",
                  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
                }}>
                  <img src="/logi-idle.png" alt="LOGI" width={32} height={32} />
                </div>
                <div style={{ background: "var(--navy3)", padding: "10px 12px", borderRadius: 10, fontSize: 13, maxWidth: "85%" }}>
                  👋 Hi, I'm LOGI! I can look things up for you, or actually do things -
                  "add driver D200 John Smith", "give driver D103 a vacation next week",
                  "generate the route plan for tomorrow". Just ask.
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
                <div style={{
                  background: m.role === "user" ? "var(--blue)" : "var(--navy3)",
                  color: m.role === "user" ? "#fff" : "var(--text)",
                  padding: "8px 12px", borderRadius: 10, fontSize: 13, whiteSpace: "pre-wrap",
                }}>
                  {m.content}
                </div>
                {m.meta && <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>{m.meta}</div>}

                {m.pendingAction && (
                  <div className="modal-pop" style={{ marginTop: 6, background: "var(--navy4)", border: "1px solid var(--amber)", borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 700, marginBottom: 4 }}>⚠ CONFIRM ACTION</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, fontFamily: "monospace" }}>
                      {m.pendingAction.tool}({JSON.stringify(m.pendingAction.params)})
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn" style={{ fontSize: 12, padding: "5px 12px" }} disabled={loading} onClick={() => confirmAction(i, m.pendingAction!)}>
                        ✓ Confirm
                      </button>
                      <button className="btn" style={{ fontSize: 12, padding: "5px 12px", background: "var(--navy3)", color: "var(--muted)" }} onClick={() => cancelAction(i)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {m.actionResult && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{m.actionResult}</div>}
              </div>
            ))}
            {error && <div className="error-text" style={{ fontSize: 12 }}>{error}</div>}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--glass-border)" }}>
            <input
              style={{ flex: 1, fontSize: 13 }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask LOGI, or tell it what to do..."
              disabled={loading}
              autoFocus
            />
            <button className="btn" type="submit" disabled={loading || !input.trim()} style={{ padding: "8px 14px" }}>
              {loading ? "..." : "Send"}
            </button>
          </form>
        </div>
      )}

      <div
        style={{ position: "fixed", bottom: 20, right: 20, zIndex: 200, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {hovering && !open && (
          <div
            className="glass-card modal-pop"
            style={{
              padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 500,
              boxShadow: "var(--elevation-2)", whiteSpace: "nowrap", maxWidth: 260,
            }}
          >
            Hi, I'm Logi. How can I help you?
          </div>
        )}
        {/*
          ITEM 7 (LOGI mascot):
          - REVERSED states: hover/open now shows logi-idle.png and the
            resting state now shows logi-active.png (previously the exact
            opposite) - same two asset files, swapped which state uses
            which, per "reverse mascot states".
          - Floating animation added for the resting state via the
            .logi-float keyframe below (transform-only, so it composes
            fine with the existing hover scale transform).
          - A "glass glow" ring was tried here and removed per explicit
            feedback - it rendered as a plain white/frosted circle behind
            the mascot rather than reading as a glow, which looked wrong.
            Reverted to just the original radial color glow below - that
            alone is enough.
          - Click still just toggles `open`, which now also drives the
            same hover-state art swap (open counts as the "active" pose),
            with a slower, smoother 0.35s crossfade instead of the
            previous instant src swap / 0.15s scale-only transition.
          - No circular avatar clipping on the mascot art itself (still
            true, as before this change).
          - Sized up (92px -> 128px outer, 84px -> 112px art) for a
            larger, more premium presence.
        */}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            position: "relative", width: 128, height: 128, borderRadius: "50%",
            background: "transparent", border: "none", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          title=""
          aria-label="LOGI Assistant"
        >
          {/* Color glow: sits behind the mascot art, brightens on hover/open. */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute", inset: -6, borderRadius: "50%",
              background: "radial-gradient(circle, var(--blue) 0%, transparent 70%)",
              opacity: hovering || open ? 0.55 : 0,
              filter: "blur(14px)",
              transition: "opacity 0.25s ease",
              pointerEvents: "none",
            }}
          />
          <span
            className={hovering || open ? undefined : "logi-float"}
            style={{
              position: "relative", width: 112, height: 112,
              transform: hovering ? "scale(1.06)" : "scale(1)",
              transition: "transform 0.2s ease",
            }}
          >
            {/* Crossfade between the two art states instead of an instant
                src swap - smoother than a single <img> whose src flips. */}
            <img
              src="/logi-active.png"
              alt="LOGI"
              width={112}
              height={112}
              style={{
                position: "absolute", inset: 0,
                filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.35))",
                opacity: hovering || open ? 0 : 1,
                transition: "opacity 0.35s ease",
              }}
            />
            <img
              src="/logi-idle.png"
              alt="LOGI"
              width={112}
              height={112}
              style={{
                position: "absolute", inset: 0,
                filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.35))",
                opacity: hovering || open ? 1 : 0,
                transition: "opacity 0.35s ease",
              }}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
