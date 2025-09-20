"use client";
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CopyIcon, CheckIcon, DownloadIcon, DatabaseIcon } from "lucide-react";
import { toast } from "sonner";

interface ExportUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  exportedUrl: string;
  connectionType: string;
  onCopy: () => void;
  isCopied: boolean;
}

const ExportUrlModal: React.FC<ExportUrlModalProps> = ({
  isOpen,
  onClose,
  exportedUrl,
  connectionType,
  onCopy,
  isCopied,
}) => {
  const getConnectionTypeInfo = (type: string) => {
    switch (type) {
      case "pgSql":
        return {
          name: "PostgreSQL",
          color: "bg-blue-100 text-blue-800",
          icon: "🐘",
        };
      case "mongodb":
        return {
          name: "MongoDB",
          color: "bg-green-100 text-green-800",
          icon: "🍃",
        };
      default:
        return {
          name: "Database",
          color: "bg-gray-100 text-gray-800",
          icon: "🗄️",
        };
    }
  };

  const connectionInfo = getConnectionTypeInfo(connectionType);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadIcon className="h-5 w-5" />
            Export Connection URL
          </DialogTitle>
          <DialogDescription>
            Your connection details have been converted to a connection string.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Connection Type Badge */}
          <div className="flex items-center gap-2">
            <span className="text-2xl">{connectionInfo.icon}</span>
            <Badge className={connectionInfo.color}>
              {connectionInfo.name}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Connection String
            </span>
          </div>

          {/* Connection URL */}
          <div className="space-y-2">
            <Label htmlFor="exported-url" className="text-sm font-medium">
              Generated Connection URL
            </Label>
            <div className="relative">
              <Textarea
                id="exported-url"
                value={exportedUrl}
                readOnly
                className="min-h-[120px] resize-none border-border bg-secondary pr-11 font-mono text-sm"
                placeholder="Connection URL will appear here..."
              />
              <div className="absolute right-2 top-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onCopy}
                  className="h-8 w-8 p-0"
                >
                  {isCopied ? (
                    <CheckIcon className="h-4 w-4 text-green-600" />
                  ) : (
                    <CopyIcon className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Click the copy button or select all text to copy the connection
              URL
            </p>
          </div>

          {/* Security Notice */}
          <div className="rounded-lg border border-amber-200 bg-amber-200/10 p-3">
            <div className="flex items-start gap-2">
              <div className="text-amber-600">⚠️</div>
              <div className="text-xs text-amber-200">
                <strong>Security Notice:</strong>
                {` This URL contains sensitive information including your password. 
                Keep it secure and don't share it in public repositories or unsecured channels.`}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onCopy} className="flex items-center gap-2">
            {isCopied ? (
              <>
                <CheckIcon className="h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <CopyIcon className="h-4 w-4" />
                Copy URL
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ExportUrlModal;
