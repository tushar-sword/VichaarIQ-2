# Disposable PostgreSQL business dataset

This local-development-only fixture uses **its own PostgreSQL cluster**, Compose project, container, network, database, credentials, and volume. It never initializes or seeds the metadata database in `docker-compose.yml`.

| Resource | Test fixture | Existing metadata |
| --- | --- | --- |
| Compose file | `docker-compose.test.yml` | `docker-compose.yml` (unchanged) |
| Project | `vichaar-iq-ecommerce-test` | Existing application project |
| Container | `vichaar-iq-ecommerce-test-postgres` | `vichaar-iq-app-postgres` |
| Host address | `127.0.0.1:5544` | Existing port 5433 |
| Database | `vichaar_ecommerce_test` | `vichaar_iq` |
| Data volume | `vichaar_iq_ecommerce_test_pgdata` | Existing application metadata volume |

Docker with Compose and Node.js 22+ are required. These npm commands run from the repository root. They select one explicit Compose file/project and use `local.env.example` instead of loading the root `.env`.

## Setup and verification

```bash
npm run test-db:up
npm run test-db:verify
npm run test-db:safety
npm run test-db:status
```

`up` validates isolation, checks for resource/port collisions, captures a read-only metadata fingerprint, and waits for a healthy test service. All fixture commands refuse remote Docker contexts/hosts; only local Unix sockets or local Windows named pipes are accepted. It refuses to stop a process already using port 5544. It reuses an existing correctly labelled test volume; it does not silently reset or reseed it.

`verify` rebuilds the workspace packages without running agents. It authenticates the reader over TCP and checks:

- Expected row counts, 12 months, five regions/statuses, four categories, and reconciled order/item totals.
- No elevated role attributes, role memberships, schema creation, database creation, or temporary-table privileges.
- SELECT on all four business tables.
- INSERT, UPDATE, DELETE, CREATE TABLE, and CREATE TEMP TABLE fail with SQLSTATE `42501`. Checks explicitly use `BEGIN READ WRITE` so the read-only default cannot mask excessive grants. All probes are rolled back.
- Sleep, advisory-lock, and configuration-changing functions are denied.
- The reader cannot connect to the default `postgres` database.
- The existing `PostgresAdapter` can log in, discover the schema, return a 12-month revenue series, cap raw rows at 500, report truncation, and reject a DELETE draft through SQL validation.
- Metadata container/volume identity, Compose bytes, and a logical schema/data dump fingerprint remain unchanged.

The verifier never logs or saves metadata SQL/data or container environment credentials. It saves only hashes and resource identity in the ignored `.test-db/metadata-baseline.json`. Random `pg_dump` guard tokens are excluded from the logical fingerprint. If metadata is stopped/absent, the script clearly reports that logical data verification is unavailable. Concurrent application writes or legitimate metadata changes can cause a comparison failure; stop the test workflow and review them rather than treating that as proof this fixture changed metadata. Archive the old baseline locally only after reviewing legitimate changes, then run setup again to capture a new baseline.

For initialization problems, inspect only the test service:

```bash
npm run test-db:logs
```

## Connection and permissions

The reader URL is documented in [`local.env.example`](./local.env.example). Paste it into VichaarIQ's **Data Sources** connection form. It is a public sample password for local development, not a production secret. Never use the bootstrap admin for query execution, send a connection string to the AI planner, or copy these passwords into production.

The reader has `CONNECT` on the test database, `USAGE` on `public`, and `SELECT` on exactly the four business tables. It receives no writes, ownership, schema creation, sequences, role membership, superuser, replication, or bypass-RLS grants. Database `CREATE`/`TEMP`, schema access through `PUBLIC`, and default-public execution of selected side-effect functions are revoked. Future admin-created functions are not publicly executable; future tables are not automatically readable. Ordinary aggregates, date functions, and casts remain available.

The role defaults to read-only transactions with five-second statement/idle-transaction limits, a one-second lock limit, and UTC timestamps. These settings are defaults the role can override; the database ACLs are the write-protection boundary. The adapter adds validation, read-only transactions, rollback, timeouts, and row limits independently. This function denylist is practical fixture hardening, not a complete PostgreSQL sandbox.

The service publishes IPv4 loopback only. The Docker network is separate from metadata. Anyone with local machine/Docker access can still use the sample admin account; this fixture must never be deployed on a public server. No OpenAI calls are needed for setup or verification. API/browser end-to-end planning is a separate task.

## Dataset

All records are synthetic and deterministic. Customers use `example.invalid` email addresses.

- 240 customers across North, South, East, West, and Central regions.
- 24 products in Electronics, Home & Living, Apparel, and Books.
- 1,440 orders: 120 per month, January–December **2025**.
- 4,320 order items: three distinct products per order, quantities 1–4, varied prices, and 0/5/10% item discounts.
- Completed, pending, shipped, cancelled, and refunded orders; varied shipping charges.
- Currency is INR. `orders.total_amount` is discounted item totals plus shipping. Exclude cancelled/refunded statuses when interpreting revenue; examples use completed orders only.

Dates are fixed rather than relative to today. Ask about **2025** explicitly; “last six months” may correctly return no rows. Phase 5B supports ordinary non-recursive CTEs and plain UNION/UNION ALL; see [the SQL policy](../../packages/validation/SQL_POLICY.md) for supported syntax/functions and limitations. Execution requires the existing dedicated reader and permits only the four business tables.

`npm run test-db:safety` runs the additional Phase 5B checks without starting or reseeding the fixture: real queries/endpoint contracts, unauthorized role/schema/table rejection, real statement and lock timeouts, row limiting and rollback recovery. It hashes the fixture before/after and preserves the metadata fingerprint. The lock-timeout probe briefly acquires a rollback-only lock using the local fixture admin; run safety checks while other fixture users are idle. No data, role grants, or initialization SQL are changed.

`npm run test-db:ai` runs Phase 5C's deterministic mocked-AI integration suite against this **existing healthy fixture only**. It exercises the actual frontend API client/store, Fastify planning/execution endpoints, schema discovery, validator, reader and chart selection. SDK responses are mocked, tracing disabled, and external HTTP fetches refused; no OpenAI calls occur. Ownership/loopback guards and before/after fixture/metadata fingerprints are required. See [AI query compatibility](../../AI_QUERY_COMPATIBILITY.md) for cases and limitations. This command never starts, recreates or reseeds a database.

```sql
SELECT date_trunc('month', created_at) AS month,
       SUM(total_amount) AS revenue
FROM public.orders
WHERE status = 'completed'
  AND created_at >= TIMESTAMPTZ '2025-01-01 00:00:00+00'
  AND created_at < TIMESTAMPTZ '2026-01-01 00:00:00+00'
GROUP BY date_trunc('month', created_at)
ORDER BY month;

SELECT p.category, SUM(oi.line_total) AS item_revenue
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
JOIN public.products p ON p.id = oi.product_id
WHERE o.status = 'completed'
GROUP BY p.category
ORDER BY item_revenue DESC;
```

## Teardown and deliberate reset

```bash
# Remove only the dedicated test container/network, preserving the test data volume.
npm run test-db:down

# Delete only the dedicated test project and its named data volume.
# This is an intentional reset of synthetic test data, not the metadata database.
npm run test-db:purge

# Recreate and reseed after a deliberate purge.
npm run test-db:up
npm run test-db:verify
```

Ownership labels, known resource names, mount/port bindings, and exclusive volume usage are checked before lifecycle operations. Purge requires an explicit deletion flag, supplied by the clearly named npm command. Initialization scripts run only when the test volume is empty. No global cleanup, unrelated-volume deletion, metadata teardown, or `--remove-orphans` is used. Teardown commands are provided for review; setup/verification do not automatically destroy the fixture.
