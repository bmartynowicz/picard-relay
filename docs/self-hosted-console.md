# Self-hosted owner console (candidate)

The optional console uses the existing Node loopback listener and HTTPS reverse proxy. It adds no web framework, daemon, provider capability, port or database migration. It is disabled by default. This source is not proof of an activated or qualified deployment.

The public root is an empty setup/login shell. Private status requires an owner session. First-run setup requires a random32-byte, expiring owner proof provisioned through an existing trusted administrator channel; a missing state file is an error, NOT first-visitor enrollment. The owner chooses a password in the HTTPS UI. Successful enrollment atomically disables setup. There is no web password-reset or reinitialization endpoint.

## Administrator-reviewed configuration

- `BRIDGE_CONSOLE_ENABLED=true` opts in.
- `BRIDGE_CONSOLE_AUTH_DIR` is an existing private0700 directory owned by the runtime service; `auth-state.json` must already be a valid0600 regular single-link file. Keep it separate from provider keys and request ledger. Preserve it across signed updates.
- `BRIDGE_CONSOLE_ORIGINS` is JSON containing exact HTTPS origins, e.g. `["https://relay.example"]`; no wildcard or HTTP origins. The proxy must preserve Host/Origin/cookies.
- Route only GET `/`, `/status`, `/auth/state` and POST `/auth/setup`, `/auth/login`, `/auth/logout` to the existing loopback service. Preserve the signed bridge route and fallback404. Do not expose the listener directly or give the web process proxy/root write permissions.
- The deployment owner must review auth-directory labels/permissions, bootstrap delivery and rollback. Linux directory-FD anchored state access must work under the actual service sandbox/SELinux policy. Do not relax enforcement to make it work.

`createBootstrapState` is a pure administrator/test schema builder, not an HTTP initializer. It hashes a canonical base64url32-byte code and accepts a bounded time window. Provision proof only when the owner is ready;15minutes is recommended. Do not put plaintext setup code/password/session token in a repository, shared logs, URL query, assistant chat or process arguments. Never reinitialize existing/enrolled state automatically.

## Authentication properties and limits

Password hashing uses native async scrypt, one concurrent operation, persistent5-attempt/minute budget. Sessions are random, stored only as a hash, eight-hour absolute lifetime, one active session. Secure/HttpOnly/SameSite=Strict host-only cookies and exact-origin POST checks are mandatory. Logout durably revokes the current session; failed revocation reports an error rather than success. Lost/expired sessions require login. This is one-owner authentication, not SSO/MFA or multiuser authorization.

The global login budget can be abused to deny login temporarily; it bounds CPU/memory, not DDoS resilience. Stale state locks and corruption fail closed and require an administrator diagnosis, never an unauthenticated reset. Password12..128UTF8bytes; choose a strong unique password.

## Read-only data and UI

Only configured owner/task aggregate counts, readiness and verified release identity are projected. No messages, results, owner/task IDs, provider keys or arbitrary runtime objects reach the page. Unknown fields remain unknown. Status snapshot time is not last provider activity. UI uses exact small README insignia, optional reduced-motion-aware animation and manual refresh; no polling service/external assets or browser token storage.

## Verification

Run `npm run test:console` under `experimental/runtime-control` and the full runtime suite. Tests cover proof replay/expiry/concurrent enrollment, filesystem tampering, bounded hashing, session restart/logout, Origin/Host/cookies, exact routes, UI interruption/stale/error behavior and zero-provider loopback lifecycle. Actual deployment also requires trustedTLS, both-origin proxy/auth behavior, SELinux filesystem access and real desktop/mobile browser inspection. Do not mark those proven from local tests alone.
