import assert from "node:assert/strict";
import test from "node:test";

import {loadConfig} from "../../packages/telemetry-config/src/index.js";

test("Domain Projection configuration has safe validated defaults", () => {
  const config = loadConfig({});
  assert.equal(config.authProfile, "bearer");
  assert.equal(config.domainProjection.enabled, true);
  assert.equal(config.domainProjection.maxMode, "shadow");
  assert.equal(config.domainProjection.batchSize, 500);
  assert.equal(config.domainProjection.lookbackMs, 1_800_000);
  assert.equal(config.domainProjection.leaseMs, 30_000);
  assert.equal(config.domainProjection.heartbeatMs, 10_000);
  assert.equal(config.domainProjection.healthPort, 8083);
  assert.equal(config.domainProjection.environmentMapVersion, "identity/1");
});

test("development-anonymous auth is explicit, development-only, and credential-free", () => {
  assert.equal(
    loadConfig({
      SDAR_TELEMETRY_AUTH_PROFILE: "development-anonymous",
      NODE_ENV: "development",
      ADMIN_API_BEARER_TOKEN: "admin-remains-independent",
    }).authProfile,
    "development-anonymous",
  );

  for (const environment of [
    {SDAR_TELEMETRY_AUTH_PROFILE: "anonymous", NODE_ENV: "development"},
    {SDAR_TELEMETRY_AUTH_PROFILE: "development-anonymous"},
    {SDAR_TELEMETRY_AUTH_PROFILE: "development-anonymous", NODE_ENV: "production"},
  ]) assert.throws(() => loadConfig(environment));

  for (const field of [
    "EVIDENCE_INGEST_BEARER_TOKEN",
    "EVIDENCE_INGEST_BEARER_TOKEN_FILE",
    "DOMAIN_SOURCE_INGEST_BEARER_TOKEN",
    "DOMAIN_SOURCE_INGEST_BEARER_TOKEN_FILE",
    "QUERY_API_BEARER_TOKEN",
    "QUERY_API_BEARER_TOKEN_FILE",
  ]) {
    assert.throws(
      () =>
        loadConfig({
          SDAR_TELEMETRY_AUTH_PROFILE: "development-anonymous",
          NODE_ENV: "development",
          [field]: "",
        }),
      /SDAR_TELEMETRY_DEVELOPMENT_ANONYMOUS_CREDENTIAL_CONFIGURED/u,
      field,
    );
  }
});

test("invalid Domain Projection numbers, booleans and enums fail startup", () => {
  for (const environment of [
    {DOMAIN_PROJECTION_ENABLED: "yes"},
    {DOMAIN_PROJECTION_MAX_MODE: "production"},
    {DOMAIN_PROJECTION_BATCH_SIZE: "0"},
    {DOMAIN_PROJECTION_BATCH_SIZE: "1001"},
    {DOMAIN_PROJECTION_POLL_INTERVAL_MS: "NaN"},
    {DOMAIN_PROJECTION_LOOKBACK_MS: "999"},
    {DOMAIN_PROJECTION_LEASE_MS: "300001"},
    {DOMAIN_PROJECTION_HEARTBEAT_MS: "30000", DOMAIN_PROJECTION_LEASE_MS: "30000"},
    {DOMAIN_PROJECTION_HEALTH_PORT: "65536"},
    {DOMAIN_ENVIRONMENT_MAP_VERSION: "custom/1"},
  ]) assert.throws(() => loadConfig(environment));
});
