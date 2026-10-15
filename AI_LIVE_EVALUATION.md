# Phase 5C Task 2 — Controlled live AI evaluation

Run: **2026-10-15, 13:31:40–13:32:01 UTC**. Result: **3/4 scenarios passed end to end (75%)**. Every plan satisfied the Zod contract, every draft passed the unchanged SQL validator, and every query executed with the dedicated fixture reader. One valid, executable query expressed the wrong business filter.

After Task 3's focused correction, the separately approved regional-count re-evaluation **passed 1/1**. Details appear at the end of this report. The original four-question run and its 3/4 result are preserved below; the other three questions were not rerun live after the correction.

## Authorization and scope

- Explicit approval: **up to 8 requests / US$0.10**.
- Configured model: `gpt-4.1-mini`; returned snapshot: `gpt-4.1-mini-2025-04-14`.
- Exactly **8 model requests**: one planner and one SQL writer per question. No retries, repair requests or extra paid diagnostics. Each response had a 2,048-output-token cap. Tracing was disabled.
- Only questions and server-discovered schema metadata were sent to OpenAI. No database rows, expected results, credentials or connection URLs were included in model input.
- Database target: **127.0.0.1:5544**, database `vichaar_ecommerce_test`, role `vichaar_test_reader`. These are real PostgreSQL executions over the existing **synthetic business fixture**, not production data or offline demo substitutions.
- Existing Docker ownership/loopback guards and adapter role/permission checks passed. The fixture's logical schema/data fingerprints matched before and after. No data, grants, schema, volumes, environment secrets or metadata database settings were changed.

## Results

| Question | Plan contract | SQL validation | Reader execution | Data correctness | Chart recommendation | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| Monthly merchandise revenue in 2025 from completed orders, excluding shipping | Pass | Pass | Pass | Pass: all 12 months, total INR 5,512,232.50 | Line: pass | **PASS** |
| Top five products by merchandise revenue in 2025 from completed orders, using discounted historical line totals | Pass | Pass | Pass | Pass: all five names, revenues and ranking | Bar: pass | **PASS** |
| Count orders grouped by status in 2025 | Pass | Pass | Pass | Pass: five statuses, 1,440 orders | Bar: pass | **PASS** |
| Count orders grouped by region in 2025 | Pass | Pass | Pass | **Fail: 216 per region instead of 288** | Bar: pass | **FAIL** |

Reference results were computed before model calls using separately authored validated read-only SQL. Revenue references recomputed `quantity * unit_price - discount_amount`; generated AI SQL summed the equivalent stored generated `line_total`. Group labels and exact monetary values/counts were compared independently of aliases and row order, with ranking checked for top products and chronological order checked for monthly charts. References were rechecked before the live run. The model did not receive reference SQL or expected rows.

The actual frontend store/API client was exercised through Fastify's real handlers using an in-process HTTP transport, with the real SDK/model and PostgreSQL adapter. Results retained `source: "postgres"`, the current question and connection identity. No mock fallback occurred. Chart selection ran against actual returned rows using the unchanged visualization engine; this was not a browser-rendering evaluation.

Successful top products (INR):

| Product | Merchandise revenue |
| --- | ---: |
| Mechanical Keyboard | 690,177.75 |
| Lightweight Jacket | 647,241.00 |
| Wireless Headphones | 639,744.00 |
| USB-C Hub | 297,471.00 |
| Wireless Mouse | 284,983.00 |

Status counts were completed **720** and cancelled, pending, refunded, shipped **180 each**. All five regions should contain **288** orders.

## Failure diagnosis and proposed minimal fix

**Category: semantic correctness; origin: the planner's business interpretation.** The regional question requested all orders. The planner inserted this unrequested filter:

```text
status IN ('completed','pending','shipped')
```

The writer faithfully retained it in the generated SQL:

```sql
SELECT region, COUNT(id) AS order_count
FROM public.orders
WHERE created_at >= '2025-01-01'::timestamptz
  AND created_at < '2026-01-01'::timestamptz
  AND status IN ('completed', 'pending', 'shipped')
GROUP BY region
ORDER BY region;
```

This excludes 180 cancelled plus 180 refunded orders: **1,080 returned versus 1,440 expected**, or **216 versus 288 per region**. The failure is not invalid syntax, a parser restriction, an adapter problem, a Zod shape problem or a visualization issue. A read-only validator cannot infer that a business filter was not requested.

The prompts currently explicitly say to include all statuses for **status counts**, while separately discussing exclusions from recognized revenue. The observed filter is consistent with applying that exclusion to regional counts; the model's internal reason is not observable. The confirmed cause is the invented filter in the plan, subsequently preserved by the writer.

Proposed minimal fix, **not applied during this evaluation**:

1. State in both agents' shared instructions: “For order counts across any grouping, include every status unless the question explicitly restricts statuses. Revenue-recognition exclusions do not apply to order counts. Do not add business filters that the question or an explicit applicable definition does not require.”
2. Add a deterministic regional-count regression expecting 288 orders per region and a prompt regression distinguishing count semantics from revenue semantics. A mocked-output test alone cannot prove that the live model follows the instruction.
3. Re-evaluate this scenario only after separate approval for new paid calls. Do not weaken the SQL validator or silently rewrite the generated filter to make the test pass.

## Model usage and cost

| Scenario | Planner input/output tokens | Writer input/output tokens | Requests |
| --- | ---: | ---: | ---: |
| Monthly revenue | 1,822 / 117 | 1,821 / 114 | 2 |
| Top products | 1,828 / 129 | 1,843 / 138 | 2 |
| Order status | 1,818 / 103 | 1,802 / 61 | 2 |
| Regional counts | 1,818 / 97 | 1,798 / 87 | 2 |
| **Total** | | **14,550 input / 846 output** | **8** |

Reported cached input tokens: **0**. At standard prices of $0.40/million input tokens and $1.60/million output tokens, the estimated token charge is **US$0.0071736** (about **$0.0072**, below one cent), within the approved $0.10 budget. This is a usage-based estimate, not an invoice, and excludes taxes or account-specific pricing. [Official model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

The harness conservatively reserved approximately $0.05625 before issuing requests, using request-byte-based input allowances and the output cap. Both SDK and model-level retries were disabled; duplicate stage requests and a ninth request were blocked, and a persistent ledger prevents accidentally rerunning the live batch.

## Evidence and limitations

Sanitized local evidence is under `.recovery-checkpoints/phase5c-task2/`: `preflight.json`, `approval.json`, `live-budget.json`, `live-report.json`, and the isolated evaluation harness. This directory is ignored and contains no API keys or connection credentials in the result reports. The successful no-cost rehearsal is saved separately as `dry-report.json`; it is not counted as live evaluation.

This single run is a small smoke evaluation, not a general success-rate benchmark. Safe SQL and schema-valid plans can still be semantically wrong, as this run demonstrates. Other schemas, complex queries, alternative phrasings, relative dates, tied rankings, failures under load and browser rendering were not evaluated here. The four-table reader policy, parser/function restrictions and in-memory connection limitations remain as documented in [AI_QUERY_COMPATIBILITY.md](AI_QUERY_COMPATIBILITY.md). No application code or SQL safety rules were changed for Task 2; only evaluation artifacts and documentation were added/updated. No commits or pushes were made.

## Task 3 — Approved regional-count re-evaluation

Run: **2026-10-15, 15:03:33–15:03:38 UTC**. Explicit new approval: at most **2 requests / US$0.03** for “Count orders grouped by region in 2025.” Result: **1/1 passed**. This was one attempt after the Task 3 implementation, not a retry within Task 2's spent budget.

The configured `gpt-4.1-mini` returned snapshot `gpt-4.1-mini-2025-04-14`. Its plan matched the Zod contract, listed only the two 2025 date predicates and required no clarification. The writer preserved those predicates without inventing a status filter:

```sql
SELECT region, COUNT(*) AS order_count
FROM public.orders
WHERE created_at >= '2025-01-01T00:00:00Z'
  AND created_at < '2026-01-01T00:00:00Z'
GROUP BY region
ORDER BY region;
```

The semantic consistency check and unchanged SQL validator passed. The actual execution endpoint used the existing dedicated reader at **127.0.0.1:5544**. Results matched the independently computed fixture expectations:

| Region | Order count |
| --- | ---: |
| Central | 288 |
| East | 288 |
| North | 288 |
| South | 288 |
| West | 288 |
| **Total** | **1,440** |

The frontend store retained real PostgreSQL provenance, the current question and connection identity; no demo data was substituted. The visualization engine recommended a bar chart with `region` and `order_count`. This verified chart selection, not browser rendering.

Exactly **2 paid requests**, no retries or repair calls, tracing disabled:

| Stage | Input tokens | Output tokens |
| --- | ---: | ---: |
| Planner | 1,964 | 116 |
| SQL writer | 1,959 | 60 |
| **Total** | **3,923** | **176** |

Cached input tokens: **0**. Estimated token charge at the pricing cited above: **US$0.0018508** (about **$0.0019**), below the approved $0.03 cap. Only question/schema metadata was sent to OpenAI. The fixture logical schema/data fingerprint was unchanged; no database contents, safety rules, production settings or secrets were modified. No commits or pushes occurred.

Sanitized evidence and the persistent two-request ledger are under `.recovery-checkpoints/phase5c-task3/live-report.json` and `live-budget.json`; the harness refuses another live run with that ledger present. Task 3's earlier no-cost rehearsal remains separate in `dry-report.json`.

This confirms the previously failing question worked on this attempt. It does not establish a new four-question 100% pass rate or guarantee arbitrary-query correctness. Further wording/schema coverage and the documented limits of the lightweight semantic guard remain relevant. Any further paid re-evaluation needs new approval.
