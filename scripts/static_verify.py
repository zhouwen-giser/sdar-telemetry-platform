from pathlib import Path
import os
import re


def compose_service(document: str, service_name: str) -> str:
    lines = document.splitlines()
    marker = f"  {service_name}:"
    try:
        start = lines.index(marker)
    except ValueError as error:
        raise AssertionError(f"compose service is missing: {service_name}") from error
    end = start + 1
    while end < len(lines):
        line = lines[end]
        if line.startswith("  ") and not line.startswith("    "):
            break
        if line and not line.startswith(" "):
            break
        end += 1
    return "\n".join(lines[start:end])


def assert_no_nested_forbidden_paths(project_root: Path) -> None:
    forbidden_names = {"node_modules", ".git", ".env"}
    allowed_root_directories = {"node_modules", ".git", "dist", "runtime", "vendor"}
    hits: list[Path] = []

    for current_directory, directory_names, file_names in os.walk(project_root):
        current = Path(current_directory)
        if current == project_root:
            directory_names[:] = [
                name for name in directory_names if name not in allowed_root_directories
            ]
            candidates = [name for name in file_names if name != ".env"] + directory_names
        else:
            candidates = file_names + directory_names

        for name in candidates:
            if name in forbidden_names:
                hits.append(current / name)
        directory_names[:] = [
            name for name in directory_names if name not in forbidden_names
        ]

    assert not hits, ("nested forbidden paths", hits[:3])


root = Path(__file__).resolve().parents[1]
compose_path = root / "deploy/compose.external-clickhouse.yaml"
dockerfile_path = root / "deploy/Dockerfile"
env_example_path = root / ".env.example"

compose = compose_path.read_text(encoding="utf-8")
dockerfile = dockerfile_path.read_text(encoding="utf-8")
env_example = env_example_path.read_text(encoding="utf-8")
readme = (root / "README.md").read_text(encoding="utf-8")
relay = (root / "apps/sdar-outbox-relay/src/main.ts").read_text(encoding="utf-8")
gitignore = (root / ".gitignore").read_text(encoding="utf-8")
dockerignore = (root / ".dockerignore").read_text(encoding="utf-8")
assert "env_file:" not in compose, "Compose must use per-service environment allowlists"

# ClickHouse is external and must never become a service in the default Compose topology.
assert not re.search(r"^  clickhouse:", compose, re.MULTILINE), (
    "default compose contains clickhouse service"
)
assert (
    root
    / "vendor/sdar-clickhouse-schema/sdar_clickhouse_schema_v1_0/migrations/13_sdar_v1_4_capability_chain.sql"
).exists()

# The production image needs ESM metadata, runtime dependencies, the frozen producer contract and
# control migrations. The build context excludes every normal local credential location.
for required_copy in [
    "COPY package.json ./package.json",
    "COPY --from=build /app/node_modules ./node_modules",
    "COPY integrations ./integrations",
    "COPY migrations ./migrations",
]:
    assert required_copy in dockerfile, f"runtime image is missing: {required_copy}"
for ignored_path in [".git", ".env", "deploy/secrets", "node_modules", "dist"]:
    assert ignored_path in dockerignore.splitlines(), f"docker context does not ignore {ignored_path}"

gateway = compose_service(compose, "ingestion-gateway")
worker = compose_service(compose, "telemetry-worker")
query = compose_service(compose, "query-api")
legacy_relay = compose_service(compose, "sdar-outbox-relay")
control_postgres = compose_service(compose, "control-postgres")

for service_name, service in [
    ("ingestion-gateway", gateway),
    ("telemetry-worker", worker),
    ("query-api", query),
]:
    assert "env_file:" not in service, f"{service_name} receives the complete root .env"
    assert "./secrets:/run/secrets" not in service, f"{service_name} mounts the complete secret directory"

wal_mount = "telemetry_wal:/var/lib/sdar-telemetry/wal"
assert wal_mount in gateway, "gateway WAL is not backed by the named volume"
assert wal_mount in worker, "worker does not consume the durable gateway WAL volume"
assert "WAL_DIR: ${WAL_DIR:-/var/lib/sdar-telemetry/wal}" in gateway
assert "WAL_DIR: ${WAL_DIR:-/var/lib/sdar-telemetry/wal}" in worker
assert "secrets: [evidence_ingest_bearer_token]" in gateway
assert "secrets: [clickhouse_password]" in worker
assert "secrets: [clickhouse_query_password, query_api_bearer_token]" in query
assert "EVIDENCE_INGEST_BEARER_TOKEN_FILE: /run/secrets/evidence_ingest_bearer_token" in gateway
assert "CLICKHOUSE_PASSWORD_FILE: /run/secrets/clickhouse_password" in worker
assert "CLICKHOUSE_QUERY_PASSWORD_FILE: /run/secrets/clickhouse_query_password" in query
assert "QUERY_API_BEARER_TOKEN_FILE: /run/secrets/query_api_bearer_token" in query
assert "${GATEWAY_PUBLISH_HOST:-127.0.0.1}" in gateway
assert "${QUERY_PUBLISH_HOST:-127.0.0.1}" in query
assert "SDAR_EVIDENCE_SCHEMA_ROOT: /app/integrations/" in gateway
assert "../migrations/control-postgres:/docker-entrypoint-initdb.d:ro" in control_postgres

# The old polling relay is opt-in and remains tied to v1.3 telemetry_outbox only.
assert "profiles: [legacy-v1.3]" in legacy_relay
assert 'io.sdar.telemetry.compatibility: "v1.3-legacy-only"' in legacy_relay
assert "telemetry_outbox" in relay
assert "evidence_outbox" not in relay
assert "SDAR_DATABASE_URL" in relay
assert "compatibility-only" in readme
assert "不能读取或更新 v1.4 的 `evidence_outbox`" in readme

# The committed template names only secret-file references. Operators may use an inline token in
# their ignored local .env, but an inline credential must never appear in the tracked example.
for required_setting in [
    "CLICKHOUSE_PASSWORD_FILE=/run/secrets/clickhouse_password",
    "CLICKHOUSE_QUERY_PASSWORD_FILE=/run/secrets/clickhouse_query_password",
    "EVIDENCE_INGEST_BEARER_TOKEN_FILE=/run/secrets/evidence_ingest_bearer_token",
    "QUERY_API_BEARER_TOKEN_FILE=/run/secrets/query_api_bearer_token",
    "SDAR_EVIDENCE_SCHEMA_ROOT=/app/integrations/skill-driven-agent-runtime/v1.4.1/schemas/evidence/v1",
]:
    assert required_setting in env_example, f"missing safe example setting: {required_setting}"
assert not re.search(
    r"^(?:CLICKHOUSE(?:_QUERY)?_PASSWORD|EVIDENCE_INGEST_BEARER_TOKEN|QUERY_API_BEARER_TOKEN)=.+$",
    env_example,
    re.MULTILINE,
), "tracked env example contains an inline credential"
assert re.search(r"^# SDAR_DATABASE_URL=$", env_example, re.MULTILINE)
assert "legacy-v1.3" in env_example
assert ".env" in gitignore.splitlines()
assert "deploy/secrets/" in gitignore.splitlines()
assert "Authorization: Bearer <query-token>" in readme

# Root .git, node_modules, dist and a developer's ignored .env are normal local state. Detect only
# nested copies elsewhere (outside the vendored frozen bundle) and prune large allowed roots so the
# static gate remains fast and does not report the repository's own installed node_modules.
assert_no_nested_forbidden_paths(root)

print("static_verify: PASS")
