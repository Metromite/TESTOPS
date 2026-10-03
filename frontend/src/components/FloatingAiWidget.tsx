import { useState, useRef, useEffect, FormEvent } from "react";
import Spline from "@splinetool/react-spline";
import { useNavigate } from "react-router-dom";
import { chatWithData, executeDataAction } from "../services/operational";

interface PendingAction { tool: string; params: Record<string, any>; }
interface Msg { role: "user" | "assistant"; content: string; meta?: string; pendingAction?: PendingAction; actionResult?: string; navigate_to?: string; }

const LOGI_BOT_SCENE = "/scene-clean.splinecode";

function SplineLogiBot({ size = 190 }: { size?: number }) {
  const rafRef = useRef<number | null>(null);
  const splineRef = useRef<any>(null);
  const robotRef = useRef<any>(null);
  const eyesRef = useRef<any>(null);
  const baseRobotPosition = useRef<{ x: number; y: number; z: number } | null>(null);
  const baseRobotRotation = useRef<{ x: number; y: number; z: number } | null>(null);
  const baseRobotScale = useRef<{ x: number; y: number; z: number } | null>(null);
  const baseEyesRotation = useRef<{ x: number; y: number; z: number } | null>(null);
  const targetGaze = useRef({ x: 0, y: 0 });
  const currentGaze = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      // LOGI follows the pointer across the whole website, not just inside its canvas.
      const nx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      targetGaze.current.x = Math.max(-1, Math.min(1, nx));
      targetGaze.current.y = Math.max(-1, Math.min(1, ny));
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const tick = () => {
      const robot = robotRef.current;
      const eyes = eyesRef.current;
      const base = baseRobotPosition.current;
      const baseRobotRot = baseRobotRotation.current;
      const baseRobotScl = baseRobotScale.current;
      const baseRotation = baseEyesRotation.current;

      // The Robot body must never follow the cursor. The authored Follow event in
      // the supplied scene is neutralized here by restoring its original position
      // every frame. This leaves the mascot planted in one place.
      if (robot && base) {
        robot.position.x = base.x;
        robot.position.y = base.y;
        robot.position.z = base.z;
        // The authored scene contains a Follow/physics setup on Robot. Lock the
        // complete mascot transform so the body can never tip, fall, or follow.
        if (baseRobotRot && robot.rotation) {
          robot.rotation.x = baseRobotRot.x;
          robot.rotation.y = baseRobotRot.y;
          robot.rotation.z = baseRobotRot.z;
        }
        if (baseRobotScl && robot.scale) {
          robot.scale.x = baseRobotScl.x;
          robot.scale.y = baseRobotScl.y;
          robot.scale.z = baseRobotScl.z;
        }
      }

      if (eyes && baseRotation) {
        currentGaze.current.x += (targetGaze.current.x - currentGaze.current.x) * 0.075;
        currentGaze.current.y += (targetGaze.current.y - currentGaze.current.y) * 0.075;

        // Only the face/eyes group rotates. The body remains untouched.
        eyes.rotation.y = baseRotation.y + currentGaze.current.x * 0.30;
        eyes.rotation.x = baseRotation.x - currentGaze.current.y * 0.16;
        eyes.rotation.z = baseRotation.z - currentGaze.current.x * 0.035;
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleLoad = (spline: any) => {
    splineRef.current = spline;
    spline.setBackgroundColor?.("transparent");

    const robot = spline.findObjectByName?.("Robot");
    const eyes = spline.findObjectByName?.("Eyes");
    robotRef.current = robot || null;
    eyesRef.current = eyes || null;

    if (robot?.position) {
      baseRobotPosition.current = {
        x: Number(robot.position.x || 0),
        y: Number(robot.position.y || 0),
        z: Number(robot.position.z || 0),
      };
    }
    if (robot?.rotation) {
      baseRobotRotation.current = {
        x: Number(robot.rotation.x || 0),
        y: Number(robot.rotation.y || 0),
        z: Number(robot.rotation.z || 0),
      };
    }
    if (robot?.scale) {
      baseRobotScale.current = {
        x: Number(robot.scale.x || 1),
        y: Number(robot.scale.y || 1),
        z: Number(robot.scale.z || 1),
      };
    }
    if (eyes?.rotation) {
      baseEyesRotation.current = {
        x: Number(eyes.rotation.x || 0),
        y: Number(eyes.rotation.y || 0),
        z: Number(eyes.rotation.z || 0),
      };
    }

    // Remove everything that is not part of the floating mascot.
    [
      "Floor", "floor", "Message", "Message 2", "Message 3",
      "SplineWatermark", "SplineWatermarkD", "logo", "mouseEventTarget",
      "MouseEventTarget", "mouse event target",
    ].forEach((name) => {
      const object = spline.findObjectByName?.(name);
      if (object) object.visible = false;
    });

    // The exported scene may carry a physics body on Robot. Disable the common
    // runtime physics flags when the exporter exposes them; this prevents gravity
    // from taking over while leaving the authored visual animation intact.
    [robot, spline.findObjectByName?.("Body")].forEach((object: any) => {
      if (!object) return;
      if ("usePhysics" in object) object.usePhysics = false;
      if ("physicsEnabled" in object) object.physicsEnabled = false;
      if ("gravityScale" in object) object.gravityScale = 0;
      if (object.physics) {
        if ("enabled" in object.physics) object.physics.enabled = false;
        if ("usePhysics" in object.physics) object.physics.usePhysics = false;
        if ("gravityScale" in object.physics) object.physics.gravityScale = 0;
      }
    });

    // Keep the authored idle/loop animation running; do not restart it from the
    // pointer loop, which can otherwise interrupt animation cycles.
    spline.play?.();
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
          <span className="logi-launcher-orb" aria-hidden="true"><SplineLogiBot size={190} /></span>
        </button>
      </div>
    </div>
  );
}
