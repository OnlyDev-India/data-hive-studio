import express, { Express, Request, Response } from "express";
import { Server } from "http";
import cors from "cors";
import { APIDetails, APIEndpoint } from "../types/custom-api.type";
import { DatabaseClient } from "@/types/db.type";
import { EndpointFlowExecutor } from "../components/api-workbench/flow-executor";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: any;
}

type methodsType = "get" | "post" | "put" | "delete" | "patch" | "all";

export class CustomServer {
  private app: Express;
  private server: Server | null = null;
  private port: number;
  private endpoints: APIEndpoint[];
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000; // Maximum number of logs to keep
  private instanceId: string; // Unique identifier for this server instance
  private apiDetails: APIDetails; // Store the complete API details for CORS and other configurations
  private dbClient: DatabaseClient|null = null;

  constructor(options: APIDetails) {
    this.apiDetails = options;
    this.port = options.port || 3000;
    this.endpoints = options.endpoints;
    this.instanceId = crypto.randomUUID();
    this.dbClient = null;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    // Log after setupLogging is called
    this.log(
      "info",
      `Created CustomServer instance ${this.instanceId} for port ${this.port}`,
    );
  }

  private setupMiddleware(): void {
    // CORS configuration
    this.setupCORS();

    this.app.use(express.json());

    // Request logging middleware
    this.app.use((req: Request, res: Response, next) => {
      this.log("info", `${req.method} ${req.path}`, {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body,
        headers: req.headers,
        ip: req.ip,
      });
      next();
    });
  }

  private setupCORS(): void {
    // If CORS is disabled, skip CORS setup
    if (!this.apiDetails.corsEnabled) {
      this.log("info", "CORS is disabled");
      return;
    }

    const corsOptions = {
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // If no origin (e.g., mobile apps, Postman), allow it
        if (!origin) {
          return callback(null, true);
        }

        // Check if origin is in allowed origins
        const allowedOrigins = this.apiDetails.corsOrigins || [];
        if (allowedOrigins.length === 0) {
          // If no specific origins configured, allow all
          return callback(null, true);
        }

        if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
          return callback(null, true);
        }

        this.log("warn", `CORS blocked request from origin: ${origin}`, {
          allowedOrigins,
          requestedOrigin: origin,
        });
        return callback(new Error("Not allowed by CORS"), false);
      },
      methods: this.apiDetails.corsMethods || [
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "OPTIONS",
      ],
      allowedHeaders: this.apiDetails.corsHeaders || [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
      ],
      credentials: true,
      optionsSuccessStatus: 200, // Some legacy browsers choke on 204
      preflightContinue: false, // Let CORS handle preflight requests
    };

    this.app.use(cors(corsOptions));

    // Handle preflight requests manually for better logging
    this.app.options("/*path", (req: Request, res: Response) => {
      this.log("info", `Preflight request: ${req.method} ${req.path}`, {
        origin: req.headers.origin,
        method: req.headers["access-control-request-method"],
        headers: req.headers["access-control-request-headers"],
      });
      res.status(200).end();
    });

    // Log CORS configuration
    this.log("info", "CORS middleware configured", {
      enabled: this.apiDetails.corsEnabled,
      origins: this.apiDetails.corsOrigins,
      methods: this.apiDetails.corsMethods,
      headers: this.apiDetails.corsHeaders,
    });
  }

  private log(level: LogEntry["level"], message: string, data?: any): void {
    const logEntry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      level,
      message,
      data: data ? JSON.stringify(data, null, 2) : undefined,
    };

    this.logs.push(logEntry);

    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Debug: Log to original console to verify logging is working
    if (level === "info" && message.includes("Custom server is running")) {
      // This will help us verify the logging system is working
    }
  }

  private setupRoutes(): void {
    // Default route
    this.app.get("/", (req: Request, res: Response) => {
      res.send("Hello World");
    });

    // Dynamic endpoints
    this.endpoints
      .filter((endpoint) => endpoint.enabled)
      .forEach((endpoint) => {
        this.app[endpoint.method.toLowerCase() as methodsType](
          endpoint.path,
          async (req: Request, res: Response) => {
            await this.executeEndpoint(endpoint, req, res);
          },
        );
      });
  }

  private async isPortInUse(port: number): Promise<boolean> {
    const testApp = express();
    return new Promise((resolve) => {
      const testServer = testApp
        .listen(port, () => {
          testServer.close();
          resolve(false);
        })
        .on("error", () => {
          this.log("info", `Port ${port} is in use`);
          resolve(true);
        });
    });
  }

  public async start(): Promise<void> {
    // Try to kill any existing process on this port first

    // Wait a bit for the port to be released
    await new Promise((resolve) => setTimeout(resolve, 100));

    const portCheck = await this.isPortInUse(this.port);
    if (portCheck) {
      throw new Error(
        `Port ${this.port} is still in use after cleanup attempt`,
      );
    }

    this.server = this.app.listen(this.port, () => {
      this.log(
        "info",
        `Custom server instance ${this.instanceId} is running on port ${this.port}`,
      );
      this.log(
        "info",
        `Server has ${this.endpoints.length} endpoints configured`,
      );
      this.log("info", "Server logging system initialized");
    });
  }

  public stop(): void {
    if (this.server) {
      this.log("info", `Stopping custom server instance ${this.instanceId}...`);
      this.server.close();
      this.server = null;
      this.log("info", `Custom server instance ${this.instanceId} stopped`);
    }
  }

  public destroy(): void {
    this.stop();
    this.logs = [];
    this.endpoints = [];
    this.log("info", `Custom server instance ${this.instanceId} destroyed`);
  }

  public isRunning(): boolean {
    return this.server !== null;
  }

  public getPort(): number {
    return this.port;
  }

  public getEndpoints(): APIEndpoint[] {
    return this.endpoints;
  }

  public getLogs(limit?: number, level?: LogEntry["level"]): LogEntry[] {
    let filteredLogs = this.logs;

    // Filter by level if specified
    if (level) {
      filteredLogs = filteredLogs.filter((log) => log.level === level);
    }

    // Apply limit if specified
    if (limit) {
      filteredLogs = filteredLogs.slice(-limit);
    }

    return filteredLogs;
  }

  public clearLogs(): void {
    this.logs = [];
  }

  public getLogCount(): number {
    return this.logs.length;
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  public updateApiDetails(newApiDetails: APIDetails): void {
    this.apiDetails = newApiDetails;
    this.endpoints = newApiDetails.endpoints;
    this.port = newApiDetails.port || 3000;

    // Re-setup routes with new endpoints
    this.setupRoutes();

    this.log("info", "API details updated", {
      port: this.port,
      endpointCount: this.endpoints.length,
      corsEnabled: this.apiDetails.corsEnabled,
    });
  }

  public getApiDetails(): APIDetails {
    return this.apiDetails;
  }

  public getCorsStatus(): {
    enabled: boolean;
    origins: string[];
    methods: string[];
    headers: string[];
  } {
    return {
      enabled: this.apiDetails.corsEnabled || false,
      origins: this.apiDetails.corsOrigins || [],
      methods: this.apiDetails.corsMethods || [
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "OPTIONS",
      ],
      headers: this.apiDetails.corsHeaders || [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
      ],
    };
  }

  private async executeEndpoint(
    endpoint: APIEndpoint,
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      this.log(
        "info",
        `Executing endpoint: ${endpoint.name} (${endpoint.method} ${endpoint.path})`,
      );

      // Check if endpoint has a flow defined
      if (!endpoint.flow || !endpoint.flow.nodes || endpoint.flow.nodes.length === 0) {
        // No flow defined, return default response
        const params = req.params;
        const queryParams = req.query;
        const body = req.body;
        const headers = req.headers;

        res.status(200).json({
          message: `Endpoint ${endpoint.name} executed (no flow defined)`,
          method: endpoint.method,
          path: endpoint.path,
          timestamp: new Date().toISOString(),
          params,
          queryParams,
          body,
          headers,
        });
        return;
      }

      // Create flow executor
      const executor = new EndpointFlowExecutor(endpoint.id);
      
      // Initialize flow with nodes and edges
      executor.initializeFlow(endpoint.flow.nodes, endpoint.flow.edges);
      
      // Set context from request
      executor.setContext({
        params: req.params,
        query: req.query as Record<string, any>,
        body: req.body,
        headers: req.headers as Record<string, string>,
      });

      // Execute the flow
      const result = await executor.execute();

      // Send response based on flow execution result
      if (result.data) {
        res.status(result.statusCode).json(result.data);
      } else {
        res.status(result.statusCode).json({
          message: result.message,
          error: result.error,
        });
      }

      this.log(
        "info",
        `Flow execution completed for endpoint: ${endpoint.name}`,
        {
          statusCode: result.statusCode,
          hasData: !!result.data,
          message: result.message,
        }
      );

    } catch (error) {
      this.log(
        "error",
        `Error executing endpoint: ${endpoint.name}`,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      res.status(500).json({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }
}
