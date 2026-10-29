# Experimental snapshot verification

Rerun against the sanitized public candidate on 2026-10-29, Linux, Node 24.22.1.

- Updater: **55 cases passed** in normal and `--jitless` execution (56 test-runner entries including the TLS parent group). Seven cases use actual loopback TLS, including the bounded 15-second timeout; 48 exercise the offline transaction core.
- Runtime-control snapshot: all 62 inherited cases, grouped native TLS regression, and actual loopback service/drain/SIGTERM integration passed. The integration proves settlement of one synthetic invocation, retained queued work, signed result retrieval after drain and rejected new admission.
- Separate Unix-domain-socket test: **BLOCKED, not passed**. `listen` returned `EPERM` in this sandbox. No bypass or production socket permission claim.
- Positive immutable root-owned release fixture: **not verified**. Runtime identity validation code exists; that does not establish deployment readiness.
- No production service adapter, updater schedule, key enrollment, VM change, live model call or public release envelope was activated.

Only explicit source/tests, disabled example policy and sanitized documentation are included. The runtime-control snapshot lives entirely below `experimental/`; it does not replace the root runtime. Ephemeral fixture keys/certificates are generated during tests and are not included. Private installers, host/account identifiers, original integration paths, credential state and raw private-workspace logs are excluded.

The updater validates signed bytes and transaction behavior with synthetic adapters. It does **not** execute candidate payloads or prove production power-loss semantics. Operator-owned policy and separate publisher key custody remain mandatory before any future activation.
