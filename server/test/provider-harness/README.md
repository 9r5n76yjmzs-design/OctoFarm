# Provider harness test foundation

This directory is the reusable test substrate for OR-11. It is intentionally separate from production provider code.

## Test categories

- `../characterization/` records observable preserved OctoFarm behavior. Characterization evidence is descriptive and does not automatically make legacy behavior normative.
- `provider-harness/` proves the accepted provider contract, compliance requirements, and synthetic protocol behavior.
- `fixtures/` contains declarative, inspectable scenario data with stable fixture IDs.

A historical defect may therefore have both a characterization test describing the preserved behavior and a contract/compliance test describing the required target behavior. The former never overrides ADR-008 or the provider contract.

## Fixture envelope

Every JSON fixture uses schema version `1` and contains:

- `id`: stable identifier such as `REG-HARNESS-001` or a future `ADV-008` fixture;
- `purpose`: `characterization`, `contract`, or `regression`;
- `description`: human-readable scenario intent;
- `requirements`: stable `OR11-REQ-###` traceability identifiers;
- `source`: provenance for why the fixture exists;
- `tags`: searchable classification;
- `input`: scenario-specific input owned by the relevant harness layer;
- `expected`: scenario-specific expected evidence.

The fixture loader validates the envelope but deliberately leaves `input` and `expected` provider/protocol-neutral. Later OR-11 units may add layer-specific validators without teaching the core loader OctoPrint semantics.

## Stable identity rules

Fixture IDs are durable evidence identifiers. Do not silently reuse an existing ID for different semantics. If intended semantics change materially, add a new fixture or explicitly supersede the old fixture in project evidence.

Duplicate fixture IDs are rejected by the loader.

## Current preserved Jest baseline

At preserved master HEAD `f22996b739b4c2285e7d342a026e86058d91c519`:

- `server/package.json` defines `test: jest --forceExit`;
- no `*.test.js`, `*.spec.js`, `__tests__`, `test`, or `tests` suite exists in the repository;
- Jest is not declared in `server/package.json` or `server/package-lock.json`.

Accordingly, there was no reproducible existing Jest suite to rerun before OR11-I01. This is preserved as a baseline finding rather than silently repaired by introducing a new test runner or dependency migration inside the fixture-foundation task.

`node test/provider-harness/core/verify-fixtures.js` provides a dependency-free loader smoke check. The Jest test file is intentionally present for the approved Jest-based harness, but a reproducible Jest execution remains blocked until the project explicitly resolves the missing historical Jest dependency/tooling state.
