# Capabilities and limitations

This page describes the current source contract. Installation-specific settings and availability must be checked on the host.

| Area | Supported now | Limit / consequence |
| --- | --- | --- |
| Provider | Fixed Groq `openai/gpt-oss-20b` text proposals | No other live provider, automatic model selection or paid fallback. |
| Requests | Exact approved, bounded, one-shot requests | No arbitrary prompt textbox, autonomous task loop or automatic renewal. |
| Finite admission | At most 8 catalogue entries and 8 slots total | One configured owner/task scope; catalogue validity at most 24 hours, individual request lifetime at most 1 hour. Enrolling new work is an operator task. |
| Request input | Request text at most 4,000 characters; bounded context and encoded sizes | See validators for UTF-8 byte limits and exact schemas. |
| Output | At most 512 output tokens for the bounded admission policy | Provider output can be incomplete, wrong or unsuitable. Completed is delivery status, not quality approval. |
| Execution | Inert text/code display and offline executor fixtures | Generated code, tools and shell commands are not executed by the live relay. |
| Recovery | Durable correlated saved answers | Not a guarantee that a provider-side result survives every failure. Uncertain work cannot be replayed automatically. |
| Console owner | Password authentication, one active session, 8-hour absolute session lifetime | No multiuser roles, SSO, MFA, self-service reset or account-management UI. Login/setup hashing is rate-limited. |
| Console history | Metadata, manual paging, at most 100 loaded rows | Filters apply to loaded rows, not a full-history search. Counts cover the configured owner across approved tasks when reusable Board admission is enabled; otherwise they retain the configured task scope. Other owners are excluded. Older loaded pages retain their recorded observation time. |
| Freshness | Read-only refresh every 15 seconds while signed in/visible; manual refresh, full timestamp/timezone and age | Status becomes stale after 60 seconds. Updater activity becomes stale after 3 minutes. Small future skew up to 5 seconds is tolerated; material skew remains unknown. |
| Updates | Signed source publication and separately enrolled Linux host updater | GitHub Actions does not deploy. The runtime bundle has 20 allowed modules; host support, Node, configuration and state are outside it. |
| Cost | Retained Free-policy enrollment and no paid fallback | No live billing/quota verification, usage dashboard or monetary guarantee. |
| Portability | Offline preview and Linux-qualified signed runtime | No general production installer, bundled production Board app or cross-platform host qualification. |

The console's reviewed-correction note is deliberately specific to one immutable historical proposal. It is not a general review editor or automatic validation of every answer. It never rewrites the original generated response.

## Verification limits

Tests use synthetic inputs and local fixtures unless a dated evidence record says otherwise. Provider calls are excluded from normal tests and deployment checks. Passing tests, publishing a signature and installing a release are distinct results.

The earlier live audit used the old catalogue-task scope and showed two completed jobs. A later live reconciliation found 13 completed, 1 failed and 3 uncertain records for the configured owner; the console-scope mismatch is tracked as PR-BUG-005. Queued/running/uncertain/error scenarios are covered by regression fixtures, but the audit did not manufacture those states in the live ledger. Physical phone interaction, a complete assistive-technology audit, arbitrary power loss, disk exhaustion and all fresh-host configurations remain outside that live UI check.

See [Status](STATUS.md) for dated evidence and [Work register](WORK-REGISTER.md) for requested improvements. A documentation example or backlog item does not itself authorize live calls, access changes or installation.
