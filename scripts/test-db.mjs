import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TEST = Object.freeze({
  project: "vichaar-iq-ecommerce-test", service: "ecommerce-postgres",
  container: "vichaar-iq-ecommerce-test-postgres", volume: "vichaar_iq_ecommerce_test_pgdata",
  purpose: "local-ecommerce-test", port: 5544, database: "vichaar_ecommerce_test",
  reader: "vichaar_test_reader", readerPassword: "local_test_reader_only",
});
const COMPOSE = ["compose", "--project-name", TEST.project, "--env-file", resolve(ROOT, "tests/postgres/local.env.example"), "--file", resolve(ROOT, "docker-compose.test.yml")];
const BASELINE = resolve(ROOT, ".test-db/metadata-baseline.json");

function docker(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`Docker unavailable: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr.trim().slice(0, 1500)}`);
  return result.stdout;
}

function container(name) {
  if (!docker(["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]).trim()) return null;
  // Never retrieve Config.Env, which can contain application credentials.
  return JSON.parse(docker(["container", "inspect", "--format",
    '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{json .State.Health.Status}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"purpose":{{json (index .Config.Labels "io.vichaariq.purpose")}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}}}', name]));
}

function volume(name) {
  if (!docker(["volume", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}"]).trim()) return null;
  return JSON.parse(docker(["volume", "inspect", "--format",
    '{"name":{{json .Name}},"created":{{json .CreatedAt}},"driver":{{json .Driver}},"project":{{json (index .Labels "com.docker.compose.project")}},"purpose":{{json (index .Labels "io.vichaariq.purpose")}}}', name]));
}

export function assertLocalDockerHost(endpoint) {
  assert.ok(typeof endpoint === "string" &&
    (endpoint.startsWith("unix:///") || endpoint.startsWith("npipe:////./pipe/")),
  "This fixture requires a local Docker socket; remote Docker contexts are refused.");
}

function guardLocalDocker() {
  const endpoint = JSON.parse(docker(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]));
  // DOCKER_CONTEXT takes precedence over DOCKER_HOST in the Docker CLI.
  assertLocalDockerHost(process.env.DOCKER_CONTEXT ? endpoint : process.env.DOCKER_HOST || endpoint);
}

export function assertIsolatedConfig(config) {
  assert.equal(config.name, TEST.project, "Unexpected Compose project");
  assert.deepEqual(Object.keys(config.services), [TEST.service], "Test Compose must contain only its test service");
  const service = config.services[TEST.service];
  assert.equal(service.container_name, TEST.container);
  assert.equal(service.environment.POSTGRES_DB, TEST.database);
  assert.equal(service.environment.POSTGRES_USER, "vichaar_test_admin");
  assert.equal(service.labels["io.vichaariq.purpose"], TEST.purpose);
  assert.equal(service.ports.length, 1);
  assert.equal(service.ports[0].host_ip, "127.0.0.1", "Test database must bind only to loopback");
  assert.equal(Number(service.ports[0].published), TEST.port);
  assert.equal(Number(service.ports[0].target), 5432);
  assert.deepEqual(Object.keys(config.volumes), ["ecommerce-test-pgdata"]);
  assert.equal(config.volumes["ecommerce-test-pgdata"].name, TEST.volume);
  assert.equal(config.volumes["ecommerce-test-pgdata"].external ?? false, false);
  assert.equal(config.volumes["ecommerce-test-pgdata"].labels["io.vichaariq.purpose"], TEST.purpose);
  assert.equal(service.volumes.length, 2);
  const data = service.volumes.find((mount) => mount.target === "/var/lib/postgresql/data");
  const init = service.volumes.find((mount) => mount.target === "/docker-entrypoint-initdb.d");
  assert.equal(data?.type, "volume");
  assert.equal(data?.source, "ecommerce-test-pgdata");
  assert.equal(init?.type, "bind");
  assert.equal(init?.source, resolve(ROOT, "tests/postgres/init"));
  assert.equal(init?.read_only, true);
}

export function assertOwned(resource) {
  assert.equal(resource.project, TEST.project, "Refusing to use a resource owned by another Compose project");
  assert.equal(resource.purpose, TEST.purpose, "Refusing a resource without the disposable-test ownership label");
}

function guardResources() {
  const existing = container(TEST.container);
  if (existing) {
    assertOwned(existing);
    assert.equal(existing.service, TEST.service);
    assert.equal(existing.mounts.find((mount) => mount.Destination === "/var/lib/postgresql/data")?.Name, TEST.volume);
    assert.deepEqual(existing.ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: String(TEST.port) }]);
  }
  const dataVolume = volume(TEST.volume);
  if (dataVolume) assertOwned(dataVolume);
  const projectContainers = docker(["container", "ls", "--all", "--filter", `label=com.docker.compose.project=${TEST.project}`, "--format", "{{.Names}}"]);
  for (const name of projectContainers.trim().split("\n").filter(Boolean)) assert.equal(name, TEST.container, "Unexpected container in test project");
  const users = docker(["container", "ls", "--all", "--filter", `volume=${TEST.volume}`, "--format", "{{.Names}}"]);
  for (const name of users.trim().split("\n").filter(Boolean)) assert.equal(name, TEST.container, "Test volume is used by another container; refusing lifecycle changes");
  return existing;
}

const hash = (text) => createHash("sha256").update(text).digest("hex");
export function logicalDumpHash(dump) {
  // Recent pg_dump versions use random psql guard tokens; these are not data changes.
  return hash(dump.split("\n").filter((line) => !/^\\(?:un)?restrict\s/.test(line)).join("\n"));
}

function metadataSnapshot() {
  const metadata = container("vichaar-iq-app-postgres");
  if (metadata) assert.equal(metadata.service, "app-postgres", "Metadata name belongs to an unexpected service; refusing access");
  let logicalHash = null;
  if (metadata?.running) {
    // Read-only fingerprint in memory only: no metadata contents, credentials or dumps are saved/logged.
    const dump = docker(["exec", "vichaar-iq-app-postgres", "sh", "-c", 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-owner']);
    logicalHash = logicalDumpHash(dump);
  }
  const names = new Set(metadata?.mounts.filter((mount) => mount.Type === "volume").map((mount) => mount.Name) ?? []);
  const labelled = docker(["volume", "ls", "--filter", "label=com.docker.compose.volume=vichaar_iq_pgdata", "--format", "{{.Name}}"]);
  labelled.trim().split("\n").filter(Boolean).forEach((name) => names.add(name));
  return { composeHash: hash(readFileSync(resolve(ROOT, "docker-compose.yml"))), container: metadata,
    volumes: [...names].sort().map(volume), logicalHash };
}

function ensureMetadataBaseline() {
  const current = metadataSnapshot();
  if (existsSync(BASELINE)) {
    assertMetadataUnchanged(JSON.parse(readFileSync(BASELINE, "utf8")), current);
  } else {
    mkdirSync(resolve(ROOT, ".test-db"), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify(current, null, 2), { mode: 0o600 });
  }
  if (!current.logicalHash) console.log("NOTE: metadata is absent/stopped; only resource identity and Compose configuration can be checked.");
  return current;
}

export function assertMetadataUnchanged(before, after) {
  assert.deepEqual(after, before, "Metadata differs from the baseline. Concurrent application writes can also cause this; the verifier never modifies metadata.");
}

async function assertFreePort() {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Loopback port ${TEST.port} is unavailable. No existing service will be stopped.`)));
    server.listen(TEST.port, "127.0.0.1", () => server.close(accept));
  });
}

async function verifyAdapter() {
  const { PostgresAdapter } = await import("../packages/database/dist/index.js");
  // 📌 REAL DATABASE: fixed loopback target; no production or environment-supplied URL is accepted.
  const adapter = new PostgresAdapter({ connectionString:
    `postgresql://${TEST.reader}:${TEST.readerPassword}@127.0.0.1:${TEST.port}/${TEST.database}` });
  try {
    assert.equal(await adapter.testConnection(), true);
    const schema = await adapter.getSchemaSummary();
    for (const table of ["customers", "products", "orders", "order_items"]) assert.ok(schema.includes(`public.${table}:`));
    const monthly = await adapter.executeReadOnlyQuery("SELECT date_trunc('month', created_at) AS month, SUM(total_amount) AS revenue FROM public.orders WHERE status = 'completed' GROUP BY date_trunc('month', created_at) ORDER BY month");
    assert.equal(monthly.rowCount, 12);
    assert.equal(monthly.truncated, false);
    const limited = await adapter.executeReadOnlyQuery("SELECT id, status, total_amount FROM public.orders ORDER BY id");
    assert.equal(limited.rowCount, 500);
    assert.equal(limited.truncated, true);
    await assert.rejects(adapter.executeReadOnlyQuery("DELETE FROM public.orders"), /SQL validation failed/);
    console.log("PASS existing adapter: TCP login, schema discovery, 12-month analytics, 500-row limit, SQL rejection");
  } finally {
    await adapter.close();
  }
}

async function main(command) {
  assert.ok(["up", "verify", "safety", "ai", "down", "purge", "status", "logs"].includes(command), "Use up, verify, safety, ai, down, purge, status or logs");
  guardLocalDocker();
  const config = JSON.parse(docker([...COMPOSE, "config", "--format", "json"]));
  assertIsolatedConfig(config);
  const existing = guardResources();
  if (command === "status" || command === "logs") {
    console.log(docker([...COMPOSE, ...(command === "status" ? ["ps"] : ["logs", "--tail", "80", TEST.service])]).trim());
    return;
  }
  if (command === "purge") assert.ok(process.argv.includes("--delete-test-volume"), "Purge requires --delete-test-volume");
  const baseline = ensureMetadataBaseline();
  try {
    if (command === "up") {
      if (!existing?.running) await assertFreePort();
      console.log(docker([...COMPOSE, "up", "--detach", "--wait", "--wait-timeout", "120", TEST.service]).trim());
      assert.equal(container(TEST.container)?.health, "healthy");
      console.log(`PASS isolated PostgreSQL is healthy on 127.0.0.1:${TEST.port}`);
    } else if (command === "ai") {
      assert.equal(existing?.health, "healthy", "Existing fixture must be healthy; AI integration checks never start, reset or reseed it");
      const fingerprint = () => logicalDumpHash(docker(["exec", TEST.container, "pg_dump", "--username", "vichaar_test_admin", "--dbname", TEST.database, "--no-owner"]));
      const before = fingerprint();
      try {
        // 📌 REAL DATABASE: ownership/loopback guards above restrict this to the existing fixture.
        // AI is mocked in Vitest; tracing and external HTTP requests are disabled by the suite.
        const result = spawnSync(process.execPath, [resolve(ROOT, "node_modules/vitest/vitest.mjs"), "run", "--config", resolve(ROOT, "tests/postgres/vitest.ai.config.mts")], {
          cwd: ROOT, stdio: "inherit", timeout: 120_000,
          env: { ...process.env, VICHAAR_AI_FIXTURE_GUARDED: "1", OPENAI_AGENTS_DISABLE_TRACING: "1" },
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, "Mocked AI / real PostgreSQL integration checks failed");
      } finally {
        assert.equal(fingerprint(), before, "Fixture schema/data changed during AI integration checks");
        console.log("PASS fixture logical schema/data fingerprint unchanged");
      }
    } else if (command === "safety") {
      assert.equal(existing?.health, "healthy", "Existing fixture must be healthy; safety checks never start, reset or reseed it");
      const { runSqlSafetyChecks } = await import("./sql-safety-checks.mjs");
      await runSqlSafetyChecks({ docker, TEST, ROOT, logicalDumpHash });
    } else if (command === "verify") {
      assert.equal(existing?.health, "healthy", "Test database is not healthy; run npm run test-db:up first");
      const checks = readFileSync(resolve(ROOT, "tests/postgres/verify-reader.sql"), "utf8");
      // TCP authentication ensures the reader password is tested, not local Unix-socket trust.
      console.log(docker(["exec", "--interactive", "--env", `PGPASSWORD=${TEST.readerPassword}`, TEST.container,
        "psql", "--no-psqlrc", "--host", "127.0.0.1", "--username", TEST.reader, "--dbname", TEST.database,
        "--set", "ON_ERROR_STOP=1", "--file", "-"], checks).trim());
      await verifyAdapter();
      // Reader cannot access the cluster's unrelated default database.
      const denied = spawnSync("docker", ["exec", "--env", `PGPASSWORD=${TEST.readerPassword}`, TEST.container,
        "psql", "--no-psqlrc", "--host", "127.0.0.1", "--username", TEST.reader, "--dbname", "postgres", "--command", "SELECT 1"], { encoding: "utf8", timeout: 10_000 });
      assert.equal(denied.status, 2);
      assert.match(denied.stderr, /permission denied for database/);
      console.log("PASS reader cannot connect to the default postgres database");
    } else {
      // Always one explicit file/project; never global cleanup or metadata teardown.
      console.log(docker([...COMPOSE, "down", ...(command === "purge" ? ["--volumes"] : [])]).trim());
      console.log(command === "purge" ? "Removed only the disposable test project and its volume." : "Removed only the test container/network; test data volume preserved.");
    }
  } finally {
    assertMetadataUnchanged(baseline, metadataSnapshot());
    console.log(baseline.logicalHash ? "PASS metadata container, volume, Compose file and logical schema/data fingerprint unchanged" : "PASS metadata resource identity and Compose file unchanged (logical data check unavailable)");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
