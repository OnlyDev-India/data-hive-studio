import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/shared/lib/utils";

/** The single left-edge panel slot shared by the database sidebar and the
 *  Activity feed. Children stay mounted even while closed (width 0) rather
 *  than unmounting via AnimatePresence — TablesBrowser's whole catalog tree
 *  (fetched schemas/objects, expanded nodes) used to get thrown away and
 *  refetched from scratch every time the panel closed and reopened. */
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
    <motion.div
      animate={{ width: open ? width : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "bg-background relative flex shrink-0 overflow-hidden",
        open && "border-r",
      )}
      style={{ pointerEvents: open ? "auto" : "none" }}
      aria-hidden={!open}
    >
      {children}
    </motion.div>
  );
}
