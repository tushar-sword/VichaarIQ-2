# VichaarIQ presentation guide

This guide covers the current prototype. The four starter scenarios now work completely offline; PostgreSQL is optional for the synthetic demo. Use only the existing disposable fixture for real database testing. The metadata database is not required.

## Emergency presentation path — start here

1. Open **http://localhost:3000/ask** in demo mode. If connected, use **Data Sources → Disconnect and return to demo** first.
2. Click any of the four visible starter cards: **Monthly revenue for 2025**, **Top 5 products by revenue in 2025**, **Orders by status in 2025**, or **Sales by region in 2025**.
3. Click **Analyze question**, then the prominent **View Dashboard** button above the question form.
4. The dashboard shows that exact scenario's chart and rows: line / bar / bar / bar. All are labelled **DEMO / SYNTHETIC DATA**. Return to Ask and repeat with another starter.
5. This path needs **no API, PostgreSQL connection, OpenAI key, or paid calls**. Unknown questions are rejected locally with an explanation; they are never mapped silently to unrelated sample rows. The displayed local plan and SQL are illustrative, not AI-generated or executed.

Quick fresh startup from the repository root (do not start another server if port 3000 already serves this build):

```bash
npm run dev
```

For frontend-only offline startup after workspace dependencies have been built: `npm run dev -w @vichaar/web`. The production startup below remains available and is what the audit leaves running.

To check the existing e-commerce database without modifying it, run **`npm run test-db`**. This is a read-only status alias. In **/data-sources**, paste the reader URL from `tests/postgres/local.env.example` into the masked field, click **Connect PostgreSQL**, and verify the four discovered tables. The exact local-development-only URL is shown in section A. Connecting switches away from synthetic results; real analysis requires AI and successful read-only execution before a result-navigation button appears.

**Emergency verification completed:** frontend typecheck and production build passed; all 62 frontend tests and all 177 repository tests passed. Real Chrome clicked all four starter questions at both 1440px and 390px, analyzed them, followed View Dashboard, verified exact fixture rows/chart types, toggled Chart/Table/KPI, and returned to Ask. All 38 document-width checks passed, including oversized SQL/tags/table cells. Offline flows made zero API requests. Unsupported questions cleared results; real connection readiness, blocked-analysis error handling and return-to-demo passed without paid calls. The existing database was healthy with 1,440 orders; no data/volumes or metadata database were changed.

If your browser was open before this update, **hard-refresh /ask (Cmd+Shift+R)** to load the new build. A reload starts in demo mode; no credentials are persisted.

## A. Start and rehearse

Prerequisites: Node.js 22+, installed npm dependencies, Docker Desktop running, and the existing private root `.env`. Do not overwrite `.env`, print the OpenAI key, or paste credentials into schema context. On a clean source checkout, run `npm ci` once before these commands.

### Recommended: production frontend with the existing API

First stop **this project's** existing frontend/API terminals with Ctrl+C. Do not run a production build while Next.js development mode is running: they share `.next` output. Do not run workspace builds/tests during the presentation; rebuilding shared packages can restart the development API and invalidate connection IDs.

If the audited servers are already running and healthy, reuse them instead of starting another pair. The audit leaves the normal API on port 4000 and the built frontend on port 3000.

Preparation terminal, from the repository root:

```bash
cd /Users/tushar_sword/Downloads/vichaar-iq-phase2-agent-prototype
npm run test-db:up
npm run test-db:verify
npm run build
```

`test-db:up` starts/reuses only the guarded `vichaar-iq-ecommerce-test` project and its existing fixture volume. It does not reset/reseed an initialized database. If ownership or metadata checks fail, investigate rather than deleting resources or replacing the baseline.

API terminal:

```bash
cd /Users/tushar_sword/Downloads/vichaar-iq-phase2-agent-prototype/services/api
node dist/server.js
```

Frontend terminal:

```bash
cd /Users/tushar_sword/Downloads/vichaar-iq-phase2-agent-prototype
npm exec -w @vichaar/web -- next start --hostname 127.0.0.1 --port 3000
```

Open **http://localhost:3000/dashboard**. Use `localhost` in the browser to match the default API CORS origin. API health: http://127.0.0.1:4000/health. The fixture listens only on `127.0.0.1:5544`.

Alternative development startup, after stopping the production servers:

```bash
cd /Users/tushar_sword/Downloads/vichaar-iq-phase2-agent-prototype
npm run test-db:up
npm run dev
```

The root development command builds workspace dependencies in order and starts both frontend and API. Leave its terminal open. Neither startup command itself makes an OpenAI request.

### Connect before presenting

Open **Data Sources** and enter the following **local-development-only sample credential** in the masked connection field:

```text
postgresql://vichaar_test_reader:local_test_reader_only@127.0.0.1:5544/vichaar_ecommerce_test
```

Do not use the fixture admin for analytics. A successful connection hides the credential field and discovers `public.customers`, `public.products`, `public.orders`, and `public.order_items`. The dashboard must say **Connected — run an analysis**, with no sample results. Connecting alone does not query business data for display.

Use the discovered schema. Do not replace it with the disconnected demo schema. PostgreSQL is the only execution adapter; the other database choices are planning-only.

### Cost-free verification commands

Run these while presentation servers are stopped, then start the servers above:

```bash
npm run typecheck
npm test
npm run build
npm run test-db:verify
npm run test-db:safety
```

These commands do not call OpenAI. The safety check briefly takes an exclusive fixture lock to verify lock timeout, then rolls it back; run it while other fixture users are idle. It checks fixture and metadata fingerprints. Do not use `purge`, `down -v`, volume removal, or global Docker cleanup for presentation recovery.

## B. Five-minute presentation script

| Time | What to say and show |
| --- | --- |
| 0:00–0:30 | **Problem:** Business users often need SQL expertise or an analyst to answer everyday questions. VichaarIQ translates a business question into a reviewable analysis and visualization. |
| 0:30–1:00 | **Product:** Show Dashboard, Ask VichaarIQ, and Data Sources. Identify whether the screen is labelled demo or connected. Explain that the fixture contains synthetic business records, even when queries execute against real PostgreSQL. |
| 1:00–1:40 | **Architecture:** Next.js/React frontend → Fastify API → two OpenAI stages for planning and SQL drafting → PostgreSQL AST validation → dedicated read-only adapter → Recharts/table. Shared schemas validate API contracts; shared React state preserves navigation context. |
| 1:40–2:15 | **AI planning:** Show the goal, measure, grouping, filters, time range and SQL draft. A clarification pauses drafting/execution. Credentials are excluded from the planner request. A model-generated draft is untrusted. |
| 2:15–2:50 | **SQL safety:** Explain one-statement AST checks, explicit function/table policy, dedicated reader permissions, read-only transactions, timeouts, rollback and row limits. Rejected SQL is a visible failure, never a reason to loosen validation. |
| 2:50–4:20 | **Demonstration:** Prefer the short order-status question below. When successful, open View dashboard, show the five returned groups, switch Chart/Table and explain why grouped results receive row/column summaries rather than invented KPI totals. If planning fails or stalls, explain the failure and switch explicitly to labelled demo mode. |
| 4:20–5:00 | **Visualization and scope:** Show the labelled demo's chart-type switch and scalar KPI cards if desired. Close with future work: additional database execution adapters, stronger deployment/authentication and broader evaluated SQL support. State the current prototype limits plainly. |

Prepare the question before speaking. A normal unambiguous analysis uses two model requests (planner and drafter); clarification can use one. Network/model latency and exact outputs vary. Do not repeatedly press Analyze to recover. The audit's request cap/retry settings belonged to its isolated test harness, not the standard application.

## C. Three fixture-specific questions

Use **calendar 2025**, not “this quarter” or “last six months”: the fixture spans January–December 2025. Questions below define stable business intent, not deterministic model wording.

1. **Order statuses — shortest presentation path**

   > Count orders by status in calendar year 2025 using orders.created_at. Include every status. Return status and order_count, sorted by order_count descending then status.

   Expected database result: completed **720**; cancelled, pending, refunded and shipped **180 each**; total **1,440**. Five groups support a bar chart. These counts were verified through actual PostgreSQL/API execution.

2. **Monthly merchandise revenue**

   > Show monthly merchandise revenue for completed orders in calendar year 2025. Sum order_items.line_total, excluding shipping. Join orders.id to order_items.order_id, group by orders.created_at month, return month as YYYY-MM and revenue, and sort chronologically.

   Expected database result: 12 months, from `2025-01` to `2025-12`, with annual merchandise revenue **5,512,232.50**. January is **499,110.00** and December **379,772.50**. Use a line chart; do not add grouped values into UI KPI cards. Currency is not specified by the fixture, so do not invent a currency symbol.

3. **Top five products**

   > Show the top 5 products by merchandise revenue from completed orders in calendar year 2025. Sum order_items.line_total, excluding shipping. Join products.id to order_items.product_id and orders.id to order_items.order_id. Return product_name and revenue, sorted by revenue descending then product_name.

   Expected order: Mechanical Keyboard, Lightweight Jacket, Wireless Headphones, USB-C Hub, Wireless Mouse. Mechanical Keyboard revenue is **690,177.75**. A bar chart is appropriate.

Additional verified database comparison: completed merchandise revenue by `orders.region` gives five regions, each **1,102,446.50**. Equal values are a property of the deterministic seed, not a chart bug. Monthly and regional totals reconcile to **5,512,232.50**. Merchandise revenue excludes shipping; `orders.total_amount` includes shipping and should not be compared as the same metric.

The database/reference-query checks passing does **not** mean every generated draft for these questions has passed a live model test. See the final audit status below.

## D. Recovery and fallback

| Problem | Safe recovery |
| --- | --- |
| Port already in use | Run `lsof -nP -iTCP:3000 -sTCP:LISTEN` (or 4000/5544) to identify the owner. Stop only your known presentation terminal with Ctrl+C. Do not kill unfamiliar processes or remove unrelated containers. Use one frontend/API pair. |
| API unavailable | Check `curl -fsS http://127.0.0.1:4000/health`. Start the API from `services/api` as above. Use browser origin `http://localhost:3000`. `NEXT_PUBLIC_API_URL` is compiled into the frontend and defaults to `http://127.0.0.1:4000`; changing it requires a stopped frontend and rebuild. Do not put secrets in this public setting. |
| PostgreSQL disconnected | Run `npm run test-db:status`, then `npm run test-db:up` if necessary. Check Docker Desktop. Reconnect with the dedicated reader URL; schema discovery should list four tables. After any API restart, reconnect: connection IDs live only in memory. |
| OpenAI request failure | Do not display a fake plan or fake live results. Check configuration privately, model access, billing/network and API logs. Avoid repeated paid retries during the talk. Use labelled demo mode immediately. A configured key alone does not prove access or response reliability. |
| Empty results | An empty result is a successful query, not demo data. Check 2025 dates, filters and status values. Use `>= '2025-01-01'` and `< '2026-01-01'` for the year; the current calendar period has no fixture orders. |
| Invalid generated SQL | Read the displayed validation reason. Simplify the question to the supported subset in `packages/validation/SQL_POLICY.md`. Do not bypass validation, switch to admin credentials, or execute a rejected draft manually. The frontend has no manual SQL editor. |
| Connection limit reached | Disconnect active connections through Data Sources. If stale IDs remain after repeated reloads, restart only the API, then reconnect. This clears its in-memory pools/IDs without changing database data. |
| Dashboard errors after a build | Stop the known frontend process and restart it using a matching mode: `next start` after `npm run build`, or `npm run dev`. Do not run dev and build against the same `.next` directory concurrently. |

### Reliable fallback without OpenAI

1. Open **Data Sources → Disconnect and return to demo**.
2. Open **Dashboard**. Confirm **Demo · sample data**, the sample-workspace banner, sample metrics and sample table labels.
3. Demonstrate Chart, Table, KPI and chart-type controls. These render from existing fixed synthetic rows without any API/model request.
4. Open Ask, select one of the four 2025 starter scenarios and press **Analyze question**. This runs entirely offline, then **View Dashboard** opens its matching synthetic result. Arbitrary questions are not supported offline. Illustrative SQL is never executed.
5. If the API cannot confirm disconnection, the UI still returns to labelled demo and displays a warning. A full page reload also starts in demo, but may leave an old backend connection until API restart; prefer explicit disconnect.

Never call synthetic preview rows “live PostgreSQL results,” never replay a saved AI response as a fresh model call, and never present an old result as belonging to a new question. The fixture itself is synthetic; “real database” means its SQL actually executed, not that it contains production customer records.

## E. Implemented and planned

| Implemented now | Planned / not implemented |
| --- | --- |
| `/dashboard`, `/ask`, `/data-sources`, shared navigation/state and responsive layouts | Additional dashboards, saved reports and durable query/history storage |
| OpenAI analysis planning, SQL drafting and clarification handling | Guaranteed model correctness or deterministic model outputs |
| Dedicated reader PostgreSQL connection, restricted schema discovery and read-only execution | MongoDB/MySQL/SQLite execution; these choices currently produce planning drafts only |
| Positive SQL AST/function/table policy, timeouts, row caps, rollback and permission checks | A hostile multi-tenant SQL sandbox or complete PostgreSQL syntax support |
| Automatic chart selection, interactive charts, tables, supported scalar KPI cards and grouped-result summaries | General semantic metric inference or arbitrary grouped-result KPI aggregation |
| Clearly labelled static mock preview and actual PostgreSQL result provenance | Fake/pre-recorded AI success responses or automatic mock substitution on database errors |
| Isolated Docker fixture, read-only role tests, schema/data fingerprint safeguards | Production authentication, authorization, tenant isolation, managed credential storage and deployment hardening |

## F. Limits to state accurately

- The SQL policy supports a deliberate subset. Recursive CTEs, window/table functions, custom types and unknown functions are rejected. UNION ordering/limits need an outer SELECT. Some numeric literals require quoted casts. See [the complete policy](packages/validation/SQL_POLICY.md).
- The standard execution profile accepts `vichaar_test_reader` and exactly four approved public tables. It is not a plug-and-play connector for arbitrary databases; other profiles require trusted server configuration.
- The backend trusts its PostgreSQL administrator/catalog. Privileged concurrent schema/grant changes and resource usage beyond statement/lock timeouts and row caps are outside this prototype's guarantees.
- Results default to 500 rows. Truncation is labelled; charts show returned rows, not full-dataset totals. Numeric strings remain exact in tables, while plotting converts them to JavaScript numbers.
- Real KPI cards are conservative single-row returned measures. Multi-row revenue/status results show summaries; identifiers and years are not totalled.
- Frontend state survives client navigation, not a full reload. Credentials are not saved in browser storage. Backend connection IDs are in memory and disappear on API restart; disconnected browser reloads may leave old backend pools until restart.
- Cancelling/editing/disconnecting guards the frontend against stale results. It does not guarantee that an already-started server-side model request stops or avoids its charge.
- Demo values are fixed per supported scenario and selected by an explicit question-to-fixture mapping. The four 2025 starter questions work offline. Arbitrary questions require a real connection and AI; a demo plan never executes SQL.
- The application has no production user authentication/authorization layer. Present locally; do not expose this development API or database publicly.
- Automated checks, browser checks, database execution and paid model checks are separate evidence. A green build does not establish live AI reliability.

## Recovery checkpoint and audit evidence

Before audit edits, the full working source (including pre-existing uncommitted/untracked source files) was archived and SHA-256 verified at:

```text
.recovery-checkpoints/20261014T181754Z/
```

It includes `source.tar.gz`, `source.sha256`, a per-file manifest, git status/base commit, tracked diff and recovery instructions. Secrets, dependencies, generated output and Docker data are excluded. Nothing was committed or stashed. Verify the checksum and extract **only into a new empty directory**; compare files before restoring individual changes. Never overwrite the active workspace wholesale. This is a source checkpoint, not a database backup.

```bash
cd /Users/tushar_sword/Downloads/vichaar-iq-phase2-agent-prototype/.recovery-checkpoints/20261014T181754Z
shasum -a 256 -c source.sha256
VICHAAR_RECOVERY_DIR=$(mktemp -d /tmp/vichaar-recovered.XXXXXX)
tar -xzf source.tar.gz -C "$VICHAAR_RECOVERY_DIR"
```

Detailed local-only screenshots, reference query results, browser reports and the durable paid-request counter are under `.recovery-checkpoints/presentation-audit-20261014T182404Z/`. These are ignored local evidence, not application fixtures or prerecorded product responses. Do not run its paid harness again; the approved audit is bounded and is not the normal startup procedure.

## Earlier stability audit status (before the emergency offline update)

**Recommendation: READY WITH LIMITATIONS.** Use the verified order-status live path and keep labelled mock mode available. No new features, dependencies, schema changes, commits or pushes were introduced.

| Check | Result |
| --- | --- |
| Workspace typechecks | All six workspaces passed after fixes. |
| Full automated suite | **161 passed, 0 failed**: 46 frontend, 7 planner, 4 API, 20 adapter, 76 SQL validator and 8 Docker safety guards. |
| Production build | Passed for packages, API and all frontend routes, including the icon. |
| Fixture verification | Passed dedicated-reader login/schema discovery, dataset integrity and denied writes/DDL/restricted functions. |
| SQL safety | Passed live timeout/lock-timeout/rollback recovery, row caps, unsafe SQL/schema rejection and API error redaction. Fixture and metadata fingerprints unchanged. |
| Real 2025 analyses | Monthly revenue, top products, status counts and regions passed direct API/PostgreSQL checks. Monthly and regional totals reconcile. |
| Chrome browser | Final live run passed **21 checks** on the built application: desktop/mobile layouts, navigation, demo controls, real connection/schema/credential handling, connected-empty state, offline errors, failed connection and demo recovery. No uncaught exceptions or unexpected console errors. Screenshots were inspected. Deliberately blocked requests/invalid-login tests generated expected network errors. |
| Restored normal servers | API health 200; `/` redirects 307 to `/dashboard`; Dashboard/Ask/Data Sources/icon return 200. A further **18 browser checks** passed with paid calls disabled against the normal API and built frontend. |
| Paid AI integration | **6 model requests total**, retries/tracing disabled in the audit harness. Final post-fix status question passed planner → SQL validator → PostgreSQL → dashboard, with exact chart/table agreement against reference results. |

Initial live tests exposed a rejected monthly draft and planner contract failures. A captured planner response used filter objects where string arrays are required. The prompt now states the exact types, and local regressions cover valid/invalid filter shapes and a single enclosing JSON/SQL Markdown wrapper. Wrappers are removed only as formatting; SQL still goes through the unchanged AST policy. Monthly and top-products **AI** paths were not re-tested successfully after these fixes within the six-call budget. Their underlying SQL/data checks passed; do not claim all three questions passed fresh live AI tests.

Other fixes: show controlled validator reasons rather than hiding them; provide readable API-unavailable/non-JSON errors without exposing database diagnostics; restore the missing icon. Ten regression tests were added across frontend/planner tests.

Empty-query success and truncation were verified at API/adapter level and their frontend rendering was inspected/tested separately; they were not driven through additional paid browser analyses. There was no Safari/Firefox testing or assistive-technology audit. Model output remains nondeterministic; use the fallback if a fresh generated draft is invalid.

Audit source changes are limited to `.gitignore`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/app/icon.svg`, `packages/agents/src/index.ts`, `packages/agents/src/index.test.ts`, and this guide. All other pre-audit source hashes match the recovery manifest. Generated build output was refreshed by checks. Existing environment secrets and database volumes were not edited.
