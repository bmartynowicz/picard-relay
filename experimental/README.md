> Signing-only GitHub Actions now builds and publishes signed source envelopes. No workflow deploys or contacts the VM. The updater remains disabled until separately enrolled; see [updated updater documentation](updater/README.md). Earlier offline-snapshot statements below describe the initial checkpoint.

# Experimental updates and runtime control

**NOT PRODUCTION-READY. NOT INSTALLED. DISABLED BY DEFAULT.**

These are isolated design/test checkpoints, not replacements for the top-level `src/` runtime. Publishing this directory does not enable updates, install a scheduler, alter a running service, authorize a model call, or deploy anything through GitHub Actions.

- [`updater/`](updater/README.md): signed-manifest/source verification, bounded HTTPS retrieval, offline code-switch/rollback transactions and disabled administrator policy. Only an explicit `offline-test` adapter is accepted. No production privileged service-control adapter exists.
- [`runtime-control/`](runtime-control/README.md): separate complete runtime snapshot with proposed private health/drain socket, durable admission stop, busy-invocation settlement, and physical release/source identity checks. The current top-level runtime remains unchanged.

## Test locally (Linux, Node 24, OpenSSL)

From the repository root:

```sh
npm --prefix experimental/updater test
npm --prefix experimental/runtime-control test
```

These use synthetic work and local temporary storage/TLS fixtures, not live providers. The separate `npm --prefix experimental/runtime-control run test:socket` requires an environment that permits Unix-domain sockets. A sandbox denial is not a passing socket test.

## Production gates still open

1. Independently review a narrowly privileged, fixed local service-control adapter and administrator/publisher key custody.
2. Validate a one-time migration from a flat runtime directory to immutable versioned releases; do not assume an existing service follows the candidate layout.
3. Prove real Unix-socket permissions, SELinux policy and positive root-owned release identity in the intended environment.
4. Validate real process/power-loss, disk-full, rollback and journal recovery behavior. Simulated persisted state is not a power-loss test.
5. Confirm drain before stopping; stop grace must exceed the provider timeout (at least 45 seconds for a 30-second bound). Preserve all ledgers, queued work and consumed/uncertain invocation markers.
6. Explicitly enroll the update source, public signing key, complete file allowlist and any schedule. None is enrolled here.

Credentials, authorization grants, databases, certificate state, firewall, Node binary and system service configuration are outside replaceable runtime source. Rollback never means restoring a database or retrying an uncertain provider invocation.
