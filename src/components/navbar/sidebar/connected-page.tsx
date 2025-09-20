import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sideBadMenu } from "@/config/menu";
import { useResizable } from "@/providers/resizable-provider";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";

const ConnectedPageSidebar = ({ pathname }: { pathname: string }) => {
  const { toggleResizable, getResizableState } = useResizable();
  const resizableState = getResizableState("editor-sidebar");
  const router = useRouter();
  const searchParams = useSearchParams();
  const sidebar = searchParams.get("sidebar") || "default";

  const handleClick = (item: any) => {
    if (item.sidebar === sidebar) {
      toggleResizable(
        item.saveId,
        resizableState.state === "expanded" ? "collapsed" : "expanded",
      );
    } else {
      router.push(item.link);
    }
  };

  return (
    <div
      className={cn(
        `z-10 h-full w-full flex-col justify-start bg-background p-2`,
      )}
    >
      {sideBadMenu
        .filter((item) => !item.disabled)
        .map((item, index) => {
          if (item.btn) {
            return <item.btn key={index} />;
          }
          // Determine if this item should be highlighted
          const isActive = item.sidebar === sidebar;
          const resizableState = item.saveId
            ? getResizableState(item.saveId)
            : { state: "expanded" };
          const shouldHighlight =
            isActive && (!item.saveId || resizableState.state === "expanded");

          return (
            item.link && (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <Button
                    variant={"ghost"}
                    onClick={() => handleClick(item)}
                    className={cn(
                      "flex items-center justify-center",
                      "w-full rounded-md p-2 text-muted-foreground transition-colors duration-150 hover:bg-popover/40 hover:text-foreground",
                      {
                        "bg-popover text-primary": shouldHighlight,
                      },
                    )}
                  >
                    <item.icon size={20} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {item.title}
                </TooltipContent>
              </Tooltip>
            )
          );
        })}
    </div>
  );
};

export default ConnectedPageSidebar;
