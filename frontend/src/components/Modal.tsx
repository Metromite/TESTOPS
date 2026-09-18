import { ReactNode } from "react";
import { createPortal } from "react-dom";

export default function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="dispatch-modal-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dispatch-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} />
      <div className="dispatch-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dispatch-modal-head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
