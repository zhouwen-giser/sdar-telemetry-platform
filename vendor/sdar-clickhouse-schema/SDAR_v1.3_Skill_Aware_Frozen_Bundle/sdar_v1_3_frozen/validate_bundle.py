#!/usr/bin/env python3
"""Validate SDAR v1.3 frozen JSON Schemas and examples."""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    from jsonschema import Draft202012Validator, RefResolver
except ImportError as exc:
    raise SystemExit("Install jsonschema: python -m pip install jsonschema") from exc


ROOT = Path(__file__).resolve().parent
SCHEMA_DIR = ROOT / "schema"
EXAMPLE_DIR = ROOT / "examples"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validator_for(schema_name: str) -> Draft202012Validator:
    common = load_json(SCHEMA_DIR / "common-definitions.schema.json")
    schema = load_json(SCHEMA_DIR / schema_name)
    store = {
        common["$id"]: common,
        schema["$id"]: schema,
    }
    resolver = RefResolver.from_schema(schema, store=store)
    return Draft202012Validator(schema, resolver=resolver)


def validate(schema_name: str, example_name: str) -> list[str]:
    validator = validator_for(schema_name)
    instance = load_json(EXAMPLE_DIR / example_name)
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
    return [f"{list(error.path)}: {error.message}" for error in errors]


def main() -> int:
    for schema_path in sorted(SCHEMA_DIR.glob("*.schema.json")):
        Draft202012Validator.check_schema(load_json(schema_path))

    pairs = [
        ("skill-execution-record.schema.json", "skill-execution-record.example.json"),
        ("skill-plan-compliance.schema.json", "skill-plan-compliance.example.json"),
        ("canonical-evidence-envelope.schema.json", "canonical-envelope.skill-execution.example.json"),
    ]

    failed = False
    for schema_name, example_name in pairs:
        errors = validate(schema_name, example_name)
        if errors:
            failed = True
            print(f"FAIL {example_name} against {schema_name}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"PASS {example_name} against {schema_name}")

    print(f"Checked {len(list(SCHEMA_DIR.glob('*.schema.json')))} JSON Schemas.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
