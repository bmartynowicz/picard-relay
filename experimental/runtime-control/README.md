# Signed runtime source

This is the complete runtime source packaged for enrolled Picard hosts. The top-level `src/` tree remains a separate preview; root `npm start` does not start this tree.

The current runtime includes a loopback signed bridge, durable SQLite dispatch/result recovery, optional owner console and finite catalogue admission, fixed Groq one-shot adapter and private Unix health/drain control. Production code rejects the local fixture executor. Generated output remains inert text/code.

## Control and identity

`BRIDGE_CONTROL_SOCKET` opts into a private absolute Unix socket path inside a service-owned private directory. `BRIDGE_RELEASE_HASH` binds expected physical source identity. The enrolled fixed-service adapter must agree with the host path. There is no public HTTP drain route.

Send one newline-terminated object of at most 256 bytes: `{"v":1,"action":"health"}` or `{"v":1,"action":"drain"}`. Health is read-only. Drain is monotonic until process restart, stops new work/claims and preserves result reads while active work settles. There is no resume command. Unresolved durable invocations prevent confirmed drain.

Versioned source identity requires the physical immutable release layout, matching raw manifest hash, declared source lengths/hashes and no undeclared modules. The current bundle includes the 20 allowed modules in [policy.example.json](../updater/policy.example.json). An environment version label does not prove that source is installed; the updater independently verifies the publisher signature.

## Guides and checks

Use [Development](../../docs/DEVELOPMENT.md), [API](../../docs/API.md), [Operations](../../docs/OPERATIONS.md) and [Status](../../docs/STATUS.md). Configuration is defined by `loadOracleConfig` and finite-admission validators; no ready-to-run live enrollment is included.

```sh
npm --prefix experimental/runtime-control test
npm --prefix experimental/runtime-control run test:socket
```

Run from the repository root with Node 24/OpenSSL on Linux. The suites use synthetic requests, actual local process/socket fixtures and normal/jitless checks. Separate source, local tests, installed identity, live browser verification and owner acceptance in evidence. A denied socket test is not a pass, and forced termination cannot justify replay of uncertain work.
