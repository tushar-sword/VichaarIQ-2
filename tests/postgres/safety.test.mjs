import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertIsolatedConfig, assertOwned, assertMetadataUnchanged, assertLocalDockerHost, logicalDumpHash, TEST } from "../../scripts/test-db.mjs";

function config() {
  return { name: TEST.project, services: { [TEST.service]: {
    container_name: TEST.container, environment: { POSTGRES_DB: TEST.database, POSTGRES_USER: "vichaar_test_admin" },
    labels: { "io.vichaariq.purpose": TEST.purpose }, ports: [{ host_ip: "127.0.0.1", published: "5544", target: 5432 }],
    volumes: [{ type: "volume", source: "ecommerce-test-pgdata", target: "/var/lib/postgresql/data" },
      { type: "bind", source: fileURLToPath(new URL("./init", import.meta.url)), target: "/docker-entrypoint-initdb.d", read_only: true }],
  } }, volumes: { "ecommerce-test-pgdata": { name: TEST.volume, labels: { "io.vichaariq.purpose": TEST.purpose } } } };
}

test("accepts the isolated loopback-only configuration", () => assertIsolatedConfig(config()));
test("refuses remote Docker daemons before inspecting or connecting to databases", () => {
  assertLocalDockerHost("unix:///var/run/docker.sock");
  assertLocalDockerHost("npipe:////./pipe/docker_engine");
  for (const endpoint of ["ssh://production", "tcp://127.0.0.1:2375", "tcp://remote:2376", "npipe:////remote/pipe/docker_engine", null]) {
    assert.throws(() => assertLocalDockerHost(endpoint));
  }
});
test("rejects metadata service or volume substitution", () => {
  const value = config();
  value.services["app-postgres"] = value.services[TEST.service];
  assert.throws(() => assertIsolatedConfig(value));
  const other = config(); other.volumes["ecommerce-test-pgdata"].name = "vichaar_iq_pgdata";
  assert.throws(() => assertIsolatedConfig(other));
});
test("rejects public bindings, wrong ports and an external volume", () => {
  for (const ip of ["0.0.0.0", "::", undefined]) {
    const value = config(); value.services[TEST.service].ports[0].host_ip = ip;
    assert.throws(() => assertIsolatedConfig(value));
  }
  const wrongPort = config(); wrongPort.services[TEST.service].ports[0].published = "5433";
  assert.throws(() => assertIsolatedConfig(wrongPort));
  const external = config(); external.volumes["ecommerce-test-pgdata"].external = true;
  assert.throws(() => assertIsolatedConfig(external));
});
test("rejects writable initialization mounts", () => {
  const value = config(); value.services[TEST.service].volumes[1].read_only = false;
  assert.throws(() => assertIsolatedConfig(value));
});
test("refuses resources without both ownership labels", () => {
  assertOwned({ project: TEST.project, purpose: TEST.purpose });
  assert.throws(() => assertOwned({ project: "metadata", purpose: TEST.purpose }));
  assert.throws(() => assertOwned({ project: TEST.project }));
});
test("normalizes pg_dump random guards while detecting data changes", () => {
  assert.equal(logicalDumpHash('\\restrict first\nINSERT 1;\n\\unrestrict first'), logicalDumpHash('\\restrict second\nINSERT 1;\n\\unrestrict second'));
  assert.notEqual(logicalDumpHash("INSERT 1;"), logicalDumpHash("INSERT 2;"));
});
test("detects metadata data and resource identity changes", () => {
  const before = { logicalHash: "data", container: { id: "original" }, volumes: ["metadata"] };
  assertMetadataUnchanged(before, structuredClone(before));
  assert.throws(() => assertMetadataUnchanged(before, { ...before, logicalHash: "changed" }));
  assert.throws(() => assertMetadataUnchanged(before, { ...before, container: { id: "replacement" } }));
});
