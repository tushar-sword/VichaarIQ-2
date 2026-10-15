import { describe, expect, it, vi } from "vitest";
import type { AnalyticsExecuteResponse, AnalyticsPlanResponse, DatabaseConnectResponse } from "@vichaar/shared";
import type { WorkspaceApi } from "./api";
import { createWorkspaceStore } from "./workspace-store";
import { DEMO_SCENARIOS } from "./demo-data";

const CONNECTION: DatabaseConnectResponse = {
  connected: true, connectionId: "10000000-0000-4000-8000-000000000001",
  databaseKind: "postgres", schemaContext: "public.sales: amount (numeric)",
};
const PLAN: AnalyticsPlanResponse = {
  plan: { goal: "Revenue", metric: "amount", dimensions: [], filters: [], timeRange: null,
    chartType: "number", needsClarification: false, clarificationQuestion: null },
  queryDraft: "SELECT SUM(amount) AS revenue FROM public.sales", warnings: [],
};
const RESULT: AnalyticsExecuteResponse = {
  columns: ["revenue"], rows: [{ revenue: "1200" }], rowCount: 1, truncated: false,
  databaseKind: "postgres", executed: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  // Every external boundary is mocked; no database or model is contacted.
  const api = {
    connect: vi.fn<WorkspaceApi["connect"]>().mockResolvedValue(CONNECTION),
    disconnect: vi.fn<WorkspaceApi["disconnect"]>().mockResolvedValue({ disconnected: true }),
    plan: vi.fn<WorkspaceApi["plan"]>().mockResolvedValue(PLAN),
    execute: vi.fn<WorkspaceApi["execute"]>().mockResolvedValue(RESULT),
  };
  return { api, store: createWorkspaceStore(api) };
}

describe("workspace integration", () => {
  it("shows no sample rows on connection, then publishes successful real results", async () => {
    const { store, api } = setup();
    expect(store.getSnapshot().result?.source).toBe("mock");
    const connecting = store.actions.connectDatabase("postgresql://example.invalid/demo");
    expect(store.getSnapshot().connection.status).toBe("connecting");
    expect(store.getSnapshot().result).toBeNull();
    await connecting;
    expect(store.getSnapshot()).toMatchObject({ executionStatus: "idle", result: null,
      connection: { status: "connected" }, connectionMessage: "Connected — run an analysis." });
    await store.actions.generate();
    expect(store.getSnapshot().result).toMatchObject({ source: "postgres", data: RESULT, sql: PLAN.queryDraft });
    expect(api.plan.mock.calls[0][0]).toEqual({ question: store.getSnapshot().question,
      databaseKind: "postgres", schemaContext: CONNECTION.schemaContext, connectionId: CONNECTION.connectionId });
  });

  it("clears previous results before a retry and keeps them cleared on failure", async () => {
    const { store, api } = setup();
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    await store.actions.generate();
    const failing = deferred<AnalyticsExecuteResponse>();
    api.execute.mockReturnValueOnce(failing.promise);
    const retry = store.actions.generate();
    expect(store.getSnapshot().result).toBeNull();
    await Promise.resolve();
    failing.reject(new Error("Query failed"));
    await retry;
    expect(store.getSnapshot()).toMatchObject({ result: null, executionStatus: "error", error: "Query failed" });
  });

  it("ignores an execution response after disconnect and reconnect", async () => {
    const { store, api } = setup();
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    const old = deferred<AnalyticsExecuteResponse>();
    api.execute.mockReturnValueOnce(old.promise);
    const analysis = store.actions.generate();
    await Promise.resolve();
    expect(store.getSnapshot().executionStatus).toBe("executing");
    const disconnect = store.actions.disconnectDatabase();
    expect(store.getSnapshot().result?.source).toBe("mock");
    expect(api.plan.mock.calls[0][1]?.aborted).toBe(true);
    await disconnect;
    await store.actions.connectDatabase("postgresql://example.invalid/other");
    old.resolve(RESULT);
    await analysis;
    expect(store.getSnapshot()).toMatchObject({ result: null, executionStatus: "idle", connection: { status: "connected" } });
  });

  it.each(["setQuestion", "setSchemaContext"] as const)("invalidates pending results when %s changes", async (action) => {
    const { store, api } = setup();
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    const pending = deferred<AnalyticsExecuteResponse>();
    api.execute.mockReturnValueOnce(pending.promise);
    const analysis = store.actions.generate();
    await Promise.resolve();
    store.actions[action]("Updated input");
    pending.resolve(RESULT);
    await analysis;
    expect(store.getSnapshot()).toMatchObject({ result: null, plan: null, executionStatus: "idle" });
  });

  it("clears a completed demo result when switching to a real source", async () => {
    const { store, api } = setup();
    await store.actions.generate();
    expect(store.getSnapshot().result?.source).toBe("mock");
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    expect(store.getSnapshot()).toMatchObject({ result: null, plan: null, executionStatus: "idle" });
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("clears a demo result when switching the planning-only database kind", async () => {
    const { store, api } = setup();
    await store.actions.generate();
    store.actions.setDatabaseKind("mongodb");
    expect(store.getSnapshot()).toMatchObject({ result: null, plan: null,
      databaseKind: "mongodb", executionStatus: "idle", error: "" });
    expect(api.plan).not.toHaveBeenCalled();
  });

  it("retains clarification and never executes its draft", async () => {
    const { store, api } = setup();
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    api.plan.mockResolvedValueOnce({ ...PLAN, plan: { ...PLAN.plan,
      needsClarification: true, clarificationQuestion: "Which period?" } });
    await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ result: null, executionStatus: "clarification-required",
      plan: { plan: { clarificationQuestion: "Which period?" } } });
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("keeps all demo database kinds planning-only", async () => {
    const { store, api } = setup();
    for (const kind of ["postgres", "mysql", "sqlite", "mongodb"] as const) {
      store.actions.setDatabaseKind(kind);
      await store.actions.generate();
      expect(store.getSnapshot().result?.source).toBe("mock");
    }
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });

  it.each(DEMO_SCENARIOS)("runs the $id demo locally with matching rows and recommendation", async (scenario) => {
    const { store, api } = setup();
    store.actions.setQuestion(scenario.question);
    expect(store.getSnapshot().result).toBeNull();
    await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ executionStatus: "succeeded", error: "",
      result: { source: "mock", scenarioId: scenario.id, data: scenario.data, question: scenario.question,
        chartType: scenario.chartType, title: scenario.title },
      plan: { plan: { metric: scenario.metric, chartType: scenario.chartType, needsClarification: false } } });
    expect(store.getSnapshot().plan?.warnings.join(" ")).toContain("SYNTHETIC");
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("rejects unsupported offline questions instead of substituting a sample or contacting AI", async () => {
    const { store, api } = setup();
    await store.actions.generate();
    store.actions.setQuestion("Which customers are at risk of churn?");
    await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ executionStatus: "error", result: null, plan: null });
    expect(store.getSnapshot().error).toContain("four starter questions");
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("disconnects a late connection success without adopting its state", async () => {
    const { store, api } = setup();
    const pending = deferred<DatabaseConnectResponse>();
    api.connect.mockReturnValueOnce(pending.promise);
    const connecting = store.actions.connectDatabase("postgresql://example.invalid/demo");
    await store.actions.disconnectDatabase();
    pending.resolve(CONNECTION);
    await connecting;
    expect(api.disconnect).toHaveBeenCalledWith({ connectionId: CONNECTION.connectionId });
    expect(store.getSnapshot().connection.status).toBe("demo");
    expect(store.getSnapshot().result?.source).toBe("mock");
  });

  it("returns to labelled demo state if connection or disconnection fails", async () => {
    const { store, api } = setup();
    const schema = store.getSnapshot().schemaContext;
    api.connect.mockRejectedValueOnce(new Error("Cannot connect"));
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    expect(store.getSnapshot().connection.status).toBe("demo");
    expect(store.getSnapshot().result?.source).toBe("mock");
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    api.disconnect.mockRejectedValueOnce(new Error("API unavailable"));
    await store.actions.disconnectDatabase();
    expect(store.getSnapshot()).toMatchObject({ connection: { status: "demo" },
      schemaContext: schema, connectionMessage: "Demo mode is active." });
    expect(store.getSnapshot().error).toContain("could not confirm");
  });

  it("accepts a successful empty query result without falling back to mock rows", async () => {
    const { store, api } = setup();
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    api.execute.mockResolvedValueOnce({ ...RESULT, rows: [], rowCount: 0 });
    await store.actions.generate();
    expect(store.getSnapshot()).toMatchObject({ executionStatus: "succeeded",
      result: { source: "postgres", data: { rows: [], rowCount: 0 } } });
  });

  it("keeps the latest analysis when responses arrive out of order", async () => {
    const { store, api } = setup();
    await store.actions.connectDatabase("postgresql://example.invalid/demo");
    const first = deferred<AnalyticsPlanResponse>();
    api.plan.mockReturnValueOnce(first.promise);
    const old = store.actions.generate();
    store.actions.setQuestion("A newer question");
    await store.actions.generate();
    first.resolve(PLAN);
    await old;
    expect(store.getSnapshot().result).toMatchObject({ source: "postgres", question: "A newer question" });
    expect(api.execute).toHaveBeenCalledTimes(1);
  });
});
