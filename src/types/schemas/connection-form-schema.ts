import { z } from "zod";
import { DbConnectionsTypes } from "../db.type";
const dbConnectionTypesArray = DbConnectionsTypes.map(
  (item) => item.value,
) as string[]; // Cast to string array if necessary

export const connectionFormSchema = z.object({
  // Basic connection info
  name: z.string().min(1, "Connection name is required"),
  connection_type: z.enum(dbConnectionTypesArray as any, {
    required_error: "Please select a connection type",
  }),
  color: z.string().optional(),
  
  // Database connection details
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().min(1, "Port must be greater than 0").max(65535, "Port must be less than 65536").optional(),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  database: z.string().min(1, "Database name is required"),
  
  // Optional fields
  connection_string: z.string().optional(),
  ssl: z.union([
    z.boolean(),
    z.object({
      rejectUnauthorized: z.boolean()
    })
  ]).optional().default(false),
  save_password: z.boolean().optional().default(true),
});
