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

/** Keep a centred card inside its area, `margin` px from each edge. */
export function clampOffset(
  offset: Offset,
  area: Size,
  card: Size,
  margin = 0,
): Offset {
  const limit = (a: number, c: number) => Math.max(0, (a - c) / 2 - margin);
  const lx = limit(area.width, card.width);
  const ly = limit(area.height, card.height);
  return {
    x: Math.min(lx, Math.max(-lx, offset.x)),
    y: Math.min(ly, Math.max(-ly, offset.y)),
  };
}

const size = (el: HTMLElement): Size => ({
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
      area && card ? clampOffset(o, size(area), size(card), margin) : o,
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
