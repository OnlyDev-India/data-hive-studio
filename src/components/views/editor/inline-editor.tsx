"use client";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, AlertCircle } from "lucide-react";

interface InlineEditorProps {
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onStream?: (chunk: string) => void; // New callback for streaming updates
  onHeightChange?: (height: number) => void; // Callback for height changes
  useAI?: boolean;
  dbType?: string;
  schemaContext?: string;
}

const InlineEditor: React.FC<InlineEditorProps> = ({
  onSubmit,
  onCancel,
  onStream,
  onHeightChange,
  useAI = false,
  dbType = "mongodb",
  schemaContext = "",
}) => {
  const [value, setValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFocus = () => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();

      // Set initial height based on content
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    // Add a small delay to ensure the textarea is rendered
    const timer = setTimeout(() => {
      handleFocus();
    }, 2);

    return () => {
      clearTimeout(timer);
      onCancel();
    };
  }, []);

  // Update height when error or loading state changes
  useEffect(() => {
    if (containerRef.current && onHeightChange) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        if (containerRef.current) {
          const height = containerRef.current.offsetHeight;
          onHeightChange(height); // Parent will restore focus after zone update
        }
      }, 2);
    }
  }, [error, isGenerating, onHeightChange]);

  const handleGenerate = async () => {
    if (!value.trim()) return;

    if (useAI) {
      setIsGenerating(true);
      setError(null); // Clear previous errors

      try {
        let fullQuery = "";

        // Call streaming API endpoint
        const response = await fetch("/api/ai/generate-query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: value.trim(),
            dbType: dbType as "mongodb" | "pgSql" | "sqlite",
            context: schemaContext,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          setError(
            errorData.error || "Failed to generate query. Please try again.",
          );
          setIsGenerating(false);
          return;
        }

        // Process the Server-Sent Events stream
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value: chunk } = await reader.read();

          if (done) break;

          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");

          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();

            // Skip empty lines
            if (!trimmedLine) continue;

            // Parse SSE data
            if (trimmedLine.startsWith("data: ")) {
              const data = trimmedLine.slice(6);

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === "error") {
                  setError(
                    parsed.error ||
                      "Failed to generate query. Please try again.",
                  );
                  setIsGenerating(false);
                  return;
                }

                if (parsed.type === "chunk" && parsed.content) {
                  fullQuery += parsed.content;

                  // Don't stream if it's starting to look like an error message
                  const shouldStream = !fullQuery.startsWith("ERROR");

                  // Stream each chunk to the editor in real-time (unless it's an error)
                  if (onStream && shouldStream) {
                    onStream(parsed.content);
                  }
                }

                if (parsed.type === "done") {
                  // Clean up the final response (remove markdown code blocks if present)
                  let cleanedQuery = fullQuery
                    .replace(/```(?:sql|mongodb|javascript)?\n?/g, "")
                    .replace(/```\n?$/g, "")
                    .trim();

                  // Check if AI returned an error
                  if (cleanedQuery.startsWith("ERROR:")) {
                    const errorMessage = cleanedQuery
                      .replace("ERROR:", "")
                      .trim();
                    setError(errorMessage || "Invalid or unclear prompt");
                    setIsGenerating(false);
                    return;
                  }

                  // Auto-fix MongoDB format if AI generated wrong format
                  // Convert db.collectionName.method() to db.collection("collectionName").method()
                  if (dbType === "mongodb") {
                    cleanedQuery = cleanedQuery.replace(
                      /\bdb\.([a-zA-Z_][a-zA-Z0-9_]*)\.(find|aggregate|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|countDocuments|distinct|replaceOne)/g,
                      'db.collection("$1").$2',
                    );
                  }

                  // Close the inline editor
                  onCancel();
                  return;
                }
              } catch (e) {
                console.warn("Failed to parse SSE data:", data);
              }
            }
          }
        }
      } catch (error: any) {
        console.error("Failed to generate query:", error);
        setError(
          error.message || "Failed to generate query. Please try again.",
        );
      } finally {
        setIsGenerating(false);
      }
    } else {
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    } else {
      onCancel();
    }
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);

    // Auto-grow textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"; // Reset height
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`; // Set to scroll height

      // Notify parent of height change
      if (containerRef.current && onHeightChange) {
        setTimeout(() => {
          if (containerRef.current) {
            const height = containerRef.current.offsetHeight;
            onHeightChange(height);
          }
        }, 0);
      }
    }

    // Clear error when user starts typing again
    if (error) {
      setError(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Enter without Shift: Generate/Submit
      e.preventDefault();
      if (useAI) {
        handleGenerate();
      } else {
        handleSubmit();
      }
    } else if (e.key === "Enter" && e.shiftKey) {
      // Shift+Enter: Allow new line (don't prevent default)
      return;
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="inlineDiffViewZone relative box-border min-h-[62px] w-full overflow-visible">
      <div className="h-full w-full">
        <div className="flex flex-col gap-1">
          <div
            tabIndex={0}
            className="z-[100] box-border flex w-full flex-row pt-1.5 outline-none"
          >
            <div className="w-0"></div>
            <div
              ref={containerRef}
              className="relative z-[1000001] ml-0.5 mr-4 box-border w-[calc(100%-20px)] min-w-[300px] max-w-[70%] overflow-visible rounded-md border border-border bg-secondary text-xs leading-6 text-foreground shadow-lg shadow-background"
            >
              <div className="flex flex-col">
                <div className="flex-grow">
                  <div className="flex w-full items-center">
                    <div className="flex-1">
                      <div className="w-full overflow-hidden">
                        <textarea
                          ref={textareaRef}
                          value={value}
                          onChange={handleValueChange}
                          onKeyDown={handleKeyDown}
                          placeholder={
                            useAI
                              ? "Describe the query you want to generate..."
                              : "Edit selected code"
                          }
                          disabled={isGenerating}
                          rows={1}
                          className="box-border block min-h-10 w-full select-text resize-none overflow-y-hidden whitespace-pre-wrap break-words border-none bg-transparent p-2 font-mono text-xs leading-6 text-foreground outline-none disabled:opacity-50"
                          style={{ height: "auto", overflowY: "hidden" }}
                        />
                        {error && (
                          <div className="mx-2 mt-1 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[10px] text-destructive">
                            <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                            <span>{error}</span>
                          </div>
                        )}
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
                  <div className="m-1 flex items-center justify-between gap-2">
                    <div className="text-[10px] text-muted-foreground">
                      {useAI
                        ? isGenerating
                          ? "Generating and inserting query..."
                          : "Press Enter to generate"
                        : "Press Enter to submit"}
                    </div>

                    <div className="flex gap-1.5">
                      {useAI ? (
                        <Button
                          onClick={handleGenerate}
                          size="sm"
                          disabled={!value.trim() || isGenerating}
                          className="h-[18px] flex-shrink-0 scale-90 px-2 text-[10px] text-white"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="mr-1 h-2.5 w-2.5" />
                              Generate
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          onClick={handleSubmit}
                          size="sm"
                          className="h-[18px] w-[18px] flex-shrink-0 scale-90 p-0 text-white"
                        >
                          <span className="text-xs">↑</span>
                        </Button>
                      )}
                    </div>
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
