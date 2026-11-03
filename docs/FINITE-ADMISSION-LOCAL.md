> Design/review checkpoint. For current behavior, limitations and operations, start with the [documentation index](README.md). Earlier scope and verification statements below describe their checkpoint, not every later release.

# Disabled admission implementation and qualification

This candidate is separate from live v0.1.14. Default startup, console HTML and
legacy signed submission remain unchanged. Only a future explicit server flag
imports the nine-module extension. No flag/catalogue/proxy/policy was installed.

Implemented modules: plan/enrollment/policy validate exact bounds and original
evidence; catalogue performs root-controlled stable no-follow metadata reads;
store handles atomic nonce/job/rate/claim state; handler/runtime compose actual
owner authentication and four strict routes; dispatch selects existing Groq
one-shot adapters; UI adds fixed-input review, approval and durable result view.
Earlier experimental paths remain compatibility exports. A planner actor object
is not proof; the handler establishes it through authentication and nonce checks.

## Commands

Use Node 24.22.1 or compatible Node 24, from repository root. No dependencies,
API keys, production data, owner password or provider connection are needed.

```
node --test test/finite-admission.test.mjs test/finite-admission-integration.test.mjs test/finite-admission-file.test.mjs test/admission-dispatch.test.mjs test/admission-ui.test.mjs test/admission-owner-auth.test.mjs test/admission-runtime.test.mjs test/admission-preview.test.mjs test/admission-legacy.test.mjs
node --jitless --test test/finite-admission.test.mjs test/finite-admission-integration.test.mjs test/finite-admission-file.test.mjs test/admission-dispatch.test.mjs test/admission-ui.test.mjs test/admission-owner-auth.test.mjs test/admission-runtime.test.mjs test/admission-preview.test.mjs test/admission-legacy.test.mjs
npm test
npm --prefix experimental/runtime-control test
npm --prefix experimental/runtime-control run test:socket
npm --prefix experimental/updater test
```

Focused suites are in `npm run test:admission`, called by the existing root/runtime
test chain. GitHub workflow is unchanged. The network guard can be added with
`node --require ./test/network-guard.cjs --test ...` for isolated qualification.

Tests use disposable SQLite, synthetic inputs/transports, mock sessions or the
actual owner-auth core with disposable synthetic credentials. They never call a
real model. Coverage: auth/Origin/CSRF/session rotation/logout/restart; binding
mismatch; nonce replay/expiry; rate restart; concurrent registration; rollback
and lost response; consumed/uncertain/incomplete state; saved reply reconciliation
without another call; corrupt/cross-scope result denial; disabled routes/files;
empty catalogue; UI private clearing/late responses and no automatic POST retry.

Commit-failure injection proves transaction rollback, not physical power-loss
durability. Independent connections race one database; multi-process/crash
qualification remains an explicit review item. Real Linux metadata, owner-auth,
loopback lifecycle and actual durable-marker fixtures are explicit Windows skips.
At the first seven-file boundary: 123 cases, 101 passed, 22 skipped, no failure.
The frozen review packet contains final normal/JIT-disabled receipts.

Linux skips must actually run before readiness is claimed. The new Requests UI
has not yet received real visual QA or used a live owner session. Exact persistent
access, twenty-file delivery and activation review is FINITE-ADMISSION-REVIEW.md.
These documents grant no permission to activate or make a model request.

## Corrections after independent f621503 review

The f621503 Linux matrix failed two test-fixture boundaries: a noncanonical
bootstrap code and global fetch under jitless Node. Fixtures now use canonical
32-byte base64url and native loopback-only Node HTTP; auth validation is intact.
The original failed matrix remains historical evidence, not a passing receipt.

Durable enrollment/event associations now preserve uncertainty stops across
catalogue removal, expiry cleanup and restart, including unexpired invocation
leases. Known durably settled incomplete output remains isolated. Registration
revalidates a synchronous policy reader inside its SQLite transaction; async
fixture readers are explicitly refused. No old jobs/markers are migrated/reset.

Saved-status UI reads are single-flight and versioned across selection/refresh;
older callbacks cannot regress terminal state. A failed read marks current
status unknown, retains the last observation and disables approval until fresh
metadata. Late result/private-session clearing has regression coverage.

`npm run demo:admission-preview` generates the enabled Requests composition with
synthetic catalogue/approval/registration/result responses and explicit no-live
labels. Unknown routes have no fallback; browser connect-src is none. It does
not host/publish itself, call a model or exercise real owner authentication.
Its exact unchanged enabled UI script and both injected script boundaries are
syntax-checked. Generate only after source changes; old preview hashes are stale.

## Legacy compatibility correction

The next candidate additionally requires an explicit, separately hash-pinned
read-only legacy inventory. `test/admission-legacy.test.mjs` covers missing and
changed rows/markers, exact synthetic acknowledgement binding, catalogue
replacement, legacy-mode reentry, association backfill, atomic registration and
saved-result access while new work is denied. Linux-only tests enforce actual
file ownership/modes, canonical bytes, hash pin, links, size and stable reads.
They generate disposable synthetic inventories only. Production configuration
and historical exception evidence are never generated or changed by tests.
