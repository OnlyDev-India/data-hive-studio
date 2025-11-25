/**
 * OpenRouter Configuration
 * 
 * Note: API key and model are now configured through user settings, not this config.
 * Only baseUrl and appName are used from here.
 */

export const openRouterConfig = {
  baseUrl: "https://openrouter.ai/api/v1",
  appName: process.env.NEXT_PUBLIC_OPENROUTER_APP_NAME || "Data Hive Studio",

  // Available models for different use cases (for reference/UI only)
  models: {
    fast: "meta-llama/llama-3.2-3b-instruct:free",
    balanced: "meta-llama/llama-3.1-8b-instruct:free",
    powerful: "deepseek/deepseek-chat-v3.1:free",
    coding: "qwen/qwen-2.5-coder-32b-instruct:free",
  },
};

