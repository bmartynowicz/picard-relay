# Remembering the owner CLI session

The [read-only workspace MCP adapter](WORKSPACE-MCP.md) can reuse this saved
session without prompting, logging in or replacing an active session.

On Windows, the owner request CLI checks for a saved, origin-bound session
before asking for a password. It verifies that session with a read-only workspace
request. The session is encrypted with Windows DPAPI for the current Windows
user under `%LOCALAPPDATA%/PicardRelay/OwnerCLI`. The password is never stored.

Run `node tools/workspace-request.mjs login --origin HTTPS_ORIGIN` for sign-in,
or use `submit` and `result` normally. Imports can call `connectWorkspace(origin)`
instead of prompting before `openWorkspace`. A valid remembered session avoids
another login; it does not issue an approval or provider request by itself.

For owner-only tool enrollment, revocation or exact client approval, the server
requires a password check within the last five minutes. An older session can
still read saved work but cannot perform those management actions. Explicitly
request a fresh sign-in when needed:

```sh
node tools/workspace-request.mjs login --origin HTTPS_ORIGIN --fresh
```

This bypasses the remembered session and asks for the password privately. A
successful sign-in replaces the active owner session and updates the protected
cache; enrolled [tool credentials](WORKSPACE-AGENT.md) stay valid. Ordinary
`login`, `submit` and `result` still reuse the cache. Cancelling or rejecting the
fresh password check leaves the local cache intact. A lost response can leave
the server outcome unknown, so the client stops without another login attempt.
Imports can request the same behavior with `connectWorkspace(origin, {fresh:true})`.

The existing server session expires after at most eight hours. Explicit logout
or another owner sign-in can revoke it sooner: the host currently permits one
active owner session. This client change does not add an independent long-lived
CLI credential or change that host policy. On the next invalid-session response,
the client forgets the token and asks once. A network error does not trigger
another login or repeat a submitted job.

Use `forget-session --origin HTTPS_ORIGIN` to remove the local encrypted copy.
This does not claim to revoke the server session. Other platforms keep the
existing interactive behavior rather than writing an unencrypted fallback.
If secure storage fails, the live session can finish the command but is not
remembered. The existing exact request, approval, recovery and no-retry checks
are unchanged.

The first login after installing this client seeds the encrypted cache. Already
finished sessions from older processes cannot be recovered. No additional live
sign-in is needed to install or test the change; tests use synthetic sessions.
