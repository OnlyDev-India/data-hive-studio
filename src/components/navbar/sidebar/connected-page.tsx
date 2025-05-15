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
  const handleFetchTables = async () => {
    dispatch(fetchTables() as any);
  };
  useEffect(() => {
    handleFetchTables();
  }, [dispatch]);
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
                "w-full rounded-md p-2 text-muted-foreground hover:bg-popover/40 hover:text-foreground",
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
