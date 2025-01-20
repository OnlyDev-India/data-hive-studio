import { z } from "zod";
import { DbConnectionsTypes } from "../db.type";
const dbConnectionTypesArray = DbConnectionsTypes as string[]; // Cast to string array if necessary

export const connectionFormSchema = z.object({
  name: z.string().optional(),
  connection_type: z.enum(dbConnectionTypesArray as any),
  connection_string: z.string(),
  color: z.string().optional(),
});
