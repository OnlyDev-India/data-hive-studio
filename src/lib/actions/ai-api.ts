"use server";

import { queryGenerator } from "@/lib/ai-agents/query-generator";

export interface GenerateQueryInput {
  prompt: string;
  dbType: "mongodb" | "pgSql" | "sqlite";
  context?: string;
  model?: string;
  apiKey?: string; // Settings from client
  selectedModel?: string; // Settings from client
}

export interface AIQueryResult {
  success: boolean;
  query?: string;
  error?: string;
}

/**
 * Server action to generate a database query using AI
 * Note: For streaming, use the API route at /api/ai/generate-query
 */
export async function generateQueryAction(
  input: GenerateQueryInput
): Promise<AIQueryResult> {
  try {
    // Validate input
    if (!input.prompt || !input.prompt.trim()) {
      return {
        success: false,
        error: "Prompt cannot be empty",
      };
    }

    if (!input.dbType) {
      return {
        success: false,
        error: "Database type is required",
      };
    }

    // Check if API key is provided from settings
    if (!input.apiKey || input.apiKey.trim() === "") {
      return {
        success: false,
        error:
          "AI query generator not configured. Please configure your API key in settings.",
      };
    }

    // Check if model is provided
    if (!input.selectedModel || input.selectedModel.trim() === "") {
      return {
        success: false,
        error:
          "Model not configured. Please select a model in settings.",
      };
    }

    // Generate the query
    const query = await queryGenerator.generateQuery({
      prompt: input.prompt.trim(),
      dbType: input.dbType,
      context: input.context,
      model: input.model,
      apiKey: input.apiKey,
      selectedModel: input.selectedModel,
    });

    return {
      success: true,
      query: query,
    };
  } catch (error: any) {
    console.error("Failed to generate query in server action:", error);
    return {
      success: false,
      error: error.message || "Failed to generate query. Please try again.",
    };
  }
}

/**
 * Server action to optimize an existing query using AI
 */
export async function optimizeQueryAction(
  query: string,
  dbType: string
): Promise<AIQueryResult> {
  try {
    if (!query || !query.trim()) {
      return {
        success: false,
        error: "Query cannot be empty",
      };
    }

    // Note: optimizeQuery, explainQuery, and fixQuery should also accept settings
    // For now, they'll use the default config
    const optimizedQuery = await queryGenerator.optimizeQuery(
      query.trim(),
      dbType
    );

    return {
      success: true,
      query: optimizedQuery,
    };
  } catch (error: any) {
    console.error("Failed to optimize query in server action:", error);
    return {
      success: false,
      error: error.message || "Failed to optimize query. Please try again.",
    };
  }
}

/**
 * Server action to explain what a query does using AI
 */
export async function explainQueryAction(
  query: string,
  dbType: string
): Promise<{ success: boolean; explanation?: string; error?: string }> {
  try {
    if (!query || !query.trim()) {
      return {
        success: false,
        error: "Query cannot be empty",
      };
    }

    // Note: explainQuery requires API key and model to be passed
    // These should come from settings when called from the client
    const explanation = await queryGenerator.explainQuery(query.trim(), dbType);

    return {
      success: true,
      explanation: explanation,
    };
  } catch (error: any) {
    console.error("Failed to explain query in server action:", error);
    return {
      success: false,
      error: error.message || "Failed to explain query. Please try again.",
    };
  }
}

/**
 * Server action to fix a query with an error using AI
 */
export async function fixQueryAction(
  query: string,
  error: string,
  dbType: string
): Promise<AIQueryResult> {
  try {
    if (!query || !query.trim()) {
      return {
        success: false,
        error: "Query cannot be empty",
      };
    }

    if (!error || !error.trim()) {
      return {
        success: false,
        error: "Error message cannot be empty",
      };
    }

    // Note: fixQuery requires API key and model to be passed
    // These should come from settings when called from the client
    const fixedQuery = await queryGenerator.fixQuery(
      query.trim(),
      error.trim(),
      dbType
    );

    return {
      success: true,
      query: fixedQuery,
    };
  } catch (error: any) {
    console.error("Failed to fix query in server action:", error);
    return {
      success: false,
      error: error.message || "Failed to fix query. Please try again.",
    };
  }
}

