"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Clock,
  Copy,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { TestResult } from "../lib/actions/test-api";
import { Editor } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import GithubDark from "@/components/views/editor/github-dark.json";
import GithubLight from "@/components/views/editor/github-light.json";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TestResultDisplayProps {
  result: TestResult;
}

const TestResultDisplay: React.FC<TestResultDisplayProps> = ({ result }) => {
  const [copied, setCopied] = React.useState(false);
  const { resolvedTheme } = useTheme();
  const [activeTab, setActiveTab] = React.useState("json");

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "loading":
        return <Clock className="h-4 w-4 animate-spin text-blue-500" />;
    }
  };

  const getStatusColor = (status: TestResult["status"]) => {
    switch (status) {
      case "success":
        return "bg-green-100 text-green-800 border-green-200";
      case "error":
        return "bg-red-100 text-red-800 border-red-200";
      case "loading":
        return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const formatResponse = (response: any) => {
    if (typeof response === "string") {
      try {
        return JSON.stringify(JSON.parse(response), null, 2);
      } catch {
        return response;
      }
    }
    return JSON.stringify(response, null, 2);
  };

  const getLanguage = (response: any) => {
    if (typeof response === "string") {
      try {
        JSON.parse(response);
        return "json";
      } catch {
        return "text";
      }
    }
    return "json";
  };

  const handleEditor = async (editor: any, monaco: any) => {
    monaco.editor.defineTheme("github-dark", GithubDark);
    monaco.editor.defineTheme("github-light", GithubLight);
    monaco.editor.setTheme(
      resolvedTheme === "dark" ? "github-dark" : "github-light",
    );
  };

  return (
    <div
      className="flex w-full flex-col gap-2"
      style={{ height: "calc(100% - 2rem)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {getStatusIcon(result.status)}
          <div className="flex items-center gap-2">
            <Badge className={getStatusColor(result.status)}>
              {result.statusCode || result.status}
            </Badge>
            {result.duration && (
              <span className="text-xs text-muted-foreground">
                {result.duration}ms
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {result.timestamp.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {result.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">Error</p>
          <p className="mt-1 text-xs text-red-600">{result.error}</p>
        </div>
      )}

      {result.response && (
        <div className="space-y-3" style={{ height: "calc(100% - 2rem)" }}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Response</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(formatResponse(result.response))}
              className="h-7 px-2"
            >
              <Copy className="mr-1 h-3 w-3" />
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            style={{ height: "calc(100% - 2rem)" }}
          >
            <TabsList className="border border-border bg-secondary">
              <TabsTrigger value="json">JSON</TabsTrigger>
              <TabsTrigger value="raw">Raw</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <div
              className="overflow-hidden rounded-md border mt-2"
              style={{ height: "calc(100% - 3rem)" }}
            >
              {activeTab === "json" && (
                <Editor
                  language={getLanguage(result.response)}
                  value={formatResponse(result.response)}
                  defaultLanguage="json"
                  theme={
                    resolvedTheme === "dark" ? "github-dark" : "github-light"
                  }
                  onMount={(editor, monaco) => {
                    handleEditor(editor, monaco);
                  }}
                  options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    lineNumbers: "on",
                    glyphMargin: false,
                    roundedSelection: false,
                    automaticLayout: true,
                    wordWrap: "on",
                    folding: true,
                    showFoldingControls: "always",
                    renderLineHighlight: "all",
                    cursorBlinking: "smooth",
                    cursorSmoothCaretAnimation: "on",
                    readOnly: true,
                    lineNumbersMinChars: 3,
                  }}
                />
              )}
              {activeTab === "raw" && (
                <pre className="p-3 font-mono text-xs">
                  {formatResponse(result.response)}
                </pre>
              )}
              {activeTab === "preview" && (
                <div className="h-full overflow-auto p-4">
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: formatResponse(result.response) }}
                  ></div>
                </div>
              )}
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
};

export default TestResultDisplay;
