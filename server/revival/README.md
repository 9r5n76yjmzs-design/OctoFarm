# Revival code and API documentation

This directory contains the independent TypeScript/Node Revival core. Its
provider contract is **not** a wrapper around legacy OctoFarm persistence or
native OctoPrint objects. The implementation is intended to remain independently
testable using the deterministic provider harness.

## Source map

| Boundary | Location | Responsibility |
| --- | --- | --- |
| Canonical contracts | `core/provider-contract.ts` | Provider-neutral snapshots, capabilities, health and runtime validation |
| Event contract | `core/domain-event.ts` | Normalized event envelopes and payload validation |
| Event lifecycle | `core/event-controller.ts`, `core/event-ingress.ts` | Reconnect/shutdown, bounded delivery, replay suppression |
| State authority | `core/state-reconciler.ts`, `core/capability-reconciler.ts` | Reject stale observations and revision rollback |
| OctoPrint adapter | `providers/octoprint/` | Native protocol negotiation, normalization and host-mediated requests |
| Host security | `security/` | Authorization, networking, credentials, safe paths, resource policy, output redaction and mandatory gate |
| Compliance evidence | `../test/provider-harness/` | Synthetic protocol fixtures, host doubles, reference provider and official runner |
| CI | `../../.github/workflows/or11-provider-compliance.yml` | Node 22.16.0 suite and official compliance entry point |

## Dependency and trust rules

- Legacy callers may call a compatibility facade, which may use Revival.
  Revival must not depend on legacy printer/store/UI implementations.
- Provider-native normalization terminates in a provider adapter. Only the
  normalized, runtime-validated contract enters the domain core. Event
  admission rejects undeclared envelope/payload fields and queues a fresh
  allowlisted copy rather than retaining the provider-owned object.
- Application authorization happens **before** invoking a provider operation.
  The host classifies privileged operations; provider hints are not authority.
  The official compliance runner proves both denied and allowed paths against
  the actual provider callback, fails on a provider bypass request, and rejects
  an advertised operation whose implementation is absent.
- Host-selected network, credential, path, resource and diagnostic controls
  are mandatory supported boundaries. Same-process JavaScript is **not**
  assumed to isolate arbitrary malicious provider code.
- Provider credentials do not belong in UI/browser projection, events,
  telemetry or compliance reports. Compliance seeds a scoped synthetic
  credential lease, scans provider-derived evidence, and emits data-only
  redacted reports without retaining provider-controlled serialization hooks.
- Replay, stream, capability, and state authority are scoped by provider
  instance without delimiter-based tuple ambiguity. Snapshot reconciliation
  and current-state lookup require validated `providerInstanceId` and
  `printerId`; lookups return copies rather than mutable authority references.
- A malformed recognized transport message is contained at the controller,
  records only a bounded host reason, and transitions to `DEGRADED`. Recovery
  is explicit through `connect()`; no new automatic reconnect threshold is
  implied by malformed-message handling. A throwing adapter `close()` cannot
  block explicit recovery or terminal shutdown finalization.
- A supported capability and its momentary availability are separate facts.
- A synthetic fixture PASS does not prove real OctoPrint 2 protocol
  qualification. Independent security approval is a separate decision.

## Documentation requirements for new or changed code

Every new or changed exported function, class, interface and nontrivial
public method must carry a JSDoc comment at its declaration. Document private
helpers when their failure modes, state transitions or security significance
are not immediately obvious. Prefer **why/invariant** over restating code.

Include the following when applicable:

1. **Purpose:** logical responsibility and who owns the boundary.
2. **Inputs:** a `@param` for each parameter, including units, identity
   dimensions, optional values, expected normalization and secret handling.
3. **Outputs:** a `@returns` describing semantics, not merely its TypeScript
   name, including `undefined`, idempotence, and copy-versus-reference behavior.
4. **Failure cases:** `@throws` for validation, authorization, transport,
   lifecycle, deadline or resource failure; state which failures are caught
   and converted into a result instead.
5. **Side effects:** health updates, queues, retries, observable audit events
   and cancellation behavior if relevant.
6. **Trust and limits:** identify the host/provider authority boundary,
   supported preconditions, explicit gaps and limits; do not claim runtime
   containment from interfaces or unit tests.

Illustrative style (not executable code):

```ts
/**
 * Rejects a provider request before invoking the adapter unless host
 * authorization approves the registered operation.
 *
 * @param operation - Host-registered operation identifier.
 * @param context - Caller context; privilege is host-computed.
 * @param invokeProvider - Deferred callback, called only after approval.
 * @returns The provider callback result after authorization.
 * @throws SecurityDeniedError for unknown, invalid or denied operations.
 */
```

A comment must remain consistent with the current implementation. An
uncertain behavior belongs in an explicit review note or failing test, not a
confident assertion in JSDoc. Avoid credentials, private endpoints, and
untrusted error causes in documentation examples.

For test files, descriptive test names are the executable specification;
use module-level comments for coverage/trust-boundary intent and annotate
helpers whose behavior is not obvious. Fixture JSON remains declarative;
document fixture structure and provenance in
[`provider-harness/README.md`](../test/provider-harness/README.md).

## Local validation

From the repository root, with **Node 22.16.0** for the current OR-11
validation baseline:

```bash
node --experimental-strip-types --test $(find server/revival/test server/test/provider-harness -name '*.test.ts' -type f | sort)
node --experimental-strip-types server/test/provider-harness/run-compliance.ts --format both
```

OR-12 governs the final runtime support policy. The OR-11 CI result does not
claim other Node runtimes or production compatibility.

Review documentation-only commits against their parent trees and verify that
the executable source text is unchanged. After code changes, rerun the
corresponding tests and rebaseline any frozen acceptance package before
treating its evidence as current. Documentation is not independent acceptance.
