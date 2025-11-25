"use client";
import React, { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { connectionFormSchema } from "@/types/schemas/connection-form-schema";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "../ui/form";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import ImportUrlModal from "../modals/import-url-modal";
import ExportUrlModal from "../modals/export-url-modal";
import { testConnection } from "@/lib/actions/fetch-data";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon, LinkIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  ConnectionDetailsType,
  ConnectionsType,
  DbConnectionColors,
  DbConnectionsTypes,
} from "@/types/db.type";
import { useDispatch, useSelector } from "react-redux";
import {
  initConnectedConnection,
  setCurrentConnection,
} from "@/redux/features/appdb";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { cn } from "@/lib/utils";
import { useAppData } from "@/hooks/useAppData";
import { AppDispatch, RootState } from "@/redux/store";
import { parseConnectionString } from "@/lib/helper/connection-details";
import { Label } from "../ui/label";

const ConnectionForm = () => {
  // TODO: when connecting from connection sub sidebar one more entry get added to the redux store
  const { createConnection, updateConnection } = useAppData();
  const [loading, setLoading] = React.useState<
    "connecting" | "testing" | "saving" | null
  >(null);
  const [isImportModalOpen, setIsImportModalOpen] = React.useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = React.useState(false);
  // const [exportedUrl, setExportedUrl] = React.useState("");
  const [isCopied, setIsCopied] = React.useState(false);
  const { currentConnection, loading: appLoading1= "idle" } = useSelector(
    (state: RootState) => state.appDB,
  );
  const appLoading = typeof window !== "undefined" && !window.electron ? "idle" : appLoading1;

  const dispatch = useDispatch<AppDispatch>();

  const router = useRouter();
  const defaultValues = {
    connection_type: "",
    connection_string: "",
    name: "untitled",
    color: "",
    host: "",
    port: undefined,
    username: "",
    password: "",
    database: "",
    ssl: false,
    save_password: true,
  };
  const form = useForm<z.infer<typeof connectionFormSchema>>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues,
  });

  // Persist a generated id for new connections
  const generatedIdRef = useRef<string>("");
  useEffect(() => {
    if (!currentConnection?.id && !generatedIdRef.current) {
      generatedIdRef.current = crypto.randomUUID();
    }
    if (currentConnection?.connection_type) {
      form.reset({
        connection_type: currentConnection?.connection_type || "",
        connection_string: currentConnection?.connection_string || "",
        name: currentConnection?.name || "",
        color: currentConnection?.color || "",
        host: currentConnection?.host || "",
        port: currentConnection?.port,
        username: currentConnection?.username || "",
        password: currentConnection?.password || "",
        database: currentConnection?.database || "",
        ssl: currentConnection?.ssl || false,
        save_password: currentConnection?.save_password === 1 || true,
      });
    } else {
      form.reset(defaultValues);
    }
  }, [currentConnection]);

  // Handle URL import
  const handleImportUrl = (connectionDetails: {
    host: string;
    port?: number;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
    connection_type: string;
    connection_string: string;
  }) => {
    form.setValue("host", connectionDetails.host);
    form.setValue("port", connectionDetails.port);
    form.setValue("username", connectionDetails.username);
    form.setValue("password", connectionDetails.password);
    form.setValue("database", connectionDetails.database);
    form.setValue("ssl", connectionDetails.ssl);
    form.setValue("connection_type", connectionDetails.connection_type);
    form.setValue("connection_string", connectionDetails.connection_string);
    form.clearErrors();
    toast.success("Connection details imported successfully!");
  };

  // Handle URL export
  const handleExportUrl = () => {
    const values = form.getValues();

    // Validate required fields
    if (
      !values.connection_type ||
      !values.host ||
      !values.username ||
      !values.password ||
      !values.database
    ) {
      toast.error("Please fill in all required fields before exporting");
      return;
    }
    // setExportedUrl(url);
    setIsExportModalOpen(true);
  };

  const exportUrl = () => {
    const values = form.watch();

    let url = "";
    const { host, port, username, password, database, ssl } = values;

    let extraParams = "";
    if (values.connection_string) {
      const parsed = parseConnectionString(values.connection_string);
      if (parsed?.queryParams) {
        extraParams = Object.entries(parsed.queryParams)
          .map(([key, value]) => `${key}=${value}`)
          .join("&");
      }
    }
    // Use default ports if not specified
    const portToUse = port;

    if (values.connection_type === "pgSql") {
      // PostgreSQL connection string
      url = `postgresql://${username}:${password}@${host}${portToUse ? `:${portToUse}` : ""}/${database}`;
      if (ssl) {
        // Handle different SSL configurations
        if (
          typeof ssl === "object" &&
          ssl.rejectUnauthorized === false &&
          !extraParams
        ) {
          url += "?sslmode=require&channel_binding=require";
        } else if (!extraParams) {
          url += "?sslmode=require";
        }
      }
    } else if (values.connection_type === "mongodb") {
      // MongoDB connection string
      url = `${portToUse ? "mongodb" : "mongodb+srv"}://${username}:${password}@${host}${portToUse ? `:${portToUse}` : ""}/${database}`;
      if (ssl) {
        url += "?ssl=true";
      }
    }
    if (extraParams) {
      url += `?${extraParams}`;
    }
    return url;
  };

  const exportedUrl = exportUrl();

  // Handle copy to clipboard
  const handleCopyToClipboard = async () => {
    if (!exportedUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(exportedUrl);
      setIsCopied(true);
      toast.success("Connection URL copied to clipboard!");
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy to clipboard");
    }
  };

  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof connectionFormSchema>) {
    // Use individual fields
    const dbConfig: ConnectionDetailsType = {
      id:
        currentConnection?.id || generatedIdRef.current || crypto.randomUUID(),
      name: values.name,
      connection_type: values.connection_type,
      host: values.host,
      port: values.port,
      username: values.username,
      password: values.password,
      database: values.database,
      connection_string: values.connection_string || "",
      save_password: values.save_password ? 1 : 0,
      color: values.color || "",
      ssl: values.ssl || false,
    };
    setLoading("connecting");
    const response = await testConnection({
      connectionDetails: dbConfig,
      isConnect: true,
      dbType: values.connection_type as any,
    });
    if (response.success) {
      router.push("/app/editor");
    } else {
      toast.error(response.error || "Failed to connect");
      setLoading(null);
    }
  }

  async function saveConnection() {
    setLoading("saving");
    const values = form.getValues();

    // Validate required fields
    if (!values.connection_type) {
      setLoading(null);
      return form.setError("connection_type", {
        message: "Connection Type is required",
      });
    }
    if (!values.name) {
      setLoading(null);
      return form.setError("name", {
        message: "Connection name is required",
      });
    }

    // Individual fields must be provided (port is optional)
    const hasIndividualFields =
      values.host && values.username && values.password && values.database;

    if (!hasIndividualFields) {
      setLoading(null);
      return form.setError("host", {
        message:
          "Please fill in all required connection fields or use Import URL",
      });
    }

    try {
      let response;
      const dbConfig: Omit<ConnectionDetailsType, "id"> = {
        name: values.name,
        connection_type: values.connection_type,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        connection_string: values.connection_string || "",
        save_password: values.save_password ? 1 : 0,
        color: values.color || "",
        ssl: values.ssl || false,
      };

      if (currentConnection) {
        const updatedConnection = {
          ...currentConnection,
          ...dbConfig,
          id: currentConnection.id,
        };
        response = await updateConnection(updatedConnection);
        if (response?.success) {
          dispatch(setCurrentConnection(updatedConnection));
          toast.success("Connection updated successfully!");
        } else {
          toast.error("Failed to update connection", {
            description: response?.error,
          });
        }
      } else {
        response = await createConnection(dbConfig);
        if (response?.success) {
          toast.success("Connection saved successfully!");
        } else {
          toast.error("Failed to save connection", {
            description: response?.error,
          });
        }
      }

      if (response?.success) {
        dispatch(initConnectedConnection());
      }
    } catch (error: any) {
      toast.error("An unexpected error occurred", {
        description: error.message,
      });
    } finally {
      setLoading(null);
    }
  }

  async function onTest() {
    const values = form.getValues();

    if (!values.connection_string) {
      form.setValue("connection_string", exportedUrl);
      return;
    }

    // Use individual fields
    const dbConfig: ConnectionDetailsType = {
      id:
        currentConnection?.id || generatedIdRef.current || crypto.randomUUID(),
      name: values.name || "",
      connection_type: values.connection_type,
      host: values.host,
      port: values.port,
      username: values.username,
      password: values.password,
      database: values.database,
      connection_string: values.connection_string || exportedUrl || "",
      save_password: values.save_password ? 1 : 0,
      color: values.color || "",
      ssl: values.ssl || false,
    };

    setLoading("testing");
    const response = await testConnection({
      connectionDetails: dbConfig,
      dbType: form.getValues().connection_type,
    });

    if (response.success) {
      toast.success("Connection successful!");
      form.clearErrors("connection_string");
    } else {
      form.setError("connection_string", { message: response.error });
      toast.error(response.error);
    }
    setLoading(null);
  }

  return (
    <div className="custom-scrollbar flex h-full w-full items-center justify-center overflow-auto py-2">
      <Card
        className="min-w-[80%] border-border/50 bg-background/20 shadow-lg backdrop-blur-xl"
        style={{
          borderColor: form.watch("color") || "transparent",
          background: form.watch("color")
            ? `radial-gradient(circle at top left, ${form.watch("color")}10 0%, transparent 50%), radial-gradient(circle at bottom right, ${form.watch("color")}10 0%, transparent 50%)`
            : "radial-gradient(circle at top left, hsl(var(--primary)/0.1) 0%, transparent 50%), radial-gradient(circle at bottom right, hsl(var(--primary)/0.1) 0%, transparent 50%)",
        }}
      >
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{form.watch("name") || "New Connection"}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 border-border"
            >
              <LinkIcon className="h-4 w-4" />
              Import URL
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportUrl}
              className="flex items-center gap-2 border-border"
            >
              <DownloadIcon className="h-4 w-4" />
              Export URL
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Connection Type */}
              <FormField
                control={form.control}
                name="connection_type"
                render={({ field }) => (
                  <FormItem>
                    <Label className="text-sm font-medium">
                      Connection Type *
                    </Label>
                    <Select
                      onValueChange={field.onChange}
                      value={form.watch("connection_type")}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-secondary">
                          <SelectValue placeholder="Select connection type..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-secondary">
                        {DbConnectionsTypes.map((connection_type) => (
                          <SelectItem
                            key={connection_type.value}
                            value={connection_type.value}
                            className="focus:bg-background"
                            disabled={connection_type.disabled}
                          >
                            {connection_type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Connection Name and Color */}
              <div className="grid grid-cols-1 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-sm font-medium">
                        Connection Name *
                      </Label>
                      <FormControl>
                        <Input
                          placeholder="My Database Connection"
                          className="bg-secondary"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Import URL Button */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="host"
                    render={({ field }) => (
                      <FormItem>
                        <Label className="text-sm font-medium">Host *</Label>
                        <FormControl>
                          <Input
                            placeholder="localhost"
                            className="bg-secondary"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="port"
                    render={({ field }) => (
                      <FormItem>
                        <Label className="text-sm font-medium">Port</Label>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={
                              form.watch("connection_type") === "pgSql"
                                ? "5432 (default)"
                                : "27017 (default)"
                            }
                            className="bg-secondary"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <Label className="text-sm font-medium">
                          Username *
                        </Label>
                        <FormControl>
                          <Input
                            placeholder="username"
                            className="bg-secondary"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <Label className="text-sm font-medium">
                          Password *
                        </Label>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="password"
                            className="bg-secondary"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="database"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-sm font-medium">
                        Database Name *
                      </Label>
                      <FormControl>
                        <Input
                          placeholder="mydatabase"
                          className="bg-secondary"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* SSL and Save Password Options */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="ssl"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">
                          SSL Connection
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Enable SSL for secure connection
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={
                            typeof field.value === "boolean"
                              ? field.value
                              : !!field.value
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              // For PostgreSQL, use object with rejectUnauthorized: false for better compatibility
                              if (
                                form.getValues("connection_type") === "pgSql"
                              ) {
                                field.onChange({ rejectUnauthorized: false });
                              } else {
                                field.onChange(true);
                              }
                            } else {
                              field.onChange(false);
                            }
                          }}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="save_password"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">
                          Save Password
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Store password for future use
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end">
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          value={field.value}
                          className="flex items-center space-y-1"
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl className="hidden">
                              <RadioGroupItem value={""} />
                            </FormControl>
                            <Label
                              className={cn(
                                `h-4 w-4 cursor-pointer rounded-sm border-2 border-transparent bg-secondary font-normal`,
                                {
                                  "border-white":
                                    !field.value || field.value === "",
                                },
                              )}
                              onClick={() => field.onChange("")}
                            />
                            {DbConnectionColors.map((color) => (
                              <FormItem
                                key={color}
                                className="flex items-center space-y-0"
                              >
                                <FormControl className="hidden">
                                  <RadioGroupItem value={color} />
                                </FormControl>
                                <Label
                                  className={cn(
                                    `h-4 w-4 cursor-pointer rounded-sm border-2 border-transparent font-normal`,
                                    {
                                      "border-white": field.value === color,
                                    },
                                  )}
                                  style={{ backgroundColor: color }}
                                  onClick={() => field.onChange(color)}
                                />
                              </FormItem>
                            ))}
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  disabled={appLoading!== "idle" || loading !== null}
                  variant="secondary"
                  onClick={onTest}
                  className="h-9 border border-border px-4"
                >
                  {loading === "testing" && (
                    <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Test Connection
                </Button>
                <Button
                  type="button"
                  disabled={appLoading!== "idle" || loading !== null}
                  variant="outline"
                  onClick={saveConnection}
                  className="h-9 border-border px-4"
                >
                  {loading === "saving" && (
                    <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save
                </Button>
                <Button
                  type="submit"
                  disabled={appLoading!== "idle" || loading !== null}
                  className="h-9 px-4 text-white"
                >
                  {(loading === "connecting") && (
                    <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Connect
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Import URL Modal */}
      <ImportUrlModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImportUrl}
      />

      {/* Export URL Modal */}
      <ExportUrlModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        exportedUrl={exportedUrl || ""}
        connectionType={form.watch("connection_type") || ""}
        onCopy={handleCopyToClipboard}
        isCopied={isCopied}
      />
    </div>
  );
};

export default ConnectionForm;
