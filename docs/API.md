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

The Requests routes are absent when finite admission is not enabled. Use the UI flow or existing client implementation instead of constructing live authorization by copying this table. The catalogue and approval response establish the exact identity and proof; the client cannot choose arbitrary text, grants, marker paths or a different provider.

The console uses same-origin credentialed requests, no-store responses and no local/session storage for tokens. JSON bodies have exact field sets. Authentication failures clear private browser state. Browser view routes such as `#jobs/<ref>` and `#requests/<ref>` are navigation state, not additional server APIs.

Common error classes are `400` invalid request, `401` authentication failure, `409` invalid/expired/conflicting approval or record, `413` oversized body, `429` rate limit and `503` unavailable/blocked state. A status/error response never grants permission to resubmit an uncertain invocation. See the handler's typed error map for exact per-route behavior.

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
