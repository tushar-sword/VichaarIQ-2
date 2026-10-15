import {
  AnalyticsExecuteResponseSchema,
  AnalyticsPlanResponseSchema,
  DatabaseConnectResponseSchema,
  DatabaseDisconnectResponseSchema,
  type AnalyticsExecuteRequest,
  type AnalyticsPlanRequest,
  type DatabaseConnectRequest,
  type DatabaseDisconnectRequest,
} from "@vichaar/shared";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://127.0.0.1:4000"
).replace(/\/+$/, "");

async function post<T>(
  endpoint: string,
  request: unknown,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Could not reach the API. Start the API server and try again.");
  }
  let body: unknown;
  try { body = await response.json(); }
  catch {
    if (signal?.aborted) throw new Error("Request cancelled.");
    throw new Error("The API returned an unreadable response. Check the API address and server.");
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      && typeof body.error === "string" ? body.error : "API request failed.";
    // Only 422 analytics responses contain controlled validator reasons. Never
    // append database diagnostics or other server error details to UI messages.
    const details = response.status === 422 && endpoint.startsWith("/api/analytics/")
      && body && typeof body === "object" && "details" in body && typeof body.details === "string"
      ? body.details.trim().slice(0, 500) : "";
    throw new Error(details ? `${message} ${details}` : message);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error("The API returned an invalid response. Please retry.");
  }
  return parsed.data;
}

export const workspaceApi = {
  // 📌 REAL DATABASE: connection credentials are sent only to this endpoint.
  connect: (request: DatabaseConnectRequest) =>
    post("/api/database/connect", request, DatabaseConnectResponseSchema),
  disconnect: (request: DatabaseDisconnectRequest) =>
    post("/api/database/disconnect", request, DatabaseDisconnectResponseSchema),
  // Planning includes an optional opaque connection ID, never database credentials.
  plan: (request: AnalyticsPlanRequest, signal?: AbortSignal) =>
    post("/api/analytics/plan", request, AnalyticsPlanResponseSchema, signal),
  // 📌 REAL DATABASE: validate the response instead of substituting empty/mock rows.
  execute: (request: AnalyticsExecuteRequest, signal?: AbortSignal) =>
    post("/api/analytics/execute", request, AnalyticsExecuteResponseSchema, signal),
};

export type WorkspaceApi = typeof workspaceApi;
