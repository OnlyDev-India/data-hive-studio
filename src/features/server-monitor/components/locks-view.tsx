import { useMemo } from "react";
import { CornerDownRight, Info, Lock, ShieldAlert } from "lucide-react";
import type { MonitorEngine, MonitorSnapshot, SessionRow } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import {
  buildBlockingTree,
  countBlocked,
  flatLocks,
  type LockNode,
} from "../lib/locks";
import {
  displayDuration,
  firstLine,
  formatDuration,
  rowActions,
  type RowAction,
} from "../lib/sessions";
import { StateBadge, ThisAppTag } from "./badges";
import { RowMenu } from "./sessions-table";

interface RowProps {
  engine: MonitorEngine;
  selected: string | null;
  locked: boolean;
  on_select: (id: string) => void;
  on_action: (row: SessionRow, a: RowAction) => void;
  on_menu_open: (open: boolean) => void;
}

/** One session line: id, user, state, the query's first line, its menu. */
function SessionLine({
  id,
  row,
  engine,
  selected,
  locked,
  on_select,
  on_action,
  on_menu_open,
  children,
}: RowProps & { id: string; row: SessionRow | null; children?: React.ReactNode }) {
  const actions = row ? rowActions(row, engine, locked) : [];
  return (
    <div
      role="button"
      tabIndex={row ? 0 : -1}
      aria-pressed={selected === id}
      onClick={() => row && on_select(id)}
      onKeyDown={(e) => {
        if (row && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          on_select(id);
        }
      }}
      className={cn(
        "text-small flex min-h-7 min-w-0 items-center gap-2 rounded-inset px-2 py-1 outline-none",
        row && "hover:bg-accent/50 focus-visible:bg-accent/60",
        selected === id && "bg-accent",
      )}
    >
      {children}
      <span className="w-16 shrink-0 font-mono tabular-nums">{id}</span>
      {row ? (
        <>
          <span className="w-24 shrink-0 truncate">{row.user ?? "—"}</span>
          <StateBadge state={row.state} />
          <span className="w-16 shrink-0 font-mono tabular-nums">
            {formatDuration(displayDuration(row))}
          </span>
          {row.is_this_app && <ThisAppTag />}
          <span className="min-w-0 flex-1 truncate font-mono">
            {row.query_hidden ? (
              <span className="text-muted-foreground italic">Hidden by the server</span>
            ) : (
              firstLine(row.query) || "—"
            )}
          </span>
          {actions.length > 0 && (
            <RowMenu
              actions={actions}
              on_pick={(a) => on_action(row, a)}
              on_open={on_menu_open}
            />
          )}
        </>
      ) : (
        <span className="text-muted-foreground min-w-0 flex-1 truncate italic">
          Not a client session, or it just ended
        </span>
      )}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  ...rest
}: RowProps & { node: LockNode; depth: number }) {
  const edge = node.edge;
  return (
    <li>
      <SessionLine id={node.id} row={node.row} {...rest}>
        <span style={{ width: depth * 20 }} className="shrink-0" aria-hidden />
        {edge ? (
          <CornerDownRight className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <ShieldAlert className="text-destructive size-3.5 shrink-0" aria-label="Blocker" />
        )}
      </SessionLine>
      {edge && (
        <p
          className="text-muted-foreground text-caption pb-1"
          style={{ paddingLeft: depth * 20 + 34 }}
        >
          Waiting {formatDuration(edge.wait_ms)} for{" "}
          <span className="font-mono">{edge.lock_mode ?? "a lock"}</span>
          {edge.relation && (
            <>
              {" "}on <span className="font-mono">{edge.relation}</span>
            </>
          )}
        </p>
      )}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={`${node.id}>${c.id}`} node={c} depth={depth + 1} {...rest} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <Lock className="text-muted-foreground size-5" />
      <p className="text-muted-foreground text-body">{text}</p>
    </div>
  );
}

/** The Locks sub tab (AC-7). Postgres: a blocking tree with each root
 *  blocker on top, or one row per waiter and blocker in Flat. Mongo: the
 *  operations waiting for a lock, since MongoDB does not say who holds it. */
export function LocksView({
  snapshot,
  flat,
  ...rest
}: RowProps & { snapshot: MonitorSnapshot; flat: boolean }) {
  const tree = useMemo(
    () => buildBlockingTree(snapshot.sessions, snapshot.blocks),
    [snapshot],
  );
  const pairs = useMemo(
    () => flatLocks(snapshot.sessions, snapshot.blocks),
    [snapshot],
  );

  if (snapshot.engine === "mongodb") {
    const waiting = snapshot.sessions.filter((s) => s.state === "waiting");
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="text-muted-foreground text-small bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
          <Info className="size-3.5 shrink-0" />
          MongoDB does not report which operation holds a lock, so this lists
          the operations waiting for one.
        </p>
        {waiting.length === 0 ? (
          <Empty text="No operation is waiting for a lock." />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {waiting.map((row) => (
              <SessionLine key={row.id} id={row.id} row={row} {...rest} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (snapshot.blocks.length === 0) {
    return <Empty text="Nobody is blocked right now." />;
  }

  if (flat) {
    const rows = new Map(snapshot.sessions.map((s) => [s.id, s]));
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-1">
          {pairs.map(({ edge, waiter }) => (
            <li key={`${edge.waiter_id}>${edge.blocker_id}`} className="rounded-control border p-1">
              <SessionLine id={edge.waiter_id} row={waiter} {...rest}>
                <span className="text-muted-foreground text-caption w-14 shrink-0">Waiting</span>
              </SessionLine>
              <SessionLine id={edge.blocker_id} row={rows.get(edge.blocker_id) ?? null} {...rest}>
                <span className="text-destructive text-caption w-14 shrink-0">Blocked by</span>
              </SessionLine>
              <p className="text-muted-foreground text-caption px-2 pb-1">
                {formatDuration(edge.wait_ms)} for{" "}
                <span className="font-mono">{edge.lock_mode ?? "a lock"}</span>
                {edge.relation && (
                  <>
                    {" "}on <span className="font-mono">{edge.relation}</span>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <ul className="flex flex-col gap-2">
        {tree.map((root) => (
          <li key={root.id} className="rounded-control border p-1">
            <p className="text-muted-foreground text-caption px-2 pt-1">
              Blocking {countBlocked(root)}{" "}
              {countBlocked(root) === 1 ? "session" : "sessions"}
            </p>
            <ul>
              <TreeNode node={root} depth={0} {...rest} />
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
