import { useEffect, useRef } from "react";
import { Copy, Table as TableIcon, TableProperties } from "lucide-react";
import type { GraphTable } from "@/shared/api/types";

export interface NodeMenuState {
  id: string;
  /** Relative to the canvas wrapper. */
  x: number;
  y: number;
}

/** The right click menu on a box: Open data, Open schema, Copy name. */
export function NodeMenu({
  state,
  table,
  onOpen,
  onClose,
  onNotice,
}: {
  state: NodeMenuState;
  table: GraphTable;
  onOpen: (view: "data" | "schema") => void;
  onClose: () => void;
  onNotice?: (
    kind: "success" | "error",
    title: string,
    detail?: string,
  ) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [state]);

  const name =
    table.schema && table.stub ? `${table.schema}.${table.name}` : table.name;
  const copy = async () => {
    onClose();
    try {
      await navigator.clipboard.writeText(table.name);
      onNotice?.("success", "Name copied", table.name);
    } catch (e) {
      onNotice?.("error", "Couldn't copy the name", String(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };

  const item =
    "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground rounded-inset text-body flex w-full items-center gap-2 px-2 py-1.5 text-left outline-none";
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${name}`}
      onKeyDown={onKeyDown}
      className="bg-popover text-popover-foreground ring-foreground/10 rounded-surface absolute z-20 w-44 p-1 shadow-md ring-1"
      style={{ left: state.x, top: state.y }}
    >
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => onOpen("data")}
      >
        <TableIcon className="size-4" />
        Open data
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => onOpen("schema")}
      >
        <TableProperties className="size-4" />
        Open schema
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => void copy()}
      >
        <Copy className="size-4" />
        Copy name
      </button>
    </div>
  );
}
