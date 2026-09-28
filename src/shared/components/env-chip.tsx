import type { CSSProperties } from "react";
import { Lock } from "lucide-react";
import {
  envColorKey,
  hasConnFlags,
  tidyEnvLabel,
  type ConnGuard,
} from "@/shared/api";
import { cn } from "@/shared/lib/utils";

// How a connection says how careful to be (spec 0007): a coloured chip with
// its environment label, and a lock when it is read only. Colours are the
// `--env-<key>` tokens in `src/index.css`, so both themes are covered there.

/** The token colours for a chip, as inline style (the key is data, so a
 *  Tailwind class name built from it would never be generated). */
export function envChipStyle(color_key: string): CSSProperties {
  return {
    backgroundColor: `var(--env-${color_key})`,
    color: `var(--env-${color_key}-fg)`,
  };
}

/** The connection's environment label as a chip: colour plus the label text
 *  (the text is what a screen reader reads, colour is never the only cue).
 *  Renders nothing when the connection has no label. */
export function EnvChip({
  conn,
  className,
}: {
  conn: ConnGuard;
  className?: string;
}) {
  const label = tidyEnvLabel(conn.env_label);
  const color_key = envColorKey(conn);
  if (!label || !color_key) return null;
  return (
    <span
      data-slot="env-chip"
      data-env-color={color_key}
      title={`Environment: ${label}`}
      style={envChipStyle(color_key)}
      className={cn(
        "text-3xs inline-flex h-4 max-w-28 shrink-0 items-center rounded-full px-1.5 leading-none font-semibold",
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The lock shown beside a read only connection. */
export function ReadOnlyLock({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      role="img"
      aria-label="Read only connection"
      title="Read only connection: writes are refused"
      data-slot="read-only-lock"
      className={cn(
        "text-muted-foreground inline-flex shrink-0 items-center",
        className,
      )}
    >
      <Lock className={cn("size-3", iconClassName)} aria-hidden="true" />
    </span>
  );
}

/** Everything a connection wears next to its name: the environment chip and
 *  the read only lock. Renders nothing for a plain connection, so it can be
 *  dropped in beside any connection name. */
export function ConnFlags({
  conn,
  className,
}: {
  conn: ConnGuard;
  className?: string;
}) {
  if (!hasConnFlags(conn)) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {conn.read_only && <ReadOnlyLock />}
      <EnvChip conn={conn} />
    </span>
  );
}
