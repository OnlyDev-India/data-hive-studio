/**
 * OpenRouter Configuration
 *
 * Add these environment variables to your .env.local file:
 * NEXT_PUBLIC_OPENROUTER_API_KEY=your_api_key_here
 * NEXT_PUBLIC_OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free
 * NEXT_PUBLIC_OPENROUTER_APP_NAME=Data Hive Studio
 */

export const openRouterConfig = {
  apiKey:
    "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",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel:
    process.env.NEXT_PUBLIC_OPENROUTER_MODEL || "meta-llama/llama-3.2-3b-instruct:free",
  appName: process.env.NEXT_PUBLIC_OPENROUTER_APP_NAME || "Data Hive Studio",

  // Available models for different use cases
  models: {
    fast: "meta-llama/llama-3.2-3b-instruct:free",
    balanced: "meta-llama/llama-3.1-8b-instruct:free",
    powerful: "deepseek/deepseek-chat-v3.1:free",
    coding: "qwen/qwen-2.5-coder-32b-instruct:free",
  },

  // Check if API key is configured
  isConfigured: () => {
    return "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";
  },
};

