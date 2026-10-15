
import { describe, expect, it } from "vitest";
import { validateReadOnlySql } from "./index.js";

describe("validateReadOnlySql", () => {
  it.each([
    "SELECT * FROM sales",
    "SELECT product_name, SUM(revenue) FROM sales GROUP BY product_name",
  ])("allows read-only query: %s", (sql) => {
    expect(validateReadOnlySql(sql).valid).toBe(true);
  });

  it.each([
    "DELETE FROM sales",
    "DROP TABLE sales",
    "SELECT * FROM sales; DELETE FROM sales",
    "SELECT FROM",
    "SELECT pg_sleep(10)",
  ])("rejects unsafe or invalid query: %s", (sql) => {
    expect(validateReadOnlySql(sql).valid).toBe(false);
  });

  it("rejects empty input", () => {
    expect(validateReadOnlySql("").valid).toBe(false);
  });

  it.each([
    "SELECT o.id, c.region, SUM(i.line_total) AS revenue FROM public.orders o JOIN public.customers c ON c.id=o.customer_id JOIN public.order_items i ON i.order_id=o.id GROUP BY o.id,c.region ORDER BY revenue DESC LIMIT 10",
    "WITH totals AS (SELECT region, SUM(total_amount) AS revenue FROM orders GROUP BY region) SELECT * FROM totals",
    "WITH a AS (SELECT id FROM orders), b AS (SELECT * FROM a) SELECT * FROM b",
    "WITH totals AS (SELECT * FROM orders) SELECT * FROM (SELECT * FROM totals) AS t",
    "SELECT id FROM orders UNION SELECT id FROM customers",
    "SELECT id FROM orders UNION ALL SELECT id FROM customers",
    "SELECT * FROM (SELECT id FROM orders UNION ALL SELECT id FROM customers) AS u ORDER BY id LIMIT 5",
    "SELECT id FROM orders WHERE EXISTS (SELECT 1 FROM order_items WHERE order_id=orders.id)",
    "SELECT id FROM orders WHERE customer_id IN (SELECT id FROM customers)",
    "SELECT COALESCE(SUM(total_amount),0), COUNT(*) FILTER (WHERE status='completed') FROM orders",
    "SELECT CASE WHEN total_amount BETWEEN 1 AND 100 THEN 1 ELSE 0 END FROM orders",
    "SELECT EXTRACT(YEAR FROM created_at), date_trunc('month',created_at), total_amount::numeric(12,2) FROM orders",
    "SELECT DISTINCT ON(region) region,id FROM orders ORDER BY region,id",
    "SELECT 'FOR UPDATE; DELETE FROM orders' AS literal",
    "SELECT 1; -- trailing comment\n",
    "SELECT trim(name), substring(name FROM 1 FOR 3) FROM customers",
  ])("allows supported analytics SQL: %s", (sql) => expect(validateReadOnlySql(sql).valid).toBe(true));

  it.each(["FOR UPDATE", "FOR SHARE", "FOR NO KEY UPDATE", "FOR KEY SHARE"])("rejects every %s locking variant at any depth", (lock) => {
    for (const suffix of ["", " NOWAIT", " SKIP LOCKED"]) {
      for (const sql of [`SELECT * FROM orders ${lock}${suffix}`, `SELECT * FROM (SELECT * FROM orders ${lock}${suffix}) AS locked`, `WITH locked AS (SELECT * FROM orders ${lock}${suffix}) SELECT * FROM locked`]) {
        expect(validateReadOnlySql(sql).valid).toBe(false);
      }
    }
  });

  it.each([
    "pg_advisory_lock(1)", "pg_try_advisory_lock(1)", "pg_advisory_xact_lock(1)", "pg_sleep(1)",
    "pg_sleep_for('1 second')", "pg_read_file('/etc/passwd')", "pg_read_binary_file('/etc/passwd')",
    "pg_ls_dir('.')", "lo_import('/etc/passwd')", "pg_terminate_backend(1)", "pg_cancel_backend(1)",
    "pg_reload_conf()", "pg_notify('x','payload')", "set_config('search_path','public',false)",
    "nextval('orders_id_seq')", "setval('orders_id_seq',1)", "random()", "custom_function()",
    "public.sum(total_amount)", '"pg_advisory_lock"(1)', "dblink('secret','SELECT 1')",
  ])("rejects unapproved functions including nested calls: %s", (fn) => {
    for (const sql of [`SELECT ${fn} FROM orders`, `SELECT COALESCE(${fn},0) FROM orders`, `SELECT 1 FROM orders WHERE (${fn}) IS NULL`]) {
      expect(validateReadOnlySql(sql).valid).toBe(false);
    }
  });

  it.each([
    "WITH deleted AS (DELETE FROM orders RETURNING *) SELECT * FROM deleted",
    "WITH updated AS (UPDATE orders SET status='completed' RETURNING *) SELECT * FROM updated",
    "WITH inserted AS (INSERT INTO orders(id) VALUES(999) RETURNING *) SELECT * FROM inserted",
    "SELECT * INTO copied_orders FROM orders", "SELECT * FROM orders; SELECT 1",
    "SELECT * FROM orders; DROP TABLE orders", "CREATE TABLE probe(id int)", "COPY orders TO STDOUT",
    "WITH RECURSIVE a AS (SELECT 1 UNION ALL SELECT 1 FROM a) SELECT * FROM a",
    "SELECT * FROM generate_series(1,100)", "SELECT * FROM orders TABLESAMPLE SYSTEM (10)",
    "SELECT row_number() OVER (ORDER BY id) FROM orders", "SELECT $1", "SELECT ARRAY[1,2]",
    "SELECT '1'::public.secret", "SELECT 'orders'::regclass", "SELECT 1 OPERATOR(public.+) 2",
    "SELECT id FROM orders UNION SELECT id FROM customers ORDER BY id LIMIT 3",
  ])("fails closed for writes, ambiguity and unsupported constructs: %s", (sql) => expect(validateReadOnlySql(sql).valid).toBe(false));

  it.each(["pg_catalog.pg_class", "information_schema.tables", "private.orders", "pg_temp.orders"])("rejects unauthorized schema: %s", (relation) => {
    expect(validateReadOnlySql(`SELECT * FROM ${relation}`).valid).toBe(false);
    expect(validateReadOnlySql(`WITH x AS (SELECT * FROM ${relation}) SELECT * FROM x`).valid).toBe(false);
  });

  it("checks the physical table allowlist through CTEs, joins and unions", () => {
    const options = { allowedTables: [{ schema: "public", name: "orders" }] };
    expect(validateReadOnlySql("WITH x AS (SELECT * FROM orders) SELECT * FROM x", options).valid).toBe(true);
    for (const sql of ["SELECT * FROM customers", "WITH x AS (SELECT * FROM customers) SELECT * FROM x", "SELECT * FROM orders JOIN customers USING(id)", "SELECT id FROM orders UNION SELECT id FROM customers"]) {
      expect(validateReadOnlySql(sql, options).valid).toBe(false);
    }
  });

  it("qualifies physical relations, functions and casts and removes comments", () => {
    const result = validateReadOnlySql("SELECT SUM(total_amount::numeric) FROM orders; -- comment\n");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain("pg_catalog.sum");
      expect(result.sql).toContain("pg_catalog.numeric");
      expect(result.sql).toContain("public.orders");
      expect(result.sql).not.toContain("--");
      expect(validateReadOnlySql(result.sql).valid).toBe(true);
    }
  });

  it("keeps parser diagnostics and unapproved function arguments out of error messages", () => {
    for (const sql of ["SELECT pg_read_file('sensitive-file-name')", "SELECT FROM sensitive_table"]) {
      const result = validateReadOnlySql(sql);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).not.toContain("sensitive");
    }
  });
  it("rejects numeric parser precision loss and scientific-notation alias ambiguity", () => {
    for (const sql of ["SELECT 9007199254740993", "SELECT 0.12345678901234567890", "SELECT 1e2", "SELECT 1e-2"]) {
      expect(validateReadOnlySql(sql).valid).toBe(false);
    }
    for (const sql of ["SELECT '9007199254740993'::numeric", "SELECT '1e2'::numeric", "SELECT 1.2300 AS value", "SELECT -2"]) {
      expect(validateReadOnlySql(sql).valid).toBe(true);
    }
  });
  it("rejects quoted EXTRACT fields that a serializer could interpret as SQL", () => {
    const sql = 'SELECT EXTRACT("year FROM created_at) + pg_sleep(1) + EXTRACT(year" FROM created_at) FROM orders';
    expect(validateReadOnlySql(sql).valid).toBe(false);
  });
});
