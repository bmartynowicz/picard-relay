# Verification boundaries

This repository snapshots the reusable relay core, not an entire private application.

## Observed before this public snapshot (2026-10-29)

- Node 24 on a small Oracle Linux VM ran 45 offline adapter/bridge/process cases.
- A single authorized live Groq request returned Hello World through the durable ledger; reopen reconciliation and duplicate replay did not make a second outbound invocation.
- A separate Caddy HTTPS endpoint passed trusted certificate verification. Its root intentionally returned 404.
- Later one-shot allowance and result-after-capacity retrieval regression tests were added locally.
- Native TLS transport corrected the `--jitless` / native-fetch WebAssembly incompatibility. Its loopback regression validates a generated local certificate and exercises the Groq adapter without contacting Groq.

Those observations do not prove a fresh installation, a third party's configuration, unlimited dispatch, or full board integration. No private logs, owner identifiers, infrastructure addresses, credentials or certificate state are included here.

## Snapshot changes

- Copied only relay source and synthetic tests; retained protocol behavior.
- Replaced a fixture UI's personal owner label with `Owner`; generalized unavailable-adapter explanations and corrected a stale service comment.
- Added a portable offline demo, complete test command and general manual configuration documentation.
- Omitted application-specific board code, historical embedded/base64 Windows installers, binaries and instance-specific setup artifacts.

See `VERIFICATION.txt` for checks actually rerun against this exact public tree. Tests use synthetic inputs and mocked provider responses unless explicitly described otherwise. No live provider call is part of the public test command.

## Still unfinished

- Complete authenticated integration with a consuming board application and hosted end-to-end proof.
- Generalized user onboarding and deployment installer across operating systems.
- Automatic updates, additional providers, ongoing work dispatch and UI design.
- No license blocker: the repository owner selected MIT; the original notice is preserved.

These are not quietly enabled by publishing this repository.
