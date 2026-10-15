import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export async function runSqlSafetyChecks({ docker, TEST, ROOT, logicalDumpHash }) {
  const { PostgresAdapter } = await import("../packages/database/dist/index.js");
  const { createApp } = await import("../services/api/dist/app.js");
  const { Client } = createRequire(resolve(ROOT, "packages/database/package.json"))("pg");
  // 📌 REAL DATABASE: this fixed connection is allowed only after the fixture ownership/port guards.
  const reader = `postgresql://${TEST.reader}:${TEST.readerPassword}@127.0.0.1:${TEST.port}/${TEST.database}`;
  // LOCAL DEVELOPMENT ONLY: known fixture bootstrap credentials for admin-rejection and rollback-only lock probes.
  const admin = `postgresql://vichaar_test_admin:local_test_admin_only@127.0.0.1:${TEST.port}/${TEST.database}`;
  // pg_dump needs set_config, intentionally revoked from the reader. Use the known
  // fixture admin solely for a read-only in-memory dump; never weaken reader grants.
  const fingerprint = () => logicalDumpHash(docker(["exec", TEST.container,
    "pg_dump", "--username", "vichaar_test_admin", "--dbname", TEST.database, "--no-owner"]));
  const before = fingerprint();
  const db = new PostgresAdapter({ connectionString: reader });
  const fast = new PostgresAdapter({ connectionString: reader, statementTimeoutMs: 1000 });
  const privileged = new PostgresAdapter({ connectionString: admin });
  let app;
  try {
    assert.equal(await db.testConnection(), true);
    await assert.rejects(privileged.testConnection(), { code: "ACCESS_POLICY_REJECTED" });
    console.log("PASS dedicated reader accepted; fixture admin rejected for execution");

    const cases = [
      ["SELECT COUNT(*) AS total_orders FROM orders", (r) => assert.equal(r.rows[0].total_orders, "1440")],
      ["WITH completed AS (SELECT * FROM orders WHERE status='completed') SELECT COUNT(*) AS completed_orders FROM completed", (r) => assert.equal(r.rows[0].completed_orders, "720")],
      ["WITH a AS (SELECT region FROM customers), b AS (SELECT region,COUNT(*) AS n FROM a GROUP BY region) SELECT * FROM b ORDER BY region", (r) => assert.equal(r.rowCount, 5)],
      ["SELECT region FROM customers UNION SELECT region FROM orders", (r) => assert.equal(r.rowCount, 5)],
      ["SELECT * FROM (SELECT id FROM customers WHERE id=1 UNION ALL SELECT id FROM orders WHERE id=1) AS u ORDER BY id", (r) => assert.equal(r.rowCount, 2)],
      ["SELECT p.category, SUM(i.line_total) AS revenue FROM products p JOIN order_items i ON i.product_id=p.id JOIN orders o ON o.id=i.order_id WHERE o.status='completed' GROUP BY p.category ORDER BY revenue DESC", (r) => assert.equal(r.rowCount, 4)],
      ["SELECT id FROM orders WHERE EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=orders.id) LIMIT 5", (r) => assert.equal(r.rowCount, 5)],
      ["SELECT COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) FILTER (WHERE status='completed') AS n FROM orders", (r) => assert.equal(r.rows[0].n, "720")],
      ["SELECT EXTRACT(YEAR FROM created_at) AS year, total_amount::numeric(12,2) AS amount FROM orders LIMIT 1", (r) => assert.equal(r.rows[0].year, "2025")],
      ["SELECT '9007199254740993'::numeric AS exact_value; -- trailing comment\n", (r) => assert.equal(r.rows[0].exact_value, "9007199254740993")],
    ];
    for (const [sql, verify] of cases) verify(await db.executeReadOnlyQuery(sql));
    console.log("PASS real SELECT/aggregates/JOIN/GROUP/ORDER, CTE scopes, UNION/ALL, EXISTS, FILTER, casts and comment normalization");

    const locked = ["FOR UPDATE", "FOR SHARE", "FOR NO KEY UPDATE", "FOR KEY SHARE"];
    const unsafe = [
      ...locked.map((clause) => `SELECT * FROM orders ${clause}`),
      "SELECT pg_advisory_lock(1)", "SELECT COALESCE(pg_sleep(0),NULL)", "SELECT public.custom_function()",
      "SELECT * FROM pg_catalog.pg_class", "SELECT * FROM information_schema.tables", "SELECT * FROM private.orders", "SELECT * FROM public.unapproved",
      "WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x", "SELECT id FROM orders; DELETE FROM orders",
      "SELECT 'orders'::regclass", "SELECT id FROM orders UNION SELECT id FROM customers ORDER BY id",
    ];
    for (const sql of unsafe) await assert.rejects(db.executeReadOnlyQuery(sql), /SQL validation failed/);
    console.log("PASS forbidden functions/locks/writes and unauthorized schema/table references rejected before execution");
    const limited = await db.executeReadOnlyQuery("SELECT id FROM orders ORDER BY id");
    assert.equal(limited.rowCount, 500); assert.equal(limited.truncated, true);
    await assert.rejects(fast.executeReadOnlyQuery("SELECT COUNT(*) FROM orders a CROSS JOIN orders b CROSS JOIN orders c"), { code: "57014" });
    assert.equal((await fast.executeReadOnlyQuery("SELECT 1 AS healthy")).rows[0].healthy, 1);
    console.log("PASS 500-row cap, real statement timeout (57014), rollback and subsequent connection recovery");

    const locker = new Client({ connectionString: admin, connectionTimeoutMillis: 5000 });
    try {
      await locker.connect();
      await locker.query("BEGIN");
      await locker.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      await locker.query("LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE");
      await assert.rejects(db.executeReadOnlyQuery("SELECT id FROM orders LIMIT 1"), { code: "55P03" });
    } finally { await locker.query("ROLLBACK").catch(() => undefined); await locker.end(); }
    assert.equal((await db.executeReadOnlyQuery("SELECT COUNT(*) AS n FROM orders")).rows[0].n, "1440");
    console.log("PASS real lock timeout (55P03), rollback-only fixture lock released, data unchanged");

    // Fastify injection uses the real endpoints/adapters without opening ports or invoking any planner/model.
    app = await createApp({ logger: false, planner: async () => { throw new Error("Live planning disabled in safety checks"); } });
    const rejected = await app.inject({ method: "POST", url: "/api/database/connect", payload: { connectionString: admin } });
    assert.equal(rejected.statusCode, 400); assert.ok(!rejected.body.includes("local_test_admin_only"));
    const connect = await app.inject({ method: "POST", url: "/api/database/connect", payload: { connectionString: reader } });
    assert.equal(connect.statusCode, 200);
    const connectionId = connect.json().connectionId;
    const successful = await app.inject({ method: "POST", url: "/api/analytics/execute", payload: { connectionId, sql: "WITH x AS (SELECT region FROM customers) SELECT DISTINCT region FROM x ORDER BY region" } });
    assert.equal(successful.statusCode, 200); assert.equal(successful.json().rowCount, 5); assert.equal(successful.json().executed, true);
    for (const sql of unsafe) {
      const rejectedQuery = await app.inject({ method: "POST", url: "/api/analytics/execute", payload: { connectionId, sql } });
      assert.equal(rejectedQuery.statusCode, 422);
    }
    const badColumn = await app.inject({ method: "POST", url: "/api/analytics/execute", payload: { connectionId, sql: "SELECT hidden_sql_error_needle FROM orders" } });
    assert.equal(badColumn.statusCode, 400); assert.ok(!badColumn.body.includes("hidden_sql_error_needle"));
    const disconnected = await app.inject({ method: "POST", url: "/api/database/disconnect", payload: { connectionId } });
    assert.equal(disconnected.statusCode, 200);
    console.log("PASS real Fastify connect/execute/disconnect contracts, 422 rejections, admin refusal and redacted SQL errors");
  } finally {
    await app?.close();
    await Promise.all([db.close(), fast.close(), privileged.close()]);
    assert.equal(fingerprint(), before, "Fixture schema/data fingerprint changed");
    console.log("PASS fixture logical schema/data fingerprint unchanged");
  }
}
