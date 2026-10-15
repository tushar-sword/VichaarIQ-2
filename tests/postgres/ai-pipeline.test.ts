import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "../../services/api/src/app";
import { createWorkspaceStore, type WorkspaceStore } from "../../apps/web/src/lib/workspace-store";
import { chooseVisualization } from "../../apps/web/src/lib/visualization";
import { metricCards } from "../../apps/web/src/lib/analytics";
import type { AnalyticsPlan } from "@vichaar/shared";

// 📌 MOCK DATA: only the two SDK model responses and HTTP transport are replaced.
// 📌 REAL DATABASE: all schema discovery and execution use the existing dedicated fixture reader.
const ai = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@openai/agents", () => ({ Agent: class {}, run: ai.run }));

let app: Awaited<ReturnType<typeof createApp>>;
let store: WorkspaceStore;
let reader: string;
const calls: string[] = [];
const plan: AnalyticsPlan = { goal: "Analyze connected data", metric: "revenue", dimensions: [], filters: [],
  timeRange: "Calendar 2025, UTC", chartType: "bar", needsClarification: false, clarificationQuestion: null };
const range = "o.created_at >= '2025-01-01'::date AND o.created_at < '2026-01-01'::date";
const recognized = `o.status='completed' AND ${range}`;
const cases = [
  { name: "monthly", question: "Show monthly merchandise revenue in 2025 for completed orders, excluding shipping", chart: "line", rows: 12,
    sql: `SELECT to_char(o.created_at,'YYYY-MM') AS month, SUM(i.line_total) AS revenue FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${recognized} GROUP BY to_char(o.created_at,'YYYY-MM') ORDER BY month` },
  { name: "products", question: "Rank the top 5 products by completed merchandise revenue in 2025, excluding shipping", chart: "bar", rows: 5,
    sql: `SELECT p.name AS product_name, SUM(i.line_total) AS revenue FROM products p JOIN order_items i ON i.product_id=p.id JOIN orders o ON o.id=i.order_id WHERE ${recognized} GROUP BY p.id,p.name ORDER BY revenue DESC, product_name LIMIT 5` },
  { name: "status", question: "Count all orders grouped by status in calendar year 2025", chart: "bar", rows: 5,
    sql: `SELECT o.status, COUNT(*) AS order_count FROM orders o WHERE ${range} GROUP BY o.status ORDER BY order_count DESC, o.status` },
  { name: "regions", question: "Compare completed merchandise sales by region in calendar 2025, excluding shipping", chart: "bar", rows: 5,
    sql: `SELECT o.region, SUM(i.line_total) AS revenue FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${recognized} GROUP BY o.region ORDER BY revenue DESC, o.region` },
];

function respond(sql: string, patch: Partial<AnalyticsPlan> = {}) {
  ai.run.mockResolvedValueOnce({ finalOutput: { ...plan, ...patch } })
    .mockResolvedValueOnce({ finalOutput: "```sql\n" + sql + "\n```" });
}

beforeAll(async () => {
  if (process.env.VICHAAR_AI_FIXTURE_GUARDED !== "1") throw new Error("Use npm run test-db:ai; unguarded fixture tests are refused.");
  const example = readFileSync(new URL("./local.env.example", import.meta.url), "utf8");
  reader = example.split("\n").find(line => line.startsWith("VICHAAR_TEST_DATABASE_URL="))!.split("=").slice(1).join("=").trim();
  const target = new URL(reader);
  expect([target.hostname, target.port, target.pathname, target.username]).toEqual(["127.0.0.1", "5544", "/vichaar_ecommerce_test", "vichaar_test_reader"]);
  app = await createApp({ logger: false });
  // Route the actual frontend API client through actual Fastify handlers without listening on ports.
  // All other fetches fail, so an accidental model/trace request cannot reach the network.
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(typeof url === "string" ? url : url instanceof URL ? url : url.url);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "4000" || !parsed.pathname.startsWith("/api/")) throw new Error("External HTTP is disabled in fixture integration tests.");
    calls.push(parsed.pathname);
    const result = await app.inject({ method: "POST", url: parsed.pathname, payload: JSON.parse(String(init?.body)) });
    return new Response(result.body, { status: result.statusCode, headers: { "Content-Type": "application/json" } });
  }));
});

beforeEach(async () => {
  ai.run.mockReset(); calls.length = 0;
  store = createWorkspaceStore(); await store.actions.connectDatabase(reader);
  expect(store.getSnapshot().connection.status).toBe("connected");
  const schema = store.getSnapshot().schemaContext;
  for (const table of ["customers", "products", "orders", "order_items"]) expect(schema).toContain(`public.${table}:`);
  expect(schema).toContain("GENERATED AS"); expect(schema).toContain("FOREIGN KEY");
  expect(schema).toContain("plus shipping"); expect(schema).not.toContain("postgresql://");
  expect(store.getSnapshot().result).toBeNull();
});
afterEach(async () => { if (store?.getSnapshot().connection.status === "connected") await store.actions.disconnectDatabase(); });
afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); });

describe("mocked AI → real PostgreSQL → frontend state and visualization", () => {
  it.each(cases)("executes $name with real provenance and the correct chart", async (c) => {
    respond(c.sql, { goal: c.question, metric: c.name === "status" ? "Order count" : "Completed merchandise revenue",
      dimensions: [c.name === "monthly" ? "month" : c.name === "products" ? "product_name" : c.name === "status" ? "status" : "region"],
      filters: c.name === "status" ? [range] : [recognized], chartType: c.chart === "line" ? "line" : "bar" });
    store.actions.setQuestion(c.question); await store.actions.generate();
    const state = store.getSnapshot(); expect(state.error).toBe(""); expect(state.executionStatus).toBe("succeeded");
    const result = state.result; expect(result?.source).toBe("postgres"); if (result?.source !== "postgres") throw new Error("Expected real result");
    expect(result.question).toBe(c.question); expect(result.data.rowCount).toBe(c.rows); expect(result.data.truncated).toBe(false);
    expect(chooseVisualization(result.data, c.question).recommended).toBe(c.chart); expect(metricCards(result)).toEqual([]);
    const context = JSON.parse(ai.run.mock.calls[0][1]);
    expect(context.schemaContext).toContain("FOREIGN KEY"); expect(context.schemaContext).not.toContain("postgresql://"); expect(context.connectionId).toBeUndefined();
    expect(ai.run).toHaveBeenCalledTimes(2);
    if (c.name === "monthly") {
      expect(result.data.rows[0]).toEqual({ month: "2025-01", revenue: "499110.00" });
      expect(result.data.rows[11]).toEqual({ month: "2025-12", revenue: "379772.50" });
      expect(result.data.rows.reduce((n, row) => n + Math.round(Number(row.revenue) * 100), 0)).toBe(551223250);
    } else if (c.name === "products") expect(result.data.rows[0]).toEqual({ product_name: "Mechanical Keyboard", revenue: "690177.75" });
    else if (c.name === "status") {
      expect(result.data.rows[0]).toEqual({ status: "completed", order_count: "720" });
      expect(result.data.rows.reduce((n, row) => n + Number(row.order_count), 0)).toBe(1440);
    } else expect(result.data.rows.every(row => row.revenue === "1102446.50")).toBe(true);
  });

  it("uses server-discovered schema even if the browser context is edited", async () => {
    store.actions.setSchemaContext("invented_table(secret_value)"); respond(cases[2].sql, { metric: "order count", filters: [range] });
    store.actions.setQuestion(cases[2].question); await store.actions.generate();
    expect(store.getSnapshot().executionStatus).toBe("succeeded");
    expect(JSON.parse(ai.run.mock.calls[0][1]).schemaContext).not.toContain("invented_table");
  });

  it.each([
    { question: "Count orders grouped by region in 2025", column: "region", expectedTotal: 1440, perRegion: 288, completed: false },
    { question: "Count orders grouped by status in 2025", column: "status", expectedTotal: 1440, perRegion: 0, completed: false },
    { question: "Count completed orders grouped by region in 2025", column: "region", expectedTotal: 720, perRegion: 144, completed: true },
  ])("preserves explicit count semantics: $question", async c => {
    const where = c.completed ? recognized : range;
    respond(`SELECT o.${c.column},COUNT(*) AS order_count FROM orders o WHERE ${where} GROUP BY o.${c.column} ORDER BY o.${c.column}`,
      { metric: "order count", filters: [where], dimensions: [c.column] });
    store.actions.setQuestion(c.question); await store.actions.generate();
    const state = store.getSnapshot(); expect(state.executionStatus).toBe("succeeded"); expect(state.error).toBe("");
    expect(state.result?.source).toBe("postgres");
    const rows = state.result!.data.rows;
    expect(rows.reduce((n,row) => n + Number(row.order_count),0)).toBe(c.expectedTotal);
    if(c.column === "region") expect(rows.every(row => Number(row.order_count) === c.perRegion)).toBe(true);
    else expect(Object.fromEntries(rows.map(row => [row.status, Number(row.order_count)]))).toEqual({ completed: 720, pending: 180, shipped: 180, cancelled: 180, refunded: 180 });
    expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it("retains the documented completed merchandise revenue definition", async () => {
    respond(`SELECT SUM(i.line_total) AS revenue FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${recognized}`,
      { metric: "completed merchandise revenue excluding shipping", filters: [recognized], dimensions: [], chartType: "number" });
    store.actions.setQuestion("Merchandise revenue from completed orders in 2025, excluding shipping"); await store.actions.generate();
    expect(store.getSnapshot().executionStatus).toBe("succeeded");
    expect(store.getSnapshot().result).toMatchObject({ source: "postgres", data: { rows: [{ revenue: "5512232.50" }] } });
  });

  it("blocks the exact failed live plan before drafting or execution, with no stale real rows", async () => {
    respond(cases[2].sql, { filters: [range] }); await store.actions.generate(); expect(store.getSnapshot().result?.source).toBe("postgres");
    ai.run.mockReset(); calls.length = 0;
    ai.run.mockResolvedValueOnce({ finalOutput: { ...plan, metric: "order_count", filters: [range, "status IN ('completed','pending','shipped')"] } });
    store.actions.setQuestion("Count orders grouped by region in 2025"); await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ executionStatus: "clarification-required", result: null, plan: { queryDraft: "" } });
    expect(ai.run).toHaveBeenCalledTimes(1); expect(calls).not.toContain("/api/analytics/execute");
  });

  it.each(["AND o.status='completed'", "AND o.region='North'"])("blocks writer-added filters before real execution: %s", async extra => {
    respond(`SELECT o.region,COUNT(*) AS order_count FROM orders o WHERE ${range} ${extra} GROUP BY o.region`, { metric: "order count", filters: [range] });
    store.actions.setQuestion("Count orders grouped by region in 2025"); await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ executionStatus: "clarification-required", result: null, plan: { queryDraft: "" } });
    expect(calls).not.toContain("/api/analytics/execute"); expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it("supports a connected question outside the four offline scenarios with a safe CTE", async () => {
    respond(`WITH completed AS (SELECT o.region, o.total_amount FROM orders o WHERE ${recognized}) SELECT region, AVG(total_amount) AS average_order_value, COUNT(*) AS order_count FROM completed GROUP BY region ORDER BY region`);
    store.actions.setQuestion("What is the average completed order value including shipping by region in 2025?");
    await store.actions.generate();
    const result = store.getSnapshot().result;
    expect(store.getSnapshot().executionStatus).toBe("succeeded");
    expect(result?.source).toBe("postgres"); expect(result?.data.rowCount).toBe(5);
    expect(result?.data.rows.reduce((n, row) => n + Number(row.order_count), 0)).toBe(720);
    expect(result?.data.rows.every(row => Number(row.average_order_value) > 0)).toBe(true);
    expect(chooseVisualization(result!.data)).toMatchObject({ recommended: "bar", yKey: "average_order_value" });
    expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it("preserves a successful empty real result instead of showing demo rows", async () => {
    respond("SELECT id FROM orders WHERE created_at >= '2031-01-01'::date", { timeRange: "From 2031-01-01", chartType: "table" });
    store.actions.setQuestion("List orders after January 1, 2031"); await store.actions.generate();
    const result = store.getSnapshot().result;
    expect(store.getSnapshot().executionStatus).toBe("succeeded"); expect(result).toMatchObject({ source: "postgres", data: { rows: [], rowCount: 0 } });
    expect(chooseVisualization(result!.data).available).toEqual(["table"]);
  });

  it.each(["SELECT pg_sleep(1)", "SELECT ROW_NUMBER() OVER (ORDER BY id) FROM orders", "SELECT id FROM orders; DELETE FROM orders", "SELECT FROM", "SELECT * FROM public.unapproved"])("rejects invalid/unsupported draft %s without execution or repair", async (sql) => {
    respond(sql); store.actions.setQuestion("An arbitrary connected analysis"); await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ result: null, executionStatus: "error", connection: { status: "connected" } });
    expect(store.getSnapshot().error).toContain("validation"); expect(calls).not.toContain("/api/analytics/execute"); expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it("clears old real rows and surfaces a safe missing-column error", async () => {
    respond(cases[2].sql); await store.actions.generate(); expect(store.getSnapshot().result?.source).toBe("postgres");
    respond("SELECT nonexistent_sensitive_column FROM orders"); store.actions.setQuestion("A new metric"); await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ result: null, executionStatus: "error" });
    expect(store.getSnapshot().error).toContain("column"); expect(store.getSnapshot().error).not.toContain("nonexistent_sensitive_column");
  });

  it("retains clarification without drafting or execution", async () => {
    ai.run.mockResolvedValueOnce({ finalOutput: { ...plan, needsClarification: true, clarificationQuestion: "Should revenue include shipping, and which order statuses count?" } });
    store.actions.setQuestion("Show revenue"); await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ result: null, executionStatus: "clarification-required", plan: { queryDraft: "" } });
    expect(ai.run).toHaveBeenCalledTimes(1); expect(calls).not.toContain("/api/analytics/execute");
  });

  it("reports a malformed plan without invoking the writer or disguising it as a credential error", async () => {
    ai.run.mockResolvedValueOnce({ finalOutput: { ...plan, filters: [{ field: "status", value: "completed" }] } });
    await store.actions.generate(); expect(store.getSnapshot()).toMatchObject({ result: null, executionStatus: "error" });
    expect(store.getSnapshot().error).toContain("invalid analysis plan"); expect(ai.run).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain("/api/analytics/execute");
  });
});
