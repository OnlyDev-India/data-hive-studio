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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Database,
  Copy,
  Terminal,
  CheckCircle,
  ExternalLink,
  AlertCircle,
  Settings,
  Server,
  FileText,
  Download,
  HelpCircle,
} from "lucide-react";
import { getCurrentConnectionDetails } from "@/lib/actions/database-backup";

interface DatabaseBackupModalProps {
  children: React.ReactNode;
}

export function DatabaseBackupModal({ children }: DatabaseBackupModalProps) {
  const [open, setOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const [currentConnection, setCurrentConnection] = useState<any>(null);
  const [connectionDetails, setConnectionDetails] = useState<any>(null);

  // Backup options state
  const [backupOptions, setBackupOptions] = useState({
    backupType: 'file', // 'file' or 'server'
    outputFormat: 'default', // 'default', 'compressed', 'custom'
    includeSchema: true,
    includeData: true,
    includeIndexes: true,
    customOutputPath: '',
    targetServer: {
      host: '',
      port: '',
      username: '',
      database: '',
      password: ''
    },
    compression: false,
    timestamp: true
  });

  useEffect(() => {
    const fetchConnectionDetails = async () => {
      const details = await getCurrentConnectionDetails();
      setCurrentConnection(details ? true : false);
      setConnectionDetails(details);
    };
    
    if(open) fetchConnectionDetails();
  }, [open]);

  const generateBackupCommand = () => {
    if (!connectionDetails) return null;

    const { connection_type, connection_string } = connectionDetails;
    
    switch (connection_type) {
      case 'mongodb':
        return generateMongoDBBackupCommand(connection_string);
      case 'pgSql':
        return generatePostgreSQLBackupCommand(connection_string);
      case 'sqlite':
        return generateSQLiteBackupCommand(connection_string);
      default:
        return null;
    }
  };

  const generateMongoDBBackupCommand = (connectionString: string) => {
    const timestamp = backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : '';
    const dbName = connectionString.split('/').pop()?.split('?')[0] || 'database';
    
    if (backupOptions.backupType === 'server') {
      const { host, port, username, database, password } = backupOptions.targetServer;
      const targetUri = `mongodb://${username}:${password}@${host}:${port}/${database}`;
      return `mongodump --uri="${connectionString}" --out=./temp-backup && mongorestore --uri="${targetUri}" ./temp-backup/${dbName}`;
    }
    
    let command = `mongodump --uri="${connectionString}"`;
    
    // Handle output format
    if (backupOptions.outputFormat === 'compressed' || backupOptions.compression) {
      command += ' --gzip';
    }
    
    // Handle output path based on format
    if (backupOptions.outputFormat === 'custom' && backupOptions.customOutputPath) {
      command += ` --out="${backupOptions.customOutputPath}"`;
    } else {
      const outputPath = backupOptions.outputFormat === 'compressed' 
        ? `./backup${timestamp}-compressed` 
        : `./backup${timestamp}`;
      command += ` --out=${outputPath}`;
    }
    
    // Handle data inclusion
    if (!backupOptions.includeData) {
      command += ' --dryRun';
    }
    
    // Handle schema-only for MongoDB (collection list)
    if (!backupOptions.includeSchema && backupOptions.includeData) {
      command += ' --excludeCollection=schema';
    }
    
    return command;
  };

    const generatePostgreSQLBackupCommand = (connectionString: string) => {
    const timestamp = backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : '';
    const url = new URL(connectionString);
    const dbName = url.pathname.slice(1);
    const host = url.hostname;
    const port = url.port || '5432';
    const username = url.username;
    
    if (backupOptions.backupType === 'server') {
      const { host: targetHost, port: targetPort, username: targetUser, database: targetDb, password: targetPass } = backupOptions.targetServer;
      return `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} | psql -h ${targetHost} -p ${targetPort} -U ${targetUser} -d ${targetDb}`;
    }
    
    let command = `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName}`;
    
    // Handle schema/data inclusion
    if (!backupOptions.includeSchema) {
      command += ' --data-only';
    } else if (!backupOptions.includeData) {
      command += ' --schema-only';
    }
    
    if (!backupOptions.includeIndexes) {
      command += ' --no-indexes';
    }
    
    // Handle output format
    const isCompressed = backupOptions.compression || backupOptions.outputFormat === 'compressed';
    if (isCompressed) {
      command += ' -Fc';
    }
    
    // Handle output path and file extension based on format
    if (backupOptions.outputFormat === 'custom' && backupOptions.customOutputPath) {
      command += ` > "${backupOptions.customOutputPath}"`;
    } else {
      let fileName;
      switch (backupOptions.outputFormat) {
        case 'compressed':
          fileName = `backup${timestamp}-compressed.dump`;
          break;
        case 'default':
        default:
          fileName = isCompressed ? `backup${timestamp}.dump` : `backup${timestamp}.sql`;
          break;
      }
      command += ` > ${fileName}`;
    }
    
    return command;
  };

  const generateSQLiteBackupCommand = (connectionString: string) => {
    const timestamp = backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : '';
    const dbPath = connectionString.replace('file:', '');
    
    if (backupOptions.backupType === 'server') {
      const { host, port, username, database, password } = backupOptions.targetServer;
      // For SQLite, we'll create a SQL dump and then import to target
      return `sqlite3 "${dbPath}" ".dump" > temp-backup.sql && psql -h ${host} -p ${port} -U ${username} -d ${database} < temp-backup.sql`;
    }
    
    // Handle output format and path
    if (backupOptions.outputFormat === 'custom' && backupOptions.customOutputPath) {
      if (backupOptions.compression) {
        return `sqlite3 "${dbPath}" ".dump" | gzip > "${backupOptions.customOutputPath}"`;
      } else {
        return `cp "${dbPath}" "${backupOptions.customOutputPath}"`;
      }
    } else {
      let fileName;
      let command;
      
      switch (backupOptions.outputFormat) {
        case 'compressed':
          fileName = `backup${timestamp}-compressed.sql.gz`;
          command = `sqlite3 "${dbPath}" ".dump" | gzip > ${fileName}`;
          break;
        case 'default':
        default:
          if (backupOptions.compression) {
            fileName = `backup${timestamp}.sql.gz`;
            command = `sqlite3 "${dbPath}" ".dump" | gzip > ${fileName}`;
          } else {
            fileName = `backup${timestamp}.db`;
            command = `cp "${dbPath}" "./${fileName}"`;
          }
          break;
      }
      
      return command;
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

  const backupCommand = generateBackupCommand();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] min-h-[400px] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Backup Commands
          </DialogTitle>
          <DialogDescription>
            Copy and run these commands in your terminal to create database backups.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 flex-1 overflow-y-auto px-1 py-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 dark:scrollbar-thumb-gray-600 dark:scrollbar-track-gray-800">
          {/* Connection Status */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">Connected Database</span>
            </div>
            <Badge variant={currentConnection ? "default" : "destructive"}>
              {currentConnection ? connectionDetails?.connection_type?.toUpperCase() : "Not Connected"}
            </Badge>
          </div>

          {/* Advanced Options Toggle */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              className="gap-2"
            >
              <Settings className="h-4 w-4" />
              {showAdvancedOptions ? 'Hide' : 'Show'} Advanced Options
            </Button>
          </div>

          {/* Advanced Options */}
          {showAdvancedOptions && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <Label className="text-sm font-medium">Backup Configuration</Label>
            </div>

              {/* Backup Type Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                  <Label className="text-xs">Backup Type</Label>
                  <Select
                    value={backupOptions.backupType}
                    onValueChange={(value: 'file' | 'server') =>
                      setBackupOptions(prev => ({ ...prev, backupType: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="file">
                        <div className="flex items-center gap-2">
                          <FileText className="h-3 w-3" />
                          Save to File
                        </div>
                      </SelectItem>
                      <SelectItem value="server">
                        <div className="flex items-center gap-2">
                          <Server className="h-3 w-3" />
                          Transfer to Server
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Output Format</Label>
                  <Select
                    value={backupOptions.outputFormat}
                    onValueChange={(value: 'default' | 'compressed' | 'custom') =>
                      setBackupOptions(prev => ({ ...prev, outputFormat: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="compressed">Compressed</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                  </div>

              {/* Include Options */}
              <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeSchema"
                      checked={backupOptions.includeSchema}
                      onCheckedChange={(checked) =>
                      setBackupOptions(prev => ({ ...prev, includeSchema: checked as boolean }))
                    }
                  />
                  <Label htmlFor="includeSchema" className="text-xs">Schema</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeData"
                    checked={backupOptions.includeData}
                    onCheckedChange={(checked) =>
                      setBackupOptions(prev => ({ ...prev, includeData: checked as boolean }))
                    }
                  />
                  <Label htmlFor="includeData" className="text-xs">Data</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeIndexes"
                      checked={backupOptions.includeIndexes}
                      onCheckedChange={(checked) =>
                      setBackupOptions(prev => ({ ...prev, includeIndexes: checked as boolean }))
                    }
                  />
                  <Label htmlFor="includeIndexes" className="text-xs">Indexes</Label>
                </div>
              </div>

              {/* Custom Output Path */}
              {backupOptions.outputFormat === 'custom' && (
                <div className="space-y-2">
                  <Label className="text-xs">Custom Output Path</Label>
                  <Input
                    placeholder="/path/to/backup/file"
                    value={backupOptions.customOutputPath}
                    onChange={(e) =>
                      setBackupOptions(prev => ({ ...prev, customOutputPath: e.target.value }))
                    }
                  />
                </div>
              )}

              {/* Target Server Configuration */}
              {backupOptions.backupType === 'server' && (
                <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    <Label className="text-sm font-medium">Target Server</Label>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Host</Label>
                      <Input
                        placeholder="localhost"
                        value={backupOptions.targetServer.host}
                        onChange={(e) =>
                          setBackupOptions(prev => ({
                            ...prev,
                            targetServer: { ...prev.targetServer, host: e.target.value }
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Port</Label>
                      <Input
                        placeholder="5432"
                        value={backupOptions.targetServer.port}
                        onChange={(e) =>
                          setBackupOptions(prev => ({
                            ...prev,
                            targetServer: { ...prev.targetServer, port: e.target.value }
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Username</Label>
                      <Input
                        placeholder="username"
                        value={backupOptions.targetServer.username}
                        onChange={(e) =>
                          setBackupOptions(prev => ({
                            ...prev,
                            targetServer: { ...prev.targetServer, username: e.target.value }
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Database</Label>
                      <Input
                        placeholder="database_name"
                        value={backupOptions.targetServer.database}
                        onChange={(e) =>
                          setBackupOptions(prev => ({
                          ...prev,
                            targetServer: { ...prev.targetServer, database: e.target.value }
                        }))
                      }
                    />
                  </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Password</Label>
                      <Input
                        type="password"
                        placeholder="password"
                        value={backupOptions.targetServer.password}
                        onChange={(e) =>
                          setBackupOptions(prev => ({
                          ...prev,
                            targetServer: { ...prev.targetServer, password: e.target.value }
                        }))
                      }
                    />
                    </div>
                  </div>
                </div>
              )}

              {/* Additional Options */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="compression"
                    checked={backupOptions.compression}
                    onCheckedChange={(checked) =>
                      setBackupOptions(prev => ({ ...prev, compression: checked as boolean }))
                    }
                  />
                  <Label htmlFor="compression" className="text-xs">Enable Compression</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="timestamp"
                    checked={backupOptions.timestamp}
                    onCheckedChange={(checked) =>
                      setBackupOptions(prev => ({ ...prev, timestamp: checked as boolean }))
                    }
                  />
                  <Label htmlFor="timestamp" className="text-xs">Add Timestamp</Label>
                </div>
              </div>
            </div>
          )}

          {/* Backup Command */}
          {backupCommand ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                <Label className="text-sm font-medium">Backup Command</Label>
          </div>

              <div className="relative">
                <div className="rounded-lg border bg-muted p-3 font-mono text-sm">
                  <code className="break-all">{backupCommand}</code>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute right-2 top-2 h-8 w-8 p-0"
                  onClick={() => handleCopyCommand(backupCommand)}
                >
                  {copiedCommand === backupCommand ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Related Commands */}
              {(backupOptions.backupType === 'file' || backupOptions.outputFormat !== 'default') && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Related Commands:</h4>
                  
                  {/* File backup related commands */}
                  {backupOptions.backupType === 'file' && (
                    <div className="space-y-2">
                      {/* Restore command based on current options */}
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">
                          Restore this backup:
                        </div>
                        <code className="text-xs break-all">
                          {connectionDetails?.connection_type === 'mongodb' && 
                            `mongorestore --uri="${connectionDetails.connection_string}" ${backupOptions.customOutputPath || `./backup${backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : ''}`}${backupOptions.compression ? ' --gzip' : ''}`
                          }
                          {connectionDetails?.connection_type === 'pgSql' && 
                            `${backupOptions.compression || backupOptions.outputFormat === 'compressed' 
                              ? `pg_restore -h ${new URL(connectionDetails.connection_string).hostname} -U ${new URL(connectionDetails.connection_string).username} -d ${new URL(connectionDetails.connection_string).pathname.slice(1)} ${backupOptions.customOutputPath || `backup${backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : ''}.dump`}`
                              : `psql -h ${new URL(connectionDetails.connection_string).hostname} -U ${new URL(connectionDetails.connection_string).username} -d ${new URL(connectionDetails.connection_string).pathname.slice(1)} < ${backupOptions.customOutputPath || `backup${backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : ''}.sql`}`
                            }`
                          }
                          {connectionDetails?.connection_type === 'sqlite' && 
                            `cp "${backupOptions.customOutputPath || `./backup${backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : ''}.db`}" "${connectionDetails.connection_string.replace('file:', '')}"`
                          }
                        </code>
                      </div>

                      {/* Verify backup command */}
                      {connectionDetails?.connection_type === 'mongodb' && (
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <div className="mb-2 text-xs font-medium text-muted-foreground">
                            Verify backup integrity:
                          </div>
                          <code className="text-xs break-all">
                            ls -la ${backupOptions.customOutputPath || `./backup${backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : ''}`} && echo "Backup files found"
                          </code>
            </div>
          )}

                      {/* Compress existing backup */}
                      {!backupOptions.compression && backupOptions.backupType === 'file' && connectionDetails?.connection_type === 'pgSql' && (
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <div className="mb-2 text-xs font-medium text-muted-foreground">
                            Compress existing backup:
                          </div>
                          <code className="text-xs break-all">
                            gzip ${backupOptions.customOutputPath || `backup${backupOptions.timestamp ? `-${new Date().toISOString().split('T')[0]}` : ''}.sql`}
                          </code>
                        </div>
                      )}
              </div>
                  )}
                </div>
              )}

              {/* Server transfer validation commands */}
              {backupOptions.backupType === 'server' && backupOptions.targetServer.host && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Validation Commands:</h4>
                  <div className="space-y-2">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">
                        Test target server connection:
                      </div>
                      <code className="text-xs break-all">
                        {connectionDetails?.connection_type === 'mongodb' && 
                          `mongosh "mongodb://${backupOptions.targetServer.username}:${backupOptions.targetServer.password}@${backupOptions.targetServer.host}:${backupOptions.targetServer.port}/${backupOptions.targetServer.database}" --eval "db.runCommand({ping: 1})"`
                        }
                        {connectionDetails?.connection_type === 'pgSql' && 
                          `psql -h ${backupOptions.targetServer.host} -p ${backupOptions.targetServer.port} -U ${backupOptions.targetServer.username} -d ${backupOptions.targetServer.database} -c "SELECT 1;"`
                        }
                        {connectionDetails?.connection_type === 'sqlite' && 
                          `psql -h ${backupOptions.targetServer.host} -p ${backupOptions.targetServer.port} -U ${backupOptions.targetServer.username} -d ${backupOptions.targetServer.database} -c "SELECT 1;"`
                        }
                      </code>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">
                        Verify transfer completion:
                      </div>
                      <code className="text-xs break-all">
                        {connectionDetails?.connection_type === 'mongodb' && 
                          `mongosh "mongodb://${backupOptions.targetServer.username}:${backupOptions.targetServer.password}@${backupOptions.targetServer.host}:${backupOptions.targetServer.port}/${backupOptions.targetServer.database}" --eval "db.stats()"`
                        }
                        {(connectionDetails?.connection_type === 'pgSql' || connectionDetails?.connection_type === 'sqlite') && 
                          `psql -h ${backupOptions.targetServer.host} -p ${backupOptions.targetServer.port} -U ${backupOptions.targetServer.username} -d ${backupOptions.targetServer.database} -c "\\dt"`
                        }
                      </code>
                    </div>
              </div>
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
                  {showInstructions ? 'Hide Instructions' : 'Show Instructions'}
                </Button>
              </div>

              {/* Instructions */}
              {showInstructions && (
                <div className="rounded-lg border border-border/50 bg-[radial-gradient(circle_at_top_left,#21b45910_0%,transparent_50%),radial-gradient(circle_at_bottom_right,#21b45910_0%,transparent_50%)] backdrop-blur-xl bg-background/20 p-4">
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
                        <span className="text-sm text-foreground">Copy the backup command above</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          2
                        </div>
                        <span className="text-sm text-foreground">Open your terminal/command prompt</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          3
                        </div>
                        <span className="text-sm text-foreground">Navigate to your desired backup directory</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          4
                        </div>
                        <span className="text-sm text-foreground">Paste and run the command</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          5
                        </div>
                        <span className="text-sm text-foreground">Enter your database password if prompted</span>
                      </div>
                    </div>
                    
                    <div className="mt-4 rounded-md bg-muted/30 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                          <span className="text-xs">💡</span>
                        </div>
                        <span className="text-sm font-medium text-foreground">Pro Tips</span>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div>• Ensure required database tools are installed</div>
                        <div>• Test connections before running large backups</div>
                        <div>• Use validation commands for server transfers</div>
                        <div>• Keep backups in a secure, accessible location</div>
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
                  No backup command available
                </span>
              </div>
              <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
                Please ensure you have an active database connection and the necessary tools installed.
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
          {backupCommand && (
          <Button
              onClick={() => handleCopyCommand(backupCommand)}
            className="gap-2"
          >
              {copiedCommand === backupCommand ? (
              <>
                  <CheckCircle className="h-4 w-4" />
                  Copied!
              </>
            ) : (
              <>
                  <Copy className="h-4 w-4" />
                  Copy Command
              </>
            )}
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
