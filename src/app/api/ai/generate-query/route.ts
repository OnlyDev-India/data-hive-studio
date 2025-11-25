import { queryGenerator } from "@/lib/ai-agents/query-generator";
import { NextRequest } from "next/server";
import { decrypt } from "@/lib/utils/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface GenerateQueryRequest {
  encrypted: string;
}

export interface DecryptedRequest {
  prompt: string;
  dbType: "mongodb" | "pgSql" | "sqlite";
  context?: string;
  model?: string;
  apiKey: string;
  selectedModel: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateQueryRequest = await request.json();

    // Decrypt the request body
    if (!body.encrypted) {
      return new Response(
        JSON.stringify({ error: "Encrypted data is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    let decryptedBody: DecryptedRequest;
    try {
      const decrypted = await decrypt(body.encrypted);
      decryptedBody = JSON.parse(decrypted);
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: "Failed to decrypt request data" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate input
    if (!decryptedBody.prompt || !decryptedBody.prompt.trim()) {
      return new Response(
        JSON.stringify({ error: "Prompt cannot be empty" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!decryptedBody.dbType) {
      return new Response(
        JSON.stringify({ error: "Database type is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check if API key is provided from settings
    if (!decryptedBody.apiKey || decryptedBody.apiKey.trim() === "") {
      return new Response(
        JSON.stringify({
          error:
            "AI query generator not configured. Please configure your API key in settings.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check if model is provided
    if (!decryptedBody.selectedModel || decryptedBody.selectedModel.trim() === "") {
      return new Response(
        JSON.stringify({
          error:
            "Model not configured. Please select a model in settings.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Create a readable stream for Server-Sent Events
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Stream the query generation
          for await (const chunk of queryGenerator.generateQueryStream({
            prompt: decryptedBody.prompt.trim(),
            dbType: decryptedBody.dbType,
            context: decryptedBody.context,
            model: decryptedBody.model,
            apiKey: decryptedBody.apiKey,
            selectedModel: decryptedBody.selectedModel,
          })) {
            // Send chunk as SSE
            const data = JSON.stringify({ type: "chunk", content: chunk });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          // Send completion signal
          const doneData = JSON.stringify({ type: "done" });
          controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));
          controller.close();
        } catch (error: any) {
          console.error("Streaming error:", error);
          const errorData = JSON.stringify({
            type: "error",
            error: error.message || "Failed to generate query",
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

