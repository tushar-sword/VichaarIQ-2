import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  AnalyticsPlanRequestSchema,
  AnalyticsExecuteRequestSchema as ExecuteSchema,
  DatabaseConnectRequestSchema as ConnectSchema,
  DatabaseDisconnectRequestSchema as DisconnectSchema,
} from "@vichaar/shared";
import { createAnalyticsPlan } from "@vichaar/agents";
import { validateReadOnlySql } from "@vichaar/validation";
import { PostgresAdapter } from "@vichaar/database";

export async function createApp(options: { logger?: boolean; planner?: typeof createAnalyticsPlan } = {}) {
  const app = Fastify({ logger: options.logger === false ? false : {
    redact: ["req.body.connectionString", "req.headers.authorization"],
  } });
  const planner = options.planner ?? createAnalyticsPlan;
  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ errorCode: "REQUEST_FAILED" }, "Request failed");
    const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 500;
    return reply.code(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500)
      .send({ error: "Request failed. Check the request and server configuration." });
  });

  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  const connections = new Map<string, PostgresAdapter>();
  const MAX_CONNECTIONS = 5;

  app.get("/health", async () => ({
    status: "ok",
    service: "vichaar-iq-api",
    phase: "3b-postgres-connection",
  }));

  app.post("/api/database/connect", async (request, reply) => {
    const parsed = ConnectSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "A valid PostgreSQL connection string is required.",
      });
    }

    let connectionUrl: URL;

    try {
      connectionUrl = new URL(parsed.data.connectionString);

      if (
        !["postgres:", "postgresql:"].includes(connectionUrl.protocol)
      ) {
        return reply.code(400).send({
          error: "Only PostgreSQL connection strings are supported.",
        });
      }
    } catch {
      return reply.code(400).send({
        error: "The PostgreSQL connection string is invalid.",
      });
    }

    if (connections.size >= MAX_CONNECTIONS) {
      return reply.code(429).send({
        error: "Connection limit reached. Disconnect an existing database first.",
      });
    }

    let adapter: PostgresAdapter | undefined;
    try {
      // 📌 REAL DATABASE: the adapter pins the dedicated reader and server-owned table policy.
      adapter = new PostgresAdapter({
        connectionString: parsed.data.connectionString,
        statementTimeoutMs: 5000,
        maxRows: 500,
      });
      await adapter.testConnection();
      const schemaContext = await adapter.getSchemaSummary();

      const connectionId = randomUUID();
      connections.set(connectionId, adapter);

      return reply.send({
        connected: true,
        connectionId,
        databaseKind: "postgres",
        schemaContext,
      });
    } catch {
      await adapter?.close().catch(() => undefined);

      return reply.code(400).send({
        error:
          "PostgreSQL connection failed. Use the dedicated read-only role and approved business tables; check credentials and network access.",
      });
    }
  });

  app.post("/api/database/disconnect", async (request, reply) => {
    const parsed = DisconnectSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid connection ID." });
    }

    const adapter = connections.get(parsed.data.connectionId);

    if (!adapter) {
      return reply.code(404).send({ error: "Connection not found." });
    }

    connections.delete(parsed.data.connectionId);
    await adapter.close();

    return reply.send({ disconnected: true });
  });

  app.post("/api/analytics/execute", async (request, reply) => {
    const parsed = ExecuteSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "A valid connection ID and SQL query are required.",
      });
    }

    const adapter = connections.get(parsed.data.connectionId);

    if (!adapter) {
      return reply.code(404).send({
        error: "Database connection not found. Connect again and retry.",
      });
    }

    const validation = adapter.validateQuery(parsed.data.sql);

    if (!validation.valid) {
      return reply.code(422).send({
        error: "SQL validation failed.",
        details: validation.error,
      });
    }

    try {
      const result = await adapter.executeReadOnlyQuery(validation.sql);

      return reply.send({
        ...result,
        databaseKind: "postgres",
        executed: true,
        truncated: result.truncated,
      });
    } catch (error) {
      request.log.warn(
        {
          errorCode:
            typeof error === "object" &&
            error !== null &&
            "code" in error
              ? String(error.code)
              : "QUERY_FAILED",
        },
        "Analytics query failed",
      );

      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const messages: Record<string, string> = {
        "42703": "The query refers to a column that is not available in the connected schema. Review the schema and ask again.",
        "42803": "The query grouping is invalid. Try a simpler grouping or clarify the metric.",
        "42883": "The query's function arguments do not match the connected schema types. Clarify the calculation.",
        "57014": "The query exceeded its time limit. Narrow the date range or simplify the analysis.",
        "55P03": "The database is busy and the query could not acquire a lock in time. Try again shortly.",
        "42501": "The read-only account cannot access the requested data. Check the approved table permissions.",
        ACCESS_POLICY_REJECTED: "The connection no longer satisfies the read-only policy. Reconnect with the approved reader account.",
        "22P02": "A query filter or typed value is invalid. Review the requested values and time range.",
      };
      return reply.code(400).send({ error: messages[code] ?? "Query execution failed. Check the SQL, table permissions, and query limits." });
    }
  });

  app.post("/api/analytics/plan", async (request, reply) => {
    const parsed = AnalyticsPlanRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    let planningRequest = parsed.data;
    if (parsed.data.connectionId) {
      if (parsed.data.databaseKind !== "postgres") return reply.code(400).send({ error: "Connected execution is available only for PostgreSQL." });
      const adapter = connections.get(parsed.data.connectionId);
      if (!adapter) return reply.code(404).send({ error: "Database connection not found. Reconnect before planning an analysis." });
      try {
        // 📌 REAL DATABASE: use fresh server-discovered schema, never client-supplied replacements.
        planningRequest = { ...parsed.data, schemaContext: await adapter.getSchemaSummary() };
      } catch {
        return reply.code(400).send({ error: "Could not read the connected schema. Check the read-only account and reconnect." });
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      return reply.code(503).send({
        error:
          "OPENAI_API_KEY is not configured. Add it to the root .env and restart the API.",
      });
    }

    try {
      const result = await planner(
        planningRequest,
        process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      );

      // A clarification response has no executable draft to validate.
      if (result.plan.needsClarification) {
        return reply.send(result);
      }

      if (parsed.data.databaseKind === "postgres") {
        const adapter = planningRequest.connectionId ? connections.get(planningRequest.connectionId) : undefined;
        if (planningRequest.connectionId && !adapter) return reply.code(404).send({ error: "Database connection was closed while planning. Reconnect and retry." });
        const validation = adapter ? adapter.validateQuery(result.queryDraft) : validateReadOnlySql(result.queryDraft);

        if (!validation.valid) {
          return reply.code(422).send({
            error: "Generated PostgreSQL query failed validation.",
            details: validation.error,
            queryReturned: false,
          });
        }

        return reply.send({
          ...result,
          queryDraft: validation.sql,
          warnings: [
            ...result.warnings,
            "The PostgreSQL draft passed the current SQL validation checks.",
            "Execution requires the read-only endpoint, approved table permissions, and query limits.",
          ],
        });
      }

      return reply.send({
        ...result,
        warnings: [
          ...result.warnings,
          `Deterministic query validation is not yet implemented for ${parsed.data.databaseKind}. The draft is untrusted and has not been executed.`,
        ],
      });
    } catch (error) {
      request.log.error(
        {
          errorCode: "PLANNING_FAILED",
        },
        "Analytics plan generation failed",
      );

      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      return reply.code(502).send({ error: code === "INVALID_PLAN_OUTPUT"
        ? "The AI returned an invalid analysis plan. Clarify your question and try again; no query was executed."
        : code === "EMPTY_QUERY_DRAFT" ? "The AI returned no query draft. Clarify the metric or schema and try again."
        : "AI planning failed. Check the API key, model access, and API logs." });
    }
  });

  app.addHook("onClose", async () => {
    const activeConnections = [...connections.values()];
    connections.clear();
    await Promise.all(
      activeConnections.map((connection) =>
        connection.close().catch(() => undefined),
      ),
    );
  });

  return app;
}
