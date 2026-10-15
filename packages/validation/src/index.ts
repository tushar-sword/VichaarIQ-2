import { parse, toSql, type Statement } from "pgsql-ast-parser";

export type SqlValidationResult = { valid: true; sql: string } | { valid: false; error: string };
export interface SqlTable { schema: string; name: string }
export interface SqlValidationOptions {
  allowedSchemas?: readonly string[];
  allowedTables?: readonly SqlTable[];
}

// Positive policy: unlisted functions, custom casts and unknown AST nodes fail closed.
export const SAFE_FUNCTIONS = Object.freeze([
  "count", "sum", "avg", "min", "max", "stddev_pop", "stddev_samp", "var_pop", "var_samp",
  "bool_and", "bool_or", "string_agg", "abs", "round", "ceil", "ceiling", "floor", "trunc",
  "sign", "sqrt", "power", "mod", "lower", "upper", "length", "char_length", "octet_length",
  "btrim", "ltrim", "rtrim", "concat", "concat_ws", "substring", "replace", "left", "right",
  "split_part", "date_trunc", "date_part", "to_char", "now",
]);
const FUNCTIONS = new Set<string>(SAFE_FUNCTIONS);
const SPECIAL = new Set(["coalesce", "nullif", "greatest", "least", "exists"]);
const TYPES: Record<string, string> = {
  bool: "bool", boolean: "bool", smallint: "int2", int2: "int2", integer: "int4", int: "int4",
  int4: "int4", bigint: "int8", int8: "int8", real: "float4", float4: "float4",
  "double precision": "float8", float8: "float8", decimal: "numeric", numeric: "numeric",
  text: "text", varchar: "varchar", "character varying": "varchar", char: "bpchar",
  character: "bpchar", bpchar: "bpchar", date: "date", timestamp: "timestamp",
  "timestamp without time zone": "timestamp", timestamptz: "timestamptz",
  "timestamp with time zone": "timestamptz", time: "time", "time without time zone": "time",
  timetz: "timetz", "time with time zone": "timetz", interval: "interval",
  json: "json", jsonb: "jsonb", uuid: "uuid", bytea: "bytea",
};
export const SAFE_COLUMN_TYPES = Object.freeze([...new Set(Object.values(TYPES))]);
const BINARY = new Set(["+", "-", "*", "/", "%", "=", "!=", "<>", ">", ">=", "<", "<=",
  "AND", "OR", "IN", "NOT IN", "LIKE", "NOT LIKE", "ILIKE", "NOT ILIKE", "||", "AT TIME ZONE"]);
const UNARY = new Set(["+", "-", "NOT", "IS NULL", "IS NOT NULL", "IS TRUE", "IS FALSE", "IS NOT TRUE", "IS NOT FALSE"]);
const KEYWORDS = new Set(["current_date", "current_timestamp", "current_time", "localtimestamp", "localtime"]);
const EXTRACT_FIELDS = new Set(["year", "month", "day", "week", "quarter", "hour", "minute", "second",
  "dow", "isodow", "doy", "epoch", "milliseconds", "microseconds", "timezone", "timezone_hour",
  "timezone_minute", "isoyear", "decade", "century", "millennium"]);
const STATEMENTS = new Set(["select", "with", "union", "union all"]);
type Node = Record<string, any>;

class PolicyError extends Error {}
function fail(message: string): never { throw new PolicyError(message); }
function fields(node: Node, allowed: string[]) {
  if (Object.keys(node).some((key) => key !== "_location" && !allowed.includes(key))) {
    fail("SQL contains an unsupported construct or AST field.");
  }
}
function name(node: Node, alias = false) {
  fields(node, alias ? ["name", "schema", "alias", "columnNames"] : ["name", "schema"]);
  if (typeof node.name !== "string" || !node.name) fail("SQL contains an unsupported identifier.");
}
function safeSchema(schema: string, schemas: readonly string[]) {
  if (schema.startsWith("pg_") || schema === "information_schema" || !schemas.includes(schema)) {
    fail("Schema access is not permitted by the SQL policy.");
  }
}
function decimalIdentity(value: string): string | undefined {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value.trim());
  if (!match) return undefined;
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  while (digits.endsWith("0")) { digits = digits.slice(0, -1); exponent++; }
  return `${match[1] === "-" ? "-" : ""}${digits}@${exponent}`;
}

export function validateReadOnlySql(input: string, options: SqlValidationOptions = {}): SqlValidationResult {
  const sql = input.trim();
  if (!sql) return { valid: false, error: "SQL query is empty." };
  if (sql.length > 20_000) return { valid: false, error: "SQL query exceeds the 20,000-character limit." };
  const schemas = options.allowedSchemas ?? ["public"];
  let statements: Statement[];
  try { statements = parse(sql, { locationTracking: true }); }
  catch { return { valid: false, error: "SQL could not be safely parsed: invalid syntax or unsupported PostgreSQL construct (including SELECT INTO)." }; }
  if (statements.length !== 1) return { valid: false, error: "Exactly one SQL statement is allowed." };
  let visited = 0;
  let currentSource = sql;

  function visitType(type: Node) {
    fields(type, ["name", "schema", "config", "doubleQuoted"]);
    const canonical = Object.hasOwn(TYPES, type.name) ? TYPES[type.name] : undefined;
    if (!canonical || (type.schema && type.schema !== "pg_catalog") || (type.doubleQuoted && canonical !== type.name)) {
      fail("Only supported pg_catalog scalar types may be used in casts and typed literals.");
    }
    if (type.config && (!Array.isArray(type.config) || type.config.some((n: unknown) => !Number.isInteger(n) || Number(n) < 0 || Number(n) > 1000))) {
      fail("Unsupported type precision or length.");
    }
    type.name = canonical;
    type.schema = "pg_catalog";
    delete type.doubleQuoted;
  }
  function budget(depth: number) {
    if (++visited > 4000 || depth > 80) fail("SQL exceeds the supported AST complexity limit.");
  }
  function order(items: Node[] | undefined, scope: Set<string>, depth: number) {
    for (const item of items ?? []) {
      fields(item, ["by", "order", "nulls"]);
      expr(item.by, scope, depth + 1);
    }
  }
  function expr(node: Node | null | undefined, scope: Set<string>, depth: number) {
    if (node == null) return;
    budget(depth);
    if (STATEMENTS.has(node.type)) return statement(node, scope, depth + 1);
    switch (node.type) {
      case "ref":
        fields(node, ["type", "name", "table"]);
        if (node.table) { name(node.table); if (node.table.schema) safeSchema(node.table.schema, schemas); }
        return;
      case "integer": case "numeric": {
        fields(node, ["type", "value"]);
        const source = node._location && currentSource.slice(node._location.start, node._location.end);
        if (node._location && /[A-Za-z0-9_$.]/.test(currentSource[node._location.end] ?? "")) {
          fail("Scientific notation or adjoining numeric tokens are unsupported; use a quoted literal cast to numeric.");
        }
        if (!Number.isFinite(node.value) || !source || decimalIdentity(source) !== decimalIdentity(String(node.value))) {
          fail("Numeric literal cannot be represented exactly by this parser; use a quoted literal cast to numeric.");
        }
        return;
      }
      case "string": case "boolean":
        fields(node, ["type", "value"]); return;
      case "null": fields(node, ["type"]); return;
      case "keyword":
        fields(node, ["type", "keyword"]);
        if (!KEYWORDS.has(node.keyword)) fail("Unsupported SQL value keyword.");
        return;
      case "binary": case "unary":
        fields(node, node.type === "binary" ? ["type", "left", "right", "op", "opSchema"] : ["type", "operand", "op", "opSchema"]);
        if ((node.opSchema && node.opSchema !== "pg_catalog") || !(node.type === "binary" ? BINARY : UNARY).has(node.op)) fail("Unsupported or custom SQL operator.");
        expr(node.left ?? node.operand, scope, depth + 1); expr(node.right, scope, depth + 1); return;
      case "ternary":
        fields(node, ["type", "value", "lo", "hi", "op"]);
        if (!["BETWEEN", "NOT BETWEEN"].includes(node.op)) fail("Unsupported SQL operator.");
        expr(node.value, scope, depth + 1); expr(node.lo, scope, depth + 1); expr(node.hi, scope, depth + 1); return;
      case "cast":
        fields(node, ["type", "operand", "to"]); visitType(node.to); expr(node.operand, scope, depth + 1); return;
      case "constant":
        fields(node, ["type", "dataType", "value"]); visitType(node.dataType); return;
      case "list":
        fields(node, ["type", "expressions"]); node.expressions.forEach((item: Node) => expr(item, scope, depth + 1)); return;
      case "case":
        fields(node, ["type", "value", "whens", "else"]);
        expr(node.value, scope, depth + 1); expr(node.else, scope, depth + 1);
        node.whens.forEach((item: Node) => { fields(item, ["when", "value"]); expr(item.when, scope, depth + 1); expr(item.value, scope, depth + 1); }); return;
      case "extract":
        fields(node, ["type", "field", "from"]); name(node.field);
        if (node.field.schema || !EXTRACT_FIELDS.has(node.field.name.toLowerCase())) fail("Unsupported EXTRACT field.");
        expr(node.from, scope, depth + 1); return;
      case "substring":
        fields(node, ["type", "value", "from", "for"]);
        expr(node.value, scope, depth + 1); expr(node.from, scope, depth + 1); expr(node.for, scope, depth + 1); return;
      case "member":
        fields(node, ["type", "operand", "op", "member"]);
        if (!["->", "->>"].includes(node.op)) fail("Unsupported JSON operator.");
        expr(node.operand, scope, depth + 1); return;
      case "call": {
        if (node.over || node.withinGroup) fail("Window and ordered-set functions are not supported by this SQL policy.");
        fields(node, ["type", "function", "args", "distinct", "orderBy", "filter"]);
        name(node.function);
        const fn = node.function;
        if (SPECIAL.has(fn.name)) {
          if (fn.schema) fail("Special SQL expressions cannot be schema-qualified.");
          if (fn.name === "exists" && (node.args.length !== 1 || !STATEMENTS.has(node.args[0]?.type))) fail("EXISTS requires a supported read-only subquery.");
        } else {
          if (fn.name === "trim" && !fn.schema) fn.name = "btrim";
          if (!FUNCTIONS.has(fn.name) || (fn.schema && fn.schema !== "pg_catalog")) fail("Function is not permitted by the SQL function allowlist.");
          fn.schema = "pg_catalog";
        }
        node.args.forEach((item: Node) => expr(item, scope, depth + 1));
        expr(node.filter, scope, depth + 1); order(node.orderBy, scope, depth + 1); return;
      }
      default: fail("Unsupported or non-read-only SQL expression.");
    }
  }
  function from(node: Node, scope: Set<string>, depth: number) {
    budget(depth);
    if (node.type === "table") {
      fields(node, ["type", "name", "join"]); name(node.name, true);
      if (!node.name.schema && scope.has(node.name.name)) { /* CTE, not a physical relation. */ }
      else {
        const schema = node.name.schema ?? "public";
        safeSchema(schema, schemas);
        if (options.allowedTables && !options.allowedTables.some((table) => table.schema === schema && table.name === node.name.name)) fail("Table access is not permitted by the SQL policy.");
        node.name.schema = schema;
      }
    } else if (node.type === "statement") {
      fields(node, ["type", "statement", "alias", "join"]); statement(node.statement, scope, depth + 1);
    } else fail("Table functions, LATERAL and unsupported FROM constructs are not allowed.");
    if (node.join) {
      fields(node.join, ["type", "on", "using"]);
      if (!["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN"].includes(node.join.type)) fail("Unsupported JOIN construct.");
      expr(node.join.on, scope, depth + 1);
      node.join.using?.forEach((item: Node) => name(item));
    }
  }
  function statement(node: Node, scope: Set<string>, depth: number, unionOperand = false) {
    budget(depth);
    if (node.type === "with") {
      fields(node, ["type", "bind", "in"]);
      const local = new Set(scope);
      const declared = new Set<string>();
      for (const binding of node.bind) {
        fields(binding, ["alias", "statement"]); name(binding.alias);
        if (declared.has(binding.alias.name)) fail("Duplicate CTE names are not supported.");
        declared.add(binding.alias.name);
        statement(binding.statement, local, depth + 1);
        local.add(binding.alias.name);
      }
      statement(node.in, local, depth + 1, unionOperand); return;
    }
    if (node.type === "union" || node.type === "union all") {
      fields(node, ["type", "left", "right"]);
      statement(node.left, scope, depth + 1, true); statement(node.right, scope, depth + 1, true); return;
    }
    if (node.type !== "select") fail("Only read-only SELECT, non-recursive CTE and UNION statements are supported; DDL/DML are forbidden.");
    if (node.for || node.skip || node.into || node.forUpdate) fail("SELECT INTO and all row-locking clauses are forbidden.");
    fields(node, ["type", "columns", "from", "where", "groupBy", "having", "limit", "orderBy", "distinct"]);
    if (!node.columns?.length) fail("SELECT must contain a supported projection.");
    // The parser attaches a UNION's global ORDER/LIMIT to its last SELECT. Never execute that altered meaning.
    if (unionOperand && (node.orderBy?.length || node.limit)) fail("ORDER BY/LIMIT on UNION operands is not safely supported; put the UNION in an outer SELECT.");
    for (const column of node.columns ?? []) { fields(column, ["expr", "alias"]); if (column.alias) name(column.alias); expr(column.expr, scope, depth + 1); }
    for (const item of node.from ?? []) from(item, scope, depth + 1);
    expr(node.where, scope, depth + 1); expr(node.having, scope, depth + 1);
    node.groupBy?.forEach((item: Node) => expr(item, scope, depth + 1));
    order(node.orderBy, scope, depth + 1);
    if (Array.isArray(node.distinct)) node.distinct.forEach((item: Node) => expr(item, scope, depth + 1));
    if (node.limit) {
      fields(node.limit, ["limit", "offset"]);
      for (const value of [node.limit.limit, node.limit.offset].filter(Boolean)) {
        if (value.type !== "integer" || !Number.isSafeInteger(value.value) || value.value < 0 || value.value > 1_000_000) fail("LIMIT/OFFSET require non-negative integer literals at most 1,000,000.");
      }
    }
  }
  try {
    statement(statements[0] as unknown as Node, new Set(), 0);
    const normalized = toSql.statement(statements[0]).trim();
    const reparsed = parse(normalized, { locationTracking: true });
    if (reparsed.length !== 1) fail("Normalized SQL could not be safely recognized.");
    // Check the executable form too: the serializer is not an independent trust boundary.
    currentSource = normalized; visited = 0;
    statement(reparsed[0] as unknown as Node, new Set(), 0);
    return { valid: true, sql: normalized };
  } catch (error) {
    return { valid: false, error: error instanceof PolicyError
      ? error.message : "SQL could not be safely normalized; this construct is unsupported." };
  }
}
