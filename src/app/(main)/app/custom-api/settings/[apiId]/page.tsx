"use client";

import { useState, useEffect, useMemo } from "react";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Save,
  RotateCcw,
  Shield,
  Zap,
  Database,
  AlertTriangle,
  PlugZapIcon,
  UnplugIcon,
} from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import {
  toggleAPI,
  updateCurrentAPI,
} from "@/features/custom-api/utils/data-thunk-func";
import { APIFetchingAnimation } from "@/features/custom-api/components";
import { Tabs } from "@/components/ui/tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SETTINGS_PAGE_NAVS } from "@/features/custom-api/config/navs";
import {
  CustomTabList,
  CustomTabsContent,
} from "@/components/common/custom-tab";
import ServerLogs from "@/features/custom-api/components/server-logs";
import {
  restartCustomServerAction,
  startCustomServerAction,
  stopCustomServerAction,
} from "@/features/custom-api/lib/actions/server";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SettingsPage = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { currentAPI, loading } = useSelector((state: RootState) => state.api);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(tab || "settings");

  const [isLoading, setIsLoading] = useState<
    "saving" | "toggling" | "idle" | "restarting" | "starting" | "stopping"
  >("idle");

  const handleTabChange = (tab: string) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("tab", tab);
    router.push(`${pathname}?${searchParams.toString()}`);
    setActiveTab(tab);
  };
  useEffect(() => {
    setActiveTab(tab || "settings");
  }, [tab]);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    version: "",
    enabled: false,
    port: undefined as number | undefined,
    tags: [] as string[],
    rateLimit: 1000,
    timeout: 30,
    corsEnabled: true,
    corsOrigins: [] as string[],
    corsMethods: [] as string[],
    corsHeaders: [] as string[],
    authentication: "none",
    logging: true,
  });

  const hasChanges = useMemo(() => {
    if (!currentAPI) return false;
    let isChanged = false;
    for (const key in formData) {
      if (
        formData[key as keyof typeof formData] !==
        currentAPI[key as keyof typeof currentAPI]
      ) {
        isChanged = true;
        break;
      }
    }
    return isChanged;
  }, [formData, currentAPI]);

  // Initialize form data when API is loaded
  useEffect(() => {
    if (currentAPI) {
      setFormData({
        name: currentAPI.name || "",
        description: currentAPI.description || "",
        version: currentAPI.version || "1.0.0",
        enabled: currentAPI.enabled || false,
        port: currentAPI.port,
        tags: currentAPI.tags || [],
        rateLimit: currentAPI.rateLimit || 1000,
        timeout: currentAPI.timeout || 30,
        corsEnabled: currentAPI.corsEnabled ?? true,
        corsOrigins: currentAPI.corsOrigins || [],
        corsMethods: currentAPI.corsMethods || [],
        corsHeaders: currentAPI.corsHeaders || [],
        authentication: currentAPI.authentication || "none",
        logging: currentAPI.logging ?? true,
      });
    }
  }, [currentAPI]);

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleToggleAPI = async () => {
    // Update the form data immediately
    setFormData((prev) => ({ ...prev, enabled: !prev.enabled }));

    // Auto-save the change
    if (currentAPI) {
      setIsLoading("toggling");
      try {
        if (!formData.enabled) {
          // Start server
          const result = await startCustomServerAction({
            ...currentAPI,
            enabled: true,
          });

          if (!result.success) {
            throw new Error(result.error);
          } else {
            toast.success(result.message);
          }
        } else {
          // Stop server
          await stopCustomServerAction({ ...currentAPI, enabled: false });
        }

        await dispatch(toggleAPI(currentAPI.connectionId) as any);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to toggle server",
        );
        console.error("Failed to toggle server:", error);
        // Revert the change if failed
        setFormData((prev) => ({ ...prev, enabled: !prev.enabled }));
      } finally {
        setIsLoading("idle");
      }
    }
  };

  const handleTagAdd = (tag: string) => {
    if (tag.trim() && !formData.tags.includes(tag.trim())) {
      handleInputChange("tags", [...formData.tags, tag.trim()]);
    }
  };

  const handleTagRemove = (tagToRemove: string) => {
    handleInputChange(
      "tags",
      formData.tags.filter((tag) => tag !== tagToRemove),
    );
  };

  const handleSave = async () => {
    if (!currentAPI) return;

    setIsLoading("saving");
    try {
      const updatedAPI = {
        ...currentAPI,
        name: formData.name,
        description: formData.description,
        version: formData.version,
        enabled: formData.enabled,
        port: formData.port,
        tags: formData.tags,
        rateLimit: formData.rateLimit,
        timeout: formData.timeout,
        corsEnabled: formData.corsEnabled,
        corsOrigins: formData.corsOrigins,
        corsMethods: formData.corsMethods,
        corsHeaders: formData.corsHeaders,
        authentication: formData.authentication as
          | "none"
          | "api-key"
          | "jwt"
          | "oauth",
        logging: formData.logging,
      };
      await dispatch(updateCurrentAPI(updatedAPI));
      setIsLoading("restarting");
      const result = await restartCustomServerAction(updatedAPI);
      if (!result.success) {
        toast.error(result.error);
        throw new Error(result.error);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsLoading("idle");
    }
  };

  const handleReset = () => {
    if (currentAPI) {
      setFormData({
        name: currentAPI.name || "",
        description: currentAPI.description || "",
        version: currentAPI.version || "1.0.0",
        enabled: currentAPI.enabled || false,
        port: currentAPI.port,
        tags: currentAPI.tags || [],
        rateLimit: currentAPI.rateLimit || 1000,
        timeout: currentAPI.timeout || 30,
        corsEnabled: currentAPI.corsEnabled ?? true,
        corsOrigins: currentAPI.corsOrigins || [],
        corsMethods: currentAPI.corsMethods || [],
        corsHeaders: currentAPI.corsHeaders || [],
        authentication: currentAPI.authentication || "none",
        logging: currentAPI.logging ?? true,
      });
    }
  };

  if (loading === "fetching" || loading === "initializing") {
    return (
      <div className="flex h-full items-center justify-center">
        <APIFetchingAnimation size="lg" />
      </div>
    );
  }

  if (!currentAPI) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold">API Not Found</h2>
          <p className="text-muted-foreground">
            The requested API could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <Tabs
        defaultValue="settings"
        value={activeTab}
        onValueChange={handleTabChange}
        className="h-full"
      >
        <CustomTabList tabs={SETTINGS_PAGE_NAVS} activeTab={activeTab} />
        <div
          className={cn(
            "scrollbar-gutter custom-scrollbar relative flex h-full flex-col overflow-auto",
            {
              "overflow-hidden": [
                "restarting",
                "starting",
                "stopping",
              ].includes(isLoading),
            },
          )}
        >
          {["restarting", "starting", "stopping"].includes(isLoading) && (
            <div
              className={cn(
                "absolute bottom-0 left-0 right-0 top-0 z-10 h-full w-full bg-secondary/50 backdrop-blur-sm",
              )}
            >
              <div className="flex h-full w-full flex-col items-center justify-center">
                <APIFetchingAnimation size="lg" />
                <span className="text-sm font-medium capitalize">
                  {isLoading}
                </span>
              </div>
            </div>
          )}
          <div className="px-6">
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 mb-3 bg-secondary pt-3">
              <div className="rounded-lg border bg-secondary p-3 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-2">
                    <Label htmlFor="enabled" className="text-sm font-medium">
                      {formData.enabled ? <PlugZapIcon /> : <UnplugIcon />}
                    </Label>
                    <p className="flex flex-col">
                      <span className="text-sm font-semibold capitalize">
                        API {tab}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Configure your API settings and preferences
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    {/* API Status Toggle */}
                    <div className="flex items-center gap-2">
                      <Switch
                        id="enabled"
                        checked={formData.enabled}
                        onCheckedChange={() => handleToggleAPI()}
                        disabled={isLoading === "toggling"}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <CustomTabsContent value="settings">
              {/* Content */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Basic Information */}
                <div className="col-span-2 rounded-lg border border-border bg-background/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      Basic Information
                    </CardTitle>
                    <CardDescription>
                      Configure the basic details of your API
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="name">API Name</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) =>
                          handleInputChange("name", e.target.value)
                        }
                        placeholder="Enter API name"
                        className="bg-secondary"
                      />
                    </div>
                    <div>
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) =>
                          handleInputChange("description", e.target.value)
                        }
                        placeholder="Describe your API"
                        rows={3}
                        className="bg-secondary"
                      />
                    </div>
                    <div>
                      <Label htmlFor="version">Version</Label>
                      <Input
                        id="version"
                        value={formData.version}
                        onChange={(e) =>
                          handleInputChange("version", e.target.value)
                        }
                        placeholder="1.0.0"
                        className="bg-secondary"
                      />
                    </div>
                    {/* Port field - only show in Electron app */}
                    {typeof window !== "undefined" && window.electron && (
                      <div>
                        <Label htmlFor="port">Port</Label>
                        <Input
                          id="port"
                          type="number"
                          value={formData.port || ""}
                          onChange={(e) =>
                            handleInputChange(
                              "port",
                              e.target.value
                                ? parseInt(e.target.value)
                                : undefined,
                            )
                          }
                          placeholder="3000"
                          min="1024"
                          max="65535"
                          className="bg-secondary"
                        />
                      </div>
                    )}
                    <div>
                      <Label>Tags</Label>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {formData.tags.map((tag, index) => (
                          <Badge
                            key={index}
                            variant="outline"
                            className="h-7 gap-1 rounded-full bg-secondary py-0 text-xs"
                          >
                            {tag}
                            <button
                              onClick={() => handleTagRemove(tag)}
                              className="ml-1 hover:text-destructive"
                            >
                              ×
                            </button>
                          </Badge>
                        ))}
                        <Input
                          placeholder="Add tag..."
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleTagAdd(e.currentTarget.value);
                              e.currentTarget.value = "";
                            }
                          }}
                          className="w-24 bg-secondary"
                        />
                      </div>
                    </div>
                  </CardContent>
                </div>
                {/* Performance Settings */}
                <div className="col-span-2 rounded-lg border border-border bg-background/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-5 w-5" />
                      Performance
                    </CardTitle>
                    <CardDescription>
                      Configure performance and rate limiting
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="rateLimit">
                        Rate Limit (requests/minute)
                      </Label>
                      <Input
                        id="rateLimit"
                        type="number"
                        value={formData.rateLimit}
                        onChange={(e) =>
                          handleInputChange(
                            "rateLimit",
                            parseInt(e.target.value),
                          )
                        }
                        className="bg-secondary"
                      />
                    </div>
                    <div>
                      <Label htmlFor="timeout">Timeout (seconds)</Label>
                      <Input
                        id="timeout"
                        type="number"
                        value={formData.timeout}
                        onChange={(e) =>
                          handleInputChange("timeout", parseInt(e.target.value))
                        }
                        className="bg-secondary"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="logging">Enable Logging</Label>
                        <p className="text-sm text-muted-foreground">
                          Log API requests and responses
                        </p>
                      </div>
                      <Switch
                        id="logging"
                        checked={formData.logging}
                        onCheckedChange={(checked) =>
                          handleInputChange("logging", checked)
                        }
                      />
                    </div>
                  </CardContent>
                </div>
                {/* Security Settings */}
                <div className="col-span-2 rounded-lg border border-border bg-background/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      Security
                    </CardTitle>
                    <CardDescription>
                      Configure security and authentication
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="authentication">Authentication</Label>
                      <Select
                        value={formData.authentication}
                        onValueChange={(value) =>
                          handleInputChange("authentication", value)
                        }
                      >
                        <SelectTrigger className="border-border bg-secondary">
                          <SelectValue placeholder="Select authentication method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="api-key">API Key</SelectItem>
                          <SelectItem value="jwt">JWT Token</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="cors">CORS Enabled</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow cross-origin requests
                        </p>
                      </div>
                      <Switch
                        id="cors"
                        checked={formData.corsEnabled}
                        onCheckedChange={(checked) =>
                          handleInputChange("corsEnabled", checked)
                        }
                      />
                    </div>
                    {/* CORS Configuration - Only show when CORS is enabled */}
                    {formData.corsEnabled && (
                      <div className="space-y-4 border-t pt-4">
                        <div>
                          <Label htmlFor="corsOrigins">Allowed Origins</Label>
                          <Textarea
                            id="corsOrigins"
                            value={formData.corsOrigins.join("\n")}
                            onChange={(e) =>
                              handleInputChange(
                                "corsOrigins",
                                e.target.value
                                  .split("\n")
                                  .filter((item) => item.trim()),
                              )
                            }
                            placeholder="Enter one origin per line:&#10;https://example.com&#10;https://app.example.com&#10;http://localhost:3000"
                            rows={3}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Enter one origin per line (e.g.,
                            https://example.com)
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="corsMethods">Allowed Methods</Label>
                          <Textarea
                            id="corsMethods"
                            value={formData.corsMethods.join("\n")}
                            onChange={(e) =>
                              handleInputChange(
                                "corsMethods",
                                e.target.value
                                  .split("\n")
                                  .filter((item) => item.trim()),
                              )
                            }
                            placeholder="Enter one method per line:&#10;GET&#10;POST&#10;PUT&#10;DELETE"
                            rows={3}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Enter one HTTP method per line (e.g., GET, POST,
                            PUT)
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="corsHeaders">Allowed Headers</Label>
                          <Textarea
                            id="corsHeaders"
                            value={formData.corsHeaders.join("\n")}
                            onChange={(e) =>
                              handleInputChange(
                                "corsHeaders",
                                e.target.value
                                  .split("\n")
                                  .filter((item) => item.trim()),
                              )
                            }
                            placeholder="Enter one header per line:&#10;Content-Type&#10;Authorization&#10;X-Requested-With"
                            rows={3}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Enter one header per line (e.g., Content-Type,
                            Authorization)
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </div>
              </div>
              <div className="bg-secondary px-6 py-2 backdrop-blur-sm">
                <div className="flex items-center justify-end">
                  {/* Save Buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleReset}
                      disabled={isLoading !== "idle" || !hasChanges}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={isLoading !== "idle" || !hasChanges}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {isLoading === "saving" ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            </CustomTabsContent>
            <CustomTabsContent value="logs">
              <ServerLogs />
            </CustomTabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
