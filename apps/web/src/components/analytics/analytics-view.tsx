"use client";

import { useState } from "react";
import type { AnalyticsResult } from "../../lib/workspace-store";
import { chooseVisualization, type ChartType } from "../../lib/visualization";
import { humanize, type MetricCard } from "../../lib/analytics";
import { DataTable } from "./data-table";
import { MetricGrid } from "./metric-grid";
import { ResultChart } from "./result-chart";
import { Icon } from "../icon";

export function AnalyticsView({ result, question, metrics }: { result: AnalyticsResult; question: string; metrics: MetricCard[] }) {
  const { data } = result;
  const sample = result.source === "mock";
  const decision = chooseVisualization(data, question);
  const chartTypes = decision.available.filter((type) => ["line", "bar", "pie"].includes(type));
  const canChart = chartTypes.length > 0 && !!decision.xKey && !!decision.yKey;
  const [view, setView] = useState<"chart" | "table" | "number">(canChart ? "chart" : metrics.length ? "number" : "table");
  // 📌 MOCK DATA: a supported scenario supplies its intended chart; real rows use the visualization engine.
  const preferredChart = sample && result.chartType ? result.chartType : decision.recommended;
  const [chartType, setChartType] = useState<ChartType>(chartTypes.includes(preferredChart) ? preferredChart : chartTypes[0] ?? "bar");

  if (!data.rows.length) return <section className="surface result-state"><div className="empty-symbol"><Icon name="table" /></div>
    <h2>The query returned no rows</h2><p>Execution completed successfully. Try a different time range or question.</p></section>;

  return <>
    <section className="surface analytics-panel" aria-label={sample ? "Sample analytics" : "Query analytics"}>
      <div className="panel-header"><div><div className="section-eyebrow">{sample ? "DEMO / SYNTHETIC DATA" : "QUERY RESULT"}</div>
        <h2>{sample ? result.title || "Synthetic 2025 e-commerce analysis" : "Analysis results"}</h2>
        <p>{sample ? result.question || "Illustrative e-commerce data for 2025. No database query was executed." : "Visualized directly from your executed query."}</p></div>
        <div className="view-switcher" role="group" aria-label="Result view">
          <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")} disabled={!canChart}><Icon name="chart" />Chart</button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}><Icon name="table" />Table</button>
          <button type="button" aria-pressed={view === "number"} onClick={() => setView("number")} disabled={!metrics.length}><Icon name="metric" />KPI</button>
        </div>
      </div>
      {view === "chart" && canChart && <><div className="chart-toolbar"><span>{humanize(decision.yKey!)} <span className="text-muted">by {humanize(decision.xKey!)}</span></span>
        <label className="inline-label">Chart type<select value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)}>
          {chartTypes.map((type) => <option value={type} key={type}>{humanize(type)}</option>)}</select></label></div>
        <ResultChart data={data} type={chartType} xKey={decision.xKey!} yKey={decision.yKey!} sample={sample} /></>}
      {view === "table" && <DataTable data={data} sample={sample} />}
      {view === "number" && <div className="metric-view"><MetricGrid cards={metrics} /></div>}
      <div className="panel-footnote"><span className={`status-dot ${sample ? "" : "is-connected"}`} />
        {sample ? "Synthetic 2025 demo · no database query executed" : `${data.rowCount} returned rows · read-only query`}</div>
    </section>
    {view !== "table" && <section className="surface data-panel"><div className="panel-header"><div>
      <div className="section-eyebrow">{sample ? "DEMO / SYNTHETIC DATA" : "RETURNED DATA"}</div><h2>{sample ? "Scenario sample data" : "Query data"}</h2>
      <p>{sample ? "The synthetic rows behind this specific scenario." : "The original values returned by PostgreSQL."}</p></div><span className="row-count">{data.rowCount} rows</span></div>
      <DataTable data={data} sample={sample} /></section>}
  </>;
}
