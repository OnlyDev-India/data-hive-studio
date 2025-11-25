import { openRouterConfig } from '@/config/ai-config';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface GenerateQueryOptions {
  prompt: string;
  dbType: 'mongodb' | 'pgSql' | 'sqlite';
  context?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string; // Optional: override from settings
  selectedModel?: string; // Optional: override from settings
}

export class QueryGenerator {
  private baseUrl: string;
  private appName: string;

  constructor() {
    // Only use baseUrl and appName from config (these are constants)
    this.baseUrl = openRouterConfig.baseUrl;
    this.appName = openRouterConfig.appName;
  }

  /**
   * Check if OpenRouter is properly configured
   * Now checks if API key is provided in settings
   */
  isConfigured(apiKey?: string): boolean {
    return !!(apiKey && apiKey.trim() !== "");
  }

  /**
   * Make a request to OpenRouter API
   */
  private async makeRequest(
    messages: OpenRouterMessage[],
    model?: string,
    temperature: number = 0.7,
    maxTokens: number = 1000,
    apiKey?: string,
    selectedModel?: string
  ): Promise<OpenRouterResponse> {
    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        'OpenRouter API key not configured. Please configure your API key in settings.'
      );
    }

    const effectiveModel = model || selectedModel;
    if (!effectiveModel) {
      throw new Error(
        'Model not configured. Please select a model in settings.'
      );
    }

    try {
      const requestBody = {
        model: effectiveModel,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      console.log('OpenRouter Request:', {
        model: requestBody.model,
        messageCount: messages.length,
        temperature,
        maxTokens,
      });

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
          'X-Title': this.appName,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = response.statusText;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
          console.error('OpenRouter API Error:', errorJson);
        } catch (e) {
          console.error('OpenRouter API Error (raw):', errorText);
        }
        
        throw new Error(`OpenRouter API error (${response.status}): ${errorMessage}`);
      }

      const data = await response.json();
      
      // Check if response contains an error even with 200 status
      if (data.error) {
        console.error('OpenRouter API Error in response:', data.error);
        const errorMsg = data.error.message || 'Unknown error from OpenRouter';
        const provider = data.error.metadata?.provider_name;
        throw new Error(
          provider 
            ? `${errorMsg} (Provider: ${provider})` 
            : errorMsg
        );
      }

      console.log('OpenRouter Response:', {
        id: data.id,
        model: data.model,
        hasChoices: !!data.choices,
        choicesLength: data.choices?.length || 0,
      });

      return data;
    } catch (error) {
      if (error instanceof Error) {
        console.error('OpenRouter request failed:', error.message);
        throw error;
      }
      throw new Error('Unknown error occurred while calling OpenRouter API');
    }
  }

  /**
   * Generate a database query based on natural language input
   */
  async generateQuery(options: GenerateQueryOptions): Promise<string> {
    const { prompt, dbType, context, model, temperature = 0.3, maxTokens = 1000, apiKey, selectedModel } = options;

    const systemPrompt = this.getSystemPrompt(dbType, context);
    
    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.makeRequest(messages, model, temperature, maxTokens, apiKey, selectedModel);
      
      if (!response || typeof response !== 'object') {
        console.error('Invalid response from OpenRouter:', response);
        throw new Error('Invalid response format from OpenRouter API');
      }

      if (!response.choices || !Array.isArray(response.choices) || response.choices.length === 0) {
        console.error('No choices in response:', response);
        throw new Error('No response generated. The AI model may be unavailable or the request was invalid.');
      }

      const content = response.choices[0]?.message?.content;
      if (!content) {
        console.error('No content in response:', response.choices[0]);
        throw new Error('Empty response from AI model');
      }

      return content.trim();
    } catch (error) {
      if (error instanceof Error) {
        // Re-throw with more context if it's our error
        throw error;
      }
      throw new Error(`Failed to generate query: ${String(error)}`);
    }
  }

  /**
   * Generate a database query with streaming support
   */
  async *generateQueryStream(options: GenerateQueryOptions): AsyncGenerator<string, void, unknown> {
    const { prompt, dbType, context, model, temperature = 0.3, maxTokens = 1000, apiKey, selectedModel } = options;

    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        'OpenRouter API key not configured. Please configure your API key in settings.'
      );
    }

    const effectiveModel = model || selectedModel;
    if (!effectiveModel) {
      throw new Error(
        'Model not configured. Please select a model in settings.'
      );
    }

    const systemPrompt = this.getSystemPrompt(dbType, context);
    
    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      const requestBody = {
        model: effectiveModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true, // Enable streaming
      };

      console.log('OpenRouter Streaming Request:', {
        model: requestBody.model,
        messageCount: messages.length,
        temperature,
        maxTokens,
      });

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
          'X-Title': this.appName,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = response.statusText;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
          console.error('OpenRouter API Error:', errorJson);
        } catch (e) {
          console.error('OpenRouter API Error (raw):', errorText);
        }
        
        throw new Error(`OpenRouter API error (${response.status}): ${errorMessage}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          
          // Skip empty lines and comments
          if (!trimmedLine || trimmedLine.startsWith(':')) continue;
          
          // Parse SSE data
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);
            
            // Check for end of stream
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              
              // Check for errors in the stream
              if (parsed.error) {
                const errorMsg = parsed.error.message || 'Unknown error from OpenRouter';
                const provider = parsed.error.metadata?.provider_name;
                throw new Error(
                  provider 
                    ? `${errorMsg} (Provider: ${provider})` 
                    : errorMsg
                );
              }
              
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch (e) {
              if (e instanceof Error && e.message.includes('Provider:')) {
                throw e;
              }
              console.warn('Failed to parse SSE data:', data);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error('OpenRouter streaming failed:', error.message);
        throw error;
      }
      throw new Error('Unknown error occurred while streaming from OpenRouter API');
    }
  }

  /**
   * Optimize an existing query
   */
  async optimizeQuery(query: string, dbType: string, apiKey?: string, selectedModel?: string): Promise<string> {
    const systemPrompt = `You are a database query optimization expert for ${dbType}. 
Analyze the provided query and suggest optimizations for better performance. 
Return ONLY the optimized query without explanations.`;

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Optimize this query:\n\n${query}` },
    ];

    const response = await this.makeRequest(messages, undefined, 0.3, 1500, apiKey, selectedModel);
    return response.choices[0].message.content.trim();
  }

  /**
   * Explain what a query does
   */
  async explainQuery(query: string, dbType: string, apiKey?: string, selectedModel?: string): Promise<string> {
    const systemPrompt = `You are a database expert for ${dbType}. 
Explain what the provided query does in simple, clear language.`;

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Explain this query:\n\n${query}` },
    ];

    const response = await this.makeRequest(messages, undefined, 0.5, 800, apiKey, selectedModel);
    return response.choices[0].message.content.trim();
  }

  /**
   * Fix a query that has an error
   */
  async fixQuery(query: string, error: string, dbType: string, apiKey?: string, selectedModel?: string): Promise<string> {
    const systemPrompt = `You are a database expert for ${dbType}. 
Fix the provided query based on the error message. 
Return ONLY the fixed query without explanations.`;

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { 
        role: 'user', 
        content: `Fix this query:\n\n${query}\n\nError:\n${error}` 
      },
    ];

    const response = await this.makeRequest(messages, undefined, 0.3, 1500, apiKey, selectedModel);
    return response.choices[0].message.content.trim();
  }

  /**
   * Get appropriate system prompt based on database type
   */
  private getSystemPrompt(dbType: string, context?: string): string {
    const basePrompts = {
      mongodb: `You are an expert MongoDB query assistant. Generate MongoDB queries based on natural language requests.

CRITICAL RULES - READ CAREFULLY:
- Return ONLY the MongoDB query code - NO explanations, NO markdown, NO comments, NO extra text
- Do NOT reply with "Here's the query" or "This will..." or any other text - ONLY CODE
- If the prompt is unclear, nonsensical, or not a database query request (like "test", "hello", random words), return: ERROR: Invalid prompt - please describe a database query

MANDATORY FORMAT REQUIREMENT (EXTREMELY IMPORTANT):
- You MUST ALWAYS use db.collection("collectionName") format
- NEVER EVER use db.collectionName format - this is FORBIDDEN and will cause errors
- Every single query MUST start with db.collection("...") or db.operation() for admin tasks
- There are NO EXCEPTIONS to this rule

YOUR RESPONSE MUST FOLLOW THIS EXACT PATTERN:
db.collection("collectionName").method(args)

NOT THIS PATTERN (FORBIDDEN):
db.collectionName.method(args)

Your entire response should EITHER be executable MongoDB code OR start with "ERROR:"

CORRECT FORMAT EXAMPLES:

Collection-level operations (most queries):
✓ db.collection("users").find();
✓ db.collection("orders").find({ status: "active" });
✓ db.collection("products").aggregate([{ $match: { price: { $gt: 100 } } }]);
✓ db.collection("tasks").countDocuments();
✓ db.collection("users").insertOne({ name: "John" });
✓ db.collection("orders").updateMany({ status: "pending" }, { $set: { status: "active" } });

Database-level operations (admin/management):
✓ db.createCollection("tasks");
✓ db.dropCollection("tasks");
✓ db.listCollections();
✓ db.stats();
✓ db.runCommand({ ping: 1 });

INCORRECT FORMAT (DO NOT USE):
✗ db.users.find()  ← Wrong: use db.collection("users").find()
✗ db.orders.aggregate()  ← Wrong: use db.collection("orders").aggregate()
✗ db.tasks.countDocuments()  ← Wrong: use db.collection("tasks").countDocuments()
✗ db.collection("tasks").create()  ← Wrong: use db.createCollection("tasks")
✗ db.collection("tasks").drop()  ← Wrong: use db.dropCollection("tasks")

IMPORTANT:
- For querying/modifying data: Use db.collection("name").operation()
- For creating/dropping collections: Use db.createCollection() or db.dropCollection()
- Always wrap collection names in quotes`,
      
      pgSql: `You are an expert PostgreSQL query assistant. Generate PostgreSQL/SQL queries based on natural language requests.

CRITICAL RULES:
- Return ONLY the SQL query code - NO explanations, NO markdown, NO comments, NO extra text
- Do NOT reply with "Here's the query" or "This will..." or any other text - ONLY CODE
- If the prompt is unclear, nonsensical, or not a database query request (like "test", "hello", random words), return: ERROR: Invalid prompt - please describe a database query
- Use proper PostgreSQL syntax and best practices
- Include appropriate clauses (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, LIMIT)
- Your entire response should EITHER be executable SQL code OR start with "ERROR:"`,
      
      sqlite: `You are an expert SQLite query assistant. Generate SQLite queries based on natural language requests.

CRITICAL RULES:
- Return ONLY the SQL query code - NO explanations, NO markdown, NO comments, NO extra text
- Do NOT reply with "Here's the query" or "This will..." or any other text - ONLY CODE
- If the prompt is unclear, nonsensical, or not a database query request (like "test", "hello", random words), return: ERROR: Invalid prompt - please describe a database query
- Use SQLite-compatible syntax
- Include appropriate clauses (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, LIMIT)
- Your entire response should EITHER be executable SQL code OR start with "ERROR:"`,
    };

    let prompt = basePrompts[dbType as keyof typeof basePrompts] || basePrompts.pgSql;
    
    if (context) {
      prompt += `\n\nDatabase Schema Context:\n${context}`;
    }

    return prompt;
  }

  /**
   * Chat with AI about database queries
   */
  async chat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    dbType: string,
    model?: string
  ): Promise<string> {
    const systemPrompt = `You are a helpful database assistant for ${dbType}. 
Help users understand, write, and optimize database queries.`;

    const fullMessages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    const response = await this.makeRequest(fullMessages, model, 0.7, 1500);
    return response.choices[0].message.content.trim();
  }
}

// Export a singleton instance
export const queryGenerator = new QueryGenerator();

