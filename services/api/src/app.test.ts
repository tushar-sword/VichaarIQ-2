import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { FastifyInstance } from "fastify";

// 📌 MOCK DATA: isolated endpoint regression stand-ins; no external database or model.
const mocks = vi.hoisted(() => ({ testConnection: vi.fn(), getSchemaSummary: vi.fn(), execute: vi.fn(), close: vi.fn() }));
vi.mock("@vichaar/database", async (original) => {
  const actual = await original<typeof import("@vichaar/database")>();
  return { ...actual, PostgresAdapter: class {
    testConnection = mocks.testConnection; getSchemaSummary = mocks.getSchemaSummary;
    executeReadOnlyQuery = mocks.execute; close = mocks.close;
    validateQuery(sql: string) {
      return validateReadOnlySql(sql, { allowedTables: actual.DEFAULT_BUSINESS_TABLES });
    }
  } };
});
import { validateReadOnlySql } from "@vichaar/validation";
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; vi.clearAllMocks(); vi.unstubAllEnvs(); });

async function connected() {
  mocks.testConnection.mockResolvedValue(true); mocks.getSchemaSummary.mockResolvedValue("public.orders: id (integer)");
  mocks.close.mockResolvedValue(undefined);
  app = await createApp({ logger: false, planner: vi.fn() });
  const connection = await app.inject({ method: "POST", url: "/api/database/connect",
    payload: { connectionString: "postgresql://example.invalid/unused" } });
  expect(connection.statusCode).toBe(200);
  return connection.json().connectionId as string;
}

describe("execution endpoint contract and error handling (no live database/model)", () => {
  it("returns the existing execution response contract", async () => {
    const connectionId = await connected();
    mocks.execute.mockResolvedValueOnce({ columns: ["id"], rows: [{ id: 1 }], rowCount: 1, truncated: false });
    const response = await app!.inject({ method: "POST", url: "/api/analytics/execute", payload: { connectionId, sql: "SELECT id FROM orders" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ columns: ["id"], rows: [{ id: 1 }], rowCount: 1, truncated: false, databaseKind: "postgres", executed: true });
  });

  it("returns 422 without execution for unsafe functions and unauthorized tables", async () => {
    const connectionId = await connected();
    for (const sql of ["SELECT pg_advisory_lock(1)", "SELECT * FROM orders FOR SHARE", "SELECT * FROM pg_catalog.pg_class", "SELECT * FROM public.secrets"]) {
      const response = await app!.inject({ method: "POST", url: "/api/analytics/execute", payload: { connectionId, sql } });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toBe("SQL validation failed.");
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not return PostgreSQL details or credentials in execution errors", async () => {
    const connectionId = await connected();
    mocks.execute.mockRejectedValueOnce(Object.assign(new Error("postgresql://secret:password@private SQL text"), { code: "42501" }));
    const response = await app!.inject({ method: "POST", url: "/api/analytics/execute", payload: { connectionId, sql: "SELECT id FROM orders" } });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/secret|password|SQL text|postgresql:\/\//);
  });

  it("rejects connection safety failures without leaking connection errors", async () => {
    mocks.testConnection.mockRejectedValueOnce(new Error("secret connection string")); mocks.close.mockResolvedValue(undefined);
    app = await createApp({ logger: false, planner: vi.fn() });
    const response = await app.inject({ method: "POST", url: "/api/database/connect", payload: { connectionString: "postgresql://example.invalid/unused" } });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("secret");
  });

  it.each([["42703", "column"], ["57014", "time limit"], ["55P03", "busy"]])("returns actionable, sanitized execution error %s", async (code, expected) => {
    const connectionId = await connected();
    mocks.execute.mockRejectedValueOnce(Object.assign(new Error("private SQL and credentials"), { code }));
    const response = await app!.inject({ method: "POST", url: "/api/analytics/execute", payload: { connectionId, sql: "SELECT id FROM orders" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain(expected);
    expect(response.body).not.toMatch(/private|credentials/);
  });

  it("plans with refreshed connected schema rather than a browser replacement", async () => {
    const connectionId = await connected();
    vi.stubEnv("OPENAI_API_KEY", "unused-mocked-key");
    const planner = vi.fn().mockResolvedValue({ plan: { goal: "Orders", metric: "count", dimensions: [], filters: [],
      timeRange: null, chartType: "number", needsClarification: false, clarificationQuestion: null }, queryDraft: "SELECT COUNT(*) AS order_count FROM orders", warnings: [] });
    // Separate app instance so the injected planner can be observed.
    await app!.close(); app = await createApp({ logger: false, planner });
    const c = await app.inject({ method: "POST", url: "/api/database/connect", payload: { connectionString: "postgresql://example.invalid/unused" } });
    const response = await app.inject({ method: "POST", url: "/api/analytics/plan", payload: {
      connectionId: c.json().connectionId, question: "Count orders", databaseKind: "postgres", schemaContext: "invented_table(secret)" } });
    expect(response.statusCode).toBe(200);
    expect(planner.mock.calls[0][0].schemaContext).toBe("public.orders: id (integer)");
    const stale = await app.inject({ method: "POST", url: "/api/analytics/plan", payload: {
      connectionId, question: "Count orders", databaseKind: "postgres", schemaContext: "invented_table(secret)" } });
    expect(stale.statusCode).toBe(404);
    expect(planner).toHaveBeenCalledTimes(1);
  });
});
