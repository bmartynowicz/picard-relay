# Routine request friction: existing bundle requirement

Tracked on the existing Picard improvement-bundle umbrella; the private review
packet retains the Board reference.
No duplicate engineering worker or live request is created by this document.

## Source-backed bottleneck

The signed bridge already accepts an immutable exact payload into a durable queue.
Its owner/task/input/grant checks, unique event identity, leases and result recovery
already handle duplicate registration, concurrent clicks, expiry and uncertain
outcomes. The new contract fixtures exercise those actual components with synthetic
inputs and no network/provider call; they do not pretend to simplify production.

The production adapter still snapshots ONE administrator-provisioned gate file.
That file binds owner/task/event/grant/text/context/input hash, request expiry and
the retained Free-only enrollment. Production selection and marker paths are set
outside the Board. A new task therefore needs operator gate selection and service
coordination even when the provider operation itself takes only a few seconds.

## Acceptance criteria

1. One supported entry takes an already-approved sanitized $0 request through
   existing registration and queueing, with an immutable approval receipt.
2. Repeated clicks and concurrent submission resolve to the same queued job;
   changing owner, task, input, grant or expiry never widens its scope.
3. The owner sees queued, invoking, completed or uncertain state from persisted
   truth, and can recover the exact durable result without another inference.
4. Expired/revoked authority stops work. An uncertain invocation never retries,
   reclaims or receives a replacement marker or grant automatically.
5. The same retained account/project/key/model cost enrollment and original
   evidence remain bound; no refreshed billing claim, new credential, paid
   fallback, account, model, shell, tool or provider is introduced.

## Explicit remaining authority delta

Full automation cannot honestly be achieved by silently relaxing the current gate.
The Board's existing HMAC is transport authentication; it is not currently authority
to install arbitrary request gates. Replacing independent operator provisioning
with dynamic Board-issued scopes transfers an admission decision and needs exact
review before implementation/activation. The present bundle does NOT do that.

The minimum proposed production contract reuses signed registration and the queue:
an independently reviewed finite request catalogue/enrollment binds owner, allowed
task/input hash, grant identity/expiry, call count and retained enrollment ID. The
runtime would validate/register each approved immutable request, derive its marker
internally, and dispatch without per-request selector edits or drain/restart. It
must not accept a caller-supplied marker path or arbitrary purpose/text. Existing
uncertain jobs, consumed markers and stop evidence remain unchanged.

Before that change, the Board owner and sole runtime operator must agree the exact
catalogue/registration authority, persistence and revocation contract. Record its
endpoint/control delta and tests in release review; do not embed an unauthenticated
route, an automatic latch reset or a generic agent framework. This pending contract
does not block the reliability, private-history and console corrections.

## Implemented source-safe qualification

`experimental/runtime-control/test/core-bundle.test.mjs` registers synthetic exact
requests through the existing signed receiver and real SQLite store. It verifies
concurrent/duplicate clicks, owner/task/input/grant rejection, expiry, durable result
after reopen and uncertain no-reclaim behavior. The assistant is a file-local
test double of an already-authorized boundary; no production selector exports or
activates it, and the existing production fixture rejection stays intact. These are contract
fixtures and a reviewable proposal, not a shipped routine-request feature.
