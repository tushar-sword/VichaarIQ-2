# AI-to-PostgreSQL compatibility — Phase 5C

The connected path accepts free-form questions over the approved discovered schema. It does not map questions to the offline demo fixtures. AI output remains untrusted: a valid plan is not proof that its SQL is correct or safe.

Task 2 follow-up: the approved [controlled live evaluation](AI_LIVE_EVALUATION.md) passed 3/4 scenarios. All four plans/queries passed contract, safety and execution checks; regional order counts failed business semantics because the planner invented a status filter. That report includes the eight-call cost, evidence and proposed minimal fix. Results below describe Task 1 unless explicitly stated otherwise.

Task 3 implements the focused count-semantics correction and the consistency checks described below. Its separately approved [regional-count re-evaluation](AI_LIVE_EVALUATION.md#task-3--approved-regional-count-re-evaluation) passed **1/1**, returning all 1,440 orders (288 per region) with two model calls. The original Task 2 four-question result remains 3/4; those other questions were not rerun live after the correction.

## Findings from the previous presentation audit

Evidence is retained locally under `.recovery-checkpoints/presentation-audit-20261014T182404Z/` (ignored, not required to run the project).

| Observation | What the evidence establishes |
| --- | --- |
| Monthly revenue returned HTTP 422 in `browser-report-initial.json` | SQL validation rejected the draft. The SQL and detailed validator reason were not captured. Its exact cause cannot be established retrospectively. |
| Top products returned HTTP 502 in `browser-report-before-planner-fix.json` | Planning failed. No model output or specific internal cause was captured for that request. |
| Status planning failed in `planning-failure.json` / `model-output-4.json` | The model emitted filter objects (`field/operator/value`), whereas the shared contract requires `string[]`. This is a confirmed output-contract failure, not a database credential error. |
| Later outputs and `actual-ai-status.json` | Explicit filter instructions produced a valid plan. A single enclosing SQL Markdown fence was removed before validation, and the final status analysis executed successfully. Fence support already existed before Phase 5C. |

Code inspection also found missing guidance about supported functions/constructs, insufficient relationship/business metadata, and literal escaped newlines in the old prompts. Those were reliability gaps; they do not prove what caused the uncaptured monthly/top-product outputs. Task 1 made no paid model calls and did not measure a live-model success rate. The subsequent Task 2 run is reported separately above.

## Current pipeline and contracts

1. A connected frontend sends its existing planning request plus an optional `connectionId`. The server refreshes schema metadata from that connection and ignores replacement browser schema text. Missing/closed connections fail before model use. Older schema-only planning requests remain supported, but confer no execution privileges.
2. Discovery includes approved columns/types, generated expressions, column descriptions, primary/foreign-key and CHECK constraints, and the UTC execution timezone. It sends no business rows or connection credentials. Oversized context is rejected rather than silently cut off. Operators must not place secrets in database metadata/comments.
3. The planner uses SDK structured output with the existing Zod plan schema. Filters/dimensions are strings; invalid output fails. Both agents receive JSON-delimited context, the same UTC date, and instructions to treat metadata/question text as data. Connection IDs and connection strings are omitted from model input.
4. Clarification returns immediately, with no query drafter or execution. Otherwise a separate writer drafts SQL using the plan and discovered schema. One enclosing Markdown fence can be removed for compatibility; embedded prose and invalid SQL are never repaired or extracted into executable statements.
5. The API validates against the connected adapter's exact table policy. The execution endpoint validates again, and the adapter retains its independent permission checks, `BEGIN READ ONLY`, UTC/search-path settings, timeouts, rollback and row cap. There is no automatic query-repair loop. `maxTurns: 1` bounds each agent run; it is not a guarantee against provider-level HTTP retries.
6. The store clears previous results before starting, publishes real provenance only after successful execution, and preserves cancellation/source-generation guards. Empty successful queries stay empty. Planning/execution errors never substitute demo rows. Known database error codes receive useful fixed messages without raw SQL diagnostics or credentials.

## Dates and business semantics

- Explicit calendar 2025 means `created_at >= '2025-01-01'::date AND created_at < '2026-01-01'::date` in UTC. Relative dates use the supplied current UTC date; the fixed 2025 fixture must not cause silent date substitutions.
- The fixture's `order_items.line_total` is generated as `quantity * unit_price - discount_amount`. Summing it already applies discounts. Product revenue uses historical item values, not current `products.price`.
- `orders.total_amount` includes discounted merchandise **plus shipping**. Its documented definition excludes cancelled/refunded orders from recognized revenue. The deterministic tests explicitly select **completed** orders and distinguish merchandise revenue from order value. There is no invented default that shipped/pending orders count as recognized revenue.
- Order totals/counts must not be multiplied by item joins. Use the proper grain, pre-aggregation, or distinct order counts. Product rankings group by product identity as well as name.
- Missing revenue definitions, status rules, relationships, allocation rules or materially ambiguous periods should produce clarification. Metadata cannot establish every business meaning; an analyst must still review the plan and SQL.

## Task 3 — Count semantics and lightweight consistency checks

Both agents now receive explicit shared rules:

- Order counts across **any grouping** include every status unless the question explicitly restricts statuses. Revenue-recognition exclusions do not automatically apply to counts.
- Do not invent filters unless requested or justified by an explicitly applicable business definition. A revenue definition does not justify filtering an order count.
- Preserve completed-only requests. Merchandise revenue, shipping, discounts and order counts are distinct measures. Discounted generated line totals must not be discounted twice.
- List intended row restrictions in the plan, preferably as PostgreSQL boolean-expression strings. The writer must not add, remove or change those restrictions.

`packages/agents/src/semantics.ts` adds deterministic checks for recognizable English PostgreSQL **order-count** questions. It makes no model requests and contains no fixture counts or hardcoded status lists:

1. Before drafting, inspect plan status predicates against status values explicitly mentioned in the question. Discovered `orders` status CHECK metadata helps detect omitted requested restrictions. An unrequested restriction such as the exact failed live `status IN ('completed','pending','shipped')` triggers clarification **before** the writer runs.
2. After drafting, first use the existing SQL validator for safe parsing/normalization for inspection only. Invalid/unsupported SQL retains the API's existing validation-error path. Inspect AST predicates, including status restrictions inside CTEs, subqueries, aggregate FILTER and CASE expressions. Status projections/GROUP BY and comments are not treated as row filters.
3. For a simple SELECT over one physical `orders` table, when all plan filters are parseable SQL expressions, compare the plan's AND-conjoined predicates with the draft's WHERE predicates. Ignore the single table's alias and conjunct ordering; recognize literal UTC-midnight date spellings and equivalent positive status membership. Detect added, removed or changed predicates. Conditional aggregate counts in this simple shape require clarification. Queries with HAVING, multiple tables, CTE/derived-table lineage or subqueries are outside the generic filter comparison.
4. A detected conflict returns the existing response contract with `needsClarification: true`, an explanatory question, and an **empty query draft**. No query is rewritten or executed. The frontend's existing clarification handling clears stale results and skips execution; real data never falls back to demo rows.

This is a narrow consistency guard, **not general natural-language semantic verification**. English recognition, exact status words and discoverable CHECK metadata limit coverage. Synonyms, mixed count/revenue questions, arbitrary business definitions, joins/CTE lineage, prose filters and non-status aggregate correctness are not fully verified. Unsupported or ambiguous status expressions can produce conservative clarification, including valid negative-status questions. The status scan cannot always distinguish identically named columns in complex scopes. Free-text non-status plan filters are not compared as SQL. Equivalent SQL formulations beyond the small canonicalization subset may also prompt clarification. Questions outside this scope still rely on explicit agent instructions, normal SQL safety checks and analyst review; successful execution is not proof of meaning.

SQL validation and database permissions remain independent and unchanged. The raw SQL execution endpoint has no question/plan intent contract and continues enforcing read-only safety, not business semantics. The agents reuse the already-installed `pgsql-ast-parser` version as an explicit dependency; no new parser or database engine was introduced.

Task 3 regression coverage includes: all 1,440 orders grouped by region (288 each); every status in status counts; completed-only regional counts (720 total, 144 each); completed discounted merchandise revenue excluding shipping; the exact captured planner failure; writer-added status/region predicates; changed/removed plan filters; nested status restrictions; and clarification with no execution or stale results. Numeric fixture expectations exist only in tests.

## Supported SQL and restrictions

The definitive implementation policy is [SQL_POLICY.md](packages/validation/SQL_POLICY.md). Prompt function/type lists are imported directly from the validator, rather than maintained separately.

Supported examples include ordinary SELECT, JOIN, aggregates, GROUP BY/HAVING, ORDER BY, CASE, subqueries, non-recursive CTEs, and UNION/UNION ALL. Combined UNION ordering/limits require an outer SELECT. Date grouping can use `to_char(created_at, 'YYYY-MM')` or `date_trunc`. Ordinary functions must be on the positive allowlist (including `sum`, `count`, `avg`, `date_trunc`, `to_char`); calls/casts are pinned to built-ins.

Writes, multiple statements, locking, recursive/modifying CTEs, window functions, table functions such as `generate_series`, arrays, custom/extension functions, unapproved schemas/tables, unsupported parser nodes and lossy numeric literals remain rejected. No validator rule was relaxed for model compatibility.

The default execution profile still requires `vichaar_test_reader` and exactly the four approved `public` business tables. Arbitrary questions over those tables are supported; arbitrary customer database onboarding is **not** implemented. Other database choices remain planning-only. Views, RLS, inheritance/partitioning and custom column types remain unsupported by the adapter.

## Repeatable verification — no OpenAI calls

```bash
npm run typecheck
npm test
npm run build
# Existing healthy fixture only; none of these commands recreate or reseed it:
npm run test-db:verify
npm run test-db:safety
npm run test-db:ai
```

`test-db:ai` builds local packages/API, verifies Docker ownership and loopback binding, and runs the real frontend API client/store → Fastify → planner/writer → validator → PostgreSQL → visualization selection. Only SDK AI responses and the HTTP transport into Fastify are mocked. External fetches are refused and tracing is disabled. The fixture reader comes from the local-development example; no environment-supplied database target is accepted. Before/after fixture and metadata fingerprints must match.

The original 15 deterministic integration cases cover monthly 2025 merchandise revenue (12 rows; total 5,512,232.50 INR), top-five products, all order statuses (1,440 orders), five regions, an additional CTE average-order question, authoritative schema refresh, empty real results, five invalid/unsupported drafts, sanitized execution failure with stale rows cleared, clarification without execution, and invalid plan shape. Task 3 expands the suite to **22 cases**, adding the count/revenue and semantic-conflict regressions above. Normal workspace tests also preserve the four labelled offline scenarios and cancellation protections. SQL safety checks separately exercise actual row caps, statement/lock timeouts and read-only restrictions.

These tests prove the plumbing executes known compatible AI outputs correctly. They do **not** prove that a live model will always produce the right plan or query. Live evaluation requires separate approval for paid calls. SQL safety is not semantic validation: valid SQL can still express a wrong business interpretation, use a hallucinated column (caught by PostgreSQL), or require clarification. Charts are inferred from returned data and may need manual chart selection; grouped multi-column results do not invent KPI totals. In-memory connections/results are lost on API restart/browser refresh. The prototype is not a hostile multi-tenant database sandbox or a quota on aggregate memory/result bytes.

## Verified results for Task 1

| Check | Result |
| --- | --- |
| All six workspace typechecks and standalone fixture-test TypeScript | Passed |
| `npm test` | 187 passed: 62 frontend, 8 API, 11 agents, 22 adapter, 76 validator, 8 fixture-guard tests |
| `npm run build` | Passed; API/packages compiled and all Next.js routes generated |
| `npm run test-db:verify` | Passed; reader SELECT, dataset integrity, denied writes/DDL/restricted functions, row cap |
| `npm run test-db:safety` | Passed; real SQL subset/endpoint tests, reader/admin distinction, statement and lock timeouts, rollback recovery |
| `npm run test-db:ai` | 15 integration cases passed against real PostgreSQL with mocked AI |
| Headless Chrome regression | Four offline scenarios at 1440px and 390px; matching charts/tables and navigation state; unsupported question rejection; no page overflow; real reader connect/disconnect; blocked planning request shows no stale results |
| API health and `/`, `/dashboard`, `/ask`, `/data-sources` | HTTP 200 after redirect where applicable |
| Database preservation | Fixture and metadata logical fingerprints unchanged; no schema, data, grants or volume changes |
| Paid AI evaluation | Not run; zero model requests initiated by this audit |

Browser evidence is retained locally in `.recovery-checkpoints/phase5c-20261015/`. The browser regression deliberately blocks analytics requests before network access; real successful AI-to-database execution is covered by the separate mocked-AI integration suite, not claimed as a live-model browser test.

## Verified results for Task 3

- `npm run typecheck`: passed all six workspaces and the standalone fixture-test TypeScript configuration.
- `npm test`: **209 passed** (62 frontend, 8 API, 33 agents, 22 database, 76 validator, 8 fixture-guard tests).
- `npm run build`: passed production API/package compilation and Next.js generation.
- `npm run test-db:verify`, `npm run test-db:safety`: passed against the existing fixture, including reader restrictions, row caps, statement/lock timeouts and rollback recovery.
- `npm run test-db:ai`: **22 passed**, including all-count and completed-only regional analytics, revenue semantics, planner-conflict clarification and writer-added-filter blocking.
- Fixture and metadata logical fingerprints remained unchanged during implementation checks. No paid calls were made during implementation; no commits, pushes or database/schema changes occurred.
- The no-cost rehearsal passed, followed by a separately approved live regional-count evaluation: **1/1 passed**, **2 requests**, 3,923 input / 176 output tokens, estimated **$0.0018508** within the $0.03 cap. The plan added no status filter, actual rows matched 288 per region, and chart selection recommended bar. The live run's fixture fingerprint also remained unchanged. No automatic retries or repair calls occurred; Task 2's spent approval was not reused. See the linked live report for evidence and remaining limits.

Task 3 modifies only `packages/agents/src/prompts.ts`, `index.ts`, `index.test.ts`, adds `semantics.ts` / `semantics.test.ts`, declares the existing parser in `packages/agents/package.json` / root `package-lock.json`, extends `tests/postgres/ai-pipeline.test.ts`, and updates this document. Other existing uncommitted changes are preserved. Evaluation preparation lives under the ignored `.recovery-checkpoints/phase5c-task3/` directory.

## Files changed in Phase 5C

Existing uncommitted changes from earlier phases were preserved. Phase 5C edits/additions are:

- `packages/agents/src/index.ts`, `prompts.ts`, `index.test.ts`, and `packages/agents/package.json`: structured planning, shared policy prompts and regressions; only an existing internal workspace dependency was added.
- `packages/database/src/index.ts`, `index.test.ts`: richer restricted schema metadata, explicit UTC transactions and regression checks.
- `packages/shared/src/index.ts`: backward-compatible optional planning connection ID.
- `services/api/src/app.ts`, `app.test.ts`: authoritative schema refresh, connected validation and controlled execution/planning errors.
- `apps/web/src/lib/api.ts`, `workspace-store.ts`, `workspace-store.test.ts`, and `apps/web/src/app/data-sources/page.tsx`: opaque planning connection ID and read-only connected schema display. Offline fixtures and visualization code are unchanged.
- `scripts/test-db.mjs`, `tests/postgres/ai-pipeline.test.ts`, `vitest.ai.config.mts`, `tsconfig.ai.json`, and `tests/postgres/README.md`: guarded no-paid-call fixture integration suite and usage.
- Root `package.json`, `package-lock.json`, `README.md`, and `AI_QUERY_COMPATIBILITY.md`: integration/typecheck commands, internal dependency metadata and documentation.

The SQL validator, SQL policy, initialization scripts, dataset, database adapter execution limits, Docker configuration and environment secrets were not changed in Phase 5C.
