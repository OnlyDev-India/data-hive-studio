"use client";
import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoaderCircleIcon, LinkIcon, CheckIcon, XIcon } from "lucide-react";
import { parseConnectionString } from "@/lib/helper/connection-details";
import { toast } from "sonner";

interface ImportUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (connectionDetails: {
    host: string;
    port?: number;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
    connection_type: string;
    connection_string: string;
  }) => void;
}

const ImportUrlModal: React.FC<ImportUrlModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [parsedDetails, setParsedDetails] = useState<{
    host: string;
    port?: number;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
    connection_type: string;
    connection_string: string;
  } | null>(null);

  const parsedUrl=() => {
    if (!url.trim()) {
      setError("Please enter a connection URL");
      return;
    }

    try {
      const config = parseConnectionString(url);
      
      if (config.error) {
        setError(config.error);
        return;
      }

      let connectionType="";
      if(config.protocol?.toLowerCase().includes("postgresql")) {
        connectionType = "pgSql";
      } else if(config.protocol?.toLowerCase().includes("mongodb")) {
        connectionType = "mongodb";
      }

      const details = {
        host: config.host || "",
        port: config.port,
        username: config.user || "",
        password: config.password || "",
        database: config.database || "",
        ssl: config.ssl || false,
        connection_type: connectionType,
        connection_string: url,
      };
      return details;
    } catch (err) {
      setError("Failed to parse connection URL. Please check the format.");
      return null;
    }
  }

  const handleParseUrl = async () => {
    const details = parsedUrl();
    if(details) {
      setParsedDetails(details);
      toast.success("Connection URL parsed successfully!");
    }
  };

  const handleImport = () => {
    const details = parsedUrl();
    if (details) {
      onImport(details);
      handleClose();
    }
  };

  const handleClose = () => {
    setUrl("");
    setError("");
    setParsedDetails(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Import Connection URL
          </DialogTitle>
          <DialogDescription>
            Paste your database connection URL to automatically fill in the connection details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="connection-url">Connection URL</Label>
            <Textarea
              id="connection-url"
              placeholder="postgresql://username:password@localhost:5432/database"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="min-h-[100px] resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Supported formats: PostgreSQL, MongoDB connection strings
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <XIcon className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {parsedDetails && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckIcon className="h-4 w-4" />
                <span className="font-medium">Connection details parsed successfully!</span>
              </div>
              
              <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Host:</span> {parsedDetails.host}
                  </div>
                  <div>
                    <span className="font-medium">Port:</span> {parsedDetails.port}
                  </div>
                  <div>
                    <span className="font-medium">Username:</span> {parsedDetails.username}
                  </div>
                  <div>
                    <span className="font-medium">Database:</span> {parsedDetails.database}
                  </div>
                  <div>
                    <span className="font-medium">SSL:</span> {parsedDetails.ssl ? "Yes" : "No"}
                  </div>
                  <div>
                    <span className="font-medium">Password:</span> {"*".repeat(8)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} className="border-border">
            Cancel
          </Button>
          <Button
            onClick={handleParseUrl}
            disabled={isLoading || !url.trim()}
            variant="secondary"
            className="border border-border"
          >
            {isLoading && <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />}
            Parse URL
          </Button>
          <Button
            onClick={handleImport}
            disabled={isLoading || !url.trim()}
            className="bg-primary text-white hover:bg-primary/90"
          >
            Import Details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportUrlModal;
