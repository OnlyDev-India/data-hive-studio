import { useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
} from "@/shared/components/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { WEB } from "@/shared/api/web";
import { pickLibraryFile, saveLibraryFile } from "@/shared/lib/platform";
import { ChoiceChips } from "@/shared/library/library-fields";
import { exportFile, matchesSearch, newestFirst } from "@/shared/library/rules";
import {
  connectionLanguage,
  type LibraryItem,
  type LibraryKind,
  type LibraryLanguage,
} from "@/shared/library/types";
import { useStudioStore } from "@/shared/store";
import { LibraryItemEditor } from "./library-item-editor";

type KindFilter = "all" | LibraryKind;
type LanguageFilter = "all" | LibraryLanguage;

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "query", label: "Queries" },
  { id: "snippet", label: "Snippets" },
];
const LANGUAGE_FILTERS: { id: LanguageFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sql", label: "SQL" },
  { id: "mongo", label: "Mongo" },
];

const languageLabel = (l: LibraryLanguage) => (l === "sql" ? "SQL" : "Mongo");

export function LibrarySection({ onClose }: { onClose: () => void }) {
  const library = useStudioStore((s) => s.library);
  const [editing, setEditing] = useState<LibraryItem | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const [deleting, setDeleting] = useState<LibraryItem | null>(null);

  const shown = useMemo(
    () =>
      newestFirst(library).filter(
        (i) =>
          (kind === "all" || i.kind === kind) &&
          (language === "all" || i.language === language) &&
          matchesSearch(i, search),
      ),
    [library, kind, language, search],
  );

  if (editing)
    return (
      <LibraryItemEditor
        item={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
      />
    );

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-heading font-semibold">Library</h2>
          <p className="text-muted-foreground text-body mt-0.5">
            Saved queries and snippets, on every connection. Type a snippet's
            trigger or a name in the editor to insert it.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <TransferButtons items={library} />
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" />
            New
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            aria-label="Search the library"
            className="pl-7"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names, triggers and text"
          />
        </div>
        <ChoiceChips
          label="Kind"
          value={kind}
          options={KIND_FILTERS}
          onChange={setKind}
        />
        <ChoiceChips
          label="Language"
          value={language}
          options={LANGUAGE_FILTERS}
          onChange={setLanguage}
        />
      </div>

      {shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {library.length === 0 ? "Your library is empty" : "No matches"}
            </EmptyTitle>
            <EmptyDescription>
              {library.length === 0
                ? "Save editor text with Save to library, or add an item here with New."
                : "Try another search or filter."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <TooltipProvider delay={300}>
          <ul className="flex flex-col gap-2" aria-label="Library items">
            {shown.map((item) => (
              <LibraryRow
                key={item.id}
                item={item}
                onEdit={() => setEditing(item)}
                onDelete={() => setDeleting(item)}
                onOpened={onClose}
              />
            ))}
          </ul>
        </TooltipProvider>
      )}

      <DeleteDialog item={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/** Why "Open in editor" is off for `item`, or null when it can open. */
function useOpenBlocker(item: LibraryItem): string | null {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === s.activeId));
  if (!conn) return "Connect to a database first.";
  if (connectionLanguage(conn.kind) !== item.language)
    return item.language === "sql"
      ? "This is a SQL query and the active connection is MongoDB."
      : "This is a Mongo query and the active connection uses SQL.";
  return null;
}

function LibraryRow({
  item,
  onEdit,
  onDelete,
  onOpened,
}: {
  item: LibraryItem;
  onEdit: () => void;
  onDelete: () => void;
  onOpened: () => void;
}) {
  const blocker = useOpenBlocker(item);
  const open = () => {
    const s = useStudioStore.getState();
    if (!s.activeId) return;
    if (item.language === "mongo")
      s.openMongoConsole(s.activeId, "", item.text);
    else s.openSql(s.activeId, item.text);
    s.setView("workspace");
    onOpened();
  };
  const firstLine = item.text.split(/\r\n?|\n/, 1)[0];

  return (
    <li className="bg-muted/30 rounded-surface flex items-start gap-3 border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-body truncate font-medium">{item.name}</span>
          <Badge variant={item.kind === "snippet" ? "info" : "muted"}>
            {item.kind === "snippet" ? "Snippet" : "Query"}
          </Badge>
          <Badge variant="outline">{languageLabel(item.language)}</Badge>
          {item.trigger && (
            <Badge variant="outline" className="font-mono">
              {item.trigger}
            </Badge>
          )}
        </div>
        <code className="text-muted-foreground text-small truncate font-mono">
          {firstLine}
        </code>
        <span className="text-muted-foreground text-caption">
          Updated {new Date(item.updated_at).toLocaleString()}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {item.kind === "query" && (
          <Tooltip>
            <TooltipTrigger
              render={
                // A disabled button gets no pointer events, so the hint sits
                // on a wrapper.
                <span tabIndex={blocker ? 0 : -1}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={blocker !== null}
                    onClick={open}
                  >
                    <ExternalLink className="size-3.5" />
                    Open in editor
                  </Button>
                </span>
              }
            />
            <TooltipContent side="top">
              {blocker ?? "Open in a new editor tab on the active connection"}
            </TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="ghost"
          size="iconXs"
          aria-label={`Edit ${item.name}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="iconXs"
          className="text-destructive hover:bg-destructive/10"
          aria-label={`Delete ${item.name}`}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function DeleteDialog({
  item,
  onClose,
}: {
  item: LibraryItem | null;
  onClose: () => void;
}) {
  const deleteItem = useStudioStore((s) => s.deleteLibraryItem);
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{item?.name}”?</DialogTitle>
          <DialogDescription>
            It is removed from the library on every connection. This can't be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (item) void deleteItem(item.id);
              onClose();
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferButtons({ items }: { items: LibraryItem[] }) {
  const importLibrary = useStudioStore((s) => s.importLibrary);
  const notify = useStudioStore((s) => s.pushNotification);
  const fileInput = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const text = JSON.stringify(exportFile(items), null, 2);
    if (WEB) {
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "dh-library.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    try {
      const path = await saveLibraryFile(text);
      if (path)
        notify({ kind: "success", title: "Library exported", detail: path });
    } catch (e) {
      notify({
        kind: "error",
        title: "Could not export the library",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const doImport = async () => {
    if (WEB) {
      fileInput.current?.click();
      return;
    }
    try {
      const text = await pickLibraryFile();
      if (text !== null) await importLibrary(text);
    } catch (e) {
      notify({
        kind: "error",
        title: "Could not import the library",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void doImport()}>
        <Upload className="size-3.5" />
        Import
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={items.length === 0}
        onClick={() => void doExport()}
      >
        <Download className="size-3.5" />
        Export
      </Button>
      {WEB && (
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void file.text().then(importLibrary);
          }}
        />
      )}
    </>
  );
}
