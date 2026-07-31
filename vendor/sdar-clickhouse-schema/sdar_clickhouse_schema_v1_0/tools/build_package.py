#!/usr/bin/env python3
"""Build deterministic SDAR ClickHouse release artifacts from migrations."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
VERSION = "1.3.0-rc.2"
DATABASES = (
    "sdar_meta",
    "sdar_core",
    "sdar_commander",
    "sdar_npc",
    "sdar_embodied",
    "sdar_mart",
)
EXPECTED_TABLE_COUNTS = {
    "sdar_meta": 20,
    "sdar_core": 70,
    "sdar_commander": 37,
    "sdar_npc": 39,
    "sdar_embodied": 30,
    "sdar_mart": 4,
}
GENERATED = (
    ROOT / "all.sql",
    ROOT / "docs" / "table_catalog.md",
    ROOT / "docs" / "static_validation.txt",
)

CREATE_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)


def migration_files() -> list[Path]:
    files = sorted(MIGRATIONS.glob("[0-9][0-9]_*.sql"))
    expected_prefixes = [f"{number:02d}_" for number in range(14)]
    actual_prefixes = [path.name[:3] for path in files]
    if actual_prefixes != expected_prefixes:
        raise SystemExit(
            f"expected migrations 00..13 exactly once; got: {actual_prefixes}"
        )
    return files


def build_all_sql(files: list[Path]) -> str:
    sections = [
        "-- GENERATED FILE. Edit migrations/*.sql, then run tools/build_package.py.",
        "-- SDAR ClickHouse fresh-install release candidate 1.3.0-rc.2 (Runtime v1.3 / Node Control v1.4).",
        "",
    ]
    for path in files:
        sections.extend(
            [
                f"-- ============================================================================",
                f"-- {path.name}",
                f"-- ============================================================================",
                path.read_text(encoding="utf-8").rstrip(),
                "",
            ]
        )
    return "\n".join(sections).rstrip() + "\n"


def objects(sql: str) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    for match in CREATE_RE.finditer(sql):
        kind = match.group(1).lower()
        name = match.group(2).lower()
        statement_end = sql.find(";", match.end())
        statement = sql[match.start() : statement_end if statement_end >= 0 else None]
        engine_match = re.search(r"\bENGINE\s*=\s*([A-Za-z0-9_]+)", statement)
        engine = engine_match.group(1) if engine_match else ("View" if kind == "view" else "")
        result.append((name, kind, engine))
    return result


def build_catalog(sql: str) -> str:
    grouped: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for name, kind, engine in objects(sql):
        database, object_name = name.split(".", 1)
        grouped[database].append((object_name, kind, engine))

    table_count = sum(kind == "table" for _, kind, _ in objects(sql))
    view_count = sum(kind == "view" for _, kind, _ in objects(sql))
    lines = [
        "# 对象目录",
        "",
        "> 本文件由 `tools/build_package.py` 从迁移脚本生成，请勿手工修改。",
        "",
        f"共 {table_count} 张物理表、{view_count} 个逻辑视图。对象职责与字段映射见 `schema_mapping.md`，评价表的版本合同见 `evaluation_contract.md`。",
        "",
    ]
    for database in DATABASES:
        rows = sorted(grouped.get(database, []))
        lines.extend(
            [
                f"## `{database}`",
                "",
                "| 对象 | 类型 | 引擎 |",
                "|---|---|---|",
            ]
        )
        for name, kind, engine in rows:
            label = "物理表" if kind == "table" else "视图"
            lines.append(f"| `{name}` | {label} | `{engine}` |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def static_checks(sql: str, files: list[Path]) -> tuple[str, list[str]]:
    errors: list[str] = []
    found_objects = objects(sql)
    table_count = sum(kind == "table" for _, kind, _ in found_objects)
    view_count = sum(kind == "view" for _, kind, _ in found_objects)
    if view_count != 76:
        errors.append(f"view count mismatch: expected 76, got {view_count}")

    for database in DATABASES:
        if f"CREATE DATABASE IF NOT EXISTS {database}" not in sql:
            errors.append(f"missing database declaration: {database}")

    actual_table_counts: dict[str, int] = defaultdict(int)
    for name, kind, _ in found_objects:
        if kind == "table":
            actual_table_counts[name.split(".", 1)[0]] += 1
    for database, expected in EXPECTED_TABLE_COUNTS.items():
        actual = actual_table_counts.get(database, 0)
        if actual != expected:
            errors.append(
                f"physical table count mismatch for {database}: expected {expected}, got {actual}"
            )

    if re.search(r"TTL\s+[a-z_][a-z0-9_]*\s*\+\s*INTERVAL", sql, re.IGNORECASE):
        errors.append("DateTime64 TTL must cast to DateTime before adding INTERVAL")

    for statement in re.findall(
        r"CREATE\s+TABLE\b.*?;", sql, flags=re.IGNORECASE | re.DOTALL
    ):
        if "ReplacingMergeTree" in statement:
            partition_match = re.search(
                r"\bPARTITION\s+BY\b(.*?)(?:\bORDER\s+BY\b|\bPRIMARY\s+KEY\b|\bTTL\b|$)",
                statement,
                flags=re.IGNORECASE | re.DOTALL,
            )
            if partition_match and re.search(
                r"\btoYYYYMM(?:DD)?\s*\(", partition_match.group(1), re.IGNORECASE
            ):
                name_match = CREATE_RE.search(statement)
                errors.append(
                    "mutable ReplacingMergeTree still uses time partition: "
                    + (name_match.group(2) if name_match else "unknown")
                )

    duplicate_names = sorted(
        name
        for name in {item[0] for item in found_objects}
        if sum(item[0] == name for item in found_objects) > 1
    )
    if duplicate_names:
        errors.append("objects declared more than once: " + ", ".join(duplicate_names))

    status = "PASS" if not errors else "FAIL"
    lines = [
        f"status={status}",
        f"schema_version={VERSION}",
        f"migration_count={len(files)}",
        f"database_count={len(DATABASES)}",
        f"physical_table_count={table_count}",
        f"view_count={view_count}",
        "checks=database_declarations,exact_table_counts,datetime64_ttl,stable_replacing_partitions,duplicate_objects",
    ]
    if errors:
        lines.extend(f"error={error}" for error in errors)
    return "\n".join(lines) + "\n", errors


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest(sql: str) -> str:
    found_objects = objects(sql)
    candidates = sorted(
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and path.name != "manifest.json"
        and "__pycache__" not in path.parts
    )
    payload = {
        "name": "sdar-clickhouse-schema",
        "version": VERSION,
        "release_kind": "fresh-install-release-candidate",
        "implementation_status": "static_validated_clickhouse_runtime_validation_pending",
        "target_final_version": "1.3.0",
        "clickhouse_compatibility": "24.8+",
        "recommended": "25.3 LTS+",
        "database_count": len(DATABASES),
        "physical_table_count": sum(kind == "table" for _, kind, _ in found_objects),
        "view_count": sum(kind == "view" for _, kind, _ in found_objects),
        "files": [
            {
                "path": str(path.relative_to(ROOT)),
                "size": path.stat().st_size,
                "sha256": sha256(path),
            }
            for path in candidates
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def write_or_check(path: Path, content: str, check: bool) -> bool:
    current = path.read_text(encoding="utf-8") if path.exists() else None
    if current == content:
        return False
    if check:
        print(f"STALE {path.relative_to(ROOT)}")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"WROTE {path.relative_to(ROOT)}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check", action="store_true", help="fail if generated artifacts are stale"
    )
    args = parser.parse_args()

    files = migration_files()
    all_sql = build_all_sql(files)
    catalog = build_catalog(all_sql)
    validation, errors = static_checks(all_sql, files)
    if errors:
        print(validation, end="")
        return 1

    changed = False
    for path, content in zip(GENERATED, (all_sql, catalog, validation), strict=True):
        changed |= write_or_check(path, content, args.check)

    # Manifest hashes the already generated artifacts, so it must be built last.
    manifest_content = manifest(all_sql)
    changed |= write_or_check(ROOT / "manifest.json", manifest_content, args.check)
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
