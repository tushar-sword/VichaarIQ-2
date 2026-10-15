import { parse } from "pgsql-ast-parser";
import { validateReadOnlySql } from "@vichaar/validation";
import type { AnalyticsPlan, AnalyticsPlanRequest } from "@vichaar/shared";

// A deliberately narrow consistency check, separate from SQL authorization/safety.
// Natural-language recognition scopes the check; SQL expressions are inspected as ASTs.
type Node = Record<string, any>;
const STATUS_REASON = "The generated analysis changes status filtering for an order count. Should this count include all statuses, or which statuses should it include?";
const FILTER_REASON = "The SQL draft's row filters differ from the analysis plan. Please confirm the intended filters or restate the question.";
const orderCount = (request: AnalyticsPlanRequest) => request.databaseKind === "postgres"
  && /\b(count|number of|how many)\b/i.test(request.question) && /\borders?\b/i.test(request.question)
  && !/\b(revenue|sales|shipping|discounts?|amount|value|average)\b/i.test(request.question);
const containsWord = (text: string, value: string) => new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);

function where(text: string): Node | undefined {
  if (text.length > 20000) return;
  try {
    const nodes = parse(`SELECT 1 WHERE ${text}`) as Node[];
    if (nodes.length === 1 && nodes[0].type === "select" && !nodes[0].from && !nodes[0].groupBy && !nodes[0].having && !nodes[0].orderBy && !nodes[0].limit) return nodes[0].where;
  } catch { /* Free-text filters are not reliably comparable as SQL. */ }
}
function hasStatus(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if ((node as Node).type === "ref" && (node as Node).name === "status") return true;
  return Object.values(node).some(hasStatus);
}
function restrictions(node: unknown): Node[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  if (n.type === "binary" && n.op === "AND") return [...restrictions(n.left), ...restrictions(n.right)];
  if (["binary", "unary", "ternary", "case"].includes(n.type) && hasStatus(n)) return [n];
  return Object.values(n).flatMap(restrictions);
}
function uncast(node: Node): Node {
  return node?.type === "cast" && node.to?.name === "text" && !node.to.config ? uncast(node.operand) : node;
}
function statusValues(node: Node): string[] | undefined {
  if (node.type !== "binary") return;
  let left = uncast(node.left), right = uncast(node.right);
  if (node.op === "=" && right?.type === "ref" && right.name === "status") [left, right] = [right, left];
  if (left?.type !== "ref" || left.name !== "status") return;
  if (node.op === "=" && right?.type === "string") return [right.value];
  if (node.op === "IN" && right?.type === "list" && right.expressions.length && right.expressions.every((v: Node) => uncast(v).type === "string")) return right.expressions.map((v: Node) => uncast(v).value);
}
function statusConflict(request: AnalyticsPlanRequest, nodes: Node[]): string | undefined {
  // Values come from discovered CHECK metadata and predicates, never fixed fixture answers.
  const known = request.schemaContext.split("\n")
    .filter(line => /\borders\b/.test(line) && /\bCHECK\b/.test(line) && /\bstatus\b/.test(line))
    .flatMap(line => [...line.matchAll(/'((?:''|[^'])*)'/g)].map(m => m[1].replaceAll("''", "'")).filter(Boolean));
  const sets = nodes.map(statusValues);
  if (sets.some(values => !values)) return STATUS_REASON;
  const actual = [...new Set(sets.flat() as string[])].sort();
  const all = /\ball (?:order )?statuses\b|\ball orders\b/i.test(request.question);
  const mentioned = [...new Set([...known, ...actual].filter(v => containsWord(request.question, v)))].sort();
  const requested = all ? [] : mentioned;
  // Negations and complex status descriptions need clarification, not an inferred positive filter.
  if (mentioned.length && (all || /\b(not|except|excluding|exclude|without|non)\b/i.test(request.question))) return STATUS_REASON;
  return JSON.stringify(actual) === JSON.stringify(requested) ? undefined : STATUS_REASON;
}

function planPredicates(plan: AnalyticsPlan): Node[] | undefined {
  const nodes = plan.filters.map(where);
  return nodes.every(Boolean) ? nodes as Node[] : undefined;
}
export function checkPlanSemantics(request: AnalyticsPlanRequest, plan: AnalyticsPlan): string | undefined {
  if (!orderCount(request)) return;
  const predicates = plan.filters.flatMap(filter => {
    const node = where(filter);
    // A status restriction in prose cannot be proved consistent: ask instead of guessing.
    return node ? restrictions(node) : /\bstatus(?:es)?\b/i.test(filter) ? [{ type: "unknown" }] : [];
  });
  return statusConflict(request, predicates);
}
const conjuncts = (node: Node | undefined): Node[] => !node ? [] : node.type === "binary" && node.op === "AND"
  ? [...conjuncts(node.left), ...conjuncts(node.right)] : [node];
function contains(node: unknown, predicate: (n: Node) => boolean): boolean {
  return !!node && typeof node === "object" && (predicate(node as Node) || Object.values(node).some(value => contains(value, predicate)));
}
function canonical(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(canonical);
  if (!node || typeof node !== "object") return node;
  const n = node as Node;
  // Positive status membership has already been checked against the question.
  // Equality direction / IN with one literal / a text cast do not change that membership.
  const statuses = statusValues(n);
  if (statuses) return { statusMembership: [...new Set(statuses)].sort() };
  // Compare literal midnight dates in this UTC execution profile; preserve casts on columns.
  if (n.type === "cast" && ["date", "timestamp", "timestamptz"].includes(n.to?.name)
    && n.operand?.type === "string" && /^\d{4}-\d{2}-\d{2}(?:T00:00:00Z)?$/.test(n.operand.value)) return canonical(n.operand);
  if (n.type === "string" && /^\d{4}-\d{2}-\d{2}(?:T00:00:00Z)?$/.test(n.value)) return { type: "string", value: n.value.slice(0, 10) };
  return Object.fromEntries(Object.keys(n).sort().filter(key => key !== "_location" && !(n.type === "ref" && key === "table"))
    .map(key => [key, canonical(n[key])]));
}
export function checkDraftSemantics(request: AnalyticsPlanRequest, plan: AnalyticsPlan, sql: string): string | undefined {
  if (!orderCount(request)) return;
  // Invalid/unsupported SQL still goes to the existing API validator for its controlled 422.
  // Normalization here is only for inspection; we never return replacement SQL.
  const validation = validateReadOnlySql(sql);
  if (!validation.valid) return;
  const ast = parse(validation.sql)[0] as Node;
  const conflict = statusConflict(request, restrictions(ast));
  if (conflict) return conflict;
  const predicates = planPredicates(plan);
  // Alias-insensitive predicate comparison is reliable only for one physical orders table.
  // CTE/join lineage and prose filters are outside this lightweight check's coverage.
  if (!predicates || ast.type !== "select" || ast.from?.length !== 1 || ast.from[0].type !== "table"
    || ast.from[0].name.name !== "orders" || ast.from[0].join || ast.having) return;
  if (contains(ast.columns, n => n.type === "case" || n.type === "call" && !!n.filter)) return FILTER_REASON;
  if ([...predicates, ast.where].some(n => contains(n, child => ["select", "with", "union", "union all"].includes(child.type)))) return;
  const keys = (nodes: Node[]) => [...new Set(nodes.flatMap(conjuncts).map(n => JSON.stringify(canonical(n))))].sort();
  return JSON.stringify(keys(predicates)) === JSON.stringify(keys(conjuncts(ast.where))) ? undefined : FILTER_REASON;
}
