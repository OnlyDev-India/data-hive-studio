import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sideBadMenu } from "@/config/menu";
import { cn } from "@/lib/utils";
import Link from "next/link";

const ConnectedPageSidebar = ({ pathname }: { pathname: string }) => {

  return (
    <div
      className={cn(
        `z-10 h-full w-full flex-col justify-start bg-background p-2`,
      )}
    >
      {sideBadMenu.map((item, index) => {
        if (item.btn) {
          return <item.btn key={index} />;
        }
        return (
          item.link && (
            <Link
              key={index}
              href={item.link}
              className={cn(
                "flex items-center justify-center",
                "w-full rounded-md p-2 text-muted-foreground transition-colors duration-150 hover:bg-popover/40 hover:text-foreground",
                {
                  "bg-popover text-primary": pathname.includes(item.link),
                },
              )}
            >
              <Tooltip>
                <TooltipTrigger>
                  <item.icon size={20} />
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {item.title}
                  {/* <span className="text-xs text-muted-foreground">{` (${item.shortcut})`}</span> */}
                </TooltipContent>
              </Tooltip>
            </Link>
          )
        );
      })}
    </div>
  );
};

export default ConnectedPageSidebar;
