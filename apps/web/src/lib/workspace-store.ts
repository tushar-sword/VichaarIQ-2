import type { AnalyticsPlanResponse, DatabaseKind } from "@vichaar/shared";
import { workspaceApi, type WorkspaceApi } from "./api";
import { DEMO_SCHEMA, DEMO_SCENARIOS, EXAMPLES, demoPlan, getDemoScenario, type DemoScenario } from "./demo-data";
import type { ChartType, VisualizationResult } from "./visualization";

export type DatabaseConnectionStatus = "demo" | "connecting" | "connected" | "disconnecting";
export type DatabaseConnection =
  | { status: Exclude<DatabaseConnectionStatus, "connected"> }
  | { status: "connected"; connectionId: string };
export type AnalyticsExecutionStatus =
  | "idle" | "planning" | "clarification-required" | "executing" | "succeeded" | "error";

export type AnalyticsResult =
  // 📌 MOCK DATA: explicit provenance prevents fixtures being relabeled as live.
  | { source: "mock"; data: VisualizationResult; scenarioId?: string; question?: string; title?: string; chartType?: ChartType }
  // 📌 REAL DATABASE: publish only after confirmed successful execution.
  | { source: "postgres"; data: VisualizationResult; connectionId: string; question: string; sql: string };

export interface WorkspaceState {
  connection: DatabaseConnection;
  question: string;
  databaseKind: DatabaseKind;
  schemaContext: string;
  plan: AnalyticsPlanResponse | null;
  result: AnalyticsResult | null;
  executionStatus: AnalyticsExecutionStatus;
  error: string;
  connectionMessage: string;
}

function demoResult(scenario: DemoScenario = DEMO_SCENARIOS[0]): AnalyticsResult {
  // 📌 MOCK DATA: used only for explicitly selected demo mode.
  return { source: "mock", data: scenario.data, scenarioId: scenario.id,
    question: scenario.question, title: scenario.title, chartType: scenario.chartType };
}

export function createWorkspaceStore(api: WorkspaceApi = workspaceApi) {
  let state: WorkspaceState = {
    connection: { status: "demo" },
    question: EXAMPLES[0],
    databaseKind: "postgres",
    schemaContext: DEMO_SCHEMA,
    plan: null,
    result: demoResult(),
    executionStatus: "idle",
    error: "",
    connectionMessage: "",
  };
  const listeners = new Set<() => void>();
  let sourceVersion = 0;
  let analysisVersion = 0;
  let analysisController: AbortController | undefined;
  let demoSource = { databaseKind: state.databaseKind, schemaContext: state.schemaContext };

  function update(patch: Partial<WorkspaceState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function cancelAnalysis() {
    analysisVersion++;
    analysisController?.abort();
    analysisController = undefined;
  }

  function edit(patch: Partial<Pick<WorkspaceState, "question" | "databaseKind" | "schemaContext">>) {
    cancelAnalysis();
    update({
      ...patch, plan: null, executionStatus: "idle", error: "",
      result: null,
    });
  }

  const actions = {
    setQuestion(question: string) { edit({ question }); },
    setSchemaContext(schemaContext: string) { edit({ schemaContext }); },
    setDatabaseKind(databaseKind: DatabaseKind) {
      // A connected execution source is always PostgreSQL.
      if (state.connection.status !== "demo") return;
      edit({ databaseKind });
    },

    async connectDatabase(connectionString: string) {
      if (!connectionString.trim()) {
        update({ error: "Enter a PostgreSQL connection string first." });
        return;
      }
      if (state.connection.status !== "demo") return;
      demoSource = { databaseKind: state.databaseKind, schemaContext: state.schemaContext };
      const version = ++sourceVersion;
      cancelAnalysis();
      update({ connection: { status: "connecting" }, result: null, plan: null,
        executionStatus: "idle", error: "", connectionMessage: "" });
      try {
        // 📌 REAL DATABASE: do not abort connect; a late success must be disconnected.
        const response = await api.connect({ connectionString: connectionString.trim() });
        if (version !== sourceVersion) {
          await api.disconnect({ connectionId: response.connectionId }).catch(() => undefined);
          return;
        }
        update({
          connection: { status: "connected", connectionId: response.connectionId },
          databaseKind: "postgres", schemaContext: response.schemaContext,
          result: null, plan: null, executionStatus: "idle", error: "",
          connectionMessage: "Connected — run an analysis.",
        });
      } catch (error) {
        if (version !== sourceVersion) return;
        // 📌 MOCK DATA: failed connection remains explicitly in demo mode.
        update({ connection: { status: "demo" }, result: demoResult(),
          error: error instanceof Error ? error.message : "Database connection failed." });
      }
    },

    async disconnectDatabase() {
      const connection = state.connection;
      const version = ++sourceVersion;
      cancelAnalysis();
      // 📌 MOCK DATA: reset immediately so pending responses cannot publish live rows.
      update({
        connection: { status: connection.status === "connected" ? "disconnecting" : "demo" },
        ...demoSource, result: demoResult(), plan: null,
        executionStatus: "idle", error: "", connectionMessage: "Demo mode is active.",
      });
      if (connection.status !== "connected") return;
      try {
        // 📌 REAL DATABASE: release the backend pool without changing the database.
        await api.disconnect({ connectionId: connection.connectionId });
      } catch {
        if (version === sourceVersion) {
          update({ error: "Demo mode is active, but the API could not confirm database disconnection." });
        }
      } finally {
        if (version === sourceVersion) update({ connection: { status: "demo" } });
      }
    },

    async generate() {
      if (state.connection.status === "connecting" || state.connection.status === "disconnecting") return;
      cancelAnalysis();
      const version = analysisVersion;
      const source = sourceVersion;
      const controller = new AbortController();
      analysisController = controller;
      const { question, databaseKind, schemaContext, connection } = state;
      const current = () => version === analysisVersion && source === sourceVersion && !controller.signal.aborted;
      update({ result: null, plan: null, executionStatus: "planning", error: "" });
      if (connection.status === "demo") {
        // 📌 MOCK DATA: only four whitelisted scenarios run offline, with no API or OpenAI requests.
        const scenario = getDemoScenario(question);
        if (!scenario) {
          update({ executionStatus: "error", result: null,
            error: "This question is not available in the offline demo. Choose one of the four starter questions, or connect a PostgreSQL database for AI analysis." });
        } else {
          update({ plan: demoPlan(scenario), result: demoResult(scenario), executionStatus: "succeeded" });
        }
        analysisController = undefined;
        return;
      }
      try {
        // Credentials are deliberately excluded from the planner request.
        const plan = await api.plan({ question, databaseKind, schemaContext,
          ...(connection.status === "connected" ? { connectionId: connection.connectionId } : {}) }, controller.signal);
        if (!current()) return;
        update({ plan });
        if (plan.plan.needsClarification) {
          update({ executionStatus: "clarification-required" });
          return;
        }
        if (connection.status === "connected") {
          // 📌 REAL DATABASE: no fixtures or previous results survive this request.
          update({ executionStatus: "executing" });
          const result = await api.execute({ connectionId: connection.connectionId, sql: plan.queryDraft }, controller.signal);
          if (!current()) return;
          update({ result: { source: "postgres", data: result, connectionId: connection.connectionId,
            question, sql: plan.queryDraft }, executionStatus: "succeeded" });
        }
      } catch (error) {
        if (!current()) return;
        update({ result: null, executionStatus: "error",
          error: error instanceof Error ? error.message : "Analysis failed." });
      } finally {
        if (current()) analysisController = undefined;
      }
    },

    cancelPending() {
      sourceVersion++;
      cancelAnalysis();
    },
  };

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    actions,
  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
