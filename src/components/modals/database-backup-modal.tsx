"use client";
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Database,
  Copy,
  Terminal,
  CheckCircle,
  AlertCircle,
  FileText,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import { getConnectionDetails } from "@/lib/actions/fetch-data";
import {
  BackupCommand,
  generateDatabaseBackupCommands,
} from "@/lib/actions/database-backup";
import { ConnectionDetailsType } from "@/types/db.type";

interface DatabaseBackupModalProps {
  children: React.ReactNode;
}

export function DatabaseBackupModal({ children }: DatabaseBackupModalProps) {
  const [open, setOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [backupCommands, setBackupCommands] = useState<BackupCommand[]>([]);
  const [selectedCommand, setSelectedCommand] = useState<BackupCommand | null>(null);

  const [currentConnection, setCurrentConnection] = useState<any>(null);
  const [connectionDetails, setConnectionDetails] = useState<any>(null);


  useEffect(() => {
    const fetchConnectionDetails = async () => {
      const { connectionDetails: details } = await getConnectionDetails();
      if (!details) return;
      await generateBackupCommand();
      setCurrentConnection(details ? true : false);
      setConnectionDetails(details);
    };

    if (open) fetchConnectionDetails();
  }, [open]);

  const generateBackupCommand = async () => {
    try {
      const commands = await generateDatabaseBackupCommands();
      setBackupCommands(commands);
      // Set the first command as selected by default
      if (commands.length > 0) {
        setSelectedCommand(commands[0]);
      }
    } catch (error) {
      console.error("Failed to generate backup commands:", error);
      toast.error("Failed to generate backup commands");
    }
  };

  const handleCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      toast.success("Command copied to clipboard!");

      // Reset copied state after 2 seconds
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch (error) {
      toast.error("Failed to copy command");
    }
  };

  const currentCommand = selectedCommand?.command || "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[90vh] min-h-[400px] flex-col overflow-hidden sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Backup Commands
          </DialogTitle>
          <DialogDescription>
            Copy and run these commands in your terminal to create database
            backups.
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 dark:scrollbar-thumb-gray-600 dark:scrollbar-track-gray-800 flex-1 space-y-6 overflow-y-auto px-1 py-2">
          {/* Connection Status */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">Connected Database</span>
            </div>
            <Badge variant={currentConnection ? "default" : "destructive"}>
              {currentConnection
                ? connectionDetails?.connection_type?.toUpperCase()
                : "Not Connected"}
            </Badge>
          </div>


          {/* Backup Commands */}
          {backupCommands.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  <Label className="text-sm font-medium">Available Commands</Label>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={generateBackupCommand}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>

              {/* Command Selection */}
              <div className="space-y-3">
                {backupCommands.map((command, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                      selectedCommand === command
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedCommand(command)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${
                            selectedCommand === command ? "bg-primary" : "bg-muted-foreground"
                          }`} />
                          <span className="text-sm font-medium">{command.description}</span>
                        </div>
                        <div className="rounded bg-muted/50 p-2 font-mono text-xs">
                          <code className="break-all">{command.command}</code>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-2 h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyCommand(command.command);
                        }}
                      >
                        {copiedCommand === command.command ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Selected Command Details */}
              {selectedCommand && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <Label className="text-sm font-medium">Selected Command</Label>
                  </div>

                  <div className="relative">
                    <div className="rounded-lg border bg-muted p-3 font-mono text-sm">
                      <code className="break-all">{currentCommand}</code>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="absolute right-2 top-2 h-8 w-8 p-0"
                      onClick={() => handleCopyCommand(currentCommand)}
                    >
                      {copiedCommand === currentCommand ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {/* Additional Commands */}
                  {selectedCommand.additionalCommands && selectedCommand.additionalCommands.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Related Commands</Label>
                      {selectedCommand.additionalCommands.map((additionalCommand, index) => (
                        <div key={index} className="rounded-lg border bg-muted/30 p-3">
                          <div className="mb-2 text-xs font-medium text-muted-foreground">
                            {additionalCommand.description}
                          </div>
                          <div className="flex items-center justify-between">
                            <code className="break-all text-xs flex-1">{additionalCommand.command}</code>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-2 h-6 w-6 p-0"
                              onClick={() => handleCopyCommand(additionalCommand.command)}
                            >
                              {copiedCommand === additionalCommand.command ? (
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}


              {/* Instructions Toggle */}
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowInstructions(!showInstructions)}
                  className="gap-2 border-muted-foreground/20 hover:border-muted-foreground/40"
                >
                  <HelpCircle className="h-4 w-4" />
                  {showInstructions ? "Hide Instructions" : "Show Instructions"}
                </Button>
              </div>

              {/* Instructions */}
              {showInstructions && (
                <div className="rounded-lg border border-border/50 bg-background/20 bg-[radial-gradient(circle_at_top_left,#21b45910_0%,transparent_50%),radial-gradient(circle_at_bottom_right,#21b45910_0%,transparent_50%)] p-4 backdrop-blur-xl">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <HelpCircle className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        How to Use These Commands
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Follow these steps to execute your backup commands
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="grid gap-2">
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          1
                        </div>
                        <span className="text-sm text-foreground">
                          Copy the backup command above
                        </span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          2
                        </div>
                        <span className="text-sm text-foreground">
                          Open your terminal/command prompt
                        </span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          3
                        </div>
                        <span className="text-sm text-foreground">
                          Navigate to your desired backup directory
                        </span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          4
                        </div>
                        <span className="text-sm text-foreground">
                          Paste and run the command
                        </span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          5
                        </div>
                        <span className="text-sm text-foreground">
                          Enter your database password if prompted
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 rounded-md bg-muted/30 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                          <span className="text-xs">💡</span>
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          Pro Tips
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div>
                          • Ensure required database tools are installed
                        </div>
                        <div>
                          • Test connections before running large backups
                        </div>
                        <div>
                          • Use validation commands for server transfers
                        </div>
                        <div>
                          • Keep backups in a secure, accessible location
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border bg-yellow-50 p-3 dark:bg-yellow-950/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  No backup commands available
                </span>
              </div>
              <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
                Please ensure you have an active database connection and the
                necessary tools installed.
              </p>
            </div>
          )}
        </div>

        {/* Spacer to prevent footer overlap */}
        <div className="h-4" />

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          {currentCommand && (
            <Button
              onClick={() => handleCopyCommand(currentCommand)}
              className="gap-2"
            >
              {copiedCommand === currentCommand ? (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy Selected Command
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
