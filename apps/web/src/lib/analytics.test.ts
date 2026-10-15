import { describe, expect, it } from "vitest";
import { formatValue, metricCards, summaryCards } from "./analytics";
import { DEMO_SCENARIOS, MOCK_DATA, getDemoScenario } from "./demo-data";
import type { AnalyticsResult } from "./workspace-store";

function real(rows: Record<string, unknown>[], truncated = false): AnalyticsResult {
  return { source: "postgres", connectionId: "example", question: "Analyze my data", sql: "SELECT ...",
    data: { columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length, truncated } };
}

describe("dashboard metric semantics", () => {
  it("derives the labelled demo metrics from the existing sample fixture", () => {
    const cards = metricCards({ source: "mock", data: MOCK_DATA });
    expect(cards.map((card) => card.value)).toEqual([578000]);
    expect(cards.every((card) => card.sample)).toBe(true);
  });

  it("labels top-product revenue as a subset and does not invent order counts", () => {
    const scenario = DEMO_SCENARIOS[1];
    const cards = metricCards({ source: "mock", data: scenario.data, scenarioId: scenario.id });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ label: "Top 5 sample revenue", sample: true });
    expect(cards[0].detail).toContain("products only");
  });

  it("uses the scenario order counts rather than nonexistent revenue columns", () => {
    const scenario = DEMO_SCENARIOS[2];
    expect(metricCards({ source: "mock", data: scenario.data, scenarioId: scenario.id }))
      .toEqual([{ label: "Sample orders", value: 1440, detail: "Synthetic 2025 data · 5 sample groups", sample: true }]);
  });

  it("supports normalized exact demo questions and refuses unrelated questions", () => {
    expect(getDemoScenario("  MONTHLY   REVENUE for 2025? ")?.id).toBe("monthly-revenue");
    expect(getDemoScenario("Monthly revenue for 2024")).toBeUndefined();
    expect(getDemoScenario("Show customer churn")).toBeUndefined();
  });

  it("never labels sample summaries as successful PostgreSQL execution", () => {
    const cards = summaryCards({ source: "mock", data: MOCK_DATA });
    expect(cards.map((card) => card.value)).toEqual([12, 2, "Offline demo"]);
    expect(cards.every((card) => card.sample)).toBe(true);
  });

  it("shows a returned scalar measure without totaling identifiers or years", () => {
    const cards = metricCards(real([{ id: 50, customer_id: 12, year: 2026, total_revenue: "45678.90" }]));
    expect(cards).toEqual([{ label: "Total Revenue", value: "45678.90", detail: "Returned by the executed query", sample: false }]);
  });

  it("does not aggregate grouped revenue or calculate full-dataset KPIs", () => {
    const result = real([{ year: 2025, revenue: 1000 }, { year: 2026, revenue: 2000 }]);
    expect(metricCards(result)).toEqual([]);
    expect(summaryCards(result).map((card) => card.value)).toEqual([2, 2, "PostgreSQL"]);
  });

  it("keeps unrelated and ambiguous numeric columns in the table", () => {
    expect(metricCards(real([{ latitude: 20.9, longitude: 72.1, value: 45, row_number: 1 }]))).toEqual([]);
  });

  it("shows averages and rates as returned instead of summing them", () => {
    expect(metricCards(real([{ avg_order_amount: "125.75", conversion_rate: "0.12" }])).map((card) => card.value))
      .toEqual(["125.75", "0.12"]);
    expect(metricCards(real([{ conversion_rate: "0.12" }, { conversion_rate: "0.14" }]))).toEqual([]);
  });

  it("labels truncated summaries as a subset and supplies no invented totals", () => {
    const result = real([{ region: "North", revenue: 100 }, { region: "South", revenue: 200 }], true);
    expect(metricCards(result)).toEqual([]);
    expect(summaryCards(result)[0]).toMatchObject({ label: "Rows returned", value: 2, detail: "Limited result · more rows available" });
  });

  it("provides no metric cards for an empty successful query", () => {
    expect(metricCards(real([]))).toEqual([]);
  });

  it("preserves exact database numeric strings and structured table values", () => {
    expect(formatValue("9007199254740993")).toBe("9007199254740993");
    expect(formatValue({ region: "North" })).toBe('{"region":"North"}');
    expect(formatValue(null)).toBe("—");
  });
});
