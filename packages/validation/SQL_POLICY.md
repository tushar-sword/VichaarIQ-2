# PostgreSQL prototype SQL policy (Phase 5B)

AI drafts and user-supplied SQL are untrusted. `validateReadOnlySql` parses one statement with `pgsql-ast-parser`, checks supported AST nodes/fields at every nesting level, reconstructs normalized SQL, then parses and validates the executable form again. Original source SQL is never used as a fallback. Parser/serializer failures reject the query without returning raw diagnostics or SQL excerpts. EXTRACT fields also have a positive unit allowlist because the serializer emits that identifier as SQL text.

## Supported subset

- SELECT projections, aliases, DISTINCT / DISTINCT ON, WHERE, GROUP BY, HAVING, ORDER BY and literal LIMIT/OFFSET (0–1,000,000). Execution still caps results independently.
- INNER, LEFT, RIGHT, FULL and CROSS joins, ON and USING.
- Derived SELECT subqueries, IN/NOT IN lists/subqueries, EXISTS, nested CASE, comparisons, arithmetic, boolean logic, LIKE/ILIKE, string concatenation, BETWEEN, JSON `->` / `->>`, and AT TIME ZONE.
- Ordinary non-recursive WITH bindings, including multiple dependent/nested CTEs. Each binding and final statement must independently be a supported read-only SELECT/CTE/union. CTE names are scoped; physical relations inside them still require authorization.
- UNION and UNION ALL without direct operand ordering/limits. For sorting/limiting the combined result, use an outer SELECT:

```sql
SELECT * FROM (
  SELECT region FROM customers
  UNION SELECT region FROM orders
) AS combined
ORDER BY region LIMIT 5;
```

- Aggregate DISTINCT/ALL, aggregate FILTER and supported aggregate argument ordering.
- EXTRACT, SUBSTRING syntax and current date/time keywords (`CURRENT_DATE`, `CURRENT_TIMESTAMP`, `CURRENT_TIME`, `LOCALTIMESTAMP`, `LOCALTIME`).
- Supported built-in scalar casts/typed literals: boolean, int2/int4/int8 and their integer aliases, float4/float8, numeric/decimal, text/varchar/bpchar, date/time/timestamp with or without time zone, interval, json/jsonb, uuid and bytea. Types are pinned to `pg_catalog`. Custom/domain/array/regclass/regproc/OID/XML/geometric casts are not supported.

## Explicit function allowlist

Ordinary calls are permitted **only** from the following list, either unqualified or explicitly qualified by `pg_catalog`. Normalization pins each permitted ordinary call to `pg_catalog` to prevent public-schema overloads. Explicit calls in other schemas are rejected, even when their names match.

| Purpose | Functions |
| --- | --- |
| Aggregation | `count`, `sum`, `avg`, `min`, `max`, `stddev_pop`, `stddev_samp`, `var_pop`, `var_samp`, `bool_and`, `bool_or`, `string_agg` |
| Numeric | `abs`, `round`, `ceil`, `ceiling`, `floor`, `trunc`, `sign`, `sqrt`, `power`, `mod` |
| Text | `lower`, `upper`, `length`, `char_length`, `octet_length`, `btrim`, `ltrim`, `rtrim`, `concat`, `concat_ws`, `substring`, `replace`, `left`, `right`, `split_part` |
| Date/time | `date_trunc`, `date_part`, `to_char`, `now` |

SQL special expressions `coalesce`, `nullif`, `greatest`, `least` and `exists` remain unqualified and have recursively checked arguments. `exists` requires a supported SELECT subquery. Unqualified `trim(...)` is normalized to `pg_catalog.btrim(...)`.

Anything unlisted is rejected, including user functions, sequence functions, advisory locks, sleep, file/large-object access, configuration changes, notifications, administration, dblink, random, and extension functions. This is a positive allowlist, not a denylist that assumes unknown functions are safe. PostgreSQL's volatility labels alone are not accepted as proof of safety.

## Rejected constructs and parser limitations

- DDL, DML, COPY, SET, transaction commands, SELECT INTO, data-modifying CTEs, recursive CTEs and multiple statements.
- Every locking clause, including FOR UPDATE, FOR SHARE, FOR NO KEY UPDATE, FOR KEY SHARE, NOWAIT and SKIP LOCKED, at any query depth.
- LATERAL, table functions, VALUES statements, TABLESAMPLE, arrays, window/ordered-set functions, parameters, unsupported AST nodes/fields and custom operators.
- Direct ORDER BY/LIMIT/OFFSET on UNION operands: this parser can attach a combined-result clause to the final branch. Rather than changing its meaning, reject it and require an outer SELECT.
- Scientific-notation numeric tokens: this parser can mistake an exponent for an alias. Use `'1e2'::numeric` instead. Numeric literals that lose precision when represented by the parser are rejected; use quoted numeric casts such as `'9007199254740993'::numeric` for exact values.
- CTE column-name lists and materialization hints are not supported by the installed parser. Invalid/unsupported syntax receives a clear rejection; safety is never weakened to make a draft run.
- Input limit 20,000 characters; visited-node/depth limits 4,000/80. LIMIT/OFFSET require bounded integer literals.

Parser and numeric-token checks complement AST validation; regular expressions are not the SQL safety boundary. Comments and an optional final semicolon are removed by reconstruction rather than naive string replacement. Alias/identifier quoting and string-literal escaping are handled by the AST serializer.

## Database enforcement

The default server-owned execution profile uses `vichaar_test_reader` and exactly `public.customers`, `public.products`, `public.orders`, and `public.order_items`. A trusted server integrator can configure `requiredRole`/`allowedTables` through adapter constructor options; analytics requests cannot override them. The standalone planner validator permits structurally safe public-schema references, but execution uses the adapter's exact physical-table allowlist.

On connection, schema discovery and **every execution**, the same pool client verifies:

- Session/effective role equals the configured reader; no elevated attributes or memberships.
- No effective database CREATE/TEMP, schema CREATE/ownership, business table ownership/writes (including column-level grants), or sequence USAGE/UPDATE.
- Every allowed table exists, is SELECT-accessible, and is a plain base table without RLS, partitioning/inheritance, views, foreign tables or custom column types. Only the supported built-in scalar column types are accepted.

PostgreSQL grants PUBLIC update access to its built-in `pg_settings` view; this existing fixture permission is excluded from the role's table-write audit. Analytics SQL cannot reference it or any system schema. Settings defaults remain overridable and are not treated as the write-protection boundary.

Execution retains `BEGIN READ ONLY`, per-statement timeout (default 5s, bounds 1–15s), lock timeout (1s), rollback and an outer row cap (default 500, bounds 1–1,000). Search path is transaction-locally pinned to `pg_catalog, pg_temp`; physical relations and ordinary functions/casts are explicitly qualified. Failed rollback destroys the pool client and cannot return a successful result. Returned server errors retain only a sanitized code; frontend errors never include raw PostgreSQL diagnostics or credentials.

The operator must trust the database administrator and built-in catalog. This is a constrained prototype, not a hostile multi-tenant PostgreSQL sandbox: race-free protection against an administrator changing grants/schema/catalog concurrently is not guaranteed. It is not a resource quota for result bytes, aggregate memory or total request duration. Unknown/unapproved metrics/functions may require a simpler draft. Current account-level settings, database ACLs and adapter enforcement are independent layers.

## Verification

`npm test` runs validator, mocked adapter and Fastify endpoint regression tests without external calls. `npm run test-db:safety` tests only the existing, ownership-checked Phase 5A fixture: real CTE/union/analytics execution, dedicated-reader acceptance/admin rejection, all forbidden query categories, statement/lock timeouts, row caps, rollback/recovery and actual endpoint contracts. It compares fixture and metadata logical fingerprints. The known local fixture admin performs the read-only in-memory `pg_dump` fingerprint because the reader's function restrictions intentionally prevent pg_dump's `set_config` call; its grants are not relaxed. It never starts/reseeds the fixture or changes data/permissions. A brief exclusive lock for the lock-timeout probe is always rolled back; run it while other fixture users are idle. No planner/model calls occur.
