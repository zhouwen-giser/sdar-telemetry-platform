# Domain Projection mapping documents v1

This directory freezes deterministic mapping documents and mapped-payload schemas. Phase 7
contains the five Commander mappings only; Phase 8 adds the five NPC mappings and closes the
10/10 catalog gate.

Every source is an exact `sdar.domain-source/v1` RC2 contract. A mapping document does not permit
near-name aliases, dynamic scripts, wall-clock-derived semantic values, projection activation or
Benchmark scoring. The package default remains disabled.
