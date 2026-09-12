import {
  Copy,
  Maximize,
  Pencil,
  type LucideIcon,
  WrapText,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

export interface JsonViewerToolbarProps {
  wrap: boolean;
  onToggleWrap: () => void;
  editable: boolean;
  editDisabled?: boolean;
  onToggleEdit: () => void;
  onExpand?: () => void;
  onCopy: () => void;
  disabled?: boolean;
}

/** Editor-action row for the JSON viewer — edit/wrap/expand/copy, split out
 *  of TreeControls' search bar into their own strip, the same way
 *  EditorRunToolbar sits above the SQL/Mongo editor separate from that
 *  tab's own chrome. */
export function JsonViewerToolbar({
  wrap,
  onToggleWrap,
  editable,
  editDisabled,
  onToggleEdit,
  onExpand,
  onCopy,
  disabled = false,
}: JsonViewerToolbarProps) {
  return (
    <TooltipProvider delay={500}>
      <div className="bg-editor-toolbar flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
        <ToolbarButton
          icon={Pencil}
          label={
            editDisabled
              ? "This row is read-only"
              : editable
                ? "Editing (click again to stop)"
                : "Edit row JSON"
          }
          color="primary"
          active={editable && !editDisabled}
          disabled={disabled || editDisabled}
          onClick={onToggleEdit}
        />
        <ToolbarButton
          icon={WrapText}
          label={wrap ? "Word wrap on" : "Word wrap off"}
          color="info"
          active={wrap}
          disabled={disabled}
          onClick={onToggleWrap}
        />
        {onExpand && (
          <ToolbarButton
            icon={Maximize}
            label="Open in dialog"
            color="warning"
            disabled={disabled}
            onClick={onExpand}
          />
        )}
        <ToolbarButton
          icon={Copy}
          label="Copy as JSON"
          color="success"
          disabled={disabled}
          onClick={onCopy}
        />
      </div>
    </TooltipProvider>
  );
}

/** Text/hover-background pair per color, same convention as
 *  EditorRunToolbar: info for the wrap display toggle, primary for the
 *  editing action, warning for expand, success for copy — each icon reads
 *  as a distinct action at a glance. */
const TOOLBAR_ICON_COLORS = {
  info: "text-info hover:bg-info/20",
  primary: "text-primary hover:bg-primary/10",
  warning: "text-warning hover:bg-warning/20",
  success: "text-success hover:bg-success/20",
} as const;

const ACTIVE_BG = {
  info: "bg-info/20",
  primary: "bg-primary/10",
  warning: "bg-warning/20",
  success: "bg-success/20",
} as const;

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  color,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  color: keyof typeof TOOLBAR_ICON_COLORS;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="iconXs"
            disabled={disabled}
            aria-label={label}
            className={cn(
              "size-6",
              TOOLBAR_ICON_COLORS[color],
              active && ACTIVE_BG[color],
            )}
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
