import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sideBadMenu } from "@/config/menu";
import { cn } from "@/lib/utils";
import { fetchTables } from "@/redux/features/tables";
import Link from "next/link";
import { useEffect } from "react";
import { useDispatch } from "react-redux";

const ConnectedPageSidebar = ({ pathname }: { pathname: string }) => {
  const dispatch = useDispatch();
  
  // Only fetch tables once when component mounts, not on every route change
  useEffect(() => {
    const handleFetchTables = async () => {
      dispatch(fetchTables() as any);
    };
    handleFetchTables();
  }, []); // Remove dispatch from dependency array

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
                "w-full rounded-md p-2 text-muted-foreground hover:bg-popover/40 hover:text-foreground transition-colors duration-150",
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
                  <span className="text-xs text-muted-foreground">{` (${item.shortcut})`}</span>
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
