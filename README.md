# VichaarIQ — Phase 2: Agent prototype

## What is included
- Two AI steps: a planner creates a structured analysis plan; a query-draft agent writes a SQL or MongoDB draft.
- A responsive, Apple-inspired UI: whitespace, restrained colors, rounded panels, clean typography.
- Fastify endpoint: `POST /api/analytics/plan`.

**Important:** this phase does not connect to or execute queries against customer databases. AI output is untrusted. Query validation and database adapters come later.

## Requirements
Node.js 22+, npm 10+, OpenAI API key. Docker Desktop is optional.

## Start
```bash
npm install
cp .env.example .env
# Add your key to OPENAI_API_KEY in .env
npm run dev
```
UI: http://localhost:3000
API health: http://127.0.0.1:4000/health

## Optional Docker metadata database
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
- `packages/database`: adapter contract for a later phase.
- `packages/validation`: placeholder for deterministic query validation.

## Test endpoint
```bash
curl -X POST http://127.0.0.1:4000/api/analytics/plan \
  -H 'Content-Type: application/json' \
  -d '{"question":"Show monthly revenue by region for the last 6 months","databaseKind":"postgres","schemaContext":"orders(id, region, total_amount, created_at)"}'
```

Never expose the OpenAI key in frontend code. Future database access must use read-only credentials, code-enforced allowlists, timeouts, and row limits.
