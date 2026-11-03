> Design/review checkpoint. For current behavior, limitations and operations, start with the [documentation index](README.md). Earlier scope and verification statements below describe their checkpoint, not every later release.

# Core improvement bundle: local candidate

Base public main: `651d1afcb1402a30b900c10c337d04c42d538cd0`.
This branch is source development, not a published or installed release.
Existing source already supplies Free-only routing, exact one-shot grants,
durable diagnostics, private authentication, signed updates and a deterministic
fixture executor. Those capabilities are retained rather than rebuilt.

## Runtime changes inside the existing eleven-module boundary

| Module | Candidate behavior |
| --- | --- |
| `dispatcher.mjs` | Returned/logged outcome follows the actual persisted job state. An uncertain external outcome is no longer labelled failed. Transition write failures use available persisted truth, or conservative uncertainty. No retry is added. |
| `relay-store.mjs` | Read-only owner AND configured-task recent-job query; deterministic keyset pages, default25/hard50, metadata projected in SQLite, strict scope-bound cursor, maximum16KiB page. No table, index or schema migration. |
| `oracle-service.mjs` | Authenticated same-origin `GET /jobs` plus private console history, allowlisted actionable reasons, stale/future observation notices,401/403 clearing and brief reduced-motion-safe numeric transitions. |

## Exact endpoint/security delta for release review

`GET /jobs?limit=1..50&cursor=<opaque-page>` is a NEW read-only route under the
existing explicitly enabled console. It requires the existing secure HttpOnly
SameSite session and configured HTTPS Host/origin, rejects cross-site reads,
never accepts owner/task from query input, and sends no-store headers. Anonymous
HTML remains a data-free shell. Existing HMAC bridge and login/setup are unchanged.

Only opaque job reference, persisted allowlisted state, bounded/null timestamps,
stored-result boolean and allowlisted reason code leave the query. No prompts,
results, owner/task/grant/provider identities, raw errors, paths, keys or headers
are returned. The result boolean describes a stored record, not permission to
retrieve it or proof of its content. Existing result expiry/revocation checks stay.

History queries filter in SQL before pagination, including reused/reconfigured
databases. A cursor must identify a row in that same scope. There is no fallback
to global counts. Unknown/malformed observations stay unknown or unavailable.
The queue is already capped at10000 rows; no new index/migration is introduced.

## Console behavior

The current dark console and exact ASCII insignia remain. History is a plain
metadata list, maximum100 rows retained in browser memory, with manual older-page
and refresh controls. It does not poll, invoke a model, run a task or retry work.
Allowlisted copy distinguishes uncertainty, expiry, revoked authority, quota,
payment and unavailable one-shot approval. Unknown provider readiness does not
claim a particular billing or latch cause.

Failed refresh retains the last observed counts/history, their actual observation
times and a sanitized error notice. Counts never become invented zeros. A stale
observation and a future device-clock observation have explicit notices.
401/403, logout and pagehide clear private values, history, cursor and animation.
Counter movement lasts180ms, shows only the actual new number, and is disabled
or cancelled for reduced motion, pause and hidden pages. No framework, font,
asset, daemon or new browser credential is required.

## Retained boundaries and remaining work

The selector, request/cost gates, HMAC protocol, provider adapter,512-token cap,
one-use markers, enrollment stop, ledger schema, trust policy, updater helpers
and workflow are unchanged. Controlled execution remains an offline fixture;
there is no real executor or new provider activation. The console states that
updater evidence is unknown rather than inferring successful delivery from health.

[Routine-request friction](ROUTINE-REQUEST-PATH.md) is tracked on the same umbrella.
This bundle adds actual existing-queue contract tests and an exact proposal;
production gate orchestration is not silently enabled. Removing operator gate
selection transfers admission authority and needs its own concrete contract review.

Before release: review this endpoint/data delta, complete Linux runtime/updater/
real socket/TLS gates, inspect actual desktop/mobile visuals, reconcile the sole
VM owner's current helper gate, then coordinate publication/delivery separately.
No provider call, new credential, gate swap, VM mutation or publication is part
of this local implementation.
