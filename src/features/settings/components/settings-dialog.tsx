import { useState } from "react";
import { Code2, Info, Keyboard, Palette, Search } from "lucide-react";
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
import { AboutSection } from "./about";
import { Button } from "@/shared/components/ui";
import { useTheme } from "@/shared/theme/theme";

type SectionId =
  "appearance" | "command-palette" | "shortcuts" | "sql-format" | "about";

interface SectionMeta {
  id: SectionId;
  label: string;
  icon: typeof Palette;
}

const SECTIONS: SectionMeta[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "command-palette", label: "Command Palette", icon: Search },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "sql-format", label: "SQL Format", icon: Code2 },
  { id: "about", label: "About", icon: Info },
];

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<SectionId>("appearance");
  const { accent, dark } = useTheme();
  const isGraphite = accent === "graphite";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed height plus a shrinkable grid row bound the panes, so the dialog
          itself never scrolls and each side scrolls on its own. */}
      <DialogContent className="h-[85%] max-h-[85%] min-w-[95%] grid-rows-[minmax(0,1fr)] overflow-hidden pb-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {/* The default close button is rendered by the dialog; content is
            tall enough that we don't add a title bar here. */}
        <div className="-mx-4 -mt-4 flex min-h-0 overflow-hidden rounded-t-2xl">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel
              defaultSize="26%"
              minSize="22%"
              maxSize="40%"
              className="border-r"
            >
              <div className="flex h-full w-full flex-col gap-1 overflow-y-auto p-4">
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                  <Button
                    variant={"ghost"}
                    key={id}
                    onClick={() => setSection(id)}
                    className={cn(
                      "flex w-full shrink-0 items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      section === id
                        ? "bg-primary hover:bg-primary/60 font-medium text-white"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      section === id && isGraphite && dark && "text-black",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </ResizablePanel>
            <ResizableHandle className="hover:bg-accent active:bg-primary/60 bg-transparent" />
            <ResizablePanel defaultSize="74%" minSize="50%">
              <div className="bg-background h-full w-full overflow-y-auto p-6">
                <div className="pb-3">
                  {section === "appearance" && <AppearanceSection />}
                  {section === "command-palette" && <CommandPaletteSection />}
                  {section === "shortcuts" && <ShortcutsSection />}
                  {section === "sql-format" && <SqlFormatSection />}
                  {section === "about" && <AboutSection />}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </DialogContent>
    </Dialog>
  );
}
