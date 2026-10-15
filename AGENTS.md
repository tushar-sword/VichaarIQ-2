# VichaarIQ — Codex Project Context

## Goal
Build an AI-powered business intelligence platform where users connect databases, ask questions in plain English, and receive validated queries, interactive charts, tables, KPI metrics, and explanations.

## Stack
- Monorepo using npm workspaces
- Node.js >=22 and TypeScript
- Next.js 15 / React 19 frontend at apps/web
- Fastify API at services/api
- OpenAI-powered analytics planner
- PostgreSQL adapter using pg
- SQL read-only validator using pgsql-ast-parser
- Recharts for dashboard visualization
- Docker PostgreSQL for application metadata

## Progress
- Phase 1: Monorepo structure
- Phase 2: AI planner and initial frontend
- Phase 3A: PostgreSQL SQL validation
- Phase 3B: PostgreSQL adapter and database endpoints (verify integration against current source)
- Phase 4: Smart visualization engine and mock dashboard in progress
- Future: MongoDB support, production hardening

## Current frontend
- apps/web/src/app/page.tsx: question builder, schema input, connection UI, analysis planner, mock dashboard
- apps/web/src/app/globals.css: existing styles and dashboard additions
- apps/web/src/lib/visualization.ts: automatic chart recommendation
- Recharts installed

## Next task
Redesign the interface into a polished, Apple-inspired SaaS BI application.
- Dedicated /dashboard route
- Separate Ask VichaarIQ workspace
- Sidebar and navigation
- KPI cards, large interactive charts, clean data table
- Preserve all working features
- Keep mock mode until a real database is connected
- Use real query results after successful connection and execution

## Important rules
- Inspect the actual repository before editing; this file may be outdated.
- Mark mock-related code with 📌 MOCK DATA comments.
- Mark real database code with 📌 REAL DATABASE comments.
- Do not invent or silently substitute mock data for real results.
- Do not delete or recreate existing databases.
- Do not expose credentials or connection strings to AI models.
- Keep SQL execution read-only with validation and database-level permissions.
- Do not overwrite .env or commit secrets.
- Run typecheck/build after changes.
- Make incremental, reviewable changes and explain what changed.
