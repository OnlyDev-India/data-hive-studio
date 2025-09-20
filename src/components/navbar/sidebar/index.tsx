"use client";
import { Button } from "../../ui/button";
import { usePathname, useRouter } from "next/navigation";
import { disconnectDb } from "@/lib/actions/fetch-data";
import {
  CirclePowerIcon,
  Database,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useDispatch } from "react-redux";
import { resetOpenFiles } from "@/redux/features/open-files";
import { resetQuery } from "@/redux/features/query";
import { resetTables } from "@/redux/features/tables";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { useTheme } from "next-themes";
import ConnectedPageSidebar from "./connected-page";
import ConnectionPageSidebar from "./connection-page";
import { useAppData } from "@/hooks/useAppData";
import { DatabaseBackupModal } from "@/components/modals/database-backup-modal";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { TooltipTrigger } from "@/components/ui/tooltip";
import { AppDispatch } from "@/redux/store";
import { Suspense } from "react";

const Sidebar = () => {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { connectionPath } = useAppData();
  const handleDisconnect = async () => {
    const response = await disconnectDb(connectionPath);
    if (response) {
      dispatch(resetOpenFiles());
      dispatch(resetQuery());
      dispatch(resetTables());
      router.push("/");
    }
  };
  return (
    <div className="flex w-[var(--sidebar-width)] flex-col items-center pb-2">
      {pathname === "/" && <ConnectionPageSidebar />}
      {pathname.startsWith("/app") && (
        <>
          <Suspense fallback={<></>}>
            <ConnectedPageSidebar pathname={pathname} />
          </Suspense>
          <DatabaseBackupModal>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={"ghost"}
                    size={"icon"}
                    className="hover:bg-secondary"
                  >
                    <Database size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Database Backup</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </DatabaseBackupModal>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={"ghost"}
            size={"icon"}
            className="hover:bg-secondary"
          >
            <SettingsIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">
              {theme?.includes("dark") ? (
                <MoonIcon size={12} />
              ) : (
                <SunIcon size={12} />
              )}
              <span>Theme</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => setTheme("light")}
                  className="text-xs"
                >
                  <SunIcon size={12} />
                  <span>Light</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setTheme("dark")}
                  className="text-xs"
                >
                  <MoonIcon size={12} />
                  <span>Dark</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setTheme("system")}
                  className="text-xs"
                >
                  <MonitorIcon size={12} />
                  <span>System</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          {pathname.startsWith("/app") && (
            <DropdownMenuItem className="text-xs" onSelect={handleDisconnect}>
              <CirclePowerIcon size={12} /> Disconnect
              <DropdownMenuShortcut>ctrl + q</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default Sidebar;
