import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

/** The single left-edge panel slot shared by the database sidebar and the
 *  Activity feed. The SLOT owns the open/close animation; its children swap
 *  instantly — so switching database <-> activity while open never replays
 *  a slide-in (the panel just changes content in place). */
export function LeftPanelSlot({
  open,
  width,
  children,
}: {
  /** Sidebar or activity is showing. */
  open: boolean;
  /** Pixel width while open (activity = 340, sidebar = resizable). */
  width: number;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="left-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="bg-background relative flex shrink-0 overflow-hidden border-r"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
