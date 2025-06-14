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
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { testConnection } from "@/lib/actions/fetch-data";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon } from "lucide-react";
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
import { createConnection, updateConnection } from "@/lib/actions/app-data";
import { initAppData, setCurrentConnection } from "@/redux/features/appdb";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { cn } from "@/lib/utils";
import { parseConnectionString } from "@/lib/helper/connection-details";

const ConnectionForm = () => {
  const [loading, setLoading] = React.useState<
    "connecting" | "testing" | "saving" | null
  >(null);
  const {
    currentConnection,
    loading: appLoading,
  }: { currentConnection: ConnectionsType; loading: boolean } = useSelector(
    (state: any) => state.appDB,
  );

  const dispatch = useDispatch();

  const router = useRouter();
  const defaultValues = {
    connection_type: "",
    connection_string: "",
    name: "",
    color: "",
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
      });
    } else {
      form.reset(defaultValues);
    }
  }, [currentConnection]);

  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof connectionFormSchema>) {
    const config = parseConnectionString(values.connection_string);
    if (config.error) {
      toast.error(config.error);
      return;
    }
    const dbConfig: ConnectionDetailsType = {
      id: currentConnection?.id || generatedIdRef.current || crypto.randomUUID(),
      name: values.name || "",
      connection_type: values.connection_type,
      host: config.host || "",
      port: config.port || 0,
      username: config.user || "",
      password: config.password || "",
      database: config.database || "",
      connection_string: values.connection_string,
      save_password: 1,
      color: values.color || "",
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
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
    let response;
    if (!form.getValues().connection_type) {
      setLoading(null);
      return form.setError("connection_type", {
        message: "Connection Type is required",
      });
    }
    if (!form.getValues().connection_string) {
      setLoading(null);
      return form.setError("connection_string", {
        message: "Connection string is required",
      });
    }
    if (currentConnection) {
      if (typeof window.electron !== "undefined") {
      const updatedConnection = { ...currentConnection, ...form.getValues() };
      response = await updateConnection(updatedConnection);
        if (typeof response === "object" && response?.data?.rows) {
          dispatch(setCurrentConnection(updatedConnection));
        }
      } else {
        toast.error("Please use the desktop app to update connection");
      }
    } else {
      if (typeof window.electron !== "undefined") {
        response = await createConnection(form.getValues() as any);
      } else {
        toast.error("Please use the desktop app to save connection");
      }
    }
    if (typeof response === "object" && response?.data?.rows) {
      dispatch(initAppData() as any);
    }

    setLoading(null);
  }

  async function onTest() {
    const config = parseConnectionString(form.getValues().connection_string);
    if (config.error) {
      toast.error(config.error);
      return;
    }
    setLoading("testing");
    const dbConfig: ConnectionDetailsType = {
      id: currentConnection?.id || generatedIdRef.current || crypto.randomUUID(),
      name: form.getValues().name || "",
      connection_type: form.getValues().connection_type,
      host: config.host || "",
      port: config.port || 0,
      username: config.user || "",
      password: config.password || "",
      database: config.database || "",
      connection_string: form.getValues().connection_string,
      save_password: 1,
      color: form.getValues().color || "",
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    };
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
    <div className="flex h-full w-full items-center justify-center overflow-auto">
      <Card
        className="min-w-[80%] border-border/50 bg-background/20 shadow-lg backdrop-blur-xl"
        style={{
          borderColor: form.watch("color") || "transparent",
          background: form.watch("color")
            ? `radial-gradient(circle at top left, ${form.watch("color")}10 0%, transparent 50%), radial-gradient(circle at bottom right, ${form.watch("color")}10 0%, transparent 50%)`
            : "radial-gradient(circle at top left, hsl(var(--primary)/0.1) 0%, transparent 50%), radial-gradient(circle at bottom right, hsl(var(--primary)/0.1) 0%, transparent 50%)",
        }}
      >
        <CardHeader>
          <CardTitle>{form.watch("name") || "New Connection"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
              <FormField
                control={form.control}
                name="connection_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Connection Type</FormLabel>
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
              <FormField
                control={form.control}
                name="connection_string"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Connection string</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Connection string"
                        className="bg-secondary"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  disabled={appLoading || loading !== null}
                  variant="secondary"
                  onClick={onTest}
                  className="h-7 text-xs"
                >
                  {loading === "testing" && (
                    <LoaderCircleIcon className="animate-spin" />
                  )}
                  Test
                </Button>
                <Button
                  type="submit"
                  disabled={appLoading || loading !== null}
                  className="h-7 text-xs text-white"
                >
                  {(appLoading || loading === "connecting") && (
                    <LoaderCircleIcon className="animate-spin" />
                  )}
                  Connect
                </Button>
              </div>
              <div className="h-[1px] w-full bg-secondary" />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs">Connection name</FormLabel>
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
                                  <FormLabel
                                    className={cn(
                                      `h-4 w-4 rounded-sm border-2 border-transparent bg-secondary font-normal`,
                                      {
                                        "border-white":
                                          !field.value || field.value === "",
                                      },
                                    )}
                                  />
                                  {DbConnectionColors.map((color) => (
                                    <FormItem
                                      key={color}
                                      className="flex items-center space-y-0"
                                    >
                                      <FormControl className="hidden">
                                        <RadioGroupItem value={color} />
                                      </FormControl>
                                      <FormLabel
                                        className={cn(
                                          `h-4 w-4 rounded-sm border-2 border-transparent font-normal`,
                                          {
                                            "border-white":
                                              field.value === color,
                                          },
                                        )}
                                        style={{ backgroundColor: color }}
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
                    <FormControl>
                      <Input
                        placeholder="Connection Name"
                        className="bg-secondary"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={appLoading || loading !== null}
                  variant="secondary"
                  onClick={saveConnection}
                  className="h-7 text-xs"
                >
                  {loading === "saving" && (
                    <LoaderCircleIcon className="animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConnectionForm;
