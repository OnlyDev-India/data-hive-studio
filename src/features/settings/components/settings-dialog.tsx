import { useState } from "react";
import { Palette } from "lucide-react";
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
import { Button } from "@/shared/components/ui";
import { useTheme } from "@/shared/theme/theme";

type SectionId = "appearance";

interface SectionMeta {
  id: SectionId;
  label: string;
  icon: typeof Palette;
}

const SECTIONS: SectionMeta[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
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
      <DialogContent className="min-h-[80%] min-w-[80%]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {/* The default close button is rendered by the dialog; content is
            tall enough that we don't add a title bar here. */}
        <div className="-mx-6 -mt-6 flex overflow-hidden rounded-t-2xl border-b">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel defaultSize="26%" minSize="22%" maxSize="40%">
              <div className="flex h-full w-full flex-col gap-1 p-4">
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                  <Button
                    variant={"ghost"}
                    key={id}
                    onClick={() => setSection(id)}
                    className={cn(
                      "flex w-full items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      section === id
                        ? "bg-primary hover:bg-primary/60 font-medium text-white"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      isGraphite && dark && "text-black",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="74%" minSize="50%">
              <div className="h-full w-full overflow-y-auto p-6">
                {section === "appearance" && <AppearanceSection />}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </DialogContent>
    </Dialog>
  );
}
