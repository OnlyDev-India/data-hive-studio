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
import { ipcRenderer } from "electron";
import Image from "next/image";
import React, { use, useEffect } from "react";

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
  const [title, setTitle] = React.useState<string>("");
  useEffect(() => {
    setTitle(document.title);
  });
  const onClicks: { [key: string]: () => void } = {
    reloadWindow: reloadWindow,
    toggleDevTools: toggleDevTools,
    closeWindow: closeWindow,
  };

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="h-[var(--menu-navbar-height)] bg-secondary px-4">
      <div
        className={cn(
          "flex h-full items-center justify-between",
          { "draggable-bar": !isDev },
        )}
      >
        <div className="no-draggable-bar z-10 flex h-full items-center gap-2">
          <Image
            src="/favicon.ico"
            width={16}
            height={16}
            alt="logo"
            className="draggable-bar"
          />
          <div className="flex h-full items-center">
            {menus.map((menu) => (
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
        </div>
        <div className="no-draggable-bar flex h-full items-center">
          <p className="rounded-md border bg-border/40 px-24 py-1 text-xs">
            {title}
          </p>
        </div>
        <div className="w-2"></div>
      </div>
    </div>
  );
};

export default MenuNavbar;
