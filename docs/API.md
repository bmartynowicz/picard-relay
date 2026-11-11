# Interfaces

These interfaces belong to the signed-runtime source under `experimental/runtime-control/src/`. The backend listens on loopback. Expose only explicitly configured proxy routes and keep normal TLS, origin, authentication and scope checks enabled.

## Browser console routes

| Method and path | Authentication / purpose |
| --- | --- |
| `GET /` | Public shell; private content is read only after sign-in. |
| `GET /auth/state` | Public enrollment state, not credentials or session tokens. |
| `POST /auth/setup` | Exact allowed HTTPS origin and administrator-provisioned expiring setup proof; body `{setupCode,password}`. |
| `POST /auth/login` | Exact allowed HTTPS origin; body `{password}`. |
| `POST /auth/logout` | Existing owner session/origin; body `{}`; durable revocation. |
| `GET /status` | Owner session; typed scoped status, readiness, release and updater observation. |
| `GET /jobs` | Owner session; bounded metadata page. Follow only the returned opaque cursor through `?cursor=...`. |
| `GET /request-catalogue` | Owner session and enabled finite admission; bounded enrolled entries/slots and availability. |
| `POST /request-approvals` | Owner session/origin; exact `{entryId,slotId}`; creates a short-lived, session-bound approval proof. |
| `POST /requests` | Owner session/origin; exact `{entryId,slotId,nonce,approvedInputSha256,approve:true}`; validates and durably registers the exact approved request. This can lead to one provider call. |
| `GET /requests/<ref>` | Owner session; current recorded state and, when available, its saved result. No new invocation. |

The legacy finite Requests routes are absent when finite admission is not enabled. Use the UI flow or existing client implementation instead of constructing live authorization by copying this table. The catalogue and approval response establish the exact identity and proof; the client cannot choose arbitrary text, grants, marker paths or a different provider.

The console uses same-origin credentialed requests, no-store responses and no local/session storage for tokens. JSON bodies have exact field sets. Authentication failures clear private browser state. Browser view routes such as `#jobs/<ref>` and `#requests/<ref>` are navigation state, not additional server APIs.

Common error classes are `400` invalid request, `401` authentication failure, `409` invalid/expired/conflicting approval or record, `413` oversized body, `429` rate limit and `503` unavailable/blocked state. A status/error response never grants permission to resubmit an uncertain invocation. See the handler's typed error map for exact per-route behavior.

### Groq key replacement

On hosts with the protected replacement helper connected, authenticated
`GET /groq/key` returns the enrolled project label, replacement state,
request ID and whether the owner recently signed in. The normal status
response also carries the safe replacement state while the helper is enabled.
Same-origin `POST /groq/key` accepts exactly `{id,key,free:true}` from a
recent owner session. The UUID identifies the operation. The key is sent
only to the local protected helper and never returned. The 1 KiB request
limit also applies at the reverse proxy.

An accepted submission returns HTTP 202 and `checking`. Read status to learn
whether the key was `replaced`, `rejected` with the previous key kept, or
`unknown`. An interrupted submission is followed by a read, with zero
automatic retries or provider calls. See [Operations](OPERATIONS.md#replace-a-groq-key).

## Status and history scope

`GET /status` includes an allowlisted `scope` value (`owner` or `task`) and counters for queued, claimed, invoking, completed, failed, blocked, cancelled and uncertain jobs. With both admission and reusable Board admission already enabled, the service queries only the configured owner across tasks; other configurations retain their allowed-task filter. Clients cannot override this scope through query parameters. `GET /jobs` uses the same server-selected scope and continues to exclude raw prompts, results and owner/task IDs.

An admission-enabled host also reports `groqKeyExpiresAt` as epoch milliseconds or `null` when the active key has no verified operator-recorded expiry. The date is for display. Key contents, fingerprints, evidence paths and grant deadlines stay separate.

The console polls read-only status/latest history every 15 seconds while visible and signed in, with a single in-flight refresh. Hidden/auth-lost pages stop polling. This does not submit, approve, retry or renew any work. Groq availability and relay counts are not provider billing/quota measurements.

`GET /status` also includes an optional `resources` object in the signed runtime: `{v:1, scope:"vm", observedAtMs, cpuPercent, memoryUsedBytes, memoryTotalBytes, relayMemoryBytes}`. All readings are numbers or `null`; the timestamp is epoch milliseconds. CPU is the aggregate Linux VM utilization between two kernel samples, across all CPUs and workloads, with idle and I/O wait excluded. It is not the relay's CPU share or its remaining cloud/AI allowance. Memory used is `MemTotal - MemAvailable`; relay memory is this Node process's resident set in bytes. No process list, hostname, paths or raw kernel text is returned.

The service samples on authenticated status reads, at most once per 15 seconds, with no new timer or service. CPU starts unknown and becomes unknown after an unreadable/reset counter, zero-tick delta or a sampling gap of 60 seconds or more. Unsupported/non-Linux readings are `null`. Clients treat observations aged 60 seconds or more, or over five seconds ahead, as unavailable. Valid memory readings remain usable independently of CPU. See [the instrument guide](FLIGHT-INSTRUMENTS.md) for the UI and motion limits.

## Signed consuming-client bridge

`POST /bridge/v1` uses the HMAC protocol in `protocol.mjs` and the receiver's exact action schema. Start with `signRequest`, `verifyResponse` and the [manual client](MANUAL-CLIENT.md); never hand-roll signature strings or treat browser identity headers as HMAC credentials.

Protocol v1 binds a key ID, timestamp, nonce and SHA-256 of the exact body. Work identity includes owner, task, request ID, grant ID/expiry, assistant ID, canonical input/context and payload hash. `eventId` is derived from owner/task/request identity. Nonces are consumed durably; the timestamp window is 60 seconds and body size is bounded at 24,576 bytes. Responses are signed and verified against the originating nonce and status.

Reject every HTTP 3xx without following `Location` or forwarding the signed request. Result retrieval is a separate action from registering work and must preserve the original identity. HMAC transport authentication does not bypass catalogue, gate, enrollment, expiry, marker or uncertainty checks.

## Dispatcher outcome reporting

The internal dispatcher's error result and the service's structured log use the confirmed ledger state for that exact owner/task/request. An unknown external result remains `uncertain`; an unavailable outcome write and readback return `unknown`. A successful readback may still report the last confirmed nonterminal state, such as `invoking`; it does not prove that the attempted failure write committed or that a provider is still running.

Error codes are allowlisted. Raw adapter messages are excluded, and the dispatcher gives a fixed instruction to review the saved job without resubmitting it. Reporting `unknown` does not create a new ledger state, change grants or add retry authority. Saved-result reconciliation still avoids another provider call. Offline regressions are in [dispatcher-outcomes.test.mjs](../experimental/runtime-control/test/dispatcher-outcomes.test.mjs).

## Private Unix control socket

The runtime uses the operator-configured absolute `BRIDGE_CONTROL_SOCKET`. The installed fixed-service adapter must agree with that host's socket path. There is no public control endpoint.

Send one newline-terminated object, at most 256 bytes:

```json
{"v":1,"action":"health"}
```

The other supported action is `drain`. Health is read-only. Drain is monotonic for that process: it stops new admission/claims while preserving result reads and allowing an active invocation to settle. There is no resume command. Starting a drain is an operational change, not a health probe.

The socket is mode `0600` within a private service-owned directory. Idle/partial clients time out after two seconds. Oversized, multiple or unknown commands fail closed. Health includes physical release identity, service/recovery readiness, provider/new-work availability, busy/draining flags and ledger state counts; it does not include request bodies or secrets.

Source references: [console and service](../experimental/runtime-control/src/oracle-service.mjs), [finite admission HTTP handler](../experimental/runtime-control/src/admission-handler.mjs), [signed protocol](../experimental/runtime-control/src/protocol.mjs), [receiver](../experimental/runtime-control/src/receiver.mjs), [control socket](../experimental/runtime-control/src/runtime-control.mjs).

## V1 owner workspace routes

These routes exist only with explicit workspace activation, on the existing exact HTTPS-origin and owner-session boundary. No owner, provider, marker path or grant may be supplied by the browser. All POST bodies reject unknown fields. The [structured contract](workspace-contract.json) gives limits and field schemas.

| Method and path | Purpose / exact body |
| --- | --- |
| GET /workspace/config | Typed readiness, fixed provider/model, limits, unknown usage/billing and setup checks. |
| GET /workspace/history?cursor=... | Owner-only named job metadata, at most 25 rows; only the returned cursor is accepted. |
| POST /workspace/drafts | Inert durable draft: {requestId,taskId,title,requestText,context,purpose}. requestId is UUIDv4; taskId may be empty. |
| GET /workspace/drafts/<requestId> | Recover the original draft and its recorded state. |
| POST /workspace/approvals | {requestId}; issues a 60-second session-bound proof for the immutable draft. |
| POST /workspace/requests | {requestId,nonce,draftSha256,approve:true}; atomically consumes approval and queues one exact job. |
| GET /workspace/requests/<ref> | Read the draft or validate the owner-scoped job/result and review history. This never invokes the provider. |
| POST /workspace/reviews/<ref> | {expectedRevision,decision,note,resultSha256}; decision is accepted or changes_requested. |
| POST /workspace/grades/<ref> | {expectedRevision,score,note,resultSha256}; score is an integer 1–5, note is at most 500 characters. Reviewer is assigned as owner by the server. |

The server assigns a grant and fixes the provider, output ceiling and 15-minute request lifetime. A duplicate draft ID with the same input returns the original clocks and grant; different input conflicts. Approval, immutable work, enrollment association and source provenance are committed in one SQLite transaction. Owner-console approval records are distinct from signed-Board attestations. Replays never become new grants. A lost response is recovered through GET; clients must not silently prepare a replacement request.

The HTTP body cap is 24,576 UTF-8 bytes; combined provider input is at most 12,000 bytes. There are at most eight active jobs, 16 live uncommitted drafts, 10 POST attempts per minute, 100 review events per result and 10,000 retained drafts/jobs. Counts are storage limits, not renewed call allowances.

## Codex Savings comparisons

For planned comparisons, record a baseline and an assisted run with the same
comparison ID. To compare a standalone Picard run with a later baseline, use
the standalone run's full usage record ID as the baseline's comparison ID.
The Codex completion recorder accepts this ID with `--comparison` and
`--variant baseline`. Savings pairs runs within the same owner, model and
reasoning effort. It preserves the recorded usage and any existing explicit
comparison.

Start each side of a comparison in its own Codex chat. Later completed turns
in that chat count toward that side automatically when recorded with the
updated notifier. Keep unrelated work in a separate chat. Savings shows each
side's full token total, fresh input plus output, and the follow-up subtotal.
The original records remain available as individual turns.

To attach an already recorded correction from another chat, use the two full
usage record IDs. The dedicated usage token authorizes the link for its owner.
An exact retry is safe. A turn can count toward only one original run.

```sh
node tools/codex-usage-notify.mjs --endpoint "$SAVINGS_ENDPOINT" --token-file "$SAVINGS_TOKEN_FILE" \
  --attach "$FIX_RUN_ID" --follow-up-to "$ORIGINAL_RUN_ID"
```

Install the server update before replacing the completion notifier. The
comparison records still accept usage from earlier notifiers.

### Prepare context before starting Codex

For a self-contained brief, send the brief directly to Codex. When an existing
Picard proposal can stand in for a larger block of source context, use the
saved result export to prepare the first prompt.

```sh
node tools/codex-handoff.mjs --brief task.txt --context sources.txt --result picard.json | codex exec --sandbox read-only -
```

The helper checks that the saved answer is complete and matches its SHA-256.
It uses the proposal only when the prepared prompt is at least 512 bytes
smaller and at least 25% shorter in UTF-8. It keeps the original context if
the proposal is missing, rejected, or fails validation. The byte budget is a
routing heuristic. Measure Codex usage to determine the effect on tokens.
Picard output stays untrusted reference data. The helper prepares text locally
and leaves the relay's request approval and provider limits in place.

Preparing the context before launch avoids a model call to retrieve it. For
text-only reviews that need no integrations or project instructions, use a
read-only Codex run scoped to the brief.

```sh
node tools/codex-handoff.mjs --brief task.txt | codex exec --ignore-user-config --disable apps --sandbox read-only -
```

This Codex option also omits the configured completion notifier. Keep the
normal configuration or pass the notifier explicitly to record usage in
Savings. Keep the configuration identical on both sides of a comparison.
The current recorder counts preloaded proposals as input without a Picard
tool-call label.

## Response quality grades

In a saved result, open **Quality**, select 1 (Poor) through 5 (Excellent), optionally add a note and save. The latest score shows whether the owner or a signed client recorded it. History preserves earlier grades. Grades describe the exact saved answer text; they do not accept a result, earn rank, change provider selection or run another call.

The authenticated owner route above uses the existing session and exact-origin checks. `expectedRevision` starts at zero and must match the grade history. A lost response can be recovered by reading the same request; an exact duplicate write is idempotent. Changed input at an old revision returns conflict. Each result permits at most 100 grade events, with a 500-character note per event. Records reuse the existing durable SQLite metadata table without migration. Unreadable grade metadata returns `grade:null` without hiding an otherwise intact saved answer, review or rank credit; further grading stops. A valid recorded grade whose hash contradicts changed saved answer text still fails closed.

AI tools can record a grade through the existing signed `POST /bridge/v1` transport with this exact body:

```json
{"v":1,"action":"grade","ownerId":"<configured owner>","taskId":"<original task>","eventId":"<original ref>","payloadHash":"<original payload hash>","expectedRevision":0,"score":4,"note":"Useful, with a clear boundary.","resultSha256":"<saved answer SHA-256>"}
```

Use the existing `signRequest` and `verifyResponse` helpers. Workspace activation, same owner/task/source and the signed client's existing expiry/revocation boundary still apply; a key alone grants no new scope. The server records reviewer `{kind:"client",keyId:<authenticated key ID>}`. This identifies the authenticated client, not a verified AI model or human identity. A caller cannot label itself as the owner. Read the current grade using signed action `grade_status` with exactly `{v,action,ownerId,taskId,eventId,payloadHash}` before a later write. Grade reads and writes return only `{revision,latest}`, keeping transport responses bounded without enlarging the existing result response; the owner result route includes the complete bounded history. Grading is available during a provider outage and never renews execution approval. Host operators must include the new exact grade route from the disabled Caddy template when separately deploying this candidate.
