
export type ChartType = "line" | "bar" | "pie" | "number" | "table";

export interface VisualizationResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated?: boolean;
}

export interface VisualizationDecision {
  recommended: ChartType;
  available: ChartType[];
  xKey?: string;
  yKey?: string;
}

const DATE_NAME = /(?:^|_)(?:date|time|month|year|day|week|quarter|timestamp|period)(?:$|_)|^(?:created|updated)_at$/i;
const SHARE_INTENT = /share|proportion|percentage|distribution|breakdown/i;

export function isDateColumn(name: string, values: unknown[]): boolean {
  if (DATE_NAME.test(name)) return true;

  const samples = values.filter((v) => v != null).slice(0, 10);
  return samples.length > 0 &&
    samples.every(
      (v) =>
        typeof v === "string" &&
        /^\d{4}-\d{1,2}(-\d{1,2})?/.test(v),
    );
}

export function isNumericColumn(values: unknown[]): boolean {
  const samples = values.filter((v) => v != null);

  return samples.length > 0 &&
    samples.every(
      (v) =>
        (typeof v === "number" && Number.isFinite(v)) ||
        (typeof v === "string" &&
          v.trim() !== "" &&
          Number.isFinite(Number(v))),
    );
}

export function isIdentifierColumn(name: string): boolean {
  return /(?:^|_)(?:id|uuid|identifier|key)$|^(?:index|row_number)$/i.test(name);
}

export function measureColumns(result: VisualizationResult): string[] {
  return result.columns.filter((key) => {
    const values = result.rows.map((row) => row[key]);
    return !isIdentifierColumn(key) && !isDateColumn(key, values) && isNumericColumn(values);
  });
}

export function chooseVisualization(
  result: VisualizationResult,
  question = "",
): VisualizationDecision {
  const { columns, rows } = result;

  if (rows.length === 0 || columns.length === 0) {
    return { recommended: "table", available: ["table"] };
  }

  // Numeric identifiers and temporal dimensions are never chart measures.
  const numericKeys = measureColumns(result);

  const dateKey = columns.find((key) =>
    isDateColumn(key, rows.map((row) => row[key])),
  );

  const categories = columns.filter((key) => !numericKeys.includes(key) && key !== dateKey);
  const categoryKey = categories.find((key) => !isIdentifierColumn(key)) ?? categories[0];

  // A single numeric result is best presented as a KPI.
  if (rows.length === 1 && numericKeys.length === 1) {
    return {
      recommended: "number",
      available: ["number", "table"],
      yKey: numericKeys[0],
    };
  }

  const yKey = numericKeys[0];

  // Time-series data is a natural fit for a line chart.
  if (dateKey && yKey) {
    return {
      recommended: "line",
      available: ["line", "bar", "table"],
      xKey: dateKey,
      yKey,
    };
  }

  if (categoryKey && yKey) {
    const categories = new Set(
      rows.map((row) => String(row[categoryKey])),
    );

    // Pie charts work best for a small number of non-negative values.
    const allNonNegative = rows.every(
      (row) => Number(row[yKey]) >= 0,
    );

    if (
      SHARE_INTENT.test(question) &&
      categories.size <= 8 &&
      categories.size === rows.length &&
      allNonNegative && rows.some((row) => Number(row[yKey]) > 0)
    ) {
      return {
        recommended: "pie",
        available: ["pie", "bar", "table"],
        xKey: categoryKey,
        yKey,
      };
    }

    return {
      recommended: "bar",
      available: ["bar", "line", "table"],
      xKey: categoryKey,
      yKey,
    };
  }

  return {
    recommended: "table",
    available: ["table"],
  };
}
