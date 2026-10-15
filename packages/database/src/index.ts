import { Pool, type PoolClient } from "pg";
import { validateReadOnlySql, SAFE_COLUMN_TYPES, type SqlTable, type SqlValidationResult } from "@vichaar/validation";

export type DatabaseKind = "postgres" | "mysql" | "sqlite" | "mongodb";
export interface DatabaseAdapter { readonly kind: DatabaseKind; getSchemaSummary(): Promise<string> }
export interface QueryExecutionResult { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }
export const DEFAULT_READONLY_ROLE = "vichaar_test_reader";
export const DEFAULT_BUSINESS_TABLES: readonly SqlTable[] = Object.freeze(
  ["customers", "products", "orders", "order_items"].map((name) => Object.freeze({ schema: "public", name })),
);
export interface PostgresAdapterOptions {
  connectionString: string;
  statementTimeoutMs?: number;
  maxRows?: number;
  /** Trusted server configuration, never taken from an analytics request. */
  requiredRole?: string;
  allowedTables?: readonly SqlTable[];
}
export class DatabaseAccessError extends Error {
  readonly code = "ACCESS_POLICY_REJECTED";
  constructor() { super("Database connection does not satisfy the dedicated read-only access policy."); }
}
export class DatabaseQueryError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    super("Database operation failed. Check permissions and query limits.");
    this.code = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : "QUERY_FAILED";
  }
}
function sanitize(error: unknown): Error {
  if (error instanceof DatabaseAccessError) return error;
  return new DatabaseQueryError(error && typeof error === "object" && "code" in error ? error.code : undefined);
}
interface ColumnInfo { schema: string; table: string; column: string; data_type: string; type_schema: string; type_name: string; relkind: string; rls: boolean; inherited: boolean; selectable: boolean; generated_expression?: string | null; description?: string | null }

export class PostgresAdapter implements DatabaseAdapter {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;
  private readonly statementTimeoutMs: number;
  private readonly maxRows: number;
  private readonly requiredRole: string;
  private readonly allowedTables: readonly SqlTable[];

  constructor(options: PostgresAdapterOptions) {
    if (!options.connectionString.trim()) throw new Error("A PostgreSQL connection string is required.");
    const timeout = options.statementTimeoutMs ?? 5000;
    const rows = options.maxRows ?? 500;
    if (!Number.isFinite(timeout) || !Number.isFinite(rows)) throw new Error("Query limits must be finite numbers.");
    this.statementTimeoutMs = Math.max(1000, Math.min(Math.floor(timeout), 15000));
    this.maxRows = Math.max(1, Math.min(Math.floor(rows), 1000));
    this.requiredRole = options.requiredRole ?? DEFAULT_READONLY_ROLE;
    this.allowedTables = (options.allowedTables ?? DEFAULT_BUSINESS_TABLES).map((table) => ({ ...table }));
    if (!this.requiredRole || !this.allowedTables.length || this.allowedTables.some((table) =>
      !table.name || !table.schema || table.schema.startsWith("pg_") || table.schema === "information_schema")) throw new DatabaseAccessError();
    this.pool = new Pool({ connectionString: options.connectionString, max: 2, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, allowExitOnIdle: true });
    this.pool.on("error", () => { /* Never log credentials or sensitive server errors. */ });
  }

  validateQuery(input: string): SqlValidationResult {
    return validateReadOnlySql(input, {
      allowedSchemas: [...new Set(this.allowedTables.map((table) => table.schema))], allowedTables: this.allowedTables,
    });
  }

  // 📌 REAL DATABASE: evaluate effective privileges on the same client used for execution.
  // pg_settings is PostgreSQL's built-in PUBLIC-updateable settings view, not a business table.
  // SQL policy denies access to it; SET defaults alone are not treated as an ACL boundary.
  private async verifyAccess(client: PoolClient): Promise<ColumnInfo[]> {
    const check = await client.query<{
      account: string; session_account: string; elevated: boolean; memberships: boolean;
      database_write: boolean; schema_write: boolean; table_write: boolean; sequence_write: boolean;
    }>(`
      SELECT current_user AS account, session_user AS session_account,
        (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS elevated,
        EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid) AS memberships,
        pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CREATE,TEMP') AS database_write,
        EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE
          n.nspowner = r.oid OR pg_catalog.has_schema_privilege(current_user, n.oid, 'CREATE')) AS schema_write,
        EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m','f') AND NOT (n.nspname = 'pg_catalog' AND c.relname = 'pg_settings')
          AND (c.relowner = r.oid OR pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES'))) AS table_write,
        EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relkind = 'S'
          AND (c.relowner = r.oid OR pg_catalog.has_sequence_privilege(current_user, c.oid, 'USAGE,UPDATE'))) AS sequence_write
      FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
    `);
    const role = check.rows[0];
    if (!role || role.account !== this.requiredRole || role.session_account !== this.requiredRole
      || role.elevated || role.memberships || role.database_write || role.schema_write || role.table_write || role.sequence_write) throw new DatabaseAccessError();

    const result = await client.query<ColumnInfo>(`
      SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
        CASE WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END AS generated_expression,
        pg_catalog.col_description(c.oid, a.attnum) AS description,
        tn.nspname AS type_schema, t.typname AS type_name, c.relkind, c.relrowsecurity AS rls,
        EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid OR i.inhrelid = c.oid) AS inherited,
        (pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE')
          AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')) AS selectable
      FROM pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb) AS permitted(schema text, name text)
      JOIN pg_catalog.pg_namespace n ON n.nspname = permitted.schema
      JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = permitted.name
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
      ORDER BY n.nspname, c.relname, a.attnum
    `, [JSON.stringify(this.allowedTables)]);
    for (const table of this.allowedTables) {
      if (!result.rows.some((row) => row.schema === table.schema && row.table === table.name)) throw new DatabaseAccessError();
    }
    if (result.rows.some((row) => row.relkind !== "r" || row.rls || row.inherited || !row.selectable
      || row.type_schema !== "pg_catalog" || !SAFE_COLUMN_TYPES.includes(row.type_name))) throw new DatabaseAccessError();
    return result.rows;
  }

  private async readOnly<T>(operation: (client: PoolClient, columns: ColumnInfo[]) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch (error) { throw sanitize(error); }
    let started = false;
    let failed = false;
    let broken: Error | undefined;
    try {
      await client.query("BEGIN READ ONLY"); started = true;
      await client.query(`SET LOCAL statement_timeout = '${this.statementTimeoutMs}ms'`);
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      // Physical tables/functions/cast types are explicitly qualified by AST normalization.
      await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
      await client.query("SET LOCAL standard_conforming_strings = on");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      const columns = await this.verifyAccess(client);
      return await operation(client, columns);
    } catch (error) { failed = true; throw sanitize(error); }
    finally {
      try { if (started) await client.query("ROLLBACK"); }
      catch (error) { broken = sanitize(error); }
      finally { client.release(broken ?? (!started && failed ? new DatabaseQueryError(undefined) : undefined)); }
      if (broken && !failed) throw broken;
    }
  }

  async testConnection(): Promise<boolean> {
    return this.readOnly(async (client) => (await client.query("SELECT 1 AS connected")).rows[0]?.connected === 1);
  }
  async getSchemaSummary(): Promise<string> {
    return this.readOnly(async (client, columns) => {
      const tables = new Map<string, string[]>();
      for (const row of columns) {
        const key = `${row.schema}.${row.table}`;
        const generated = row.generated_expression ? ` GENERATED AS ${row.generated_expression}` : "";
        const description = row.description ? ` DESCRIPTION ${JSON.stringify(row.description)}` : "";
        tables.set(key, [...(tables.get(key) ?? []), `${row.column} (${row.data_type})${generated}${description}`]);
      }
      // 📌 REAL DATABASE: relationship/semantic metadata only; no rows or connection credentials.
      const constraints = await client.query<{ schema: string; table: string; definition: string }>(`
        SELECT n.nspname AS schema, c.relname AS table,
          pg_catalog.pg_get_constraintdef(k.oid, true) AS definition
        FROM pg_catalog.pg_constraint k
        JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb) AS permitted(schema text, name text)
          ON permitted.schema = n.nspname AND permitted.name = c.relname
        WHERE k.contype IN ('p', 'f', 'c') AND (k.contype <> 'f' OR k.confrelid IN (
          SELECT target.oid FROM pg_catalog.pg_class target
          JOIN pg_catalog.pg_namespace tn ON tn.oid = target.relnamespace
          JOIN pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb) AS approved(schema text, name text)
            ON approved.schema = tn.nspname AND approved.name = target.relname))
        ORDER BY n.nspname, c.relname, k.conname
      `, [JSON.stringify(this.allowedTables)]);
      const summary = [
        ...[...tables.entries()].map(([table, fields]) => `${table}: ${fields.join(", ")}`),
        "Execution timezone: UTC. Constraints below describe metadata, not executable query examples.",
        ...constraints.rows.map((row) => `${row.schema}.${row.table} CONSTRAINT ${row.definition}`),
      ].join("\n");
      if (summary.length > 12000) throw new Error("Discovered schema exceeds the planner context limit.");
      return summary;
    });
  }
  async executeReadOnlyQuery(input: string): Promise<QueryExecutionResult> {
    const validation = this.validateQuery(input);
    if (!validation.valid) throw new Error(`SQL validation failed: ${validation.error}`);
    // 📌 REAL DATABASE: execute the normalized AST, never a fallback to untrusted source text.
    return this.readOnly(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM (${validation.sql}) AS vichaar_result LIMIT $1`, [this.maxRows + 1],
      );
      const rows = result.rows.slice(0, this.maxRows);
      return { columns: result.fields.map((field) => field.name), rows, rowCount: rows.length,
        truncated: result.rows.length > this.maxRows };
    });
  }
  async close(): Promise<void> { await this.pool.end(); }
}
