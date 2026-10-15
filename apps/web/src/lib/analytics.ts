import type { AnalyticsResult } from "./workspace-store";
import { measureColumns } from "./visualization";

export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
  }
  // Preserve PostgreSQL numeric strings, including values beyond JS integer precision.
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export interface MetricCard {
  label: string;
  value: unknown;
  detail: string;
  sample: boolean;
}

// Conservative scalar semantics: ambiguous columns stay in the result table.
const METRIC_NAME = /(?:^|_)(?:revenue|sales|profit|cost|amount|price|balance|quantity|orders?|customers?|units|count|total|avg|average|rate|percent|percentage|duration|score)(?:$|_)/i;

export function metricCards(result: AnalyticsResult): MetricCard[] {
  const { data } = result;
  if (data.rows.length === 0) return [];
  if (result.source === "mock") {
    // 📌 MOCK DATA: total only the scenario's declared additive measure; never invent missing columns.
    const metric = data.columns.includes("revenue") ? "revenue"
      : data.columns.includes("order_count") ? "order_count" : null;
    if (!metric) return [];
    const values = data.rows.map((row) => Number(row[metric]));
    if (values.some((value) => !Number.isFinite(value))) return [];
    const topProducts = result.scenarioId === "top-products";
    return [{ label: metric === "revenue" ? (topProducts ? "Top 5 sample revenue" : "Sample revenue") : "Sample orders",
      value: values.reduce((sum, value) => sum + value, 0),
      detail: `Synthetic 2025 data · ${data.rows.length} ${topProducts ? "products only" : "sample groups"}`, sample: true }];
  }
  // 📌 REAL DATABASE: never total grouped rows, identifiers, years or arbitrary numbers.
  // A scalar measure is shown as returned; no additional aggregation is performed.
  if (data.rows.length !== 1) return [];
  return measureColumns(data).filter((key) => METRIC_NAME.test(key)).slice(0, 4).map((key) => ({
    label: humanize(key), value: data.rows[0][key], detail: "Returned by the executed query", sample: false,
  }));
}

export function summaryCards(result: AnalyticsResult): MetricCard[] {
  if (result.source === "mock") {
    // 📌 MOCK DATA: sample summaries must not imply PostgreSQL execution.
    return [
      { label: "Sample rows", value: result.data.rowCount, detail: "Synthetic 2025 example", sample: true },
      { label: "Columns", value: result.data.columns.length, detail: "Fields in this sample", sample: true },
      { label: "Source", value: "Offline demo", detail: "DEMO / SYNTHETIC DATA", sample: true },
    ];
  }
  return [
    { label: "Rows returned", value: result.data.rowCount,
      detail: result.data.truncated ? "Limited result · more rows available" : "Rows in this query result", sample: false },
    { label: "Columns", value: result.data.columns.length, detail: "Fields available to explore", sample: false },
    { label: "Source", value: "PostgreSQL", detail: "Successful read-only execution", sample: false },
  ];
}
