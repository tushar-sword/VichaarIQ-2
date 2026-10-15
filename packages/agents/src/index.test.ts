import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsPlan } from "./index.js";
import { AnalyticsPlanSchema } from "@vichaar/shared";
import { SAFE_FUNCTIONS } from "@vichaar/validation";

// 📌 MOCK DATA: deterministic model stand-ins; these tests never call OpenAI.
const mocks = vi.hoisted(() => ({ run: vi.fn(), configs: [] as { instructions: string; outputType?: unknown }[] }));
vi.mock("@openai/agents", () => ({ Agent: class {
  constructor(config: { instructions: string; outputType?: unknown }) { mocks.configs.push(config); }
}, run: mocks.run }));

const plan = { goal: "Revenue", metric: "amount", dimensions: [], filters: [], timeRange: null,
  chartType: "number", needsClarification: false, clarificationQuestion: null };
const request = { question: "Show revenue", databaseKind: "postgres" as const, schemaContext: "sales(amount)" };

beforeEach(() => { mocks.run.mockReset(); mocks.configs = []; });
afterEach(() => vi.useRealTimers());

describe("analytics clarification", () => {
  it("returns clarification without calling the query drafter", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: JSON.stringify({ ...plan,
      needsClarification: true, clarificationQuestion: "Which period?" }) });
    const response = await createAnalyticsPlan(request, "test-model");
    expect(response.plan.needsClarification).toBe(true);
    expect(response.queryDraft).toBe("");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("preserves two-stage drafting for an unambiguous plan", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: JSON.stringify(plan) })
      .mockResolvedValueOnce({ finalOutput: "SELECT SUM(amount) FROM sales" });
    const response = await createAnalyticsPlan(request, "test-model");
    expect(response.queryDraft).toBe("SELECT SUM(amount) FROM sales");
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it("accepts single enclosing JSON and SQL Markdown wrappers", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: "```json\n" + JSON.stringify(plan) + "\n```" })
      .mockResolvedValueOnce({ finalOutput: "```sql\nSELECT SUM(amount) FROM sales\n```" });
    const response = await createAnalyticsPlan(request, "test-model");
    expect(response.plan).toEqual(plan);
    expect(response.queryDraft).toBe("SELECT SUM(amount) FROM sales");
  });

  it("accepts an unlabelled wrapper without changing query contents", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: "```\n" + JSON.stringify(plan) + "\n```" })
      .mockResolvedValueOnce({ finalOutput: "```\nSELECT 'literal; -- unchanged' AS value\n```" });
    const response = await createAnalyticsPlan(request, "test-model");
    expect(response.queryDraft).toBe("SELECT 'literal; -- unchanged' AS value");
  });

  it("rejects planner prose instead of extracting embedded JSON", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: "Here is the plan:\n```json\n" + JSON.stringify(plan) + "\n```" });
    await expect(createAnalyticsPlan(request, "test-model")).rejects.toThrow("Planner output did not match");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("leaves SQL prose for the validator to reject instead of extracting a statement", async () => {
    const prose = "Here is your query:\n```sql\nSELECT 1\n```";
    mocks.run.mockResolvedValueOnce({ finalOutput: JSON.stringify(plan) })
      .mockResolvedValueOnce({ finalOutput: prose });
    expect((await createAnalyticsPlan(request, "test-model")).queryDraft).toBe(prose);
  });

  it("keeps rejecting object filters instead of silently changing the API contract", async () => {
    // Regression from a real audit response: the planner used field/operator/value objects.
    mocks.run.mockResolvedValueOnce({ finalOutput: JSON.stringify({ ...plan,
      filters: [{ field: "created_at", operator: "between", value: ["2025-01-01", "2025-12-31"] }] }) });
    await expect(createAnalyticsPlan(request, "test-model")).rejects.toThrow();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("uses schema-enforced SDK output and passes parsed structured plans to the writer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2032-02-17T12:00:00Z"));
    mocks.run.mockResolvedValueOnce({ finalOutput: plan }).mockResolvedValueOnce({ finalOutput: "SELECT SUM(amount) FROM sales" });
    await createAnalyticsPlan({ ...request, connectionId: "10000000-0000-4000-8000-000000000001" }, "test-model");
    expect(mocks.configs[0].outputType).toBe(AnalyticsPlanSchema);
    const input = JSON.parse(mocks.run.mock.calls[0][1]);
    expect(input).toEqual({ ...request, currentDateUtc: "2032-02-17", executionTimezone: "UTC" });
    expect(JSON.parse(mocks.run.mock.calls[1][1]).plan).toEqual(plan);
    expect(mocks.run.mock.calls[0][2]).toEqual({ maxTurns: 1 });
  });

  it("shares the actual SQL function policy with both model stages", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: plan }).mockResolvedValueOnce({ finalOutput: "SELECT 1" });
    await createAnalyticsPlan(request, "test-model");
    for (const config of mocks.configs) {
      for (const name of SAFE_FUNCTIONS) expect(config.instructions).toContain(name);
      expect(config.instructions).toContain("half-open timestamp ranges");
      expect(config.instructions).toContain("never subtract the discount again");
      expect(config.instructions).toContain("Do not multiply order-level totals");
      expect(config.instructions).toContain("For order counts across ANY grouping");
      expect(config.instructions).toContain("Revenue-recognition exclusions do not automatically");
      expect(config.instructions).toContain("must not add, remove or change filters");
    }
  });

  it("does not draft for an empty clarification or malformed structured plan", async () => {
    for (const output of [undefined, { ...plan, metric: null }, { ...plan, needsClarification: true, clarificationQuestion: " " }]) {
      mocks.run.mockReset(); mocks.run.mockResolvedValueOnce({ finalOutput: output });
      await expect(createAnalyticsPlan(request, "test-model")).rejects.toMatchObject({ code: "INVALID_PLAN_OUTPUT" });
      expect(mocks.run).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects an empty draft with a controlled error", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: plan }).mockResolvedValueOnce({ finalOutput: " " });
    await expect(createAnalyticsPlan(request, "test-model")).rejects.toMatchObject({ code: "EMPTY_QUERY_DRAFT" });
  });

  it("clarifies a planner-invented status filter before calling the writer", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: { ...plan, filters: ["status IN ('completed','pending','shipped')"] } });
    const response = await createAnalyticsPlan({ ...request, question: "Count orders by region in 2025" }, "test-model");
    expect(response).toMatchObject({ plan: { needsClarification: true }, queryDraft: "" });
    expect(response.plan.clarificationQuestion).toContain("status");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("clarifies writer-added filtering without rewriting or executing its SQL", async () => {
    mocks.run.mockResolvedValueOnce({ finalOutput: { ...plan, filters: [] } })
      .mockResolvedValueOnce({ finalOutput: "SELECT region, COUNT(*) FROM orders WHERE status='completed' GROUP BY region" });
    const response = await createAnalyticsPlan({ ...request, question: "Count orders by region" }, "test-model");
    expect(response).toMatchObject({ plan: { needsClarification: true }, queryDraft: "" });
    expect(response.warnings[0]).toContain("No SQL was changed or executed");
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
});
