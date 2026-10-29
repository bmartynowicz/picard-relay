# Offline Picard runtime control candidate

Published as an experimental source snapshot only: not installed or enabled. The working runtime entrypoint and installer remain untouched.

## Interface
Opt in with `BRIDGE_CONTROL_SOCKET` (absolute path within a real service-owned0700 directory) and `BRIDGE_RELEASE_HASH` (expected64hex). Both absent preserves current runtime behavior. No public HTTP control route.

Connect to the Unix socket0600; send one newline-terminated JSON object <=256bytes:
`{"v":1,"action":"health"}` or `{"v":1,"action":"drain"}`.
Idle/partial clients close after2seconds. Unknown keys/actions, oversize and multiple JSON messages fail closed. Existing socket/path is not unlinked at startup. Graceful shutdown removes only the inode created by this process.

Health: `v`, `protocolVersion`, `release`, `releaseHash`, `updateReady`, `pid`, `serviceReady`, `resultRecoveryReady`, `providerReady`, `accepting`, `acceptingNewWork`, `busy`, `draining`, `drained`, `unresolvedInvoking`, `ledgerStateCounts`. No task IDs, credentials or model calls. `accepting` is new-work readiness, not service liveness. A spent/expired provider allowance can retain service/result readiness.

Drain is monotonic; no resume command. New durable inserts and dispatcher claims stop. Already-running invocation finishes; existing signed result retrieval remains available. Any durable invoking row makes `drained=false`, even without an active callback. Health does not reconcile/mutate ledger. SIGTERM waits for active invocation plus HTTP/control closure before closing SQLite. Queued jobs and once marker are untouched.

## Release identity
Flat layout reports `unversioned-flat` and `updateReady=false`. Versioned layout requires physical `releases/<hash>/src`, expected hash matches directory, immutable root-owned release/src/manifest and sources; manifest raw bytes SHA256 matches directory, all declared files match exact SHA256/length and no undeclared sources. Required11 runtime modules include runtime-control.mjs. Runtime relies on the updater's independently verified publisher signature; runtime does not accept an arbitrary env label as code identity.

## Local evidence
PASS under Node --jitless --max-old-space-size=96:
- actual localhost HTTP service lifecycle with fixture assistant: busy drain, SIGTERM waits, one invocation, second queued item retained, signed result retrieval after drain, new durable admission rejected.
- nine existing receiver tests.
- eight one-shot runtime tests.
- direct control-state test: old durable invoking row prevents drained; no mutation; idle drain monotonic.

NOT VERIFIED here: actual Unix-socket I/O and chmod behavior, positive root-owned release layout. Unix listen rejected EPERM in execution sandbox with NODE_OPTIONS unset and no project network guard loaded. One escalated test failed environment bwrap startup, before execution; no further escalation. The real socket test is supplied for an authorized capable test environment. No VM operations or provider calls.

## Required future bootstrap (not performed)
Current frozen installer uses systemd TimeoutStopSec=15s, shorter than the30s provider bound. Future approved updater bootstrap must stop only after confirmed drain and configure stop grace at least45s. Local SIGTERM tests prove the JavaScript handler waits; they do NOT prove the current systemd unit allows that wait. Forced termination remains an uncertain outcome; durable invocation marker prevents retry. Do not delete the marker, reopen admission, or renew a grant during an update.

## Running the isolated candidate

Use `npm test` in this directory for existing regressions and the loopback drain integration. `npm run test:socket` separately runs the Unix-domain-socket test and may fail with EPERM in restricted sandboxes. No production service is started. The root-owned release positive path remains unverified; do not treat test success as production readiness.
