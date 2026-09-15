import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  buildDelimitedList,
  type DelimitedListSettings,
} from "./delimited-list";

/** Turns the selected text into a quoted, joined list — split/quote/join
 *  are each independently configurable (unlike `pasteAsSqlInCondition`'s
 *  fixed single-quote/comma/parens), with a live preview before committing.
 *  Settings persist across opens (passed in/out via `settings`/
 *  `onSettingsChange` rather than owned here, so the caller's store-backed
 *  value survives this dialog unmounting). */
export function DelimitedListDialog({
  source,
  settings,
  onSettingsChange,
  onApply,
  onClose,
}: {
  /** The text to transform — `null` closes the dialog. */
  source: string | null;
  settings: DelimitedListSettings;
  onSettingsChange: (s: DelimitedListSettings) => void;
  onApply: (result: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);

  const preview = useMemo(
    () => (source === null ? "" : buildDelimitedList(source, draft)),
    [source, draft],
  );

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Build delimited list</DialogTitle>
          <DialogDescription>
            Turn the selected text into a quoted, joined list.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Split on</Label>
            <Input
              value={draft.splitOn}
              onChange={(e) =>
                setDraft((d) => ({ ...d, splitOn: e.target.value }))
              }
              placeholder="\n"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Quote with</Label>
            <Input
              value={draft.quote}
              onChange={(e) =>
                setDraft((d) => ({ ...d, quote: e.target.value.slice(0, 1) }))
              }
              placeholder="(none)"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Join with</Label>
            <Input
              value={draft.joinWith}
              onChange={(e) =>
                setDraft((d) => ({ ...d, joinWith: e.target.value }))
              }
              placeholder=", "
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Preview</Label>
          <Textarea
            readOnly
            value={preview}
            rows={4}
            className="resize-y font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={preview.length === 0}
            onClick={() => {
              onSettingsChange(draft);
              onApply(preview);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
