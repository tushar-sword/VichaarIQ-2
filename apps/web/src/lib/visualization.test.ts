import { describe, expect, it } from "vitest";
import { chooseVisualization } from "./visualization";

function decision(rows: Record<string, unknown>[], question = "") {
  return chooseVisualization({ columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length }, question);
}

describe("smart visualization", () => {
  it("plots revenue against a numeric year instead of plotting year against itself", () => {
    expect(decision([{ year: 2025, revenue: "100" }, { year: 2026, revenue: "200" }]))
      .toMatchObject({ recommended: "line", xKey: "year", yKey: "revenue" });
  });

  it("uses a numeric identifier as a category, never a measure", () => {
    expect(decision([{ product_id: 1, revenue: 100 }, { product_id: 2, revenue: 200 }]))
      .toMatchObject({ recommended: "bar", xKey: "product_id", yKey: "revenue" });
  });

  it("prefers a readable category label to an identifier", () => {
    expect(decision([{ product_id: 1, product_name: "One", revenue: 100 }, { product_id: 2, product_name: "Two", revenue: 200 }]))
      .toMatchObject({ xKey: "product_name", yKey: "revenue" });
  });

  it("does not recommend KPIs for standalone identifiers or years", () => {
    expect(decision([{ id: 1 }]).recommended).toBe("table");
    expect(decision([{ year: 2026 }]).recommended).toBe("table");
  });

  it("retains scalar, time-series, and share recommendations", () => {
    expect(decision([{ revenue: "100.50" }]).recommended).toBe("number");
    expect(decision([{ month: "May", revenue: 100 }, { month: "Jun", revenue: 200 }]).recommended).toBe("line");
    expect(decision([{ region: "North", revenue: 100 }, { region: "South", revenue: 200 }], "Revenue share").recommended).toBe("pie");
  });

  it("avoids pie charts for duplicate categories, negative values, and all-zero values", () => {
    for (const rows of [
      [{ region: "North", revenue: 100 }, { region: "North", revenue: 200 }],
      [{ region: "North", revenue: -1 }, { region: "South", revenue: 2 }],
      [{ region: "North", revenue: 0 }, { region: "South", revenue: 0 }],
    ]) expect(decision(rows, "Revenue share").recommended).toBe("bar");
  });

  it("falls back to a table for empty or non-numeric results", () => {
    expect(decision([]).available).toEqual(["table"]);
    expect(decision([{ label: "North" }]).available).toEqual(["table"]);
  });
});
