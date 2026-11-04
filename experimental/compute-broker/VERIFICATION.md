# Verification checkpoint — November 4, 2026

**Candidate execution-adapter source; no live executor enrollment or two-provider execution claim.** PR #7's foundation is merged at `164507f379cd610acc6114b82a56bb75e35c7050`. The new Oracle/GitHub adapters are separate source, outside the unchanged 20-module signed runtime artifact. No production service/environment/database, credentials, grants, account plan or resource was changed by this adapter work.

## Source qualification

Linux on the existing host, trusted Node **24.22.2**, isolated private temporary source directory: **72 passed normally and 72 passed with `--jitless`; zero failed or skipped**. Documentation checks passed for 23 indexed guides/entry files, 13 work records and 20 runtime modules. The demo returned two completed simulated jobs with `realCloudProvidersExecuted: 0`. No production environment or database was loaded. Windows Node 22 development checks are supplemental and do not replace Linux/Node 24 qualification. The public PR workflow separately tests its exact candidate commit on Node 24.22.1.

Tests cover exact input/context/hash binding, shared-ledger reservations, one invocation intent, pending receipts, expiry/revocation, preflight cancellation, no late dispatch, no retry after transport loss, saved-result collection after authority expiry, terminal-state protection, private state/profile permissions, actual stdio MCP processes, strict JSON/UTF-8/artifact validation, HMAC scope/expiry, finite independent Oracle worker budgets and explicit isolation denial. Mocked GitHub transports exercise public/free workflow checks, changed tags/YAML, one POST, exact run/runner identity, rerun rejection, duplicate/missing markers, bounded logs and redirects without credential forwarding. Fixed CI child processes receive only minimal non-credential environment and a verified source revision.

Provider APIs and SSH execution in these regressions are **synthetic transports**. Boolean isolation fixtures do not qualify a real SSH worker account/cgroup. Normal project CI is not proof of broker-driven workflow dispatch. No live adapter profile, restricted worker identity, new key, dispatch token or worker tag has been installed/configured.

## Actual read-only evidence

The earlier credential-free CI observer read real run [41889597537](https://github.com/bmartynowicz/picard-relay/actions/runs/41889597537), exact source `2aca378414d18cb1c524e7a1eb1bbb3db8cc0ec1`: public repository, expected workflow, completed/success and matching job/steps. It also passed through actual MCP on Linux Node 24.22.2 with `executionMode: read-only-project-ci` and dispatch disabled.

The Oracle status tool read the real micro VM through existing pinned SSH, then actual MCP on Windows Node 22: live OS capacity, `dispatchEnabled: false`, `costVerification: unknown`, `accountQuota: null`. It installs nothing and cannot authorize jobs. The Console separately confirmed the VM's Always Free label, domain quota (two allowed, one used), one 50 GB boot disk and no additional attached block volumes.

After intermittent blank pages, current Cost Analysis rendered **$0.00 for November 1–4, 2026**, across Compute/Block Storage/Telemetry/Virtual Cloud Network. The page states billing estimates can lag about 24 hours and differ from invoices. The account remains Free Trial; subscription expiry was visible separately, while promotional credits remain excluded. This dated estimate is not an independent spending cap or live monetary guarantee. Private account screenshots/snapshots remain outside Git.

## Still unqualified

Dedicated Oracle worker installation and actual OS limits; protected GitHub worker tag/token/dispatch; real broker MCP jobs on both backends with saved receipts/logs/inline artifacts; enforceable account-wide cost controls and quota refresh; outages/expired logs in real providers; arbitrary-code isolation; ARM/GPU; multi-tenant or full MCP interoperability; Windows ACL enforcement; network SQLite; power-loss/disk-full behavior. Preserve uncertain evidence and stop rather than retry or substitute a paid path.

## Restricted Oracle enrollment follow-up

PR #8 merged at `715cd625f0b9bee105ea526122d346500c2badd7`. Actual SSH readiness uncovered two defects before dispatch: Node fetch requires WebAssembly in jitless mode, and cgroup v2 root has no memory.max file. Native bounded HTTP and root-boundary handling correct them. The expanded Linux Node 24.22.2 suite passed **76 normally and 76 jitless, zero failures/skips**. New tests exercise real loopback HTTP, malformed/oversized/redirect responses, cgroup ancestor limits and branch-ref namespace binding. No provider calls occur in the suite.

The dedicated Oracle worker now reports verified isolation in its real forced-command SSH session: three-second hard CPU limit and 128 MiB cgroup ceiling. One exact MCP word-count job completed with value 5; its inline result.json SHA-256 is `7d0562a451cb0bcf8ed3b75b8235cb3aab90e23a53cc15f920c369d73ffcd06a`. Repeated run returned the saved result, independent worker lookup recovered it, and the one-job CPU budget is consumed. Arbitrary shell commands exited 64 and remote forwarding was rejected. The separate production AI relay was not changed. Windows packaging required normalizing the wrapper to LF before installation.

GitHub dispatch verification is still pending at this checkpoint. A protected fixed worker branch is supported so its operational token needs Actions write with Contents/Metadata read-only; no broader Contents write permission is required. Private credentials, profile, databases and account evidence remain outside Git.
