"use client";

import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "../ui/form";
import { Input } from "../ui/input";
import { useSettings } from "@/hooks/useSettings";
import { toast } from "sonner";
import { LoaderCircleIcon, CheckIcon, ArrowLeft } from "lucide-react";
import { useDebouncedCallback } from "@/hooks/debounce";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "../ui/button";

const settingsFormSchema = z.object({
  provider: z.enum(["openrouter", "openai", "claude"]),
  providers: z.object({
    openrouter: z.object({
      apiKey: z.string().optional(),
      model: z.string().optional(),
    }),
    openai: z.object({
      apiKey: z.string().optional(),
      model: z.string().optional(),
    }),
    claude: z.object({
      apiKey: z.string().optional(),
      model: z.string().optional(),
    }),
  }),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

const providerConfig = {
  openrouter: {
    label: "OpenRouter",
    apiKeyPlaceholder: "Enter your OpenRouter API key",
    modelPlaceholder: "meta-llama/llama-3.2-3b-instruct:free",
    modelDescription:
      "The AI model to use (e.g., meta-llama/llama-3.2-3b-instruct:free)",
  },
  openai: {
    label: "OpenAI",
    apiKeyPlaceholder: "Enter your OpenAI API key",
    modelPlaceholder: "gpt-4",
    modelDescription: "The OpenAI model to use (e.g., gpt-4, gpt-3.5-turbo)",
  },
  claude: {
    label: "Claude (Anthropic)",
    apiKeyPlaceholder: "Enter your Anthropic API key",
    modelPlaceholder: "claude-3-5-sonnet-20241022",
    modelDescription:
      "The Claude model to use (e.g., claude-3-5-sonnet-20241022)",
  },
};

const SettingsForm = () => {
  const { settings, loading: settingsLoading, updateSettings } = useSettings();
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const homePage = searchParams.get("homePage");
  const isInitialLoad = React.useRef(true);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      provider: "openrouter",
      providers: {
        openrouter: {
          apiKey: "",
          model: "meta-llama/llama-3.2-3b-instruct:free",
        },
        openai: {
          apiKey: "",
          model: "gpt-4",
        },
        claude: {
          apiKey: "",
          model: "claude-3-5-sonnet-20241022",
        },
      },
    },
  });

  const saveSettings = React.useCallback(
    async (values: SettingsFormValues) => {
      // Don't save on initial load
      if (isInitialLoad.current) {
        return;
      }

      setSaving(true);
      setSaved(false);
      try {
        const result = await updateSettings({
          provider: values.provider,
          providers: {
            openrouter: {
              apiKey: values.providers.openrouter.apiKey || "",
              model:
                values.providers.openrouter.model ||
                "meta-llama/llama-3.2-3b-instruct:free",
            },
            openai: {
              apiKey: values.providers.openai.apiKey || "",
              model: values.providers.openai.model || "gpt-4",
            },
            claude: {
              apiKey: values.providers.claude.apiKey || "",
              model:
                values.providers.claude.model || "claude-3-5-sonnet-20241022",
            },
          },
        });

        if (result.success) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        } else {
          toast.error(result.error || "Failed to save settings");
        }
      } catch (error: any) {
        toast.error(error.message || "Failed to save settings");
      } finally {
        setSaving(false);
      }
    },
    [updateSettings],
  );

  const debouncedSave = useDebouncedCallback(saveSettings, 1000);
  const previousValuesRef = React.useRef<string>("");

  useEffect(() => {
    if (!settingsLoading && settings) {
      form.reset({
        provider: settings.provider || "openrouter",
        providers: settings.providers || {
          openrouter: {
            apiKey: "",
            model: "meta-llama/llama-3.2-3b-instruct:free",
          },
          openai: {
            apiKey: "",
            model: "gpt-4",
          },
          claude: {
            apiKey: "",
            model: "claude-3-5-sonnet-20241022",
          },
        },
      });
      // Mark initial load as complete after reset
      setTimeout(() => {
        isInitialLoad.current = false;
        // Store initial values to prevent immediate save
        previousValuesRef.current = JSON.stringify(form.getValues());
      }, 100);
    }
  }, [settings, settingsLoading, form]);

  // Auto-save when form values change
  useEffect(() => {
    if (settingsLoading || isInitialLoad.current) {
      return;
    }

    const subscription = form.watch((values) => {
      const currentValues = JSON.stringify(values);
      // Only save if values actually changed
      if (currentValues !== previousValuesRef.current) {
        previousValuesRef.current = currentValues;
        debouncedSave(values as SettingsFormValues);
      }
    });

    return () => subscription.unsubscribe();
  }, [settingsLoading, form, debouncedSave]);

  if (settingsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoaderCircleIcon className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div className="mx-auto max-w-4xl px-8 py-4">
        {homePage === "settings" && (
          <div className="mb-2 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/")}
              className="flex items-center gap-2 px-0"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        )}
        <div>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              AI Settings
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {saving ? (
                <>
                  <LoaderCircleIcon className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : saved ? (
                <>
                  <CheckIcon className="h-3 w-3 text-green-500" />
                  <span>Saved</span>
                </>
              ) : null}
            </div>
          </div>

          <Form {...form}>
            <form>
              <div className="space-y-8">
                {/* OpenRouter Section */}
                <div className="space-y-6">
                  <div className="border-b border-border pb-2">
                    <h3 className="text-sm font-medium text-foreground">
                      {providerConfig.openrouter.label}
                    </h3>
                  </div>
                  <div className="space-y-6 pl-4">
                    <FormField
                      control={form.control}
                      name="providers.openrouter.apiKey"
                      render={({ field }) => (
                        <FormItem className="space-y-1">
                          <div className="flex items-start justify-between gap-8">
                            <div className="min-w-0 flex-1 space-y-1">
                              <FormLabel className="text-sm font-normal text-foreground">
                                AI: API Key
                              </FormLabel>
                              <FormDescription className="text-xs text-muted-foreground">
                                Your API key is stored securely and used for AI
                                query generation
                              </FormDescription>
                            </div>
                            <div className="w-[400px] flex-shrink-0">
                              <FormControl>
                                <Input
                                  type="password"
                                  placeholder={
                                    providerConfig.openrouter.apiKeyPlaceholder
                                  }
                                  className="h-8 border-input bg-background text-sm"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="mt-1 text-xs" />
                            </div>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="providers.openrouter.model"
                      render={({ field }) => (
                        <FormItem className="space-y-1">
                          <div className="flex items-start justify-between gap-8">
                            <div className="min-w-0 flex-1 space-y-1">
                              <FormLabel className="text-sm font-normal text-foreground">
                                AI: Model
                              </FormLabel>
                              <FormDescription className="text-xs text-muted-foreground">
                                {providerConfig.openrouter.modelDescription}
                              </FormDescription>
                            </div>
                            <div className="w-[400px] flex-shrink-0">
                              <FormControl>
                                <Input
                                  type="text"
                                  placeholder={
                                    providerConfig.openrouter.modelPlaceholder
                                  }
                                  className="h-8 border-input bg-background text-sm"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="mt-1 text-xs" />
                            </div>
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* OpenAI Section - Disabled for now */}
                {false && (
                  <div className="space-y-6">
                    <div className="border-b border-border pb-2">
                      <h3 className="text-sm font-medium text-foreground">
                        {providerConfig.openai.label}
                      </h3>
                    </div>
                    <div className="space-y-6 pl-4">
                      <FormField
                        control={form.control}
                        name="providers.openai.apiKey"
                        render={({ field }) => (
                          <FormItem className="space-y-1">
                            <div className="flex items-start justify-between gap-8">
                              <div className="min-w-0 flex-1 space-y-1">
                                <FormLabel className="text-sm font-normal text-foreground">
                                  AI: API Key
                                </FormLabel>
                                <FormDescription className="text-xs text-muted-foreground">
                                  Your API key is stored securely and used for
                                  AI query generation
                                </FormDescription>
                              </div>
                              <div className="w-[400px] flex-shrink-0">
                                <FormControl>
                                  <Input
                                    type="password"
                                    placeholder={
                                      providerConfig.openai.apiKeyPlaceholder
                                    }
                                    className="h-8 border-input bg-background text-sm"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage className="mt-1 text-xs" />
                              </div>
                            </div>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="providers.openai.model"
                        render={({ field }) => (
                          <FormItem className="space-y-1">
                            <div className="flex items-start justify-between gap-8">
                              <div className="min-w-0 flex-1 space-y-1">
                                <FormLabel className="text-sm font-normal text-foreground">
                                  AI: Model
                                </FormLabel>
                                <FormDescription className="text-xs text-muted-foreground">
                                  {providerConfig.openai.modelDescription}
                                </FormDescription>
                              </div>
                              <div className="w-[400px] flex-shrink-0">
                                <FormControl>
                                  <Input
                                    type="text"
                                    placeholder={
                                      providerConfig.openai.modelPlaceholder
                                    }
                                    className="h-8 border-input bg-background text-sm"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage className="mt-1 text-xs" />
                              </div>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Claude Section - Disabled for now */}
                {false && (
                  <div className="space-y-6">
                    <div className="border-b border-border pb-2">
                      <h3 className="text-sm font-medium text-foreground">
                        {providerConfig.claude.label}
                      </h3>
                    </div>
                    <div className="space-y-6 pl-4">
                      <FormField
                        control={form.control}
                        name="providers.claude.apiKey"
                        render={({ field }) => (
                          <FormItem className="space-y-1">
                            <div className="flex items-start justify-between gap-8">
                              <div className="min-w-0 flex-1 space-y-1">
                                <FormLabel className="text-sm font-normal text-foreground">
                                  AI: API Key
                                </FormLabel>
                                <FormDescription className="text-xs text-muted-foreground">
                                  Your API key is stored securely and used for
                                  AI query generation
                                </FormDescription>
                              </div>
                              <div className="w-[400px] flex-shrink-0">
                                <FormControl>
                                  <Input
                                    type="password"
                                    placeholder={
                                      providerConfig.claude.apiKeyPlaceholder
                                    }
                                    className="h-8 border-input bg-background text-sm"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage className="mt-1 text-xs" />
                              </div>
                            </div>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="providers.claude.model"
                        render={({ field }) => (
                          <FormItem className="space-y-1">
                            <div className="flex items-start justify-between gap-8">
                              <div className="min-w-0 flex-1 space-y-1">
                                <FormLabel className="text-sm font-normal text-foreground">
                                  AI: Model
                                </FormLabel>
                                <FormDescription className="text-xs text-muted-foreground">
                                  {providerConfig.claude.modelDescription}
                                </FormDescription>
                              </div>
                              <div className="w-[400px] flex-shrink-0">
                                <FormControl>
                                  <Input
                                    type="text"
                                    placeholder={
                                      providerConfig.claude.modelPlaceholder
                                    }
                                    className="h-8 border-input bg-background text-sm"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage className="mt-1 text-xs" />
                              </div>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
};

export default SettingsForm;
