# Provider harness test foundation

This directory is the reusable test substrate for OR-11. It is intentionally separate from production provider code.

## Architectural baseline

OctoFarm Revival uses **TypeScript on Node.js** for new architectural code, including the OR-11 harness. The exact supported Node release line is governed separately by OR-12.

The harness uses Node's native `node:test` API as the initial runner because the runner is intentionally thin and the reusable harness machinery must remain runner-independent. No historical Jest requirement exists: the preserved repository contains a `jest --forceExit` script and manual-mock artifacts, but no surviving Jest suite or pinned Jest dependency.

TypeScript provides developer-time contract safety. Runtime validation remains mandatory at fixture, protocol, provider, and other trust boundaries because TypeScript types do not exist at runtime.

## Test categories

- `../characterization/` records observable preserved OctoFarm behavior. Characterization evidence is descriptive and does not automatically make legacy behavior normative.
- `provider-harness/` proves the accepted provider contract, compliance requirements, and synthetic protocol behavior.
- `fixtures/` contains declarative, inspectable scenario data with stable fixture IDs.

A historical defect may therefore have both a characterization test describing preserved behavior and a contract/compliance test describing required target behavior. The former never overrides ADR-008 or the provider contract.

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

## Runner boundary

The fixture loader, synthetic services, host doubles, compliance rules, and security checks must be plain reusable TypeScript modules. The test runner only invokes them and reports evidence.

The current I01 validation uses Node's built-in test runner. On Node releases where native TypeScript type stripping requires an explicit runtime flag, use that flag. OR-12 will establish the exact supported Node line and therefore the final command form.

Changing the runner later must not require redesigning fixtures or harness-core modules.

## Preserved testing evidence

At preserved master HEAD `f22996b739b4c2285e7d342a026e86058d91c519`:

- `server/package.json` defines `test: jest --forceExit`;
- no `*.test.js`, `*.spec.js`, `__tests__`, `test`, or `tests` suite exists in the preserved repository;
- Jest is not declared in `server/package.json` or `server/package-lock.json`;
- nearby preserved branches inspected show the same pattern.

Project-owner decision: these are treated as incomplete/abandoned testing artifacts, not as a requirement to preserve Jest.

## OR11-I01 validation

The TypeScript fixture foundation currently proves:

- valid fixture-envelope loading;
- rejection of unknown top-level fields;
- rejection of malformed requirement IDs;
- loading of committed JSON fixtures;
- duplicate fixture-ID rejection;
- dependency-free fixture-directory smoke verification.

No production source path is modified by I01.
