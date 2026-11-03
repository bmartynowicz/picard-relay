# Self-hosted owner authentication

The optional console shares the existing loopback Node listener and trusted HTTPS reverse proxy. It is disabled by default and adds no framework or database migration. An enrolled host can activate it independently of the reusable preview.

## Configure an authorized host

- Set `BRIDGE_CONSOLE_ENABLED=true`.
- `BRIDGE_CONSOLE_AUTH_DIR` must name a real private 0700 runtime-service-owned directory. Its pre-provisioned `auth-state.json` is a 0600 regular single-link file. Keep it separate from provider credentials and the request ledger, and preserve it across updates.
- `BRIDGE_CONSOLE_ORIGINS` is a JSON array of exact HTTPS origins, without wildcard/HTTP origins. The proxy preserves Host, Origin and cookies.
- Expose only the routes documented in [API](API.md). The finite-admission routes exist only when that feature is independently configured; preserve the signed bridge route and normal 404 behavior.
- Verify directory-FD anchored state access under the actual Linux service restrictions and SELinux policy. Do not disable enforcement to make setup succeed.

## First enrollment

The public root is a setup/login shell. First setup requires a random 32-byte expiring administrator-provisioned proof. A missing or invalid auth-state file is an error, not permission for the first visitor to enroll. The owner enters the proof and chooses a password over HTTPS; successful enrollment durably disables setup.

`createBootstrapState` is an administrator/test schema builder, not a web initializer. It accepts a bounded proof window, at most one hour; a short handoff window is preferable. There is no unauthenticated reset/reinitialization endpoint. Keep proof, passwords and session tokens out of source control, logs, URLs, process arguments and assistant chat.

## Passwords and sessions

Passwords accept **8–128 UTF-8 bytes**, with no character-mix rule. The UI explains the byte bound; non-ASCII characters may use multiple bytes. Hashing uses native asynchronous scrypt, one concurrent operation and a persistent five-attempt/minute budget.

Sessions use random tokens stored only as hashes on the server. Cookies are Secure, HttpOnly, SameSite=Strict and host-only. The absolute session lifetime is eight hours, with one active owner session. A new login can invalidate an older one. Logout is confirmed only after durable revocation; a failed revocation reports uncertainty.

This is one-owner password authentication, not SSO, MFA, multiuser authorization or DDoS protection. Rate limits can temporarily deny login. Locks/corrupt state fail closed and need operator diagnosis rather than automatic repair.

## What authentication permits

Status and Jobs expose typed scoped metadata rather than request/result bodies. When finite admission is enabled, authenticated Requests exposes the enrolled exact input and its saved result through separate scoped routes. Session authentication does not authorize arbitrary prompts, tools, providers or grants.

See [Console guide](CONSOLE-WORKSPACE.md), [Operations](OPERATIONS.md) and the source/tests in `experimental/runtime-control/`. Local tests and a valid cookie do not by themselves prove trusted public TLS or the target host's filesystem policy.
