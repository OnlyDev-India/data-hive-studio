"use client";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface InlineEditorProps {
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const InlineEditor: React.FC<InlineEditorProps> = ({ onSubmit, onCancel }) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    } else {
      onCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="inlineDiffViewZone relative box-border h-[72px] min-h-[62px] w-full overflow-visible">
      <div className="h-full w-full">
        <div className="flex flex-col gap-1">
          <div
            tabIndex={0}
            className="z-[100] box-border flex w-full flex-row pt-1.5 outline-none"
          >
            <div className="w-0"></div>
            <div className="relative z-[1000001] ml-0.5 mr-4 box-border w-[calc(100%-20px)] min-w-[300px] max-w-[70%] overflow-visible rounded-md border border-border bg-secondary px-2 pt-2 text-xs leading-6 text-foreground shadow-xl shadow-background">
              <div className="flex flex-col">
                <div className="flex-grow">
                  <div className="flex w-full items-center">
                    <div className="flex-1">
                      <div className="w-full overflow-hidden">
                        <textarea
                          ref={textareaRef}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="Edit selected code"
                          className="custom-scrollbar box-border block h-10 w-full select-text resize-none overflow-hidden whitespace-pre-wrap break-words border-none bg-transparent p-2 font-mono text-xs leading-6 text-foreground outline-none"
                        />
                      </div>
                    </div>
                    <div className="mr-1 self-start">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                        className="h-6 w-6 p-0 text-foreground hover:bg-muted"
                      >
                        x
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0 pt-0.5">
                  <div className="my-1 flex items-center justify-start">
                    <div className="min-w-0 max-w-full">
                      <div className="flex min-w-0 max-w-full flex-shrink cursor-pointer items-center gap-1 overflow-hidden rounded-full border-none bg-transparent px-1.5 py-0.5 text-xs leading-3">
                        <div />
                      </div>
                    </div>
                    <div className="flex-grow"></div>
                    <div className="box-border flex min-h-5 cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap rounded px-1 text-xs leading-4">
                      <span className="text-[10px]">Edit Selection</span>
                      <span className="text-[10px] opacity-70">▼</span>
                    </div>
                    <Button
                      onClick={handleSubmit}
                      size="sm"
                      className="h-[18px] w-[18px] flex-shrink-0 scale-90 p-0 text-white"
                    >
                      <span className="text-xs">↑</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InlineEditor;
