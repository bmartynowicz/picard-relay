# Picard Relay — safe updates, offline candidate

**Status: code-only prototype, not installed, deployed, activated, or production-ready.**
Published as experimental source only. No provider API call, SSH command, VM change, secret access, scheduled job or deployment is performed by publishing this candidate.

## Purpose

After the relay's bounded live connection works, stop making its owner manually shuttle scripts. A small, opt-in updater pulls a publisher-signed runtime release from public GitHub storage, verifies it locally, drains the relay, atomically switches code, verifies readiness, and rolls back code if readiness fails. GitHub Actions is not used. No incoming update or shell-execution endpoint is added.

## Files and tests

- `updater.mjs`: built-in Node cryptography/filesystem only; offline transaction core.
- `pull.mjs`: bounded native `node:https` retrieval, compatible with `--jitless`; no Undici/WebAssembly.
- `updater.test.mjs`: 48 core cases, including concurrent callers, signed-manifest validation, allowlists, rollback and pending recovery.
- `pull-tls.test.mjs`: 7 real loopback-TLS cases, including bad CA, redirects, size cap, malformed response and the actual 15-second timeout. Requires local OpenSSL only for ephemeral test certificates.
- See `../VERIFICATION.md` for rerun evidence; raw private-workspace logs are not published. The VM has not run this suite.

Run `npm test` or `node --jitless --test *.test.mjs`. No dependencies or external network calls are needed for tests. TLS fixtures use localhost sockets. Test keypairs are ephemeral in memory, fake credentials are clearly synthetic, and mock runtime bytes are never executed.

## Security/transaction contract

1. Disabled unless local administrator policy enables updates. Production adapters are intentionally rejected in this version; only `kind: offline-test` is accepted. This is not a production security boundary; it is an explicit unfinished integration gate.
2. Administrator-pinned Ed25519 publisher key verifies the exact manifest bytes. GitHub account access or a SHA-256 checksum alone does not authorize code. TLS validates source identity in addition to publisher signatures.
3. One fixed public `raw.githubusercontent.com/<owner>/<repo>/main/releases/stable.json` URL. No redirects, credentials, arbitrary URLs, retries, fallback or provider calls. Fifteen-second timeout, 3 MiB envelope cap. Public artifacts contain source only.
4. Signed manifest fixes product, channel, monotonic sequence, version, expiry (maximum 7 days), Node major 24, state schema, migration=`none`, complete file list and hashes. Bundle is bounded JSON/base64 rather than an archive: no archive traversal, symlinks, executable modes, extraction hooks or shell quoting.
5. Entire approved runtime file list is required. Only explicitly configured `src/<simple-name>.mjs` paths can change. Node, systemd, SELinux, Caddy, firewall, credentials, authorization grants, ledger, SQLite schema and boot enablement are outside update scope.
6. Administrator-controlled code root must match the separately pinned administrator UID (normally 0), and must not be group/world writable. Ownership checks also cover releases, current link/target, lock, and state/journal files; state/journal reads use O_NOFOLLOW and descriptor metadata. Its `releases` directory cannot be a symlink. New files are write-once staging files; synchronized immutable-looking releases use read-only modes. Exact manifest bytes are also persisted as read-only manifest.json for runtime source-hash/readiness verification. A same-filesystem symlink rename switches `current` atomically. Read-only modes do not replace the required separate OS service account.
7. Exclusive directory lock; never steal a stale lock. Journal is durable before quiesce/switch. Sequence high-water mark persists even after rollback. Unresolved journal or lock blocks subsequent updates. A crashed process requires explicit recovery; this candidate does not guess whether an in-flight provider request completed.
8. Quiesce must confirm in-flight requests finished or were durably marked uncertain. An unconfirmed drain NEVER forces stop or switches code. Readiness failure attempts code rollback; rollback failure retains the journal. Both versions must use the SAME external durable ledger and one-use markers. No database restore/delete or grant renewal.
9. Local filesystem rollback is not provider-call rollback. Neither health checks nor rollback may invoke Groq or reset an invocation boundary. Existing uncertain/replayed jobs remain uncertain/replayed after restart.

## Trust boundary

Signed code can run with relay service privileges. Therefore publisher approval is code approval: signing keys must be controlled separately from the relay and never published or held in the public repository. Signature checks do not make hostile publisher code safe. Pinning a public key and selecting the allowed runtime file set require a separately reviewed enrollment action.

The code root, policy, state and lock directory must be owned by an updater identity that the network-facing relay cannot write. No untrusted local writer is supported: defending against an administrator or a same-UID attacker is out of scope. The provided loadAdministratorPolicy loader validates parent ownership, file ownership/mode/size, and rejects symlinks with O_NOFOLLOW. Its expected administrator UID comes from the wrapper, never policy content. The current test caller supplies policy directly; production must use the reviewed fixed path/loader and pin the parent chain.

## Actual runtime compatibility checked read-only

Inspected the original relay service source and related runtime metadata: Node >=24, SQLite durable store, loopback HTTP port 8787, `SIGTERM`/`SIGINT` shutdown and selected provider adapter. Native HTTPS is already the project's solution for SELinux `--jitless` compatibility, so this updater uses it too.

**Missing in current runtime:** a side-effect-free version/readiness endpoint and a verifiable drain completion receipt. Root 404 from Caddy is NOT readiness. Do not infer readiness from a build, service Active, or TLS alone.

## Remaining implementation and review before any deployment

- Receive actual install layout from runtime owner; bootstrap a version directory/current link once without breaking the working pilot. Do not assume the installed runtime already follows this layout.
- `policy.example.json` lists the actual 10 installer modules plus runtime-control.mjs. Keep it disabled; review that exact full set and state-schema compatibility. No permissive wildcard configuration.
- Add loopback-only version/readiness output with exact release digest, durable-store open/read health and dispatch state; no task text, keys or provider calls.
- Add bounded drain acknowledgement. Do not stop a worker mid-call simply because a grace timer expires. Confirm durable uncertain-state reconciliation across restart.
- Implement one fixed local service-control adapter with narrow privilege and bounded operations. It must accept no remotely supplied command, path, unit, environment, arguments or health URL. Independently review privilege separation, SELinux labels and crash recovery.
- Test real process termination at every journal boundary, power-loss/filesystem behavior, disk-full, timeout, stale lock recovery, cancellation and rollback failure with the actual runtime. Current crash tests simulate persisted pending state, not power loss.
- Repeat the already passing local TLS 200/redirect/oversize/timeout/bad-CA tests on the actual VM and verify its trust store/public retrieval. No public-network retrieval has been performed.
- Establish publisher identity/key custody and manually signed release publication. No Actions deployment or new external service is required.
- Explicitly enroll opt-in schedule and release channel only after connection and bounded pilot are accepted. No timer is installed by this candidate. Failed checks should stop and record an actionable checkpoint, not silently retry forever.
- Review artifact privacy before public push. No private board identifiers or host-specific configuration should be in portable docs/artifacts.

## Intended installation shape (proposal, not observed VM paths)

`<admin-code-root>/releases/<manifest-digest>/src/*.mjs`

`<admin-code-root>/current -> releases/<manifest-digest>`

`<admin-code-root>/{state.json,pending.json,executor.lock}`

Existing protected credentials, durable database, provider invocation ledger and one-shot authorization markers stay outside that root and are never replaced. Public source storage may host signed release envelopes. No new paid provider/service or purchased domain is needed.

## Candidate checkpoint

“Automatic relay updates: offline candidate implemented; 55 test cases pass (56 test-runner entries including the TLS group) under Node 24 normal and --jitless. Signed source verification, atomic code switching and rollback logic are tested with mocks. Not deployed or activated. Production drain/readiness, fixed service adapter, enrollment and real crash/VM verification remain outstanding.”
