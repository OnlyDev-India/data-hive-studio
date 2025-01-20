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
        `z-10 h-full w-full flex-col justify-start bg-background px-0`,
      )}
    >
      {sideBadMenu.map((item, index) => {
        if (item.btn) {
          return <item.btn key={index} />;
        }
        return (
          <div
            key={index}
            className={cn(
              "w-full rounded-none border-l-2 border-transparent p-2 text-muted-foreground data-[state=active]:border-primary",
              {
                "border-primary text-foreground": pathname.includes(item.link),
              },
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                {item.link && (
                  <Link
                    href={item.link}
                    className="flex items-center justify-center"
                  >
                    <item.icon size={20} />
                  </Link>
                )}
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                {item.title}
                <span className="text-xs text-muted-foreground">{` (${item.shortcut})`}</span>
              </TooltipContent>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
};

export default ConnectedPageSidebar;
