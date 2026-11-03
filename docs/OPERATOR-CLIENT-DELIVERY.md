# Separate operator source delivery proposal

The existing signed updater installs exactly eleven runtime modules. It does
not install this client, and its allowlist, signing workflow, units, trust policy
and privileges are unchanged. Publishing source alone does not install the CLI.

A concrete separate delivery is a hash-pinned four-file source bundle:

```
tools/manual-request.mjs
tools/manual-client.mjs
tools/manual-node.mjs
experimental/runtime-control/src/protocol.mjs
```

Preserve these relative paths for imports. Qualification metadata supplies each
committed blob hash, SHA256 and byte count. No dependencies, provider API key,
HMAC, configuration, journal, request or private usage is part of the bundle.
This source-only bundle is not a signed runtime envelope and must never be fed
to the updater or described as an automatically trusted update.

After exact delivery approval, use the existing administrator file-transfer
lane to place verified bytes in a new immutable source directory such as
`/usr/local/lib/board-event-relay/operator/<sourceCommit>/`. Verify all four hashes
before any use. Proposed code directories0755/files0644 are root-owned; no
systemd unit, daemon, cron, network listener, new sudo rule or credentials are
needed. No installer or remote execution is included in this branch. The
current production runtime and existing files are not overwritten.

Use the existing Node executable to run the CLI from that directory only for a
separately approved exact request. The caller must already be authorized to read
the existing private configuration and HMAC; the client neither grants that
access nor opens the provider key. Read-only metadata compatibility checks must
confirm exact0600 input files and0700 private journal directory. If existing
production file modes differ, stop and report incompatibility; do not repair or
relax them as part of delivery.

Rollback simply stops using the immutable client version; production selectors,
services and updater are unchanged. Never remove an intent journal or consumed
marker to retry a request. Durable jobs/results remain on the existing relay.
Any later cleanup of installed code is separate from retained private journals.

This delivery proposal needs explicit review/approval. It does not enable the
separate no-restart admission prototype, approve a model request, create a new
grant or change the existing per-request operator gate requirement.
