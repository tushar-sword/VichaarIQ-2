import type { AnalyticsPlanResponse } from "@vichaar/shared";
import type { ChartType, VisualizationResult } from "./visualization";

export interface DemoScenario {
  id: string;
  title: string;
  kicker: string;
  question: string;
  chartType: ChartType;
  data: VisualizationResult;
  metric: string;
  dimensions: string[];
  filters: string[];
  timeRange: string;
  queryDraft: string;
}

// 📌 MOCK DATA: deterministic synthetic 2025 scenarios, never database results or AI responses.
const period = "January–December 2025";
const dateFilter = "o.created_at >= '2025-01-01' AND o.created_at < '2026-01-01'";
const illustrative = "-- DEMO / SYNTHETIC DATA: illustrative SQL only; not executed.\n";
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "monthly-revenue", title: "Monthly revenue · 2025", kicker: "12 synthetic months",
    question: "Monthly revenue for 2025", chartType: "line", metric: "revenue",
    dimensions: ["month"], filters: ["Completed orders", "Synthetic data only"], timeRange: period,
    data: { columns: ["month", "revenue"], rows: [
      { month: "2025-01", revenue: 32400 }, { month: "2025-02", revenue: 35800 },
      { month: "2025-03", revenue: 38200 }, { month: "2025-04", revenue: 40100 },
      { month: "2025-05", revenue: 42000 }, { month: "2025-06", revenue: 46500 },
      { month: "2025-07", revenue: 43800 }, { month: "2025-08", revenue: 51200 },
      { month: "2025-09", revenue: 54800 }, { month: "2025-10", revenue: 60100 },
      { month: "2025-11", revenue: 64200 }, { month: "2025-12", revenue: 68900 },
    ], rowCount: 12 },
    queryDraft: illustrative + `SELECT date_trunc('month', o.created_at) AS month,\n       SUM(oi.line_total) AS revenue\nFROM public.orders o\nJOIN public.order_items oi ON oi.order_id = o.id\nWHERE o.status = 'completed' AND ${dateFilter}\nGROUP BY date_trunc('month', o.created_at)\nORDER BY month;`,
  },
  {
    id: "top-products", title: "Top 5 products · 2025", kicker: "5 synthetic products",
    question: "Top 5 products by revenue in 2025", chartType: "bar", metric: "revenue",
    dimensions: ["product"], filters: ["Completed orders", "Top 5", "Synthetic data only"], timeRange: period,
    data: { columns: ["product", "revenue"], rows: [
      { product: "Wireless headphones", revenue: 126000 }, { product: "Standing desk", revenue: 108500 },
      { product: "Running shoes", revenue: 84200 }, { product: "Coffee maker", revenue: 68500 },
      { product: "Travel backpack", revenue: 57300 },
    ], rowCount: 5 },
    queryDraft: illustrative + `SELECT p.name AS product, SUM(oi.line_total) AS revenue\nFROM public.products p\nJOIN public.order_items oi ON oi.product_id = p.id\nJOIN public.orders o ON o.id = oi.order_id\nWHERE o.status = 'completed' AND ${dateFilter}\nGROUP BY p.id, p.name\nORDER BY revenue DESC\nLIMIT 5;`,
  },
  {
    id: "orders-by-status", title: "Orders by status · 2025", kicker: "5 synthetic statuses",
    question: "Orders by status in 2025", chartType: "bar", metric: "order_count",
    dimensions: ["status"], filters: ["Synthetic data only"], timeRange: period,
    data: { columns: ["status", "order_count"], rows: [
      { status: "completed", order_count: 720 }, { status: "shipped", order_count: 288 },
      { status: "pending", order_count: 216 }, { status: "cancelled", order_count: 144 },
      { status: "refunded", order_count: 72 },
    ], rowCount: 5 },
    queryDraft: illustrative + `SELECT o.status, COUNT(*) AS order_count\nFROM public.orders o\nWHERE ${dateFilter}\nGROUP BY o.status\nORDER BY order_count DESC;`,
  },
  {
    id: "regional-sales", title: "Sales by region · 2025", kicker: "5 synthetic regions",
    question: "Sales by region in 2025", chartType: "bar", metric: "revenue",
    dimensions: ["region"], filters: ["Completed orders", "Synthetic data only"], timeRange: period,
    data: { columns: ["region", "revenue"], rows: [
      { region: "North", revenue: 139200 }, { region: "South", revenue: 126700 },
      { region: "East", revenue: 108300 }, { region: "West", revenue: 120500 },
      { region: "Central", revenue: 83300 },
    ], rowCount: 5 },
    queryDraft: illustrative + `SELECT o.region, SUM(oi.line_total) AS revenue\nFROM public.orders o\nJOIN public.order_items oi ON oi.order_id = o.id\nWHERE o.status = 'completed' AND ${dateFilter}\nGROUP BY o.region\nORDER BY revenue DESC;`,
  },
];

export const EXAMPLES = DEMO_SCENARIOS.map((scenario) => scenario.question);
export const MOCK_DATA = DEMO_SCENARIOS[0].data;

// Explicit normalized exact matching; arbitrary questions cannot be substituted with sample results.
const normalizeQuestion = (question: string) => question.trim().replace(/\s+/g, " ").replace(/[?.!]+$/, "").toLowerCase();
export function getDemoScenario(question: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((scenario) => normalizeQuestion(scenario.question) === normalizeQuestion(question));
}

export function demoPlan(scenario: DemoScenario): AnalyticsPlanResponse {
  // 📌 MOCK DATA: local scenario description, never a model response or executed database query.
  return {
    plan: { goal: scenario.title, metric: scenario.metric, dimensions: scenario.dimensions,
      filters: scenario.filters, timeRange: scenario.timeRange, chartType: scenario.chartType,
      needsClarification: false, clarificationQuestion: null },
    queryDraft: scenario.queryDraft,
    warnings: ["DEMO / SYNTHETIC DATA — deterministic offline example. No OpenAI request or database query was made. SQL is illustrative only."],
  };
}

// 📌 MOCK DATA: editable fixture-shaped schema; credentials and actual database rows are absent.
export const DEMO_SCHEMA = "public.customers(id, name, email, region, created_at)\npublic.products(id, name, category, price)\npublic.orders(id, customer_id, region, status, shipping_amount, total_amount, created_at)\npublic.order_items(id, order_id, product_id, quantity, unit_price, discount_amount, line_total)";
