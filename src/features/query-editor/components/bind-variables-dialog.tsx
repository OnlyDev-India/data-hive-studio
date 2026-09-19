import { useState } from "react";
import { Variable } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@/shared/components/ui";
import { useShortcuts } from "@/shared/hooks/use-shortcut";

/** Prompts for a value per detected `:name`/`${name}` bind variable before a
 *  run — gates `run_all`/`run_target` exactly like `DangerConfirmDialog`
 *  gates dangerous SQL, just a step earlier in the same pipeline: this
 *  substitutes literal values into the SQL text first (`bind-variables.ts`),
 *  and the resulting statements then go through the danger-confirm gate as
 *  usual. */
export function BindVariablesDialog({
  names,
  onConfirm,
  onCancel,
}: {
  /** `null` closes the dialog. */
  names: string[] | null;
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const open = names !== null;
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = () => {
    onConfirm(values);
    setValues({});
  };
  useShortcuts([{ key: "Enter", handler: submit }], { enabled: open });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setValues({});
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Variable className="size-4" />
            Bind variables
          </DialogTitle>
          <DialogDescription>
            {names?.length === 1
              ? "This run references one bind variable — empty stays NULL:"
              : `This run references ${names?.length ?? 0} bind variables — empty stays NULL:`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {names?.map((name, i) => (
            <div key={name} className="flex flex-col gap-1">
              <Label className="font-mono text-xs">{name}</Label>
              <Input
                autoFocus={i === 0}
                value={values[name] ?? ""}
                onChange={(e) =>
                  setValues((cur) => ({ ...cur, [name]: e.target.value }))
                }
                placeholder="value…"
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
            <kbd className="bg-muted text-muted-foreground text-3xs ml-1 rounded-md border px-1.5 py-0.5 font-medium">
              ESC
            </kbd>
          </Button>
          <Button onClick={submit}>
            Run
            <kbd className="bg-muted text-muted-foreground text-3xs ml-1 rounded-md border px-1.5 py-0.5 font-medium">
              ENTER
            </kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
