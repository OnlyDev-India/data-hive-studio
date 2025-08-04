"use client";
import React from "react";
import { SearchIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function CommandMenu() {
  const handleClick = () => {
    // Dispatch a custom event to trigger the command palette
    const event = new CustomEvent('command-palette-trigger', {
      bubbles: true,
      detail: { 
        source: 'search-button',
        type: 'file' // or 'command' for command mode
      }
    });
    document.dispatchEvent(event);
  };

  return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
          onClick={handleClick}
            className="flex h-10 w-full items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <SearchIcon size={20} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
        Command Palette
        {/* <span className="text-xs text-muted-foreground">{` (ctrl+shift+p)`}</span> */}
        </TooltipContent>
      </Tooltip>
  );
}
