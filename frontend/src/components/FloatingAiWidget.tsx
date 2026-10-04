import { useState, useRef, useEffect, FormEvent } from "react";
import Spline from "@splinetool/react-spline";
import { useNavigate } from "react-router-dom";
import { chatWithData, executeDataAction } from "../services/operational";

interface PendingAction { tool: string; params: Record<string, any>; }
interface Msg { role: "user" | "assistant"; content: string; meta?: string; pendingAction?: PendingAction; actionResult?: string; navigate_to?: string; }

const LOGI_BOT_SCENE = "/scene-clean.splinecode";
const LOGI_CHAT_SCENE = "/scene-clean-6.splinecode";

function SplineLogiBot({ size = 250, headOnly = false, onReady }: { size?: number; headOnly?: boolean; onReady?: () => void }) {
  const [sceneReady, setSceneReady] = useState(false);
  const rafRef = useRef<number | null>(null);
  const splineRef = useRef<any>(null);
  const robotRef = useRef<any>(null);
  const eyesRef = useRef<any>(null);
  const bodyRef = useRef<any>(null);
  const baseRobotPosition = useRef<{ x: number; y: number; z: number } | null>(null);
  const baseRobotRotation = useRef<{ x: number; y: number; z: number } | null>(null);
  const baseRobotScale = useRef<{ x: number; y: number; z: number } | null>(null);
  const baseEyesRotation = useRef<{ x: number; y: number; z: number } | null>(null);
  const targetGaze = useRef({ x: 0, y: 0 });
  const currentGaze = useRef({ x: 0, y: 0 });
  const animationLoopRef = useRef<number | null>(null);

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

      // HARD BODY LOCK: the supplied scene's Follow/physics can rotate the Robot
      // onto its back. Keep the mascot upright at all times and never let the
      // cursor drive the body. The authored facing direction (Y/Z) is preserved;
      // X is explicitly neutralized so head stays above feet.
      if (robot && base) {
        robot.position.x = base.x;
        robot.position.y = base.y + (headOnly ? -18 : 0);
        robot.position.z = base.z;
        if (robot.rotation) {
          robot.rotation.x = 0;
          robot.rotation.y = baseRobotRot?.y ?? 0;
          // The supplied scene is authored upside-down in the viewer coordinate frame.
          // A 180° roll around Z puts the head above the feet while preserving the face toward the screen.
          robot.rotation.z = (baseRobotRot?.z ?? 0) + Math.PI;
        }
        if (baseRobotScl && robot.scale) {
          const scaleMultiplier = headOnly ? 2.15 : 1.55;
          robot.scale.x = baseRobotScl.x * scaleMultiplier;
          robot.scale.y = baseRobotScl.y * scaleMultiplier;
          robot.scale.z = baseRobotScl.z * scaleMultiplier;
        }
      }

      const body = bodyRef.current;
      if (body && body.rotation) {
        body.rotation.x = 0;
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
      if (animationLoopRef.current !== null) window.clearInterval(animationLoopRef.current);
    };
  }, []);

  const handleLoad = (spline: any) => {
    splineRef.current = spline;
    spline.setBackgroundColor?.("transparent");

    const robot = spline.findObjectByName?.("Robot");
    const eyes = spline.findObjectByName?.("Eyes");
    const body = spline.findObjectByName?.("Body");
    robotRef.current = robot || null;
    eyesRef.current = eyes || null;
    bodyRef.current = body || null;

    // Chat avatars use only Logi's head. Hide the authored Body plus any
    // remaining meshes that still use the body material; this removes the one
    // white body fragment that can otherwise survive beside the head.
    if (headOnly) {
      if (body) body.visible = false;
      const root = (spline as any).scene || (spline as any)._scene;
      const hideBodyMaterials = (node: any) => {
        if (!node) return;
        const materialName = String(node.material?.name || node.materialName || "").toLowerCase();
        const objectName = String(node.name || "").toLowerCase();
        if (objectName === "body" || materialName.includes("body material")) node.visible = false;
        const children = Array.isArray(node.children) ? node.children : [];
        children.forEach(hideBodyMaterials);
      };
      hideBodyMaterials(root);
    }

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
      "MouseEventTarget", "mouse event target", "Cursor Target", "cursor",
      "Target Head", "Target Movement", "Target Px", "target", "Follow", "LookAt",
    ].forEach((name) => {
      const object = spline.findObjectByName?.(name);
      if (object) object.visible = false;
    });

    // The exported scene may carry a physics body on Robot. Disable the common
    // runtime physics flags when the exporter exposes them; this prevents gravity
    // from taking over while leaving the authored visual animation intact.
    [
      robot,
      body,
      spline.findObjectByName?.("rigidBody"),
      spline.findObjectByName?.("fusedBody"),
    ].forEach((object: any) => {
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

    // Start the authored animation immediately, then replay it periodically so
    // the mascot's color/idle motion never freezes on its final state.
    spline.play?.();
    if (animationLoopRef.current !== null) window.clearInterval(animationLoopRef.current);
    animationLoopRef.current = window.setInterval(() => spline.play?.(), 4200);

    // Never expose the raw first Spline frame. Wait only for two paint frames
    // plus a short settling window; this is faster than before but still keeps
    // the authored floor/face-down frame completely hidden.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          setSceneReady(true);
          onReady?.();
        }, 24);
      });
    });
  };

  return (
    <div
      className={`logi-bot-scene ${headOnly ? "logi-bot-head-scene" : ""}`}
      style={{ width: size, height: size, visibility: sceneReady ? "visible" : "hidden", opacity: sceneReady ? 1 : 0 }}
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


function SplineLogiChatIcon({ size = 62 }: { size?: number }) {
  const [sceneReady, setSceneReady] = useState(false);
  const animationLoopRef = useRef<number | null>(null);

  const handleLoad = (spline: any) => {
    spline.setBackgroundColor?.("transparent");

    // Keep the imported icon scene clean: transparent background, no floor,
    // helper targets, messages, or Spline branding. The scene itself remains
    // a real animated 3D object.
    [
      "Floor", "floor", "Message", "Message 2", "Message 3",
      "SplineWatermark", "SplineWatermarkD", "logo", "mouseEventTarget",
      "MouseEventTarget", "mouse event target", "Cursor Target", "cursor",
      "Target Head", "Target Movement", "Target Px", "target", "Follow", "LookAt",
    ].forEach((name) => {
      const object = spline.findObjectByName?.(name);
      if (object) object.visible = false;
    });

    spline.play?.();
    if (animationLoopRef.current !== null) window.clearInterval(animationLoopRef.current);
    animationLoopRef.current = window.setInterval(() => spline.play?.(), 4200);

    // Reveal only after the same two paint frames used for the outer mascot,
    // so the chat icon never exposes the raw first Spline frame.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => setSceneReady(true), 24);
      });
    });
  };

  useEffect(() => () => {
    if (animationLoopRef.current !== null) window.clearInterval(animationLoopRef.current);
  }, []);

  return (
    <div
      className="logi-chat-3d-icon"
      style={{ width: size, height: size, visibility: sceneReady ? "visible" : "hidden", opacity: sceneReady ? 1 : 0 }}
      aria-hidden="true"
    >
      <Spline
        scene={LOGI_CHAT_SCENE}
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
  const launcherHitRef = useRef<HTMLSpanElement>(null);
  const [launcherReady, setLauncherReady] = useState(false);

  // Hover is driven by the clipped hit target itself, not the transparent
  // 210px Spline canvas. This keeps the chat button and other UI clickable.
  const handleLauncherEnter = () => setHovering(true);
  const handleLauncherLeave = () => setHovering(false);

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
            position: "fixed", bottom: 154, right: 6, width: 380, height: 520,
            display: "flex", flexDirection: "column", zIndex: 1500, padding: 0, overflow: "hidden",
            boxShadow: "var(--elevation-2)",
          }}
        >
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
              LOGI Assistant
            </strong>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <SplineLogiChatIcon size={62} />
                <div style={{ background: "var(--navy3)", padding: "10px 12px", borderRadius: 10, fontSize: 13, maxWidth: "85%" }}>
                  👋 Hi, I'm LOGI. I can look things up for you, and actually do things. Just ask.
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%", display: "flex", gap: 7, alignItems: "flex-end" }}>
                {m.role === "assistant" && <SplineLogiChatIcon size={62} />}
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
                <SplineLogiChatIcon size={62} />
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
        className={`logi-launcher ${launcherReady ? "is-ready" : ""} ${hovering || open ? "is-active" : ""}`}
        style={{ position: "fixed", bottom: 20, right: -18, zIndex: 1400 }}
      >
        {hovering && !open && (
          <div
            className="glass-card modal-pop logi-hover-tip"
          >
            Hi, I'm Logi. How can I help you?
          </div>
        )}
        <span className="logi-launcher-glow" aria-hidden="true" />
        <span className="logi-launcher-orb" aria-hidden="true">
          <SplineLogiBot size={210} onReady={() => setLauncherReady(true)} />
        </span>
        <span
          ref={launcherHitRef}
          className="logi-click-target"
          role="button"
          tabIndex={0}
          aria-label="LOGI Assistant"
          onPointerEnter={handleLauncherEnter}
          onPointerLeave={handleLauncherLeave}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        />
        <span className={`logi-bot-engraving ${launcherReady ? "is-ready" : ""}`} aria-hidden="true"><img src="/logi-company-engraving.png" alt="" /></span>
      </div>
    </div>
  );
}
