"use client";
import React, { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Database,
  Download,
  Upload,
  FileText,
  Settings,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useSelector } from "react-redux";
import {
  createDatabaseBackup,
  DatabaseBackupOptions,
  BackupResult,
} from "@/lib/actions/database-backup";

interface DatabaseBackupModalProps {
  children: React.ReactNode;
}

export function DatabaseBackupModal({ children }: DatabaseBackupModalProps) {
  const [open, setOpen] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);

  const currentConnection = null;

  // Backup options state
  const [backupOptions, setBackupOptions] = useState<DatabaseBackupOptions>({
    includeData: true,
    includeSchema: true,
    includeIndexes: true,
    includeConstraints: true,
    format: "sql",
    compression: false,
  });

  const handleBackup = async () => {
    if (!currentConnection) {
      toast.error("No active database connection");
      return;
    }

    setIsBackingUp(true);
    setBackupProgress(0);
    setBackupResult(null);

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setBackupProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + 10;
        });
      }, 200);

      const result = await createDatabaseBackup(
        currentConnection,
        backupOptions,
      );

      clearInterval(progressInterval);
      setBackupProgress(100);

      if (result.success) {
        setBackupResult(result);
        toast.success(
          `Backup completed successfully! ${result.tablesCount} tables, ${result.recordsCount} records`,
        );

        // Trigger file download
        if (result.data && result.fileName) {
          const blob = new Blob([result.data], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = result.fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } else {
        toast.error(result.error || "Backup failed");
      }
    } catch (error) {
      toast.error("Backup failed: " + (error as Error).message);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async (file: File) => {
    // TODO: Implement restore functionality
    toast.info("Restore functionality coming soon!");
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Backup & Restore
          </DialogTitle>
          <DialogDescription>
            Create backups of your connected database or restore from previous
            backups.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Connection Status */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">Connected Database</span>
            </div>
            <Badge variant={currentConnection ? "default" : "destructive"}>
              {currentConnection
                ? currentConnection
                : "Not Connected"}
            </Badge>
          </div>

          {/* Backup Options */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <Label className="text-sm font-medium">Backup Options</Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Include in Backup</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeData"
                      checked={backupOptions.includeData}
                      onCheckedChange={(checked) =>
                        setBackupOptions((prev) => ({
                          ...prev,
                          includeData: checked as boolean,
                        }))
                      }
                    />
                    <Label htmlFor="includeData" className="text-xs">
                      Data
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeSchema"
                      checked={backupOptions.includeSchema}
                      onCheckedChange={(checked) =>
                        setBackupOptions((prev) => ({
                          ...prev,
                          includeSchema: checked as boolean,
                        }))
                      }
                    />
                    <Label htmlFor="includeSchema" className="text-xs">
                      Schema
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeIndexes"
                      checked={backupOptions.includeIndexes}
                      onCheckedChange={(checked) =>
                        setBackupOptions((prev) => ({
                          ...prev,
                          includeIndexes: checked as boolean,
                        }))
                      }
                    />
                    <Label htmlFor="includeIndexes" className="text-xs">
                      Indexes
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeConstraints"
                      checked={backupOptions.includeConstraints}
                      onCheckedChange={(checked) =>
                        setBackupOptions((prev) => ({
                          ...prev,
                          includeConstraints: checked as boolean,
                        }))
                      }
                    />
                    <Label htmlFor="includeConstraints" className="text-xs">
                      Constraints
                    </Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Format</Label>
                <Select
                  value={backupOptions.format}
                  onValueChange={(value: "sql" | "json" | "csv") =>
                    setBackupOptions((prev) => ({ ...prev, format: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sql">SQL</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="compression"
                    checked={backupOptions.compression}
                    onCheckedChange={(checked) =>
                      setBackupOptions((prev) => ({
                        ...prev,
                        compression: checked as boolean,
                      }))
                    }
                  />
                  <Label htmlFor="compression" className="text-xs">
                    Compress Backup
                  </Label>
                </div>
              </div>
            </div>
          </div>

          {/* Backup Progress */}
          {isBackingUp && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Creating backup...</span>
                <span>{backupProgress}%</span>
              </div>
              <Progress value={backupProgress} className="h-2" />
            </div>
          )}

          {/* Backup Result */}
          {backupResult && (
            <div className="rounded-lg border bg-green-50 p-3 dark:bg-green-950/20">
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-800 dark:text-green-200">
                  Backup Completed
                </span>
              </div>
              <div className="space-y-1 text-xs text-green-700 dark:text-green-300">
                <div>File: {backupResult.fileName}</div>
                <div>
                  Size:{" "}
                  {backupResult.backupSize
                    ? formatFileSize(backupResult.backupSize)
                    : "N/A"}
                </div>
                <div>Tables: {backupResult.tablesCount}</div>
                <div>Records: {backupResult.recordsCount}</div>
              </div>
            </div>
          )}

          {/* Restore Section */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Restore from Backup</Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".sql,.json,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleRestore(file);
                  }
                }}
                className="flex-1"
              />
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isBackingUp}
          >
            Cancel
          </Button>
          <Button
            onClick={handleBackup}
            disabled={!currentConnection || isBackingUp}
            className="gap-2"
          >
            {isBackingUp ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating Backup...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Create Backup
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
