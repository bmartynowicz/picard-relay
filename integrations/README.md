# Task-board handoff contract

[`task-board-handoff.mjs`](task-board-handoff.mjs) is a dependency-free data
contract for an owner-approved task-board integration. It has no network client,
credentials, approval capability, service or signed-runtime entrypoint. It runs
in Node 24 or a Web Crypto-enabled browser/Worker.

The board-side workflow is:

1. Read an owned task and its current revision.
2. Prepare exactly the intended brief and context with `validateHandoffInput`
   and `createHandoffDraft`. Keep its immutable IDs, hash and one-hour expiry.
3. Show that exact draft to the owner. Approval and dispatch belong to the
   authenticated owner interface, never to a prepare/read MCP tool.
4. Recheck the task revision and existing Free-only enrollment before committing
   the one approved request through the board's enrolled bridge.
5. Retrieve only the original saved result after a lost response. Attach a
   verified reply to the same task, preserving notes, review and acceptance.

The authenticated signed `health` response includes `activeEnrollmentId` for
reusable Board admission. Compare it with the Board's retained enrollment before
offering approval and again before sending. A missing, malformed or different
binding stops new work; provider readiness alone cannot establish that the same
key is enrolled. This field is only an opaque enrollment hash, never a key or
live billing guarantee. After key replacement, reconcile the retained enrollment
through an explicit owner review. Do not silently rebind old approvals or resend
their requests. Saved results remain independent of a new-work enrollment check.

`validateHandoffDraft` checks the immutable owner/task/revision/input/ID/expiry
bindings. `handoffState` projects recorded outcomes without renewing a grant or
turning an uncertain result into new work. These helpers do not authenticate a
caller, verify a provider result or authorize a request; the integrating server
must enforce those boundaries and retain its own durable ledger.

The contract permits only the existing 512 or 4096 output-token ceilings. No
provider/model URL, credential, tool, retry or paid-fallback argument is accepted.
Only explicitly supplied context is included; private board notes are not
collected automatically. A draft expires without automatic renewal. Reading a
completed result is independent of later task revisions and expiry.

The read-only [workspace MCP](../docs/WORKSPACE-MCP.md), opt-in
[approved agent MCP](../docs/WORKSPACE-AGENT.md) and separately enrolled signed
Board bridge remain distinct integrations. This contract does not make one MCP
server call another or implement an autonomous agent loop.

Run `node --test test/task-board-handoff.test.mjs`, or `npm run test:workspace-mcp`
for normal and jitless checks. Qualification through Picard's protected worker
covers this public contract and its tests. Private board integration tests and
actual provider acceptance require their own evidence.
