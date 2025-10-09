"use server";

import { queryGenerator } from "@/lib/ai-agents/query-generator";

export interface GenerateQueryInput {
  prompt: string;
  dbType: "mongodb" | "pgSql" | "sqlite";
  context?: string;
  model?: string;
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

    // Check if query generator is configured
    if (!queryGenerator.isConfigured()) {
      return {
        success: false,
        error:
          "AI query generator not configured. Please add NEXT_PUBLIC_OPENROUTER_API_KEY to your environment variables.",
      };
    }

    // Generate the query
    const query = await queryGenerator.generateQuery({
      prompt: input.prompt.trim(),
      dbType: input.dbType,
      context: input.context,
      model: input.model,
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

    if (!queryGenerator.isConfigured()) {
      return {
        success: false,
        error: "AI query generator not configured",
      };
    }

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

    if (!queryGenerator.isConfigured()) {
      return {
        success: false,
        error: "AI query generator not configured",
      };
    }

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

    if (!queryGenerator.isConfigured()) {
      return {
        success: false,
        error: "AI query generator not configured",
      };
    }

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

