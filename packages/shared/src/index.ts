import {z} from "zod";
export const DatabaseKindSchema=z.enum(["postgres","mysql","sqlite","mongodb"]);
export const AnalyticsPlanRequestSchema=z.object({question:z.string().trim().min(3).max(2000),databaseKind:DatabaseKindSchema,schemaContext:z.string().trim().min(3).max(12000)});
export type AnalyticsPlanRequest=z.infer<typeof AnalyticsPlanRequestSchema>;
export const AnalyticsPlanSchema=z.object({goal:z.string(),metric:z.string(),dimensions:z.array(z.string()),filters:z.array(z.string()),timeRange:z.string().nullable(),chartType:z.enum(["line","bar","pie","table","number"]),needsClarification:z.boolean(),clarificationQuestion:z.string().nullable()});
export type AnalyticsPlan=z.infer<typeof AnalyticsPlanSchema>;
export const AnalyticsPlanResponseSchema=z.object({plan:AnalyticsPlanSchema,queryDraft:z.string(),warnings:z.array(z.string())});
export type AnalyticsPlanResponse=z.infer<typeof AnalyticsPlanResponseSchema>;
