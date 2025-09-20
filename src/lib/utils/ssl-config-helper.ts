/**
 * Helper utilities for handling SSL configurations in connection strings
 */

export interface SSLConfig {
  rejectUnauthorized: boolean;
}

export type SSLValue = boolean | SSLConfig;

/**
 * Generates SSL parameters for PostgreSQL connection strings
 */
export const generatePostgreSQLSSLParams = (ssl: SSLValue): string => {
  if (!ssl) return "";
  
  if (typeof ssl === 'boolean') {
    return ssl ? "?sslmode=require" : "";
  }
  
  // Handle SSL object configuration
  if (ssl.rejectUnauthorized === false) {
    return "?sslmode=require&channel_binding=require";
  }
  
  return "?sslmode=require";
};

/**
 * Generates SSL parameters for MongoDB connection strings
 */
export const generateMongoDBSSLParams = (ssl: SSLValue): string => {
  if (!ssl) return "";
  
  if (typeof ssl === 'boolean') {
    return ssl ? "?ssl=true" : "";
  }
  
  // For MongoDB, SSL object is typically just boolean
  return "?ssl=true";
};

/**
 * Creates a connection string from individual parameters
 */
export const createConnectionString = (
  connectionType: string,
  host: string,
  port: number,
  username: string,
  password: string,
  database: string,
  ssl: SSLValue
): string => {
  const baseUrl = `${connectionType}://${username}:${password}@${host}:${port}/${database}`;
  
  if (connectionType === "postgresql") {
    return baseUrl + generatePostgreSQLSSLParams(ssl);
  } else if (connectionType === "mongodb") {
    return baseUrl + generateMongoDBSSLParams(ssl);
  }
  
  return baseUrl;
};

/**
 * Example usage with your configuration:
 * 
 * const config = {
 *   connectionType: "postgresql",
 *   host: "ep-still-grass-a51vu090-pooler.us-east-2.aws.neon.tech",
 *   port: 5432,
 *   username: "project-planit_owner",
 *   password: "YQUIuwtVO6Z3",
 *   database: "project-planit",
 *   ssl: { rejectUnauthorized: false }
 * };
 * 
 * const connectionString = createConnectionString(
 *   config.connectionType,
 *   config.host,
 *   config.port,
 *   config.username,
 *   config.password,
 *   config.database,
 *   config.ssl
 * );
 * 
 * // Result: "postgresql://project-planit_owner:YQUIuwtVO6Z3@ep-still-grass-a51vu090-pooler.us-east-2.aws.neon.tech:5432/project-planit?sslmode=require&channel_binding=require"
 */
