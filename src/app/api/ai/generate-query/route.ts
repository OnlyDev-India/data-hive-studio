import { queryGenerator } from "@/lib/ai-agents/query-generator";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface GenerateQueryRequest {
  prompt: string;
  dbType: "mongodb" | "pgSql" | "sqlite";
  context?: string;
  model?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateQueryRequest = await request.json();

    // Validate input
    if (!body.prompt || !body.prompt.trim()) {
      return new Response(
        JSON.stringify({ error: "Prompt cannot be empty" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!body.dbType) {
      return new Response(
        JSON.stringify({ error: "Database type is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check if query generator is configured
    if (!queryGenerator.isConfigured()) {
      return new Response(
        JSON.stringify({
          error:
            "AI query generator not configured. Please add NEXT_PUBLIC_OPENROUTER_API_KEY to your environment variables.",
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
            prompt: body.prompt.trim(),
            dbType: body.dbType,
            context: body.context,
            model: body.model,
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

