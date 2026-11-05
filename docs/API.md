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

## Status and history scope

`GET /status` includes an allowlisted `scope` value (`owner` or `task`) and counters for queued, claimed, invoking, completed, failed, blocked, cancelled and uncertain jobs. With both admission and reusable Board admission already enabled, the service queries only the configured owner across tasks; other configurations retain their allowed-task filter. Clients cannot override this scope through query parameters. `GET /jobs` uses the same server-selected scope and continues to exclude raw prompts, results and owner/task IDs.

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

The server assigns a grant and fixes the provider, output ceiling and 15-minute request lifetime. A duplicate draft ID with the same input returns the original clocks and grant; different input conflicts. Approval, immutable work, enrollment association and source provenance are committed in one SQLite transaction. Owner-console approval records are distinct from signed-Board attestations. Replays never become new grants. A lost response is recovered through GET; clients must not silently prepare a replacement request.

The HTTP body cap is 24,576 UTF-8 bytes; combined provider input is at most 12,000 bytes. There are at most eight active jobs, 16 live uncommitted drafts, 10 POST attempts per minute, 100 review events per result and 10,000 retained drafts/jobs. Counts are storage limits, not renewed call allowances.
