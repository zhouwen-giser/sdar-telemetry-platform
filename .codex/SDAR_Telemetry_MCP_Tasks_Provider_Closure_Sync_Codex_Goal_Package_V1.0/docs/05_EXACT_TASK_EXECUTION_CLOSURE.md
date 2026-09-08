# 05 — Exact Task to Execution Closure

## Problem

Current Provider Closure v2 establishes exact Provider Task fact selection but does not prove a unique Provider Execution.

A ready closure must not be satisfied by an unrelated state/resource fact.

## Algorithm

For each authoritative Runtime binding:

1. Select Provider facts only by exact Runtime binding tuple.
2. From selected facts / approved provider-internal relations, extract Provider Execution candidate IDs.
3. Deduplicate candidates by deterministic identity.
4. Validate same identity has stable content hash.
5. Compute matchCount.

Result:

- `0 -> unresolved`
- `1 -> exact`
- `>1 -> conflict`

## Forbidden disambiguators

Do not choose one candidate because it is:

- latest;
- earliest;
- closest in time;
- same resource only;
- same operation name only;
- same trace only.

## Required detail record

Persist enough typed detail for a downstream auditor to see:

- authoritative binding id;
- Remote Task id;
- exact Provider tuple;
- candidate execution IDs;
- selected execution ID when exact;
- source fact/relation IDs;
- status;
- content hash.

## Readiness

A required Remote Task with no exact execution closure cannot be `ready`.

If the upstream contract explicitly models a Remote Task that legally has no Provider Execution, represent that case by a frozen semantic category; do not invent an exception in code.
