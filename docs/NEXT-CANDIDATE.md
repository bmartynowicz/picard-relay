# Bounded source candidate

Base main: `7aa57675f8113527aabdbdb64d506ecfac716b02`.
This is a local review candidate, not a published or installed release. The
fresh checkout contains no `AGENTS.md`, `.agents` directory or repository skills.

## Source-backed delivery boundary

`scripts/build-release.mjs` reads exactly eleven modules from
`experimental/runtime-control/src`, using the existing updater allowlist.
The standalone top-level `src` is a separate preview; it is not that bundle's
source. This candidate changes six of the eleven runtime modules:

| Module | Change that can travel in the existing source bundle |
| --- | --- |
| `selected-assistant.mjs` | Explicit immutable Free-only policy; only the existing durable Groq one-shot can be selected; at most one routing attempt per adapter, zero retries/fallbacks. |
| `adapters.mjs` | Pure, disabled-by-default deterministic local fixture executor export. It has no production selection path. |
| `dispatcher.mjs` | Reject the fixture executor kind or local-test marker before claiming production work. |
| `oracle-service.mjs` | Reject fixture executor startup before opening a store or listener; provide existing runtime health evidence to the receiver. |
| `receiver.mjs` | Add allowlisted aggregate diagnostics to the existing authenticated `health` action. No new action, route, listener or credential. |
| `relay-store.mjs` | Dedicated read-only diagnostic counts filtered by authenticated owner and configured allowed task, including reused databases. Global counts remain private to runtime control. |

The other five modules, signing workflow, release builder, updater helpers,
allowlist, ledger/schema, trust policy, credentials and system units are unchanged.
Tests and local examples remain source-only; the updater does not install them.

## Routing and spent allowance

Production selection now requires `GROQ_ONE_SHOT=true` as well as the existing
explicit Groq/model configuration. The request-bound ephemeral adapter is not
a production fallback. The existing external Free gate, exact literal
`Reply Hello World`, task/context binding, one-use marker and durable invocation
ledger still control every possible provider call.

Limits stay fixed: one call, 12,000 input bytes, 512 completion tokens, 65,536
response bytes and a 30-second timeout. Errors, payment/quota rejection and
uncertain outcomes never retry or select another provider. The wrapper reserves
its attempt before awaiting the existing adapter; the durable adapter still
reserves its marker before transport. The wrapper cannot recreate or remove a
marker, renew a gate or issue a grant. Saved-result recovery remains independent
of provider readiness, including a spent or expired allowance. No live call,
key/account provisioning or allowance renewal is part of this candidate.

The Free gate remains an external attestation, not a billing check or monetary
guarantee. This source introduces no paid route or new provider.

## Local fixture tasks

`createFixtureTaskExecutor({enabledForLocalTestOnly:true})` accepts only bounded
JSON `{v:1, operation:'echo'|'count-words', text:'...'}`. Default is disabled.
Text is at most 512 characters and 1,024 UTF-8 bytes; the JSON envelope is at
most 1,024 characters and 2,048 bytes. An instance caches at most four tasks by
default, with a hard maximum of eight. Exact replays reuse a cached result;
changed content/identity conflicts. Aborted requests are rejected before work.

There is no shell, eval, dynamic code, filesystem/network task operation,
remote tool call, callback, privilege change or provider invocation. The export
always declares `localTestOnly:true` and `ready:false`; production dispatcher
and service startup explicitly reject it. It is not a general task executor.
Run `npm run demo:fixtures` for the purely local word-count/replay demonstration.

## Diagnostics and mission control

Only signed `POST /bridge/v1` with the existing exact owner-scoped health payload
can obtain diagnostics. HMAC verification, nonce replay protection and identity
checks are retained. Root, GET and unknown routes do not expose the preview.
The existing health `ready`, `assistantId` and `code` fields remain compatible.

`diagnostics` contains only strict booleans, eight known job-state counts, total
jobs, a completed-result count, capability constants, and a content-addressed
release hash when the runtime's existing immutable release identity check
supplies one. Invalid or over-limit aggregate observations become unknown.
`release.state='identified'` refers to that local physical identity; it does not
claim independent signature, install, timer or rollback verification. Updater
state is always `unknown` because the runtime has no updater evidence channel.
Network counts always filter by the authenticated owner and also by
`allowedTaskId` whenever configured. A dedicated parameter-bound read-only query
does this filtering in SQLite; there is no global-count fallback. Reopening or
reconfiguring a shared database cannot reveal other owners' or excluded tasks'
counts. Global counts remain available only to private runtime control. The
snapshot omits job rows, task text, owner/task/request/grant identities,
result bodies, paths, PIDs, keys, errors and private metadata. A healthy service
and working saved-result recovery may coexist with `providerReady:false`.

`examples/mission-control.mjs` generates a self-contained read-only HTML fixture
with inline CSS, no script, connection, authentication material, task controls or
external asset. It requires `source:'fixture'`, drops unknown fields, rejects
arbitrary labels and applies HTML escaping. Installed release and updater state
remain unknown. `node examples/mission-control.mjs --output NEW_FILE.html` writes
a new file and refuses overwrite; no argument prints HTML. Browser visual QA was
not performed during the explicitly browser-free development phase.

A future live UI needs an explicitly reviewed authenticated board-backend proxy
and separately delivered UI files. The shared HMAC secret must remain server-side.
No new endpoint, browser credential, public UI or real executor is proposed for
this release, and none is authorized by this candidate.

## Qualification

Use Node 24 and OpenSSL. `npm run test:candidate` runs the new policy, fixture,
signed-health/auth/privacy and static presentation cases. Both root and signed
runtime `npm test` include it after inherited cases. Run the existing updater
suite and runtime socket suite separately as before.

Native Windows cannot qualify the existing POSIX ownership/private-marker or
Unix-socket controls. The new durable spent-marker reconstruction case explicitly
skips Windows; existing POSIX suites retain their fail-closed behavior and are
not weakened or mocked to pass. Full Linux qualification is required before
publication. Exact test receipts accompany the review artifact.

Publication and signed delivery remain on coordinator hold. There was no main
push, signing run, provider call, VM/SSH action or host configuration change.
