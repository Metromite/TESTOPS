import { useState, useRef, useEffect, FormEvent } from "react";
import Spline from "@splinetool/react-spline";
import { useNavigate } from "react-router-dom";
import { chatWithData, executeDataAction } from "../services/operational";

interface PendingAction { tool: string; params: Record<string, any>; }
interface Msg { role: "user" | "assistant"; content: string; meta?: string; pendingAction?: PendingAction; actionResult?: string; navigate_to?: string; }

const LOGI_BOT_SCENE = "https://prod.spline.design/ACGnkYrEMTuUnRlk/scene.splinecode";

function SplineLogiBot({ size = 116 }: { size?: number }) {
  const sceneRef = useRef<any>(null);
  const robotRef = useRef<any>(null);
  const basePositionRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
  }, []);

  const handleLoad = (spline: any) => {
    sceneRef.current = spline;
    spline.setBackgroundColor?.("transparent");
    // Zoom the camera into the mascot so LOGI reads as the robot itself,
    // not as a small object sitting inside a separate Spline environment.
    spline.setZoom?.(1.65);

    const robot = spline.findObjectByName?.("Robot");
    if (!robot) return;

    // Strip the authored scene down to the mascot subtree. This keeps the
    // robot's own materials/lights/animations while removing the separate
    // room/environment objects that made it look like a window inside LOGI.
    const robotObjects = new Set<any>();
    const collectRobotTree = (node: any) => {
      if (!node || robotObjects.has(node)) return;
      robotObjects.add(node);
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(collectRobotTree);
    };
    collectRobotTree(robot);

    const isLightLike = (obj: any) => {
      const type = String(obj?.type || obj?.constructor?.name || "").toLowerCase();
      return type.includes("light") || type.includes("camera");
    };

    const belongsToRobot = (obj: any) => {
      if (robotObjects.has(obj)) return true;
      let parent = obj?.parent;
      while (parent) {
        if (parent === robot) return true;
        parent = parent.parent;
      }
      return false;
    };

    for (const obj of spline.getAllObjects?.() || []) {
      if (!belongsToRobot(obj) && !isLightLike(obj)) {
        obj.visible = false;
      }
    }

    robotRef.current = robot;
    basePositionRef.current = {
      x: Number(robot.position?.x || 0),
      y: Number(robot.position?.y || 0),
      z: Number(robot.position?.z || 0),
    };

    // The source scene contains a Follow action on Robot and a Look At action
    // on Eyes. Keep the original Eyes interaction, but lock Robot itself to
    // its authored position so the mascot never becomes a moving mini-scene.
    const lockRobot = () => {
      const current = robotRef.current;
      const base = basePositionRef.current;
      if (current && base) {
        current.position.x = base.x;
        current.position.y = base.y;
        current.position.z = base.z;
      }
      rafRef.current = window.requestAnimationFrame(lockRobot);
    };

    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(lockRobot);
  };

  return (
    <div
      className="logi-bot-scene"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Spline
        scene={LOGI_BOT_SCENE}
        onLoad={handleLoad}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      />
      <span className="logi-bot-engraving" aria-hidden="true">
        <img src="/city-pharmacy-logi-mark.png" alt="" />
      </span>
    </div>
  );
}

interface ChatResponse {
  navigate_to?: string;
  provider_used?: string;
  fallback_used?: boolean;
  elapsed_seconds?: number;
  rag_available?: boolean;
  reply: string;
  pending_action: PendingAction | null;
}

export default function FloatingAiWidget() {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionPassword, setActionPassword] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
      const data = await chatWithData<ChatResponse>(userMsg.content, history);
      setMessages((m) => [...m, { role: "assistant", content: data.reply, pendingAction: data.pending_action || undefined, navigate_to: data.navigate_to }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction(msgIndex: number, action: PendingAction) {
    if (!actionPassword) { setError("Admin password is required to make changes."); return; }
    setError("");
    setLoading(true);
    try {
      const result = await executeDataAction<Record<string, unknown>>(action, actionPassword);
      setActionPassword("");
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
    setActionPassword("");
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
              <SplineLogiBot size={26} />
              LOGI Assistant
            </strong>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <SplineLogiBot size={34} />
                <div style={{ background: "var(--navy3)", padding: "10px 12px", borderRadius: 10, fontSize: 13, maxWidth: "85%" }}>
                  👋 Hi, I'm LOGI. I can look things up for you, and actually do things. Just ask.
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%", display: "flex", gap: 7, alignItems: "flex-end" }}>
                {m.role === "assistant" && <SplineLogiBot size={34} />}
                <div style={{ minWidth: 0 }}>
                  <div className={m.role === "assistant" ? "logi-chat-bubble" : undefined} style={{
                    background: m.role === "user" ? "var(--blue)" : "var(--navy3)",
                    color: m.role === "user" ? "#fff" : "var(--text)",
                    padding: "8px 12px", borderRadius: 10, fontSize: 13, whiteSpace: "pre-wrap",
                  }}>
                    {m.content}
                  </div>
                  {i === messages.length - 1 && m.role === "assistant" && m.navigate_to && (
                    <button className="btn" style={{ marginTop: 6, fontSize: 11, padding: "5px 10px" }} onClick={() => { if (m.navigate_to) navigate(m.navigate_to); }}>Open screen</button>
                  )}

                  {m.pendingAction && (
                    <div className="modal-pop" style={{ marginTop: 6, background: "var(--navy4)", border: "1px solid var(--amber)", borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 700, marginBottom: 4 }}>⚠ CONFIRM ACTION</div>
                      <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 8 }}>
                        {(() => { const p = m.pendingAction.params || {}; const rows = Array.isArray(p.rows) ? p.rows : (p.row ? [p.row] : []); return `${String(p.reason || `LOGI wants to ${p.operation || "change data"}.`)}${rows.length ? ` (${rows.length} record${rows.length === 1 ? "" : "s"})` : ""}`; })()}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, fontFamily: "monospace", overflowWrap: "anywhere" }}>
                        {m.pendingAction.params.table} · {m.pendingAction.params.operation}
                      </div>
                      <label style={{ display:"block", marginBottom:8 }}>
                        <span style={{ display:"block", fontSize:10, color:"var(--amber)", marginBottom:4 }}>Admin password required</span>
                        <input type="password" value={actionPassword} onChange={e=>setActionPassword(e.target.value)} placeholder="Enter admin password" style={{ width:"100%", fontSize:12 }} disabled={loading} />
                      </label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" style={{ fontSize: 12, padding: "5px 12px" }} disabled={loading || !actionPassword} onClick={() => confirmAction(i, m.pendingAction!)}>
                          ✓ Confirm change
                        </button>
                        <button className="btn" style={{ fontSize: 12, padding: "5px 12px", background: "var(--navy3)", color: "var(--muted)" }} onClick={() => cancelAction(i)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {m.actionResult && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{m.actionResult}</div>}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: "flex-start", display: "flex", gap: 7, alignItems: "flex-end" }}>
                <SplineLogiBot size={34} />
                <div className="logi-chat-bubble" style={{ background: "var(--navy3)", padding: "9px 12px", borderRadius: 10, fontSize: 13 }}>
                  <span className="logi-typing-dots"><i></i><i></i><i></i></span>
                </div>
              </div>
            )}
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
              {loading ? "Talking…" : "Send"}
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
        <button
          className={`logi-launcher ${hovering || open ? "is-active" : ""}`}
          onClick={() => setOpen((o) => !o)}
          title=""
          aria-label="LOGI Assistant"
          onMouseMove={(e) => {
            const el = e.currentTarget.querySelector<HTMLDivElement>(".logi-launcher-orb");
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const x = ((e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)) * 5;
            const y = ((e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)) * 5;
            el.style.setProperty("--gaze-x", `${Math.max(-5, Math.min(5, x))}px`);
            el.style.setProperty("--gaze-y", `${Math.max(-5, Math.min(5, y))}px`);
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget.querySelector<HTMLDivElement>(".logi-launcher-orb");
            if (el) { el.style.setProperty("--gaze-x", "0px"); el.style.setProperty("--gaze-y", "0px"); }
          }}
        >
          <span className="logi-launcher-glow" aria-hidden="true" />
          <span className="logi-launcher-orb" aria-hidden="true"><SplineLogiBot size={116} /></span>
        </button>
      </div>
    </div>
  );
}
