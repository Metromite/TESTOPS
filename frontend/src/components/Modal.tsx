import { ReactNode } from "react";
import { GlassModal } from "../design-system/GlassModal";

/**
 * Responsive Detail Windows (V2 milestone): dialogs auto-size to their
 * content instead of a fixed box, capped at 92vw so nothing ever overflows
 * the viewport, and only ever scroll vertically. If a table is genuinely
 * wider than 92vw even after auto-sizing, wrap it in `.table-scroll`
 * (already used elsewhere in the app) so ONLY that inner table scrolls
 * horizontally as a last resort, never the dialog chrome around it.
 *
 * PHASE 7-9 NOTE: same props/behavior as before (every call site - Modal
 * is used by AvailabilityWidget, DetailWindow, Imports, leadTimeWidgets -
 * is unchanged), now built on the design system's GlassModal (Radix
 * Dialog) instead of a hand-rolled overlay div. Free upgrade for all of
 * them: proper focus trap, and ESC now closes it too (backdrop-click-to-
 * close already worked before and still does).
 */
export default function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <GlassModal open onOpenChange={(next) => { if (!next) onClose(); }} title={title} size="content">
      {children}
    </GlassModal>
  );
}
