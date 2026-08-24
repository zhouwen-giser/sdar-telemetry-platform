from pathlib import Path
import base64
import hashlib
import json
import os
import re
from urllib.parse import urlparse


DOCKERFILE_FRONTEND = (
    "# syntax=docker/dockerfile:1.19@sha256:"
    "b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6"
)
NODE_22_ALPINE_BASE = (
    "node:22-alpine@sha256:"
    "c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32"
)
OFFLINE_NPM_BUILD_LINES = [
    "RUN node scripts/vendor-npm-cache.mjs verify \\",
    "      --lock package-lock.json --cache /app/vendor/npm-cache \\",
    "    && npm ci --offline --cache=/app/vendor/npm-cache \\",
    "      --include=dev --ignore-scripts --no-audit --no-fund --no-update-notifier \\",
    "    && npm run build \\",
    "    && npm prune --offline --omit=dev --ignore-scripts \\",
    "      --no-audit --no-fund --no-update-notifier",
]
OFFLINE_NPM_BUILD_INSTRUCTION = "\n".join(OFFLINE_NPM_BUILD_LINES)
VENDOR_CACHE_COPY = "COPY vendor/npm-cache /app/vendor/npm-cache"


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


def dockerfile_build_and_runtime_stages(document: str) -> tuple[str, str]:
    stage_headers = list(re.finditer(r"^FROM [^\r\n]+$", document, re.MULTILINE))
    assert len(stage_headers) == 2, "Dockerfile must contain exactly build and runtime stages"
    build_header, runtime_header = stage_headers
    assert re.search(r"\sAS\s+build\s*$", build_header.group(), re.IGNORECASE), (
        "first Dockerfile stage must be named build"
    )
    build_stage = document[build_header.start() : runtime_header.start()]
    runtime_stage = document[runtime_header.start() :]
    return build_stage, runtime_stage


def assert_node_base_image_contract(document: str) -> None:
    stage_headers = [
        match.group()
        for match in re.finditer(r"^FROM [^\r\n]+$", document, re.MULTILINE)
    ]
    assert len(stage_headers) == 2, "Dockerfile must contain exactly two Node base stages"
    assert stage_headers[0] == f"FROM {NODE_22_ALPINE_BASE} AS build", (
        "build stage must use the exact frozen Node 22 Alpine digest"
    )
    assert stage_headers[1] == f"FROM {NODE_22_ALPINE_BASE}", (
        "final runtime stage must use the exact frozen Node 22 Alpine digest"
    )


def vendor_cache_descriptors(package_lock: dict[str, object]) -> list[dict[str, object]]:
    packages = package_lock.get("packages")
    assert isinstance(packages, dict), "npm lock must contain the complete packages graph"
    descriptors: list[dict[str, object]] = []
    for lock_path, value in sorted(packages.items()):
        if lock_path == "":
            continue
        assert isinstance(value, dict), f"invalid npm lock entry: {lock_path}"
        name = lock_path.split("node_modules/")[-1]
        version = value.get("version")
        resolved = value.get("resolved")
        integrity = value.get("integrity")
        assert all(isinstance(field, str) for field in [name, version, resolved, integrity]), (
            f"npm lock entry is incomplete: {lock_path}"
        )
        parsed_url = urlparse(resolved)
        assert (
            parsed_url.scheme == "https"
            and parsed_url.netloc == "registry.npmjs.org"
            and parsed_url.username is None
            and parsed_url.password is None
            and not parsed_url.query
            and not parsed_url.fragment
        ), f"npm lock URL is outside the exact HTTPS npm registry origin: {resolved}"
        assert integrity.startswith("sha512-"), f"unsupported npm integrity: {integrity}"
        expected_sha512 = base64.b64decode(integrity.removeprefix("sha512-"), validate=True)
        assert len(expected_sha512) == 64, f"invalid npm SHA-512 integrity: {integrity}"
        sha512_hex = expected_sha512.hex()
        content_path = (
            f"_cacache/content-v2/sha512/{sha512_hex[:2]}/"
            f"{sha512_hex[2:4]}/{sha512_hex[4:]}"
        )
        index_key = f"make-fetch-happen:request-cache:{resolved}"
        index_hash = hashlib.sha256(index_key.encode()).hexdigest()
        descriptors.append(
            {
                "lockPath": lock_path,
                "name": name,
                "version": version,
                "resolved": resolved,
                "integrity": integrity,
                "licenseObservation": value.get("license", "UNDECLARED"),
                "contentPath": content_path,
                "sha512": sha512_hex,
                "indexPath": (
                    f"_cacache/index-v5/{index_hash[:2]}/"
                    f"{index_hash[2:4]}/{index_hash[4:]}"
                ),
                "indexKey": index_key,
            }
        )
    assert descriptors, "npm lock must contain a package closure"
    assert len({entry["contentPath"] for entry in descriptors}) == len(descriptors), (
        "npm lock closure must have unique content objects"
    )
    assert len({entry["indexPath"] for entry in descriptors}) == len(descriptors), (
        "npm lock closure must have unique exact URL index entries"
    )
    return descriptors


def canonical_vendor_index(entry: dict[str, object], size: int) -> bytes:
    record = {
        "key": entry["indexKey"],
        "integrity": entry["integrity"],
        "time": 1,
        "size": size,
        "metadata": {
            "time": 1,
            "url": entry["resolved"],
            "options": {"compress": True},
        },
    }
    serialized = json.dumps(record, separators=(",", ":"))
    record_hash = hashlib.sha1(serialized.encode()).hexdigest()
    return f"\n{record_hash}\t{serialized}".encode()


def assert_vendor_cache_contract(
    root: Path,
    package_lock_path: Path,
    package_lock: dict[str, object],
) -> dict[str, object]:
    cache_root = root / "vendor/npm-cache"
    manifest_path = cache_root / "manifest.json"
    descriptors = vendor_cache_descriptors(package_lock)
    content_by_path: dict[str, bytes] = {}
    index_by_path: dict[str, bytes] = {}
    rows: list[dict[str, object]] = []

    for entry in descriptors:
        content_path = cache_root / str(entry["contentPath"])
        assert content_path.is_file() and not content_path.is_symlink(), (
            f"vendor cache content is missing or unsafe: {entry['contentPath']}"
        )
        content = content_path.read_bytes()
        actual_sha512 = hashlib.sha512(content).hexdigest()
        assert actual_sha512 == entry["sha512"], (
            f"vendor cache content SHA-512 mismatch: {entry['contentPath']}"
        )
        content_by_path[str(entry["contentPath"])] = content

        index_path = cache_root / str(entry["indexPath"])
        assert index_path.is_file() and not index_path.is_symlink(), (
            f"vendor cache index is missing or unsafe: {entry['indexPath']}"
        )
        index_content = index_path.read_bytes()
        assert index_content == canonical_vendor_index(entry, len(content)), (
            f"vendor cache index is not canonical: {entry['indexPath']}"
        )
        index_by_path[str(entry["indexPath"])] = index_content
        rows.append(
            {
                key: value
                for key, value in entry.items()
                if key not in {"lockPath", "indexKey"}
            }
            | {"size": len(content)}
        )
        rows[-1] = {
            key: rows[-1][key]
            for key in [
                "name",
                "version",
                "resolved",
                "integrity",
                "licenseObservation",
                "contentPath",
                "sha512",
                "size",
                "indexPath",
            ]
        }

    aggregate = hashlib.sha256()
    for entry in descriptors:
        content = content_by_path[str(entry["contentPath"])]
        aggregate.update(f"{entry['integrity']}\0{len(content)}\0".encode())
        aggregate.update(content)
    licenses: dict[str, int] = {}
    for entry in descriptors:
        license_name = str(entry["licenseObservation"])
        licenses[license_name] = licenses.get(license_name, 0) + 1
    content_bytes = sum(len(content) for content in content_by_path.values())
    index_bytes = sum(len(content) for content in index_by_path.values())
    expected_manifest = {
        "schemaVersion": 1,
        "source": {
            "lockfile": "package-lock.json",
            "lockfileSha256": hashlib.sha256(package_lock_path.read_bytes()).hexdigest(),
            "registryOrigin": "https://registry.npmjs.org",
        },
        "cacheFormat": {
            "content": "content-v2",
            "index": "index-v5",
            "npmConsumerVersion": "10.9.8",
            "indexMetadataPolicy": (
                "deterministic URL and compression only; no copied host headers, "
                "credentials, or timestamps"
            ),
        },
        "licenseObservationScope": (
            "Values are package-lock metadata observations, not legal review or clearance."
        ),
        "licenseObservations": dict(sorted(licenses.items())),
        "totals": {
            "packages": len(rows),
            "contentObjects": len(content_by_path),
            "indexEntries": len(index_by_path),
            "contentBytes": content_bytes,
            "indexBytes": index_bytes,
            "cacheBytes": content_bytes + index_bytes,
        },
        "aggregateContentSha256": aggregate.hexdigest(),
        "packages": rows,
    }
    actual_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert actual_manifest == expected_manifest, (
        "vendor cache manifest must exactly match the lock-derived closure"
    )

    expected_files = {
        "manifest.json",
        *(
            relative_path
            for entry in descriptors
            for relative_path in [str(entry["contentPath"]), str(entry["indexPath"])]
        ),
    }
    actual_files = {
        path.relative_to(cache_root).as_posix()
        for path in cache_root.rglob("*")
        if path.is_file()
    }
    assert actual_files == expected_files, (
        "vendor cache must contain exactly the lock-addressed manifest, content, and index files"
    )
    assert not any(path.is_symlink() for path in cache_root.rglob("*")), (
        "vendor cache must not contain symlinks"
    )
    return expected_manifest


def assert_dependency_install_contract(
    document: str,
    manifest: dict[str, object],
    package_lock: dict[str, object],
) -> None:
    build_stage, _ = dockerfile_build_and_runtime_stages(document)
    build_lines = build_stage.splitlines()
    lock_copy = "COPY package.json package-lock.json tsconfig.json ./"

    assert document.splitlines()[0] == DOCKERFILE_FRONTEND, (
        "Dockerfile must use the exact frozen frontend digest"
    )
    assert document.splitlines().count(DOCKERFILE_FRONTEND) == 1, (
        "Dockerfile frontend digest must appear exactly once"
    )
    assert build_lines.count(lock_copy) == 1, (
        "build stage must copy package-lock.json exactly once"
    )
    assert "pnpm-lock.yaml" not in build_stage, (
        "build stage must not copy a lock ignored by npm"
    )
    assert build_lines.count(VENDOR_CACHE_COPY) == 1, (
        "build stage must copy the product-owned vendor npm cache exactly once"
    )
    assert build_stage.count(OFFLINE_NPM_BUILD_INSTRUCTION) == 1, (
        "build stage must use the exact verified offline npm instruction"
    )
    assert build_lines.index(lock_copy) < build_lines.index(VENDOR_CACHE_COPY), (
        "build stage must copy package-lock.json before npm ci"
    )
    assert build_lines.index(VENDOR_CACHE_COPY) < build_lines.index(OFFLINE_NPM_BUILD_LINES[0]), (
        "build stage must copy the vendor cache before verifying and consuming it"
    )
    assert "npm install" not in build_stage, "build stage must not execute npm install"
    assert "--mount=type=cache" not in build_stage and "/root/.npm" not in build_stage, (
        "build stage must not hide the committed closure with a mutable npm cache mount"
    )
    assert "--prefer-offline" not in build_stage, (
        "build stage must require fully offline npm dependency consumption"
    )

    assert package_lock.get("lockfileVersion") == 3, "npm lockfileVersion must be 3"
    packages = package_lock.get("packages")
    assert isinstance(packages, dict), "npm lock must contain the complete packages graph"
    root_package = packages.get("")
    assert isinstance(root_package, dict), "npm lock must contain the root importer"
    for dependency_class in ["dependencies", "devDependencies"]:
        assert root_package.get(dependency_class, {}) == manifest.get(dependency_class, {}), (
            f"npm lock root {dependency_class} must match package.json"
        )
    locked_packages = [value for path, value in packages.items() if path != ""]
    assert locked_packages, "npm lock must contain transitive package entries"
    assert all(
        isinstance(value, dict) and "resolved" in value and "integrity" in value
        for value in locked_packages
    ), "every non-root npm lock entry must freeze resolution and integrity"


def assert_integration_copy_contract(document: str) -> None:
    build_stage, runtime_stage = dockerfile_build_and_runtime_stages(document)
    build_copy = "COPY integrations integrations"
    runtime_copy = "COPY integrations ./integrations"
    build_lines = build_stage.splitlines()
    runtime_lines = runtime_stage.splitlines()

    assert build_lines.count(build_copy) == 1, (
        "build stage must copy integrations exactly once"
    )
    assert build_stage.count(OFFLINE_NPM_BUILD_INSTRUCTION) == 1, (
        "build stage must contain the exact verified offline install/build/prune instruction"
    )
    assert build_lines.index(build_copy) < build_lines.index(OFFLINE_NPM_BUILD_LINES[0]), (
        "build stage must copy integrations before npm build"
    )
    assert runtime_lines.count(runtime_copy) == 1, (
        "runtime stage must retain the raw integrations copy"
    )


root = Path(__file__).resolve().parents[1]
compose_path = root / "deploy/compose.external-clickhouse.yaml"
dockerfile_path = root / "deploy/Dockerfile"
env_example_path = root / ".env.example"
manifest_path = root / "package.json"
package_lock_path = root / "package-lock.json"

compose = compose_path.read_text(encoding="utf-8")
dockerfile = dockerfile_path.read_text(encoding="utf-8")
_, runtime_stage = dockerfile_build_and_runtime_stages(dockerfile)
assert_node_base_image_contract(dockerfile)
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
package_lock = json.loads(package_lock_path.read_text(encoding="utf-8"))
assert_dependency_install_contract(dockerfile, manifest, package_lock)
vendor_cache_manifest = assert_vendor_cache_contract(root, package_lock_path, package_lock)
assert vendor_cache_manifest["totals"] == {
    "packages": 22,
    "contentObjects": 22,
    "indexEntries": 22,
    "contentBytes": 5_097_438,
    "indexBytes": 8_768,
    "cacheBytes": 5_106_206,
}, "vendor cache closure totals drifted"
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
    "COPY migrations ./migrations",
]:
    assert required_copy in runtime_stage, f"runtime image is missing: {required_copy}"
assert_integration_copy_contract(dockerfile)

# Regression probe for the exact r2 failure: a Dockerfile with only the runtime raw-assets copy
# must not satisfy the build-input contract.
runtime_copy_only_fixture = dockerfile.replace("COPY integrations integrations\n", "", 1)
try:
    assert_integration_copy_contract(runtime_copy_only_fixture)
except AssertionError as error:
    assert "build stage must copy integrations exactly once" in str(error), (
        "runtime-only integrations regression probe failed for an unexpected reason"
    )
else:
    raise AssertionError("runtime-only integrations copy unexpectedly passed the build contract")

# Both direct Node stages must independently reject the former floating tag.
floating_build_base_fixture = dockerfile.replace(
    f"FROM {NODE_22_ALPINE_BASE} AS build",
    "FROM node:22-alpine AS build",
    1,
)
try:
    assert_node_base_image_contract(floating_build_base_fixture)
except AssertionError as error:
    assert "build stage must use the exact frozen Node 22 Alpine digest" in str(error), (
        "floating build-base regression probe failed for an unexpected reason"
    )
else:
    raise AssertionError("floating build-stage Node tag unexpectedly passed the base-image contract")

floating_runtime_base_fixture = dockerfile.replace(
    f"FROM {NODE_22_ALPINE_BASE}\n",
    "FROM node:22-alpine\n",
    1,
)
try:
    assert_node_base_image_contract(floating_runtime_base_fixture)
except AssertionError as error:
    assert "final runtime stage must use the exact frozen Node 22 Alpine digest" in str(error), (
        "floating runtime-base regression probe failed for an unexpected reason"
    )
else:
    raise AssertionError("floating runtime Node tag unexpectedly passed the base-image contract")

floating_frontend_fixture = dockerfile.replace(
    DOCKERFILE_FRONTEND,
    "# syntax=docker/dockerfile:1.19",
    1,
)
try:
    assert_dependency_install_contract(floating_frontend_fixture, manifest, package_lock)
except AssertionError as error:
    assert "exact frozen frontend digest" in str(error), (
        "floating frontend regression probe failed for an unexpected reason"
    )
else:
    raise AssertionError("floating Dockerfile frontend unexpectedly passed the install contract")

legacy_npm_install_fixture = dockerfile.replace(
    OFFLINE_NPM_BUILD_INSTRUCTION,
    "RUN npm install --ignore-scripts && npm run build && npm prune --omit=dev",
    1,
)
try:
    assert_dependency_install_contract(legacy_npm_install_fixture, manifest, package_lock)
except AssertionError as error:
    assert "exact verified offline npm instruction" in str(error), (
        "legacy npm install regression probe failed for an unexpected reason"
    )
else:
    raise AssertionError("legacy npm install unexpectedly passed the install contract")

mutable_cache_fixture = dockerfile.replace(
    OFFLINE_NPM_BUILD_INSTRUCTION,
    "RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline",
    1,
)
try:
    assert_dependency_install_contract(mutable_cache_fixture, manifest, package_lock)
except AssertionError as error:
    assert "exact verified offline npm instruction" in str(error), (
        "mutable npm cache regression probe failed for an unexpected reason"
    )
else:
    raise AssertionError("mutable npm cache mount unexpectedly passed the install contract")
for ignored_path in [".git", ".env", "deploy/secrets", "node_modules", "dist"]:
    assert ignored_path in dockerignore.splitlines(), f"docker context does not ignore {ignored_path}"

gateway = compose_service(compose, "ingestion-gateway")
worker = compose_service(compose, "telemetry-worker")
query = compose_service(compose, "query-api")
admin = compose_service(compose, "admin-api")
domain_worker = compose_service(compose, "domain-projection-worker")
legacy_relay = compose_service(compose, "sdar-outbox-relay")
control_postgres = compose_service(compose, "control-postgres")

for service_name, service in [
    ("ingestion-gateway", gateway),
    ("telemetry-worker", worker),
    ("query-api", query),
    ("admin-api", admin),
    ("domain-projection-worker", domain_worker),
]:
    assert "env_file:" not in service, f"{service_name} receives the complete root .env"
    assert "./secrets:/run/secrets" not in service, f"{service_name} mounts the complete secret directory"

wal_mount = "telemetry_wal:/var/lib/sdar-telemetry/wal"
assert wal_mount in gateway, "gateway WAL is not backed by the named volume"
assert wal_mount in worker, "worker does not consume the durable gateway WAL volume"
assert "WAL_DIR: ${WAL_DIR:-/var/lib/sdar-telemetry/wal}" in gateway
assert "WAL_DIR: ${WAL_DIR:-/var/lib/sdar-telemetry/wal}" in worker
assert "secrets: [evidence_ingest_bearer_token, domain_source_ingest_bearer_token]" in gateway
assert "secrets: [clickhouse_password]" in worker
assert "secrets: [clickhouse_query_password, query_api_bearer_token]" in query
assert "EVIDENCE_INGEST_BEARER_TOKEN_FILE: /run/secrets/evidence_ingest_bearer_token" in gateway
assert "DOMAIN_SOURCE_INGEST_BEARER_TOKEN_FILE: /run/secrets/domain_source_ingest_bearer_token" in gateway
assert "CLICKHOUSE_PASSWORD_FILE: /run/secrets/clickhouse_password" in worker
assert "CLICKHOUSE_QUERY_PASSWORD_FILE: /run/secrets/clickhouse_query_password" in query
assert "QUERY_API_BEARER_TOKEN_FILE: /run/secrets/query_api_bearer_token" in query
assert "ADMIN_API_BEARER_TOKEN_FILE: /run/secrets/admin_api_bearer_token" in admin
assert "CONTROL_POSTGRES_URL_FILE: /run/secrets/control_postgres_url" in admin
assert "CONTROL_POSTGRES_URL_FILE: /run/secrets/control_postgres_url" in domain_worker
assert "secrets: [admin_api_bearer_token, control_postgres_url]" in admin
assert "secrets: [clickhouse_password, control_postgres_url]" in domain_worker
assert "DOMAIN_PROJECTION_MAX_MODE: ${DOMAIN_PROJECTION_MAX_MODE:-shadow}" in domain_worker
assert "DOMAIN_PROJECTION_ENABLED: ${DOMAIN_PROJECTION_ENABLED:-true}" in domain_worker
assert "DOMAIN_PROJECTION_BIND_HOST: 0.0.0.0" in domain_worker
assert "${ADMIN_PUBLISH_HOST:-127.0.0.1}" in admin
assert "${DOMAIN_PROJECTION_PUBLISH_HOST:-127.0.0.1}" in domain_worker
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
    "DOMAIN_SOURCE_INGEST_BEARER_TOKEN_FILE=/run/secrets/domain_source_ingest_bearer_token",
    "QUERY_API_BEARER_TOKEN_FILE=/run/secrets/query_api_bearer_token",
    "ADMIN_API_BEARER_TOKEN_FILE=/run/secrets/admin_api_bearer_token",
    "CONTROL_POSTGRES_URL_FILE=/run/secrets/control_postgres_url",
    "DOMAIN_PROJECTION_MAX_MODE=shadow",
    "DOMAIN_PROJECTION_HEALTH_PORT=8083",
    "SDAR_EVIDENCE_SCHEMA_ROOT=/app/integrations/skill-driven-agent-runtime/v1.4.1/schemas/evidence/v1",
]:
    assert required_setting in env_example, f"missing safe example setting: {required_setting}"
assert not re.search(
    r"^(?:CLICKHOUSE(?:_QUERY)?_PASSWORD|EVIDENCE_INGEST_BEARER_TOKEN|QUERY_API_BEARER_TOKEN|ADMIN_API_BEARER_TOKEN|CONTROL_POSTGRES_URL)=.+$",
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
