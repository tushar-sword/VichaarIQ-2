import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("frontend API contract", () => {
  it("uses NEXT_PUBLIC_API_URL and sends the existing request shape", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.invalid///");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ disconnected: true })));
    vi.stubGlobal("fetch", fetch);
    const { workspaceApi } = await import("./api");
    await workspaceApi.disconnect({ connectionId: "10000000-0000-4000-8000-000000000001" });
    expect(fetch).toHaveBeenCalledWith("https://api.example.invalid/api/database/disconnect",
      expect.objectContaining({ method: "POST", body: '{"connectionId":"10000000-0000-4000-8000-000000000001"}' }));
  });

  it("retains the localhost development fallback", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const { API_BASE_URL } = await import("./api");
    expect(API_BASE_URL).toBe("http://127.0.0.1:4000");
  });

  it.each([{}, { rows: [] }, { columns: [], rows: [], rowCount: 0, truncated: false,
    databaseKind: "postgres", executed: false }])("rejects malformed execution success: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const { workspaceApi } = await import("./api");
    await expect(workspaceApi.execute({ connectionId: "10000000-0000-4000-8000-000000000001", sql: "SELECT 1" }))
      .rejects.toThrow("invalid response");
  });

  it("preserves API failure messages and passes the abort signal", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "SQL validation failed." }), { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const { workspaceApi } = await import("./api");
    const controller = new AbortController();
    await expect(workspaceApi.execute({ connectionId: "10000000-0000-4000-8000-000000000001", sql: "SELECT 1" }, controller.signal))
      .rejects.toThrow("SQL validation failed.");
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("shows controlled validator reasons for rejected analytics drafts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Generated PostgreSQL query failed validation.", details: "Function is not permitted by the SQL function allowlist.",
    }), { status: 422 })));
    const { workspaceApi } = await import("./api");
    await expect(workspaceApi.plan({ question: "Revenue in 2025", databaseKind: "postgres", schemaContext: "orders(total_amount)" }))
      .rejects.toThrow("Function is not permitted by the SQL function allowlist.");
  });

  it("does not expose raw database error details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Query execution failed.", details: "postgresql://secret:secret@private-host/db",
    }), { status: 400 })));
    const { workspaceApi } = await import("./api");
    await expect(workspaceApi.execute({ connectionId: "10000000-0000-4000-8000-000000000001", sql: "SELECT 1" }))
      .rejects.toThrow(/^Query execution failed\.$/);
  });

  it("gives recovery guidance when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { workspaceApi } = await import("./api");
    await expect(workspaceApi.disconnect({ connectionId: "10000000-0000-4000-8000-000000000001" }))
      .rejects.toThrow("Start the API server");
  });

  it("handles an HTML server error without leaking response text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>private proxy diagnostics</html>", { status: 502 })));
    const { workspaceApi } = await import("./api");
    await expect(workspaceApi.disconnect({ connectionId: "10000000-0000-4000-8000-000000000001" }))
      .rejects.toThrow(/^The API returned an unreadable response\. Check the API address and server\.$/);
  });

  it("preserves cancellation instead of reporting an unavailable API", async () => {
    const controller = new AbortController();
    const error = new DOMException("Cancelled", "AbortError");
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    const { workspaceApi } = await import("./api");
    await expect(workspaceApi.execute({ connectionId: "10000000-0000-4000-8000-000000000001", sql: "SELECT 1" }, controller.signal))
      .rejects.toBe(error);
  });
});
