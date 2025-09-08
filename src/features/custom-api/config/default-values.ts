import { APIDetails, APIEndpointForm } from "../types/custom-api.type";

export const API_FORM_DEFAULT_VALUES: Omit<
  APIDetails,
  "id" | "createdAt" | "updatedAt" | "connectionId"
> = {
  name: "untitled",
  description: "test-api-description",
  version: "1.0.0",
  enabled: false,
  tags: [],
  rateLimit: 1000,
  timeout: 30,
  corsEnabled: true,
  corsOrigins: [],
  corsMethods: [],
  corsHeaders: [],
  authentication: "none",
  logging: true,
  endpoints: [],
  groups: [],
};

export const API_ENDPOINT_DEFAULT_VALUES: APIEndpointForm= {
  name: "",
  path: "",
  method: "GET",
  description: "",
  enabled: false,
  fullPath: "",
};