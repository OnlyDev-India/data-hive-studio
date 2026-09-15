import type { ReactNode, RefObject } from "react";
import { motion, type Transition } from "motion/react";
import { cn } from "@/shared/lib/utils";

const defaultTransition: Transition = { duration: 0.18, ease: "easeOut" };

/** A resizable panel docked to the left or right edge of the workspace —
 *  shared by the database sidebar/Activity feed (left) and the JSON viewer
 *  (right). Children stay mounted even while closed (width 0) rather than
 *  unmounting via AnimatePresence — the sidebar's whole catalog tree
 *  (fetched schemas/objects, expanded nodes) used to get thrown away and
 *  refetched from scratch every time the panel closed and reopened, and the
 *  JSON viewer's own open/close used to run through two separate,
 *  unsynchronized animations (a `layoutId` width FLIP plus a manual slide
 *  transform) that visibly raced each other — one continuous width/opacity
 *  tween like this is what actually keeps the reserved space and the
 *  visible reveal moving together as a single value. */
export function EdgePanelSlot({
  open,
  width,
  side,
  panelRef,
  transition,
  children,
}: {
  /** The panel's content is showing. */
  open: boolean;
  /** Pixel width while open. */
  width: number;
  /** Which edge of the workspace this panel is docked to — only affects
   *  which side gets the divider border. */
  side: "left" | "right";
  /** Exposes the underlying element so a caller doing its own drag-resize
   *  (see json-viewer/index.tsx) can mutate its DOM width directly during a
   *  live drag, in sync with whatever else it mutates directly for the same
   *  reason, instead of driving every pointermove tick through React. */
  panelRef?: RefObject<HTMLDivElement | null>;
  /** Overrides the default open/close tween — used to make a width change
   *  that was already applied directly to the DOM (a live drag-resize)
   *  apply instantly here too, instead of animating from Framer's
   *  last-known value up to the new one. */
  transition?: Transition;
  children: ReactNode;
}) {
  return (
    <motion.div
      ref={panelRef}
      animate={{ width: open ? width : 0, opacity: open ? 1 : 0 }}
      transition={transition ?? defaultTransition}
      className={cn(
        "bg-background relative flex shrink-0 overflow-hidden",
        open && (side === "left" ? "border-r" : "border-l"),
      )}
      style={{ pointerEvents: open ? "auto" : "none" }}
      aria-hidden={!open}
    >
      {children}
    </motion.div>
  );
}
