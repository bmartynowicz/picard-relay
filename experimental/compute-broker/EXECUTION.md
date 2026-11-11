# Enrolling fixed execution adapters

**Implementation guide, not evidence of live activation.** Source is separate from Picard's signed runtime. Defaults make no cloud calls. Start with [README.md](README.md) and [contract.json](contract.json). Never provision resources, upgrade an account or use trial credits to make a job eligible.

## Shared requirements

Keep the coordinator database in a private directory. Copy [execution-profile.example.json](execution-profile.example.json) outside Git, mode 0600 on POSIX. It is disabled, with expired placeholders and no approved jobs. Its two provider kinds are the only implemented live adapters.

For reviewed enrollment, replace host paths, worker hash, cost evidence, finite budgets and expiry. `validUntil` may be at most 24 hours ahead; at most eight exact approvals and one provider of each kind are allowed. An approval has `resourceId`, `jobSha256` and `validUntil`; calculate the hash using exported `jobSha256(normalizeJob(job))`. IDs are part of the hash. There are no wildcards. Credentials belong only in named `PICARD_COMPUTE_*` environment variables, never in profiles or Git.

Hash reviewed worker source:

```sh
node --input-type=module -e "import {workerSha256} from './experimental/compute-broker/src/execution-protocol.mjs'; console.log(workerSha256())"
```

The hash covers ten fixed files, with CRLF normalized to LF. Each adapter checks the local hash before dispatch. The ledger preserves original resource/transport/worker context. Resetting a database/budget to bypass consumed or uncertain evidence is unsupported.

Call `compute_refresh_resources`, `compute_plan`, `compute_submit`, then `compute_run`. Collect GitHub outcomes explicitly with `compute_collect`. An unknown outcome is a stop, not permission for a new ID or dispatch. Collection uses read-only provider requests after expiry if needed, retaining the original context. It never refreshes spending evidence or quotas.

For multiple exact-approved jobs, the [batch workflow](BATCHES.md) adds atomic
submission and explicit bounded dispatch. It uses the same profile, approvals,
worker pins and ledger; batch submission does not grant or renew any of them.

## Oracle: existing Always Free micro VM

Only x64 `VM.Standard.E2.1.Micro` is supported. Preflight checks shape, source hash, free memory, worker budget and isolation. Permanent free eligibility must be retained separately from Free Trial credits. This code cannot independently verify billing or prevent out-of-band administrators from changing resources.

Prepare for host-owner review before installing or granting access:

1. Dedicated unprivileged `picard-compute-worker` user with no sudo/cloud credentials and a dedicated pinned SSH key. Do not reuse the broad `opc` deployment identity for execution.
2. Root-owned reviewed source under `/opt/picard-compute-worker/src`, trusted Node 24 at `/opt/picard-compute-worker/node` and the fixed [wrapper](deployment/worker-command.sh), installed with LF line endings even when packaged on Windows. Source/wrapper must be unwritable by the worker.
3. Owned mode-0700 `/var/lib/picard-compute-worker`, with mode-0600 `policy.json`: `resourceId`, a fresh random 32-byte `keyHex`, `maximumJobs` (1–8), `cpuBudgetMs` (3,000–24,000), finite `validUntil`. Only this per-worker key is shared with the coordinator through its named environment variable. Never share master credentials.
4. Verified cgroup v2 memory ceiling of at most 128 MiB covering **every SSH worker session**, for example a reviewed per-user slice with PAM/session placement confirmed. Setting MemoryMax on an unrelated service is insufficient. Check the actual session's `/proc/self/cgroup` and effective ancestor `memory.max` before enabling work.
5. An authorized-key forced command pointing to the wrapper, with `restrict` (no PTY, forwarding, agent or user RC). The wrapper accepts exactly three literal identity/execute/lookup sentinels. It applies a 10-second wall deadline, three-second hard CPU limit, 64 open files, Node jitless and 32 MiB JS heap. No caller command interpolation.

The worker independently verifies non-root identity, username, CPU/file limits and effective cgroup memory before executing. A short-lived HMAC grant binds resource, job hash, worker hash and expiry. An independent SQLite ledger records intent before the operation, allows one slot and enforces finite cumulative CPU/job budgets. Interrupted attempts never execute again. Lookup authenticates original saved context after expiry/source updates; preserve old keys/source for recovery.

This guide/adapter installs nothing. Creating users/keys/forced-command access is a separate reviewed host change. Mocked tests do not qualify live isolation. Fresh preflight is a conditional check, not a way to stop unrelated administrators changing billing or resources afterward.

## GitHub: this public project's CI only

The adapter is fixed to `bmartynowicz/picard-relay` and `.github/workflows/compute-worker.yml`. The workflow must be merged to the default branch before dispatch. Create a reviewed fixed `compute-worker-vN` branch or tag at the approved worker commit and protect it against updates/deletion. The profile field `tag` is the legacy ref-name field; `refKind: "branch"` chooses the heads namespace, while omitted/`"tag"` chooses tags. Ref kind is bound into saved context. A protected branch can be created through the existing owner connector without granting the worker token Contents write. Configure a repository-scoped fine-grained token with Actions write and Contents read through its named environment variable. Never extract connector credentials, commit a token or silently expand access.

Before dispatch, bounded GETs check public/non-archived status, exact ref→commit identity and exact workflow bytes against the bundled free workflow. Then one POST is made. Lost responses are uncertain. These checks are not atomic with administrator changes; enrollment must retain the protected ref and public/free scope. Ref protection is an operator control, not created or independently proved by this adapter.

The fixed workflow uses `ubuntu-latest`, read-only Contents permission, pinned checkout/setup actions, Node 24 and a three-minute limit; no matrix, artifact uploads, cache uploads or paid runner selection. It checks out the pinned worker and an **exact approved public source SHA**, checks HEAD, runs only compute-broker normal/jitless tests, strips credentials from child environments and captures output. Public source tests remain executable code: approve the commit, not an arbitrary repository. This is project CI, not a compute farm.

Collection searches the latest 20 dispatch runs for exact job/hash, worker commit and workflow. It requires one run, one expected standard-runner job and one bounded receipt marker in logs. Allowed HTTPS GitHub/Azure log redirects never receive API credentials. Result/log tails/inline `result.json` are saved locally; no artifact storage is used. Missing/duplicate/cancelled runs, invalid receipts, expired logs or runs outside the search window remain uncertain or return a sanitized error. Collection never reruns them.

Runner availability, queueing, log retention and rate limits are provider constraints. HTTP requests have five-second deadlines, bounded bodies and no retries. Refresh enrollment against the [workflow API](https://docs.github.com/en/rest/actions/workflows), [job-log API](https://docs.github.com/en/rest/actions/workflow-jobs) and [billing rules](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Standard public runner compute is free; larger runners and artifact/cache storage have separate rules and are excluded.

## Remaining live milestone

Review and merge source; configure/verify the dedicated Oracle worker and protected GitHub worker ref and workflow/token; retain current zero-dollar evidence without credits; approve one exact job for each backend; verify actual execution, saved receipts/logs/artifacts, replay and uncertain recovery through real MCP. Until then the board task stays in progress. General code execution, GPUs, more providers, tenant isolation, live monetary guarantees and multi-host SQLite remain unsupported.
