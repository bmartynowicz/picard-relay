# Picard Relay signed updater — experimental

**Source candidate only. Not installed or activated by this repository.**

GitHub Actions may test, build, sign with Sigstore ephemeral identity, and publish a source envelope. It never deploys, SSHs into a host, or receives VM/provider credentials. Standard public runners only; no paid runner or provider call.

The fixed source is `releases/stable.json`. `policy.example.json` stays disabled. The verifier pins the workflow identity, repository, main ref, issuer, and source commit. A separately installed root-owned cosign binary and trust root are required. No long-lived publisher private key lives on the VM.

## Local verification

Run `npm test` (Node 24 and OpenSSL). The core, bounded pull, fixed-service-adapter mocks, and verifier-argument tests pass locally. These tests do not establish real Sigstore issuance, production bootstrap, or VM crash safety. Unix socket tests in the separate runtime-control package are blocked by this development sandbox and must pass on the public runner.

## Deployment is a separate enrollment

`run-once.mjs`, `launch-versioned.mjs`, and systemd files are prepared source, not an installer. `applyPreparedUpdate` requires root, enabled administrator policy, pinned administrator UID and Sigstore mode. The default example cannot activate it. Do not install or enable the timer until host layout, root ownership, immutable releases, service-account separation, control socket, trust root and rollback are verified.

The fixed adapter drains the exact local service before stopping it; an unconfirmed drain never forces a stop. It accepts no remote shell commands or service names. The transaction verifies the complete 11-file allowlist, signature, hashes, schema, expiry and monotonic sequence; journals before switching a same-filesystem current link; and rolls back code only on failed readiness. Durable databases, credentials, invocation markers, grants, firewall, Caddy, SELinux, Node and schema migrations are outside its scope.

Uncertain provider invocations must never be retried because of an update. Pending journal, unsafe ownership, stale lock or failed verification stops progress and requires review. Signed code still requires trusted publisher review: a valid signature is not a safety proof.

Production crash/power-loss/disk-full behavior and actual host enrollment remain unverified. GitHub publication is not VM activation.

## Split network / privileged installation

The prepared host path now separates fetching from installation. `fetch-release.mjs` runs as the verified existing relay account and atomically writes an **untrusted** bounded envelope into a private inbox. `run-once.mjs` opens that inbox file without following symlinks, then performs signature and source verification before staging. The privileged service permits AF_UNIX only and denies IP networking. The fetch unit requires an explicit verified service-user substitution; it is not directly installable as shipped.

Cosign binary and trust-root checks include every ancestor directory: root-owned, nonsymlink and not group/world-writable. Real deployment and enrollment remain separately controlled; committing these templates does not install units, change host settings or authorize a provider request.

## Read-only console activity

`activity-report.mjs` and `picard-updater-activity.service` / `.timer` publish a bounded status observation every minute. The observer only reads the enabled policy, HOLD presence, and fixed systemd metadata for the existing fetch, updater and updater timer units. It cannot invoke an update or change those units. It writes only `/var/lib/picard-updater-status/status.json`, atomically, root-owned and readable as metadata. The file contains typed state, policy/timer flags and attempt/outcome timestamps; no credentials, request text, private logs, paths or raw errors are published.

The runtime reads this fixed file through its existing authenticated status projection. Unsafe ownership, links, writable metadata, malformed/oversized data, observations older than three minutes and future clocks produce an unknown state. Installed release identity is separate from last-check success: a successful check does not necessarily install a new release.

The observer is fixed host support code outside the replaceable 20-module runtime bundle. Deploying its script and units, creating the status directory and enabling its timer require installation authorization. Hosts enforcing SELinux must grant the existing relay domain read-only access to this metadata path; no policy, HOLD, journal, invocation marker or credential access is added to the relay.
