#!/usr/bin/env python3
"""Validate repository examples against their declared JSON Schemas."""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import jsonschema
    from jsonschema import Draft7Validator, RefResolver
except ImportError:
    print(
        '缺少依赖 jsonschema；请执行: python3 -m pip install "jsonschema>=4.18"',
        file=sys.stderr,
    )
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parent
TARGETS = (
    (
        "examples/v1_3_skill_aware/canonical-envelope.skill-execution.example.json",
        "schemas/sdar_runtime/v1_3_skill_aware/canonical-evidence-envelope.schema.json",
    ),
    (
        "examples/v1_3_skill_aware/skill-execution-record.example.json",
        "schemas/sdar_runtime/v1_3_skill_aware/skill-execution-record.schema.json",
    ),
    (
        "examples/v1_3_skill_aware/skill-plan-compliance.example.json",
        "schemas/sdar_runtime/v1_3_skill_aware/skill-plan-compliance.schema.json",
    ),
    ("examples/commander_episode.example.json", "schemas/commander/episode_evidence_bundle.schema.json"),
    ("examples/npc_episode.example.json", "schemas/npc/episode_evidence_bundle.schema.json"),
    ("examples/evaluation_result.example.json", "schemas/sdar_runtime/evaluation_result.schema.json"),
    ("npc_minimal_case_schema_v1/npc_minimal_case.example.json", "npc_minimal_case_schema_v1/npc_minimal_case.schema.json"),
    ("npc_minimal_runtime_schema_v1/npc_minimal_runtime_record.example.json", "npc_minimal_runtime_schema_v1/npc_minimal_runtime_record.schema.json"),
)

REJECTION_TARGETS = (
    ("examples/commander_episode.example.json", "schemas/npc/episode_evidence_bundle.schema.json"),
    ("examples/npc_episode.example.json", "schemas/commander/episode_evidence_bundle.schema.json"),
)


def load_json(relative_path: str) -> dict:
    path = ROOT / relative_path
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法读取 {relative_path}: {exc}") from exc


def json_path(parts) -> str:
    return "/" + "/".join(str(part) for part in parts) if parts else "/"


def main() -> int:
    schema_store = {}
    for path in sorted((ROOT / "schemas").rglob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        schema_store[path.resolve().as_uri()] = schema
        if schema.get("$id"):
            schema_store[schema["$id"]] = schema
    for _, schema_path in TARGETS:
        path = (ROOT / schema_path).resolve()
        schema = json.loads(path.read_text(encoding="utf-8"))
        schema_store[path.as_uri()] = schema
        if schema.get("$id"):
            schema_store[schema["$id"]] = schema

    validator_class = getattr(jsonschema, "Draft202012Validator", None)
    if validator_class is None:
        validator_class = Draft7Validator
        print(
            '提示: 当前 jsonschema 不支持 Draft 2020-12，正使用 Draft 7 兼容模式；正式校验请升级到 "jsonschema>=4.18"。',
            file=sys.stderr,
        )

    failure_count = 0
    for example_path, schema_path in TARGETS:
        try:
            instance = load_json(example_path)
            schema = load_json(schema_path)
            validator_class.check_schema(schema)
            resolver = RefResolver(
                base_uri=(ROOT / schema_path).resolve().as_uri(),
                referrer=schema,
                store=schema_store,
            )
            validator = validator_class(schema, resolver=resolver)
            errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
        except Exception as exc:
            print(f"FAIL {example_path}: {exc}")
            failure_count += 1
            continue

        if not errors:
            print(f"PASS {example_path} -> {schema_path}")
            continue

        failure_count += 1
        print(f"FAIL {example_path} -> {schema_path} ({len(errors)} errors)")
        for error in errors:
            print(f"  {json_path(error.absolute_path)}: {error.message}")

    for example_path, schema_path in REJECTION_TARGETS:
        try:
            instance = load_json(example_path)
            schema = load_json(schema_path)
            resolver = RefResolver(
                base_uri=(ROOT / schema_path).resolve().as_uri(),
                referrer=schema,
                store=schema_store,
            )
            errors = list(validator_class(schema, resolver=resolver).iter_errors(instance))
        except Exception as exc:
            print(f"FAIL 隔离检查 {example_path} x {schema_path}: {exc}")
            failure_count += 1
            continue

        if errors:
            print(f"PASS 隔离检查 {example_path} 被 {schema_path} 拒绝")
        else:
            print(f"FAIL 隔离检查 {example_path} 不应符合 {schema_path}")
            failure_count += 1

    if failure_count:
        print(f"\n校验失败: {failure_count} 项检查未通过。")
        return 1

    print(f"\n校验通过: {len(TARGETS)} 个正向示例和 {len(REJECTION_TARGETS)} 个系统隔离检查均通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
