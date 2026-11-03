# Existing-gate manual client

This operator-side client uses the existing authenticated relay protocol. It
does not create approval, install/select a gate, read a provider API key, restart
a service or change a credential. Production use and delivery of these new
operator files remain subject to exact review/approval. They are not in the
existing eleven-module signed runtime artifact.

An independently approved exact v3 gate must already be configured. Its owner,
task, event, grant, input/context and request expiry must match the intent. The
server remains the authority for Free/key enrollment, consumed markers, expiry,
revocation and whether work may run. Original evidence times are not refreshed.

On the operator's Linux host, using an existing private0700 working directory:

```
node tools/manual-request.mjs prepare --gate /absolute/approved-gate.json --request-id APPROVED_REQUEST_ID --out /private/intent.json
node tools/manual-request.mjs submit --config /etc/board-event-relay/runtime.env --origin https://approved-console-origin --intent /private/intent.json --journal /private/journal --wait-ms 30000
node tools/manual-request.mjs result --config /etc/board-event-relay/runtime.env --origin https://approved-console-origin --intent /private/intent.json --journal /private/journal
```

The existing configuration must be a private file owned by the operator. The
origin must already be in its configured console origins. HMAC is read from its
existing private file only after request identity checks and stays in process
memory. No provider key is opened. Paths are absolute/canonical; private files
reject symlinks/hardlinks, unsafe modes and unstable reads. No shell/eval or
runtime-generated code runs. Native HTTPS verifies certificates and never follows
redirects, including under jitless Node.

The immutable intent is exclusively created and fsynced before work submission.
Repeated/concurrent submit commands recover results only. A lost response,
signature problem or failed receipt write never authorizes another exchange.
Incomplete/uncertain/failed work is reported and never automatically retried or
regranted. Receipts/results remain in the private journal. Output is JSON and
untrusted provider text is never executed. Waiting polls only result retrieval,
for at most60seconds; without --wait-ms the queued receipt returns immediately.

The initial authenticated action has its own10second transport limit. The
additional --wait-ms budget starts after that receipt: no result poll begins at
or after its deadline, and any in-flight poll shares the remaining deadline.
At that deadline the last actual receipt is retained; a pending result is not
misreported as completed or failed, and no submission is repeated.

Do not delete a journal to retry. If submission is unconfirmed, inspect the
existing event/read its result; do not make a new identity or grant automatically.
No token usage or invoice cost is inferred when the server does not supply it.

The journal retains at most64 small receipts for each intent. At capacity it
fails closed rather than deleting audit evidence or authorizing a new exchange.
The consumed intent remains readable. Files must already have exact0600 mode
and the journal directory0700; this client never repairs production permissions.
Confirm actual existing configuration/HMAC file compatibility at delivery review.

This eliminates custom signed-client scripts and result handoffs for an already
configured gate. It does NOT remove per-request operator gate selection or
restarts. That remaining requirement is tracked separately in the finite
admission design/prototype; it is not marked complete by this client.
