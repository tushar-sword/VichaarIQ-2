# VichaarIQ — Phase 2: Agent prototype

## What is included
- Two AI steps: a planner creates a structured analysis plan; a query-draft agent writes a SQL or MongoDB draft.
- A responsive, Apple-inspired UI: whitespace, restrained colors, rounded panels, clean typography.
- Fastify endpoint: `POST /api/analytics/plan`.

PostgreSQL connections and validated read-only execution are now implemented. Without a connection, the dashboard displays explicitly labelled sample rows; demo planning never executes its draft. MySQL, SQLite, and MongoDB remain planning-only.

## Requirements
Node.js 22+, npm 10+. An OpenAI API key is needed only for connected AI analysis; the four synthetic 2025 starter demos work offline without it. Docker Desktop is optional for the PostgreSQL fixture.

## Start
```bash
npm install
cp .env.example .env
# Add your key to OPENAI_API_KEY in .env
npm run dev
```
UI: http://localhost:3000
API health: http://127.0.0.1:4000/health

The UI now has three workspaces: `/dashboard` for charts, returned metrics, and tables; `/ask` for questions and analysis plans; and `/data-sources` for PostgreSQL connections and editable schema context. `/` redirects to `/dashboard`. Navigation preserves workspace state. On mobile, the sidebar becomes a compact navigation bar.

To preview only the frontend, run `npm run dev -w @vichaar/web` after `npm run build:packages`. On `/ask`, select one of the four 2025 starter questions, click Analyze question, then View Dashboard. Monthly revenue, top products, order status and regional sales each use matching, clearly labelled synthetic rows and never call OpenAI or PostgreSQL. Unsupported offline questions show an explanation instead of unrelated data. Connect calls the API; Analyze uses the real AI/query path only when PostgreSQL is connected. Real KPI cards display supported single-row measures as returned; grouped or ambiguous results show row/column summaries rather than invented totals. See [the presentation guide](PRESENTATION_GUIDE.md) for immediate startup and connection steps.

The frontend uses `NEXT_PUBLIC_API_URL`, falling back to `http://127.0.0.1:4000`. Export it before running the workspace commands, or set it in `apps/web/.env.local` (Next.js does not load the API's root `.env`). It is a public API address, not a place for credentials, and must be set before a production build when using another API host. Existing deployments also need a matching API `WEB_ORIGIN`.

`npm run typecheck`, `npm test`, and `npm run build` prepare their package dependencies before checking, testing, or building. The frontend typecheck generates Next.js route types first. Shared workspace state persists during client navigation; full browser reloads still start in demo mode.

## Optional Docker metadata database

For a separate business dataset for integration testing, see [the disposable PostgreSQL fixture](tests/postgres/README.md). Run `npm run test-db:up` and `npm run test-db:verify`. It binds to loopback port 5544 and never uses the metadata database or its volume. These commands do not call OpenAI.

Phase 5B hardens query execution with an AST/function allowlist, the dedicated reader, explicit business-table access, and runtime permission checks. See [the supported SQL policy](packages/validation/SQL_POLICY.md). Run `npm run test-db:safety` against the existing fixture for real CTE/UNION, endpoint, timeout, row-limit and rollback checks; it does not reseed data or call OpenAI. Reconnect in Data Sources after restarting the API, using the fixture reader URL rather than its admin account.

Phase 5C adds schema-enforced AI plans, authoritative connected schema metadata, and prompts aligned with the SQL policy and business/date semantics. See [AI query compatibility](AI_QUERY_COMPATIBILITY.md) for evidence from the previous audit and remaining limitations. Run `npm run test-db:ai` to verify mocked AI responses through the real frontend store/API/validator/PostgreSQL pipeline against the existing fixture, without OpenAI calls or reseeding.
```bash
docker compose up -d app-postgres
docker compose ps
docker compose logs -f app-postgres
docker compose stop app-postgres
```
The `vichaar_iq_pgdata` volume preserves data. Avoid `docker compose down -v` unless you intend to delete that volume.

## Folder map
- `apps/web`: Next.js UI.
- `services/api`: Fastify API.
- `packages/agents`: planner and query-draft agents.
- `packages/shared`: shared Zod request/response schemas.
- `packages/database`: PostgreSQL connection, schema discovery, and read-only execution.
- `packages/validation`: deterministic PostgreSQL SQL validation.

## Test endpoint
```bash
curl -X POST http://127.0.0.1:4000/api/analytics/plan \
  -H 'Content-Type: application/json' \
  -d '{"question":"Show monthly revenue by region for the last 6 months","databaseKind":"postgres","schemaContext":"orders(id, region, total_amount, created_at)"}'
```

Never expose the OpenAI key in frontend code. Execution requires the dedicated read-only role and approved tables, with AST/function allowlists, runtime permission checks, read-only transactions, timeouts, and row limits. See the SQL policy above for supported syntax and prototype limitations.
