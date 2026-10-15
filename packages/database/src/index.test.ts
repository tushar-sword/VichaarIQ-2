import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseAccessError, PostgresAdapter } from "./index.js";

// 📌 MOCK DATA: test-only pool/role/row stand-ins; never returned by the running API.
const mocks = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), connect: vi.fn(), end: vi.fn(),
  role: {} as Record<string, unknown>, columns: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[], dataError: undefined as Error | undefined,
  rollbackError: undefined as Error | undefined,
  constraints: [] as Record<string, unknown>[],
}));
vi.mock("pg", () => ({ Pool: class {
  on() {} connect = mocks.connect; end = mocks.end;
} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = { account: "vichaar_test_reader", session_account: "vichaar_test_reader", elevated: false,
    memberships: false, database_write: false, schema_write: false, table_write: false, sequence_write: false };
  mocks.columns = ["customers", "products", "orders", "order_items"].map((table) => ({ schema: "public", table,
    column: "id", data_type: "integer", type_schema: "pg_catalog", type_name: "int4", relkind: "r", rls: false, inherited: false, selectable: true }));
  mocks.rows = [{ id: 1 }]; mocks.dataError = undefined; mocks.rollbackError = undefined;
  mocks.constraints = [];
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM pg_catalog.pg_roles r")) return { rows: [mocks.role] };
    if (sql.includes("FROM pg_catalog.pg_constraint")) return { rows: mocks.constraints };
    if (sql.includes("jsonb_to_recordset")) return { rows: mocks.columns };
    if (sql.includes("AS vichaar_result")) {
      if (mocks.dataError) throw mocks.dataError;
      return { rows: mocks.rows, fields: [{ name: "id" }] };
    }
    if (sql === "ROLLBACK" && mocks.rollbackError) throw mocks.rollbackError;
    return { rows: [{ connected: 1 }], fields: [] };
  });
});

const adapter = (options = {}) => new PostgresAdapter({ connectionString: "postgresql://example.invalid/unused", ...options });
describe("PostgreSQL execution safeguards (mocked database)", () => {
  it("uses read-only transaction, bounded timeouts, trusted search path and rollback", async () => {
    const db = adapter();
    await db.executeReadOnlyQuery("SELECT id FROM orders");
    const commands = mocks.query.mock.calls.map((call) => call[0]);
    expect(commands.slice(0, 5)).toEqual(["BEGIN READ ONLY", "SET LOCAL statement_timeout = '5000ms'",
      "SET LOCAL lock_timeout = '1000ms'", "SET LOCAL search_path = pg_catalog, pg_temp", "SET LOCAL standard_conforming_strings = on"]);
    expect(commands.at(-1)).toBe("ROLLBACK");
    expect(commands).toContain("SET LOCAL TIME ZONE 'UTC'");
    expect(mocks.release).toHaveBeenCalledWith(undefined);
    expect(commands.find((sql) => sql.includes("AS vichaar_result"))).toContain("public.orders");
  });

  it("detects an extra row and returns only the configured limit", async () => {
    mocks.rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = await adapter({ maxRows: 2 }).executeReadOnlyQuery("SELECT id FROM orders");
    expect(result).toMatchObject({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2, truncated: true });
    expect(mocks.query.mock.calls.find((call) => call[0].includes("AS vichaar_result"))?.[1]).toEqual([3]);
  });

  it.each(["elevated", "memberships", "database_write", "schema_write", "table_write", "sequence_write"])("refuses effective privilege: %s", async (flag) => {
    mocks.role[flag] = true;
    await expect(adapter().testConnection()).rejects.toBeInstanceOf(DatabaseAccessError);
    expect(mocks.query.mock.calls.some((call) => call[0].includes("AS vichaar_result"))).toBe(false);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("requires the configured reader as both session and effective account", async () => {
    for (const field of ["account", "session_account"]) {
      const original = mocks.role[field]; mocks.role[field] = "privileged_admin";
      await expect(adapter().testConnection()).rejects.toBeInstanceOf(DatabaseAccessError);
      mocks.role[field] = original;
    }
  });

  it("rechecks permissions on every execution, including after a previously successful query", async () => {
    const db = adapter(); await db.executeReadOnlyQuery("SELECT id FROM orders");
    mocks.role.table_write = true;
    await expect(db.executeReadOnlyQuery("SELECT id FROM orders")).rejects.toBeInstanceOf(DatabaseAccessError);
    expect(mocks.query.mock.calls.filter((call) => call[0].includes("AS vichaar_result"))).toHaveLength(1);
  });

  it.each([{ rls: true }, { inherited: true }, { relkind: "v" }, { selectable: false }, { type_schema: "public" }, { type_name: "unsafe_type" }])("rejects unsupported relation/type profile: %j", async (patch) => {
    Object.assign(mocks.columns[0], patch);
    await expect(adapter().testConnection()).rejects.toBeInstanceOf(DatabaseAccessError);
  });

  it("blocks unauthorized schemas and public tables before acquiring a database client", async () => {
    for (const sql of ["SELECT * FROM pg_catalog.pg_class", "SELECT * FROM private.orders", "SELECT * FROM public.secrets"]) {
      await expect(adapter().executeReadOnlyQuery(sql)).rejects.toThrow("SQL validation failed");
    }
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("redacts server SQL errors and recovers the client after a timeout", async () => {
    const db = adapter();
    mocks.dataError = Object.assign(new Error("sensitive SQL with a password"), { code: "57014" });
    await expect(db.executeReadOnlyQuery("SELECT id FROM orders")).rejects.toMatchObject({ code: "57014", message: "Database operation failed. Check permissions and query limits." });
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    mocks.dataError = undefined;
    await expect(db.executeReadOnlyQuery("SELECT id FROM orders")).resolves.toMatchObject({ rowCount: 1 });
  });

  it("discards a client whose rollback failed and never reports its query as successful", async () => {
    mocks.rollbackError = new Error("sensitive connection error");
    await expect(adapter().executeReadOnlyQuery("SELECT id FROM orders")).rejects.toThrow("Database operation failed");
    expect(mocks.release.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(mocks.release.mock.calls[0][0].message).not.toContain("sensitive");
  });

  it("rejects non-finite resource settings", () => {
    expect(() => adapter({ statementTimeoutMs: NaN })).toThrow("finite");
    expect(() => adapter({ maxRows: Infinity })).toThrow("finite");
  });

  it("discovers generated measures, business descriptions and authorized relationships without credentials", async () => {
    Object.assign(mocks.columns[3], { column: "line_total", generated_expression: "quantity * unit_price - discount_amount", description: "Discounted merchandise value" });
    mocks.constraints = [{ schema: "public", table: "order_items", definition: "FOREIGN KEY (order_id) REFERENCES public.orders(id)" }];
    const summary = await adapter().getSchemaSummary();
    expect(summary).toContain("GENERATED AS quantity * unit_price - discount_amount");
    expect(summary).toContain("Discounted merchandise value");
    expect(summary).toContain("FOREIGN KEY (order_id) REFERENCES public.orders(id)");
    expect(summary).toContain("Execution timezone: UTC");
    expect(summary).not.toContain("postgresql://");
    const query = mocks.query.mock.calls.find(c => c[0].includes("FROM pg_catalog.pg_constraint"));
    expect(query?.[0]).toContain("k.confrelid IN");
    expect(query?.[1]).toEqual([JSON.stringify(["customers", "products", "orders", "order_items"].map(name => ({ schema: "public", name })))]);
  });

  it("rejects oversized schema context instead of silently truncating columns or relationships", async () => {
    mocks.columns[0].description = "x".repeat(13000);
    await expect(adapter().getSchemaSummary()).rejects.toThrow("Database operation failed");
  });
});
