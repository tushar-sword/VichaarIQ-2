import {z} from "zod";
export const DatabaseKindSchema=z.enum(["postgres","mysql","sqlite","mongodb"]);
export type DatabaseKind = z.infer<typeof DatabaseKindSchema>;
export const AnalyticsPlanRequestSchema=z.object({question:z.string().trim().min(3).max(2000),databaseKind:DatabaseKindSchema,schemaContext:z.string().trim().min(3).max(12000),connectionId:z.string().uuid().optional()});
export type AnalyticsPlanRequest=z.infer<typeof AnalyticsPlanRequestSchema>;
export const AnalyticsPlanSchema=z.object({goal:z.string(),metric:z.string(),dimensions:z.array(z.string()),filters:z.array(z.string()),timeRange:z.string().nullable(),chartType:z.enum(["line","bar","pie","table","number"]),needsClarification:z.boolean(),clarificationQuestion:z.string().nullable()});
export type AnalyticsPlan=z.infer<typeof AnalyticsPlanSchema>;
export const AnalyticsPlanResponseSchema=z.object({plan:AnalyticsPlanSchema,queryDraft:z.string(),warnings:z.array(z.string())});
export type AnalyticsPlanResponse=z.infer<typeof AnalyticsPlanResponseSchema>;

// 📌 REAL DATABASE: credentials belong only to the connection endpoint.
export const DatabaseConnectRequestSchema = z.object({
  connectionString: z.string().trim().min(1).max(2000),
});
export type DatabaseConnectRequest = z.infer<typeof DatabaseConnectRequestSchema>;
export const DatabaseConnectResponseSchema = z.object({
  connected: z.literal(true),
  connectionId: z.string().uuid(),
  databaseKind: z.literal("postgres"),
  schemaContext: z.string(),
});
export type DatabaseConnectResponse = z.infer<typeof DatabaseConnectResponseSchema>;

export const DatabaseDisconnectRequestSchema = z.object({
  connectionId: z.string().uuid(),
});
export type DatabaseDisconnectRequest = z.infer<typeof DatabaseDisconnectRequestSchema>;
export const DatabaseDisconnectResponseSchema = z.object({ disconnected: z.literal(true) });
export type DatabaseDisconnectResponse = z.infer<typeof DatabaseDisconnectResponseSchema>;

export const AnalyticsExecuteRequestSchema = z.object({
  connectionId: z.string().uuid(),
  sql: z.string().trim().min(1).max(20000),
});
export type AnalyticsExecuteRequest = z.infer<typeof AnalyticsExecuteRequestSchema>;
export const AnalyticsExecuteResponseSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  databaseKind: z.literal("postgres"),
  executed: z.literal(true),
});
export type AnalyticsExecuteResponse = z.infer<typeof AnalyticsExecuteResponseSchema>;
