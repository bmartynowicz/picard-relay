> Design/review checkpoint. For current behavior, limitations and operations, start with the [documentation index](README.md). Earlier scope and verification statements below describe their checkpoint, not every later release.

# Picard-only completion candidate

Preparation only. No publication, preview hosting, production mutation or model
request is authorized by this branch. The baseline is reviewed04919cd, published
as2e4a763 and naturally installed as v0.1.13/13001. One approved synthetic smoke
request subsequently completed once and returned Picard relay operational.

The current public main was reconciled read-only at
62ae39bcaa937234a598faf3efeb3c3c838a659b (tree
956d0344b8a4bfd8c25d0cd808ba54d7d9e3a9fc). Its111 non-envelope blobs exactly
match the reviewed04919cd code baseline. The candidate preserves the current
signed13001 stable envelope byte-for-byte; it never substitutes an older envelope.
The local candidate parent is04919cd; public publication would require a new
commit on the freshly checked public head, with the reviewed candidate tree.

## Finite acceptance checklist

| Item | Baseline evidence | Candidate acceptance |
|---|---|---|
| Consistent uncertainty/no retry (DBOS lesson) | Shipped12001; incomplete isolation13001 | Preserve persisted truth, spent markers, no reclaim and all regressions |
| Blocked/provider explanations (Bifrost lesson) | Shipped12001/13001 | Keep allowlisted reasons and unknown state; include incomplete-output reason in Jobs inspector |
| Private recent jobs (Dagu lesson) | Scoped authenticated route shipped12001 | Preserve SQL owner/task filtering, keyset bounds, metadata-only projection; aligned workspace/inspector |
| Console redesign | Local1babbd1 only | Four peer views: Overview, Jobs, Groq, System; keyboard/focus/mobile; loaded-row filter labelled; no execution controls |
| Privacy/freshness | Shipped12001, including numeric ARIA clearing | Clear all added workspace/inspector attributes and text on logout/401/403/pagehide; retain old observation on503, current health unknown |
| Retro counters/motion | Shipped12001 | Preserve actual numbers, bounded animation, pause/reduced-motion/hidden-tab behavior |
| Manual request simplification | Signed relay smoke succeeded; manual operator scripting was excessive | One client prepares an immutable request against an already configured exact gate, submits once, journals before I/O, retrieves durable result; concurrent/repeated commands never resend; no provider key read |
| Automatic admission without gate setup/restart | Proposal only | Not silently enabled. Requires separate finite catalogue/admission-authority contract; manual client must state this limit |
| Controlled execution | Deterministic offline fixtures already shipped | Retain fixture-only truth and production rejection; no shell/remote executor |
| Signed updater | Installed13001 naturally, signature/11files/state preserved | Runtime UI stays within existing11modules; no schema, Node, unit, trust or updater changes; separate operator-client delivery must be explicit |

Private tracker references and operator receipts remain in the separate review
packet, outside public source. Assistant evidence updates do not accept or close
owner tasks; this checklist is not a claim that the entire backlog is complete.

## Delivery boundary

The embedded console change can use the existing signed11module runtime updater.
The manual operator client is source under tools/, not an extra runtime module.
It cannot be installed through the current updater unchanged. A later exact
approval must specify delivery/use of those operator files separately, or review
an explicit updater-file policy delta. This branch does not modify that policy,
hide the client in unrelated runtime files, or add any new admission endpoint.

Board implementation/deployment and additional provider connectors are excluded.
The broader multi-cloud network, automatic Axiom conversations and production
execution privileges remain separate scope. No current billing observation or
invoice-level zero-dollar guarantee is fabricated from retained Free enrollment.

## Required qualification

Meaningful client failure/identity/expiry/concurrency/persistence/redaction tests;
normal+jitless UI and client tests; existing root/runtime/updater/realTLS/socket
and authentication suites on an authorized isolated Linux runner; exact11-file
artifact/hash check; actual synthetic desktop/phone visual QA through an approved
preview route. No denied route is retried or bypassed. Actual visual evidence may
remain approval-dependent; source/DOM tests do not constitute a visual pass.

The current local run is on Windows. New operator/planner/preview tests run
normal and jitless;12 private-filesystem/process cases require Linux and remain
explicit skips here. The inherited owner-auth test file fails its POSIX-mode
preconditions on Windows (18 auth_unavailable failures); its failure log is kept
in the private qualification packet. Those failures are not relabelled as passes
or removed from the existing Linux/CI suite. Full root/runtime/updater/TLS/socket
qualification and owner-auth checks remain required in isolated Linux.
