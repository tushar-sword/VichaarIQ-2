import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../app/dashboard/page";
import Ask from "../app/ask/page";
import DataSources from "../app/data-sources/page";
import { AppShell } from "./app-shell";
import { createWorkspaceStore, type WorkspaceState } from "../lib/workspace-store";
import { DEMO_SCENARIOS, demoPlan } from "../lib/demo-data";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), pathname: vi.fn() }));
vi.mock("../state/workspace-provider", () => ({ useWorkspace: mocks.workspace }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));
// DOM sizing and chart interactions require a browser; these tests cover surrounding UI states.
vi.mock("./analytics/result-chart", () => ({ ResultChart: () => null }));

function workspace(patch: Partial<WorkspaceState> = {}) {
  const store = createWorkspaceStore();
  mocks.workspace.mockReturnValue({ ...store.getSnapshot(), ...store.actions, ...patch });
}

beforeEach(() => { workspace(); mocks.pathname.mockReturnValue("/dashboard"); });

describe("workspace UI states", () => {
  it("labels demo metrics, charts, and data as sample", () => {
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain("Sample key metrics");
    expect(html).toContain("DEMO / SYNTHETIC DATA");
    expect(html).toContain(DEMO_SCENARIOS[0].title);
    expect(html).toContain("Scenario sample data");
    expect(html).toContain("2025-12");
  });

  it("renders connected-without-results instead of sample metrics", () => {
    workspace({ connection: { status: "connected", connectionId: "example" }, result: null });
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain("Connected — run an analysis");
    expect(html).not.toContain("Sample key metrics");
    expect(html).not.toContain("2,98,400");
  });

  it("shows grouped real results as a summary and labels truncation", () => {
    workspace({ connection: { status: "connected", connectionId: "example" }, executionStatus: "succeeded",
      result: { source: "postgres", connectionId: "example", question: "Revenue by year", sql: "SELECT ...",
        data: { columns: ["year", "revenue"], rows: [{ year: 2025, revenue: 100 }, { year: 2026, revenue: 200 }], rowCount: 2, truncated: true } } });
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain("Result summary");
    expect(html).toContain("Rows returned");
    expect(html).toContain("This result is limited.");
    expect(html).not.toContain("Sample key metrics");
    expect(html).not.toContain("Total revenue");
  });

  it("shows an explicit failed state without a data table", () => {
    workspace({ result: null, executionStatus: "error", error: "Query failed" });
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain("Query failed");
    expect(html).toContain("Previous results have been cleared.");
    expect(html).not.toContain('<table class="data-table"');
  });

  it("hides the credential form after connection", () => {
    workspace({ connection: { status: "connected", connectionId: "example" }, result: null });
    const html = renderToStaticMarkup(createElement(DataSources));
    expect(html).toContain("Disconnect and return to demo");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("postgresql://user:password");
  });

  it("keeps clarification visible and supplies no successful-results link", () => {
    workspace({ result: null, executionStatus: "clarification-required", plan: {
      plan: { goal: "Revenue", metric: "revenue", dimensions: ["region"], filters: [], timeRange: null,
        chartType: "bar", needsClarification: true, clarificationQuestion: "Which period?" }, queryDraft: "", warnings: [] } });
    const html = renderToStaticMarkup(createElement(Ask));
    expect(html).toContain("Which period?");
    expect(html).toContain("No query has been executed.");
    expect(html).not.toContain("View Dashboard");
  });

  it("offers four explicit offline starter scenarios", () => {
    const html = renderToStaticMarkup(createElement(Ask));
    for (const scenario of DEMO_SCENARIOS) {
      expect(html).toContain(`data-demo-scenario="${scenario.id}"`);
      expect(html).toContain(scenario.question);
    }
    expect(html).toContain("without PostgreSQL or OpenAI");
    expect(html).toContain("Other questions require a real database and AI analysis");
  });

  it.each(DEMO_SCENARIOS)("shows matching ready results for $id", (scenario) => {
    workspace({ connection: { status: "demo" }, executionStatus: "succeeded", question: scenario.question,
      plan: demoPlan(scenario), result: { source: "mock", data: scenario.data, scenarioId: scenario.id,
        question: scenario.question, title: scenario.title, chartType: scenario.chartType } });
    const ask = renderToStaticMarkup(createElement(Ask));
    expect(ask).toContain("View Dashboard");
    expect(ask.indexOf("View Dashboard")).toBeLessThan(ask.indexOf("question-panel"));
    const dashboard = renderToStaticMarkup(createElement(Dashboard));
    expect(dashboard).toContain(scenario.title);
    expect(dashboard).toContain(scenario.question);
    expect(dashboard).toContain(`value="${scenario.chartType}" selected`);
    expect(dashboard).toContain("DEMO / SYNTHETIC DATA");
  });

  it("offers real result navigation only after successful execution for the connected source", () => {
    const result = { source: "postgres" as const, connectionId: "active", question: "Orders by status",
      sql: "SELECT status, count(*) FROM orders GROUP BY status", data: DEMO_SCENARIOS[2].data };
    const plan = demoPlan(DEMO_SCENARIOS[2]);
    for (const executionStatus of ["idle", "planning", "executing", "error"] as const) {
      workspace({ connection: { status: "connected", connectionId: "active" }, executionStatus, result, plan });
      expect(renderToStaticMarkup(createElement(Ask))).not.toContain("View Dashboard");
    }
    workspace({ connection: { status: "connected", connectionId: "different" }, executionStatus: "succeeded", result, plan });
    expect(renderToStaticMarkup(createElement(Ask))).not.toContain("View Dashboard");
    workspace({ connection: { status: "demo" }, executionStatus: "succeeded", result, plan });
    expect(renderToStaticMarkup(createElement(Ask))).not.toContain("View Dashboard");
    workspace({ connection: { status: "connected", connectionId: "active" }, executionStatus: "succeeded", result, plan });
    expect(renderToStaticMarkup(createElement(Ask))).toContain("View Dashboard");
  });

  it("does not offer stale demo results as a connected result", () => {
    workspace({ connection: { status: "connected", connectionId: "active" }, executionStatus: "succeeded",
      plan: demoPlan(DEMO_SCENARIOS[0]) });
    expect(renderToStaticMarkup(createElement(Ask))).not.toContain("View Dashboard");
  });

  it("provides three routes, a current-page marker, and a skip link", () => {
    const html = renderToStaticMarkup(createElement(AppShell, { children: "Workspace content" }));
    for (const route of ["/dashboard", "/ask", "/data-sources"]) expect(html).toContain(`href="${route}"`);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="#main-content"');
  });
});
