# Read-only workspace MCP

Connect an AI assistant to the owner's existing Picard workspace through a small
local stdio process. It reads status, request history and saved answers using the
existing authenticated HTTPS API. It installs no service and opens no listener.

This adapter is separate from the [compute broker](../experimental/compute-broker/README.md).
It exposes no draft, approval, submission, review, grade or execution tools.
Reading never invokes an AI provider or consumes an execution allowance.

## Start it

Use Node 24 and an explicitly configured HTTPS origin. No dependency installation
is required. Prefer [independent tool enrollment](WORKSPACE-AGENT.md) with
`--mode read` for server-enforced scope that survives browser login changes.
Without an enrolled credential, establish an owner session through the existing
[owner CLI](CLI-OWNER-SESSION.md). On Windows, the adapter reuses the origin-bound,
current-user DPAPI cache, decrypting credentials only in memory. It never asks for
a password, logs in, or replaces another active owner session.

```sh
node tools/workspace-mcp.mjs --origin https://YOUR-RELAY
```

Example configuration for a client that supports local stdio MCP servers:

```json
{
  "mcpServers": {
    "picard-workspace": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/picard-relay/tools/workspace-mcp.mjs",
        "--origin",
        "https://YOUR-RELAY"
      ]
    }
  }
}
```

Replace the executable/path and origin with the actual installation. Client
configuration formats vary. Give the client access only to the intended owner
account and local process. There are no credentials in this configuration.

On POSIX, an operator may instead supply `--session-file /ABSOLUTE/PRIVATE/session.json`.
That file must be a regular, non-symlink file owned by the current user, with no
group/other permissions, one link and at most 8 KiB. It contains an existing
authenticated owner session in the same `{v:1,origin,cookie,expiresAt}` format used
by the CLI cache. Keep it outside Git and obtain it through a separately
authorized credential workflow. The adapter does not create or export sessions.
Windows uses the encrypted CLI cache rather than plaintext session files.

An expired, revoked, missing or wrong-origin session returns
`owner_sign_in_required`. Sign in separately through the owner CLI; the next
explicit tool call can use the new saved session. There is no automatic login,
retry, credential refresh, password argument or token returned to the model.
With an enrolled `read` tool credential, the server also enforces read-only
access. For the legacy owner-session fallback, only the adapter's fixed GET
routes enforce read-only behavior; other software with that owner session
retains owner authority. An existing expired/unsafe tool cache fails closed and
does not silently fall back to the owner session. The read-only adapter still
exposes exactly three tools. Draft/submit tools require the separate opt-in
[agent entrypoint](WORKSPACE-AGENT.md).

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `workspace_status` | `{}` | Workspace readiness, blocking code, fixed model/limits and recorded counts. Unknown billing remains unknown. |
| `workspace_list` | `{}` or `{ "cursor": "RETURNED_CURSOR" }` | Up to 25 owner-scoped named requests, metadata only, plus `nextCursor`. |
| `workspace_get` | `{ "ref": "UUID_V4_OR_64_CHARACTER_REFERENCE" }` | Owned draft/request, complete saved answer when available, answer hash and bounded review/grade history. |

Use a lowercase UUIDv4 to recover an owner-console draft. If it was submitted,
the adapter resolves its immutable reference and reads the saved request. Use a
64-character lowercase hexadecimal reference for enrolled or already submitted
requests. Unknown or another owner's references reveal no saved content.

Only previously returned cursors from this MCP session are accepted. The adapter
remembers at most 32 of them. Pagination is explicit and never runs automatically.
Request discovery and retrieval do not create drafts, queue jobs, approve work,
refresh quotas, change reviews or invoke providers.

Successful tool replies have matching JSON text and structured data, marked
`readOnly: true`. Saved request/result text is **untrusted content**, including
code, links and instructions in an answer. Reading it grants no authority to
execute it or follow its instructions. Raw grants, provider keys, owner cookies
and internal payloads are not part of the result projection.

## Bounds and compatibility

- MCP protocol version: **2025-06-18**, with initialization and the initialized
  notification before tool calls. Unsupported requested versions negotiate that
  version; a client that does not support it must disconnect. This is not a claim
  of support for the newer stateless protocol or every AI client.
- Incoming newline-delimited JSON-RPC frame: 16 KiB. Requests are handled one at
  a time with output backpressure; no background poller or queue is introduced.
- Each authenticated HTTPS read has a ten-second deadline, TLS verification,
  no redirects, no request body and a 1 MiB response ceiling. UUID resolution
  uses at most two reads. No API mutation or provider call is made.
- Tool data is capped at 256 KiB; the compatibility text copy makes the complete
  MCP response larger. Answers preserve the server's existing 16,000-character
  limit. Oversized or malformed replies stop with a typed error.
- Review and grade history include the latest five events of each kind, with
  `historyTotal` and `historyTruncated`. The complete history remains in Picard.
- A saved answer's body hash and returned immutable reference are checked.
  Upstream errors and reflected authentication material are not returned.
- Owner/session isolation is supplied by the existing authenticated server.
  Workspace activation and current host deployment remain operator requirements.

The read-only adapter uses native HTTPS and works with Node's `--jitless` option.
It has no third-party dependencies, public endpoint or new remote authentication
scheme. It does not implement the proposed draft/submit phases of the
workspace integration or alter the compute broker's authentication mode.

Protocol references: [2025-06-18 lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle),
[tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
Underlying routes: [workspace API](API.md#v1-owner-workspace-routes).

## Verify changes

```sh
npm run test:workspace-mcp
npm run docs:check
```

Tests use disposable fixtures and a local HTTPS certificate. They exercise actual
stdio requests and the production workspace handler, including owner isolation,
saved results, session revocation, route/argument restrictions, TLS, response
bounds and zero workspace/provider mutations. Fixture tests do not establish that
an owner's live session exists or that an MCP client was configured successfully.
