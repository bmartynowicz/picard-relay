# Signed runtime and updater source

This directory contains the complete signed-runtime source and separately installed updater support. The name `experimental` reflects its origin; it is not a claim that every current host is uninstalled. Repository templates remain disabled by default, and a working enrolled host does not qualify arbitrary fresh installations.

Start with the [current documentation index](../docs/README.md), [architecture](../docs/ARCHITECTURE.md), [operations](../docs/OPERATIONS.md), [limitations](../docs/LIMITATIONS.md) and [dated status](../docs/STATUS.md).

- [runtime-control](runtime-control/README.md): the complete 20-module source tree packaged for an enrolled host, including the private console, finite admission and durable request lifecycle.
- [updater](updater/README.md): bounded download, Sigstore/source verification, fixed local service control, code-switch/rollback transaction and read-only activity observer.

GitHub Actions tests, signs and publishes a source envelope. It does not receive host/provider credentials or deploy. An independently enabled host timer can consume a valid publication.

Run the exact release checks on Linux with Node 24 and OpenSSL:

```sh
npm --prefix experimental/updater test
npm --prefix experimental/runtime-control test
npm --prefix experimental/runtime-control run test:socket
```

They use synthetic work and local fixtures, not live provider calls. Preserve all ledgers, consumed/uncertain markers, grants, auth state and operator checkpoints during updates. Source replacement does not change credentials, host policy, Node or schemas. Power-loss, disk-full and new-host qualification limits remain explicit; see [Status](../docs/STATUS.md). The older [verification checkpoint](VERIFICATION.md) retains its original October 29 scope.
