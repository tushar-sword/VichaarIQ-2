import { describe, expect, it } from "vitest";
import type { AnalyticsPlan, AnalyticsPlanRequest } from "@vichaar/shared";
import { checkPlanSemantics, checkDraftSemantics } from "./semantics.js";

// 📌 MOCK DATA: metadata and model drafts only; no database or OpenAI calls.
const schemaContext = "public.orders: id (integer), region (text), status (text), created_at (timestamp with time zone)\npublic.orders CONSTRAINT CHECK (status IN ('completed', 'pending', 'shipped', 'cancelled', 'refunded'))";
const range = ["orders.created_at >= '2025-01-01'", "orders.created_at < '2026-01-01'"];
const request = (question = "Count orders grouped by region in 2025"): AnalyticsPlanRequest => ({ question, databaseKind: "postgres", schemaContext });
const plan = (filters = range): AnalyticsPlan => ({ goal: "Count orders", metric: "order count", dimensions: ["region"], filters,
  timeRange: "2025", chartType: "bar", needsClarification: false, clarificationQuestion: null });
const sql = (extra = "") => `SELECT o.region, COUNT(*) AS order_count FROM orders o WHERE o.created_at >= '2025-01-01'::date AND o.created_at < '2026-01-01T00:00:00Z' ${extra} GROUP BY o.region`;

describe("narrow order-count semantic consistency", () => {
  it("allows all-status regional and status counts", () => {
    expect(checkPlanSemantics(request(), plan())).toBeUndefined();
    expect(checkDraftSemantics(request(), plan(), sql())).toBeUndefined();
    expect(checkDraftSemantics(request("Count orders grouped by status in 2025"), plan(), sql().replaceAll("o.region", "o.status"))).toBeUndefined();
  });
  it("rejects the exact status exclusion observed in the live plan", () => {
    expect(checkPlanSemantics(request(), plan([...range, "status IN ('completed','pending','shipped')"]))).toContain("status");
  });
  it("does not let the writer add a status filter to a consistent plan", () => {
    expect(checkDraftSemantics(request(), plan(), sql("AND status='completed'"))).toContain("status");
  });
  it("preserves explicit completed-only intent with aliases and literal date casts", () => {
    const q = request("Count completed orders by region in 2025");
    const p = plan([...range, "orders.status='completed'"]);
    expect(checkPlanSemantics(q, p)).toBeUndefined();
    expect(checkDraftSemantics(q, p, sql("AND 'completed' = o.status::text"))).toBeUndefined();
  });
  it.each(["AND status='refunded'", ""])("asks when completed-only SQL changes/omits its status restriction: %s", extra => {
    expect(checkDraftSemantics(request("Count completed orders by region in 2025"), plan([...range, "status='completed'"]), sql(extra))).toContain("status");
  });
  it("detects a missing completed-only plan restriction using discovered CHECK values", () => {
    expect(checkPlanSemantics(request("How many completed orders are there in 2025?"), plan())).toContain("status");
  });
  it("derives other status names from metadata instead of fixture-specific answers", () => {
    const q = { ...request("Count settled orders in 2025"), schemaContext: "public.orders CONSTRAINT CHECK (status IN ('settled', 'review'))" };
    expect(checkPlanSemantics(q, plan())).toContain("status");
    expect(checkPlanSemantics(q, plan([...range, "status='settled'"]))).toBeUndefined();
  });
  it.each([
    "SELECT region, COUNT(*) FILTER (WHERE status='completed') FROM orders GROUP BY region",
    "WITH a AS (SELECT * FROM orders WHERE status='completed') SELECT region, COUNT(*) FROM a GROUP BY region",
    "SELECT region, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) FROM orders GROUP BY region",
    "SELECT region, COUNT(*) FROM orders WHERE lower(status)='completed' GROUP BY region",
  ])("recognizes nested/conditional status restrictions in ASTs: %s", draft => {
    expect(checkDraftSemantics(request(), plan(), draft)).toContain("status");
  });
  it.each(["AND region='North'", "AND total_amount > 0"])("detects writer-added non-status WHERE restrictions: %s", extra => {
    expect(checkDraftSemantics(request(), plan(), sql(extra))).toContain("filters differ");
  });
  it("detects removed or changed plan filters without rewriting SQL", () => {
    expect(checkDraftSemantics(request("Count orders in North by region in 2025"), plan([...range, "region='North'"]), sql())).toContain("filters differ");
    const draft = sql().replace("2025-01-01", "2024-01-01");
    expect(checkDraftSemantics(request(), plan(), draft)).toContain("filters differ");
    expect(draft).toContain("2024-01-01");
  });
  it("clarifies writer-added conditional counts rather than approving hidden non-status filters", () => {
    const draft = sql().replace("COUNT(*)", "COUNT(*) FILTER (WHERE region='North')");
    expect(checkDraftSemantics(request(), plan(), draft)).toContain("filters differ");
  });
  it("ignores comments/string contents rather than matching status text as SQL", () => {
    expect(checkDraftSemantics(request(), plan(), sql()+" -- status='completed'\n")).toBeUndefined();
  });
  it("asks about unsupported negated or prose status intent", () => {
    expect(checkPlanSemantics(request("Count orders excluding refunded orders"), plan(["status != 'refunded'"]))).toContain("status");
    expect(checkPlanSemantics(request(), plan(["Only statuses with recognized revenue"]))).toContain("status");
    expect(checkPlanSemantics(request("Count all orders except refunded orders"), plan())).toContain("status");
  });
  it("keeps invalid/unsafe SQL on the existing validator error path", () => {
    for (const draft of ["SELECT FROM", "SELECT pg_sleep(1)", "DELETE FROM orders"]) expect(checkDraftSemantics(request(), plan(), draft)).toBeUndefined();
  });
  it("does not apply count restrictions to completed merchandise revenue", () => {
    const q = request("Merchandise revenue from completed orders in 2025, excluding shipping");
    const p = plan([...range, "status='completed'"]);
    expect(checkPlanSemantics(q, p)).toBeUndefined();
    expect(checkDraftSemantics(q, p, "SELECT SUM(line_total) FROM order_items JOIN orders ON order_id=orders.id WHERE status='completed'")).toBeUndefined();
  });
});
