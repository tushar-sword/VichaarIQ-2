import {Agent,run} from "@openai/agents";
import {AnalyticsPlanSchema,type AnalyticsPlanRequest,type AnalyticsPlanResponse} from "@vichaar/shared";
function planner(model:string){return new Agent({
  name:"Analytics Planner",model,
  instructions:"Convert the business question into JSON with keys goal, metric, dimensions (array), filters (array), timeRange (string or null), chartType (line|bar|pie|table|number), needsClarification (boolean), clarificationQuestion (string or null). Use only supplied schema context and never invent fields. If ambiguous, ask one concise clarification. Do not draft or execute queries."
});}
function queryDrafter(model:string){return new Agent({
  name:"Query Draft Writer",model,
  instructions:"Draft only an analytics query using the supplied question, plan and schema. Use only listed entities/fields. For SQL, output one read-only SELECT statement and never write/DDL statements or multiple statements. For MongoDB, output a JSON array aggregation pipeline, not JavaScript. If schema is insufficient, explain briefly instead of guessing. Output only the draft; it is not validated or executed."
});}
export async function createAnalyticsPlan(request:AnalyticsPlanRequest,model:string):Promise<AnalyticsPlanResponse>{
  const planned=await run(planner(model),`Question:\\n${request.question}\\nDatabase: ${request.databaseKind}\\nSchema context:\\n${request.schemaContext}`);
  if(!planned.finalOutput) throw new Error("Planner returned no output.");
  let value:unknown;
  try{value=JSON.parse(planned.finalOutput);}catch{throw new Error("Planner output was not valid JSON.");}
  const plan=AnalyticsPlanSchema.parse(value);
  const drafted=await run(queryDrafter(model),`Question: ${request.question}\\nDatabase: ${request.databaseKind}\\nSchema context:\\n${request.schemaContext}\\nPlan JSON: ${JSON.stringify(plan)}\\nDraft the query only.`);
  const queryDraft=(drafted.finalOutput??"").trim();
  if(!queryDraft) throw new Error("Query drafter returned no output.");
  return {plan,queryDraft,warnings:["AI-generated query is untrusted and has not been deterministically validated.","No customer database connection or query execution occurs in Phase 2."]};
}
