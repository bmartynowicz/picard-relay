> Design/review checkpoint. For current behavior, limitations and operations, start with the [documentation index](README.md). Earlier scope and verification statements below describe their checkpoint, not every later release.

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
before any use. Proposed version directories0555/files0444 are root-owned; no
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

## Exact code-only installation proposal

Published source `f3b472d203931d6e6bf182a2fe5dd23b7ae67d83` is byte-identical to
reviewed `f6a88bb` for these four files. Target:
`/usr/local/lib/board-event-relay/operator/f3b472d203931d6e6bf182a2fe5dd23b7ae67d83/`.

| File | Bytes | SHA256 |
| --- | --- | --- |
| tools/manual-request.mjs | 3408 | f4e1dc096ab1bd8af44b731f5834f2cf6fc2e3b20a82b6522a9c550dc6ee376b |
| tools/manual-client.mjs | 8257 | e0d2df2736515496b0b0361071d63bd0eab07d6152080d8b2d677c0335d89ee4 |
| tools/manual-node.mjs | 7035 | ecfe711d1f1d967b699e83f10abf4714514a7deda0d59e066b2411e4be3c50f9 |
| experimental/runtime-control/src/protocol.mjs | 5909 | 8c53e6954a0999ee5827eac6bd637bc67eccecd2b8484affa35548cf9c2f412c |

The private review packet includes a fixed-payload Python installer and its hash.
It was AST-parsed only, not executed. It requires Linux administrator identity,
checks canonical root-owned directories, creates an exclusive new version,
writes only these four verified public files and verifies read-only ownership.
An existing exact version is a no-op; partial/different state is a stop, never an
overwrite or automatic cleanup. It reads no configuration/credential, invokes
no client/provider, creates no journal and changes no service or gate.

Only after exact approval and installer hash verification, the existing Windows
administrator SSH lane may feed that reviewed ASCII script through stdin:

```powershell
Get-Content -LiteralPath .\install-manual-client-f3b472d.py -Raw |
  & ssh.exe -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=10 -i "$env:USERPROFILE\.ssh\board-event-relay-20261029" opc@141.148.50.78 'sudo -n /usr/bin/python3 -'
```

Installation does not authorize using prepare/submit/result. Each real request
still needs its own applicable scope; this command itself never calls a model.
Current retained metadata reports runtime.env root:root0600; other input/HMAC
prerequisites still need read-only compatibility verification before client use.
