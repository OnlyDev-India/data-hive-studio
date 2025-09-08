export interface APIGroup {
  id: string;
  path: string;
  endpoints?: APIEndpoint[];
  subGroups?: APIGroup[];
}

export interface APIDetails {
  id: string;
  name: string;
  description?: string;
  endpoints: APIEndpoint[];
  groups?: APIGroup[];
  enabled: boolean;
  connectionId: string;
  createdAt: Date;
  updatedAt: Date;
  version: string;
  tags?: string[];
  // Performance settings
  rateLimit?: number;
  timeout?: number;
  logging?: boolean;
  // Security settings
  corsEnabled?: boolean;
  corsOrigins?: string[];
  corsMethods?: string[];
  corsHeaders?: string[];
  authentication?: "none" | "api-key" | "jwt" | "oauth";
}

export interface APIEndpoint {
  id: string;
  name: string;
  fullPath: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  description?: string;
  parameters?: APIParameter[];
  responses?: APIResponse[];
  flow?: APIFlow;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface APIEndpointForm
  extends Omit<
    APIEndpoint,
    "id" | "createdAt" | "connectionId" | "updatedAt"
  > {}

export interface APIParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: any;
  validation?: ParameterValidation;
}

export interface ParameterValidation {
  min?: number;
  max?: number;
  pattern?: string;
  enum?: string[];
}

export interface APIResponse {
  statusCode: number;
  description: string;
  schema?: any;
  example?: any;
}

export interface APIFlow {
  nodes: APINode[];
  connections: APIConnection[];
}

export interface APINode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: any;
  config: any;
}

export interface APIConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface APIDetailsStore {
  apiDetails: {
    [key: string]: APIDetails;
  };
}

export interface ConnectionsTypeWithAPIs {
  id: string;
  name: string;
  connection_type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  connection_string: string;
  database?: string;
  save_password: number;
  color: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  is_current?: boolean;
  apis?: string[]; // Array of API UUIDs
}

export type LoadingState =
  | "idle"
  | "succeeded"
  | "failed"
  | "updating"
  | "deleting"
  | "toggling"
  | "creating"
  | "fetching"
  | "initializing";
