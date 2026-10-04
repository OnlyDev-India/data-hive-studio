import { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  Code2,
  History,
  Info,
  Keyboard,
  Palette,
  Search,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { cn } from "@/shared/lib/utils";
import { AppearanceSection } from "./appearance";
import { CommandPaletteSection } from "./command-palette-section";
import { ShortcutsSection } from "./shortcuts-section";
import { SqlFormatSection } from "./sql-format-section";
import { ActivitySection } from "./activity-section";
import { LibrarySection } from "./library-section";
import { AboutSection } from "./about";
import { Button, Input } from "@/shared/components/ui";
import { WEB } from "@/shared/api/web";
import {
  searchSettings,
  type SectionId,
  type SettingEntry,
} from "./settings-search";

interface SectionMeta {
  id: SectionId;
  label: string;
  icon: typeof Palette;
}

export const SECTIONS: SectionMeta[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "command-palette", label: "Command Palette", icon: Search },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "sql-format", label: "SQL Format", icon: Code2 },
  { id: "library", label: "Library", icon: BookMarked },
  // The browser build has no activity log.
  ...(WEB
    ? []
    : [{ id: "activity" as const, label: "Activity log", icon: History }]),
  { id: "about", label: "About", icon: Info },
];

const SECTION_LABELS = new Map(SECTIONS.map((s) => [s.id, s.label]));

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<SectionId>("appearance");
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState<{ label: string; n: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const searching = query.trim().length > 0;
  const matches = searchSettings(query, SECTION_LABELS);
  const matched_sections = SECTIONS.filter((s) =>
    matches.some((m) => m.section === s.id),
  );
  // While searching, show a section that has hits rather than a stale one.
  const shown =
    searching && !matched_sections.some((s) => s.id === section)
      ? (matched_sections[0]?.id ?? section)
      : section;

  const go_to = (entry: SettingEntry) => {
    setSection(entry.section);
    setJump((j) => ({ label: entry.label, n: (j?.n ?? 0) + 1 }));
  };

  useEffect(() => {
    if (!jump) return;
    const root = contentRef.current;
    if (!root) return;
    const el = Array.from(root.querySelectorAll("span, label, h2, h3")).find(
      (n) => n.textContent?.trim() === jump.label,
    );
    const target = el?.closest(".border, .divide-y > *");
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("ring-2", "ring-primary/60");
    const t = setTimeout(
      () => target.classList.remove("ring-2", "ring-primary/60"),
      1200,
    );
    return () => clearTimeout(t);
  }, [jump]);

  const handle_open_change = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handle_open_change}>
      {/* Fixed height plus a shrinkable grid row bound the panes, so the dialog
          itself never scrolls and each side scrolls on its own. */}
      <DialogContent className="h-[85%] max-h-[85%] min-w-[95%] grid-rows-[minmax(0,1fr)] overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="rounded-dialog flex min-h-0 flex-col overflow-hidden">
          {/* Right padding keeps clear of the dialog's own close button. */}
          <div className="bg-muted/40 flex h-11 shrink-0 items-center gap-3 border-b pr-12 pl-4">
            <span className="text-body font-semibold">Settings</span>
            <div className="relative mx-auto w-full max-w-md">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
              <Input
                autoFocus
                aria-label="Search settings"
                className="h-7 pr-7 pl-7"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) go_to(matches[0]);
                }}
                placeholder="Search settings"
              />
              {searching && (
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="Clear search"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={() => setQuery("")}
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          </div>

          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
          >
            <ResizablePanel
              defaultSize="26%"
              minSize="22%"
              maxSize="40%"
              className="border-r"
            >
              <div className="flex h-full w-full flex-col gap-1 overflow-y-auto p-4">
                {searching && matched_sections.length === 0 && (
                  <p className="text-muted-foreground text-body px-3 py-2">
                    No settings match “{query.trim()}”.
                  </p>
                )}
                {(searching ? matched_sections : SECTIONS).map(
                  ({ id, label, icon: Icon }) => (
                    <div key={id} className="flex flex-col gap-0.5">
                      <Button
                        variant={"ghost"}
                        onClick={() => setSection(id)}
                        className={cn(
                          "rounded-surface text-body flex w-full shrink-0 items-center justify-start gap-2.5 px-3 py-2 text-left transition-colors",
                          shown === id
                            ? "bg-primary hover:bg-primary/60 text-primary-foreground font-medium"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                        {label}
                      </Button>
                      {searching &&
                        matches
                          .filter((m) => m.section === id)
                          .map((m) => (
                            <button
                              key={m.label}
                              onClick={() => go_to(m)}
                              className="rounded-surface text-small text-muted-foreground hover:bg-muted/60 hover:text-foreground truncate py-1 pr-3 pl-9 text-left transition-colors"
                            >
                              {m.label}
                            </button>
                          ))}
                    </div>
                  ),
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle className="hover:bg-accent active:bg-primary/60 bg-transparent" />
            <ResizablePanel defaultSize="74%" minSize="50%">
              <div
                ref={contentRef}
                className="bg-background h-full w-full overflow-y-auto p-6"
              >
                <div className="pb-3">
                  {shown === "appearance" && <AppearanceSection />}
                  {shown === "command-palette" && <CommandPaletteSection />}
                  {shown === "shortcuts" && <ShortcutsSection />}
                  {shown === "sql-format" && <SqlFormatSection />}
                  {shown === "library" && (
                    <LibrarySection onClose={() => handle_open_change(false)} />
                  )}
                  {shown === "activity" && <ActivitySection />}
                  {shown === "about" && <AboutSection />}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </DialogContent>
    </Dialog>
  );
}
