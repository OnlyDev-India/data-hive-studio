"use client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { menus } from "@/config/menu-bar.config";
import { cn } from "@/lib/utils";
import Image from "next/image";
import React, { useEffect } from "react";
import { ConnectionStatus } from "@/components/common/connection-status";
import { usePathname } from "next/navigation";

const getOperatingSystem = () => {
  if (typeof window === "undefined") return "unknown";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "win32";
  if (platform.includes("mac")) return "darwin";
  if (platform.includes("linux")) return "linux";
  return "unknown";
};

const reloadWindow = () => {
  if (window.electron) {
    window.electron.reloadWindow();
  } else {
    window.location.reload();
  }
};

const toggleDevTools = () => {
  if (process.env.NODE_ENV === "development" && window.electron) {
    window.electron.toggleDevTools();
  }
};

const closeWindow = () => {
  if (window.electron) {
    window.electron.closeWindow();
  } else {
    window.close();
  }
};

const MenuNavbar = () => {
  const [title, setTitle] = React.useState<string>("Data Hive Studio");
  const [isDesktop, setIsDesktop] = React.useState<boolean>(false);
  const [os, setOs] = React.useState<string>("unknown");
  const pathname = usePathname();
  const isConnectedPage = pathname.startsWith("/app");

  useEffect(() => {
    // Only run client-side code inside useEffect
    if (typeof window !== "undefined") {
      setTitle(document.title);
      setIsDesktop(!!window.electron);
      setOs(getOperatingSystem());
    }
  }, []);

  const onClicks: { [key: string]: () => void } = {
    reloadWindow: reloadWindow,
    toggleDevTools: toggleDevTools,
    closeWindow: closeWindow,
  };

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="h-[var(--menu-navbar-height)] bg-secondary px-4">
      <div
        className={cn("flex h-full items-center justify-between", {
          "draggable-bar": !isDev,
        })}
      >
        <div className="no-draggable-bar z-10 flex h-full items-center gap-2">
          {os === "win32" && (
            <>
              <Image
                src="/favicon.ico"
                width={16}
                height={16}
                alt="logo"
                className="draggable-bar"
              />
              <div className="flex h-full items-center">
                {isDesktop &&
                  menus.map((menu) => (
                    <DropdownMenu key={menu.label}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-5 px-2 py-0 text-xs focus-visible:outline-none focus-visible:ring-0"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          {menu.label}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {menu.submenu.map((submenu) => (
                          <DropdownMenuItem
                            key={submenu.label}
                            onClick={onClicks[submenu.onClick]}
                            className="text-xs"
                          >
                            {submenu.label}
                            <DropdownMenuShortcut>
                              {submenu.shortcut}
                            </DropdownMenuShortcut>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ))}
              </div>
            </>
          )}
        </div>
        <div className="no-draggable-bar flex h-full items-center gap-2">
          <p className="rounded-md border bg-border/40 px-24 py-1 text-xs">
            {title}
          </p>
        </div>
        <div className="flex h-full items-center gap-2">
          <div className="no-draggable-bar flex h-full items-center gap-2">
            {isConnectedPage && <ConnectionStatus />}
          </div>
          {os === "win32" && <div className="w-2"></div>}
        </div>
      </div>
    </div>
  );
};

export default MenuNavbar;
