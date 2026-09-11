import {
  Select,
  SelectItem,
  SelectContent,
  SelectGroup,
  SelectTrigger,
  SelectValue,
  Button,
} from "@/shared/components/ui";
import {
  FolderOpen,
  PlayIcon,
  Save,
  SpellCheck2,
  TextAlignStart,
  TextSelect,
} from "lucide-react";
import { DBIcons, type DbIconKind } from "@/shared/components/icons/types";
import { cn } from "@/shared/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

/** Run control + (for Postgres/Mongo) a database picker — shared by the
 *  SQL and Mongo console bodies, rendered above the editor itself rather
 *  than in the global action bar, so which database a run targets is right
 *  next to the button that runs it. No separate schema picker: a
 *  non-default Postgres schema is named straight in the query text
 *  (`schema.table`) instead — see `schemaCompletions`'s doc comment in
 *  `sql-completions.ts` for why, and how hints still work for it.
 *
 *  Just one run button (not a separate "run at cursor" one): the gutter's
 *  per-statement play buttons (see `statement-runner.ts`) now cover running
 *  a single statement — this one only ever means "run everything" or, with
 *  an active selection, "run exactly what's selected". */
export function EditorRunToolbar({
  has_selection,
  can_run_target,
  has_text,
  on_run_target,
  on_run_all,
  db_kind,
  database,
  databases,
  on_database_change,
  on_format,
  lint_enabled,
  on_toggle_lint,
  is_dirty,
  on_save,
  on_open,
}: {
  has_selection: boolean;
  can_run_target: boolean;
  has_text: boolean;
  on_run_target: () => void;
  on_run_all: () => void;
  /** Drives the colored connection-type icon next to the database picker. */
  db_kind?: DbIconKind;
  /** Omitted entirely (both `databases` and `on_database_change` absent) =
   *  no database concept to switch (SQLite). */
  database?: string;
  databases?: string[];
  on_database_change?: (v: string) => void;
  /** SQL editor formats with `sql-formatter`; the Mongo console formats its
   *  JS shell commands with prettier's standalone (babel) parser instead —
   *  see each body's own `format_sql`/`format_script`. */
  on_format?: () => void;
  lint_enabled?: boolean;
  on_toggle_lint?: () => void;
  is_dirty?: boolean;
  on_save?: () => void;
  on_open?: () => void;
}) {
  const DbIcon = db_kind ? DBIcons[db_kind] : null;
  return (
    <TooltipProvider delay={500}>
      <div className="bg-editor-toolbar flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1">
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:bg-success/20 h-6 bg-transparent px-2 text-xs"
                  disabled={has_selection ? !can_run_target : !has_text}
                  title={has_selection ? "Run selected" : "Run all"}
                  onClick={has_selection ? on_run_target : on_run_all}
                >
                  {has_selection ? (
                    <TextSelect className="text-success size-3.5" />
                  ) : (
                    <PlayIcon className="text-success size-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipContent side="top">
              {has_selection ? "Run selected" : "Run all"}
            </TooltipContent>
          </Tooltip>
          {on_format && (
            <ToolbarIconButton
              icon={TextAlignStart}
              label="Format query"
              color="info"
              disabled={!has_text}
              onClick={on_format}
            />
          )}
          {on_toggle_lint && (
            <ToolbarIconButton
              icon={SpellCheck2}
              label={lint_enabled ? "Disable linting" : "Enable linting"}
              color="warning"
              active={lint_enabled}
              onClick={on_toggle_lint}
            />
          )}
          {on_open && (
            <ToolbarIconButton
              icon={FolderOpen}
              label="Open file"
              color="muted"
              onClick={on_open}
            />
          )}
          {on_save && (
            <ToolbarIconButton
              icon={Save}
              label="Save"
              color="primary"
              disabled={!is_dirty}
              onClick={on_save}
            />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {databases && databases.length > 0 && on_database_change && (
            <Select
              key={database}
              value={database || undefined}
              onValueChange={(v) => v && on_database_change(v)}
            >
              <SelectTrigger
                size="sm"
                className="h-6! border-none text-xs dark:bg-transparent"
              >
                {DbIcon && <DbIcon className="size-4 shrink-0" />}
                <SelectValue>{() => database}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {databases.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Text/hover-background pair per color, so each toolbar button reads as a
 *  different kind of action at a glance instead of a row of identical green
 *  icons: info (transform) for Format, warning (flags issues) for the lint
 *  toggle, primary (the app's own "ink" accent) for Save, muted for the
 *  neutral file-system Open action. */
const TOOLBAR_ICON_COLORS = {
  info: "text-info hover:bg-info/20",
  warning: "text-warning hover:bg-warning/20",
  primary: "text-primary hover:bg-primary/10",
  muted: "text-muted-foreground hover:bg-accent",
} as const;

function ToolbarIconButton({
  icon: Icon,
  label,
  onClick,
  color,
  disabled,
  active,
}: {
  icon: typeof PlayIcon;
  label: string;
  onClick: () => void;
  color: keyof typeof TOOLBAR_ICON_COLORS;
  disabled?: boolean;
  /** Explicit off-state (the lint toggle) — falls back to muted regardless
   *  of `color`, same as a disabled control reading as neutral. */
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 bg-transparent px-2 text-xs",
              active === false
                ? "text-muted-foreground hover:bg-accent"
                : TOOLBAR_ICON_COLORS[color],
            )}
            disabled={disabled}
            title={label}
            onClick={onClick}
          >
            <Icon className="size-3.5" />
          </Button>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
