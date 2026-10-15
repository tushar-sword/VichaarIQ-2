import { Agent, run } from "@openai/agents";
import { AnalyticsPlanSchema, type AnalyticsPlanRequest, type AnalyticsPlanResponse } from "@vichaar/shared";
import { plannerInstructions, writerInstructions } from "./prompts.js";
import { checkPlanSemantics, checkDraftSemantics } from "./semantics.js";

export class AnalyticsPlanningError extends Error {
  constructor(readonly code: "INVALID_PLAN_OUTPUT" | "EMPTY_QUERY_DRAFT") {
    super(code === "INVALID_PLAN_OUTPUT" ? "Planner output did not match the analysis plan schema." : "Query drafter returned no output.");
    this.name = "AnalyticsPlanningError";
  }
}

// Formatting only: SQL contents are untouched and still require AST validation.
function unwrapOutput(output: string, format: "json" | "sql"): string {
  const match = new RegExp("^```(?:" + format + ")?[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```$", "i").exec(output.trim());
  return match ? match[1].trim() : output.trim();
}

export async function createAnalyticsPlan(request: AnalyticsPlanRequest, model: string): Promise<AnalyticsPlanResponse> {
  const postgres = request.databaseKind === "postgres";
  const planner = new Agent({ name: "Analytics Planner", model,
    instructions: plannerInstructions(postgres), outputType: AnalyticsPlanSchema });
  // Credentials and connection IDs are intentionally absent. JSON preserves question/schema boundaries.
  const context = {
    question: request.question, databaseKind: request.databaseKind, schemaContext: request.schemaContext,
    currentDateUtc: new Date().toISOString().slice(0, 10), executionTimezone: "UTC",
  };
  const planned = await run(planner, JSON.stringify(context, null, 2), { maxTurns: 1 });
  let candidate: unknown = planned.finalOutput;
  try {
    // SDK structured output is an object. Text support preserves older mocked/compatible transports.
    if (typeof candidate === "string") candidate = JSON.parse(unwrapOutput(candidate, "json"));
    candidate = AnalyticsPlanSchema.parse(candidate);
  } catch { throw new AnalyticsPlanningError("INVALID_PLAN_OUTPUT"); }
  const plan = candidate as AnalyticsPlanResponse["plan"];
  if (plan.needsClarification) {
    if (!plan.clarificationQuestion?.trim()) throw new AnalyticsPlanningError("INVALID_PLAN_OUTPUT");
    return { plan, queryDraft: "", warnings: ["Clarification is required before drafting or executing a query."] };
  }
  const clarify = (reason: string): AnalyticsPlanResponse => ({
    plan: { ...plan, needsClarification: true, clarificationQuestion: reason }, queryDraft: "",
    warnings: ["Semantic consistency check requires clarification. No SQL was changed or executed."],
  });
  const planConflict = checkPlanSemantics(request, plan);
  if (planConflict) return clarify(planConflict);
  const writer = new Agent({ name: "Query Draft Writer", model, instructions: writerInstructions(postgres) });
  const drafted = await run(writer, JSON.stringify({ ...context, plan }, null, 2), { maxTurns: 1 });
  const queryDraft = unwrapOutput(drafted.finalOutput ?? "", request.databaseKind === "mongodb" ? "json" : "sql");
  if (!queryDraft) throw new AnalyticsPlanningError("EMPTY_QUERY_DRAFT");
  const draftConflict = checkDraftSemantics(request, plan, queryDraft);
  if (draftConflict) return clarify(draftConflict);
  return { plan, queryDraft, warnings: [
    "AI-generated SQL must pass deterministic validation before execution.",
    "Planning never executes queries. Execution is a separate read-only API request.",
  ] };
}
