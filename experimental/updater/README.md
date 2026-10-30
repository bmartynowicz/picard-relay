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
