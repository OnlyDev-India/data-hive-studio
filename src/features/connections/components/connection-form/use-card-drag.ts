import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface Offset {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface Box extends Size {
  left: number;
  top: number;
}

/** Keep the card inside its area, `margin` px from each edge. `card` is its untranslated box within the area. */
export function clampOffset(
  offset: Offset,
  area: Size,
  card: Box,
  margin = 0,
): Offset {
  const axis = (v: number, a: number, start: number, len: number) => {
    const lo = margin - start;
    const hi = a - margin - start - len;
    return lo > hi ? 0 : Math.min(hi, Math.max(lo, v));
  };
  return {
    x: axis(offset.x, area.width, card.left, card.width),
    y: axis(offset.y, area.height, card.top, card.height),
  };
}

const size = (el: HTMLElement): Size => ({
  width: el.clientWidth,
  height: el.clientHeight,
});

// offsetLeft/offsetTop ignore the transform and are relative to the area,
// which is the card's offsetParent (it is `relative`).
const box = (el: HTMLElement): Box => ({
  left: el.offsetLeft,
  top: el.offsetTop,
  width: el.offsetWidth,
  height: el.offsetHeight,
});

/** Drag a centred card by a handle. The offset is not saved. */
export function useCardDrag(margin: number) {
  const [area, attachArea] = useState<HTMLElement | null>(null);
  const [card, attachCard] = useState<HTMLElement | null>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    start: Offset;
  } | null>(null);

  const clamp = useCallback(
    (o: Offset) =>
      area && card ? clampOffset(o, size(area), box(card), margin) : o,
    [area, card, margin],
  );

  useEffect(() => {
    if (!area || !card || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setOffset((o) => clamp(o)));
    ro.observe(area);
    ro.observe(card);
    return () => ro.disconnect();
  }, [area, card, clamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, start: offset });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag;
    if (!d) return;
    setOffset(
      clamp({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }),
    );
  };
  const onPointerUp = () => {
    setDrag(null);
  };

  return {
    attachArea,
    attachCard,
    offset,
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}

export type CardDrag = Omit<ReturnType<typeof useCardDrag>, "attachArea">;

export const CardDragContext = createContext<CardDrag | null>(null);

export const useCardDragContext = () => useContext(CardDragContext);
