# Capabilities and limitations

This page describes the current source contract. Installation-specific settings and availability must be checked on the host.

| Area | Supported now | Limit / consequence |
| --- | --- | --- |
| Provider | Fixed Groq `openai/gpt-oss-20b` text proposals | No other live provider, automatic model selection or paid fallback. |
| Requests | Exact approved, bounded, one-shot requests | V1 supports owner text drafts with exact approval. No autonomous task loop or automatic renewal. |
| Finite admission | At most 8 catalogue entries and 8 slots total | One configured owner/task scope; catalogue validity at most 24 hours, individual request lifetime at most 1 hour. Enrolling new work is an operator task. |
| Request input | Request text at most 4,000 characters; bounded context and encoded sizes | See validators for UTF-8 byte limits and exact schemas. |
| Output | Workspace: 4,096 output tokens; finite catalogue: 512 | Provider output can be incomplete, wrong or unsuitable. Completed is delivery status, not quality approval. |
| Execution | Model output remains inert; a separate enrolled broker runs fixed approved operations/CI checks | Generated code is not executed by the request workspace. Fixed CI checks are not arbitrary shell access. |
| Compute checks | Exact public-project commits, protected worker, bounded per-group results and saved receipts | Requires a separately enrolled provider/allowance. No automatic renewal, arbitrary runner or account-wide spending cap. |
| Recovery | Durable correlated saved answers | Not a guarantee that a provider-side result survives every failure. Uncertain work cannot be replayed automatically. |
| Console owner | Password authentication, one active session, 8-hour absolute session lifetime | No multiuser roles, SSO, MFA, self-service reset or account-management UI. Login/setup hashing is rate-limited. |
| Coding tools | [Independent revocable access](WORKSPACE-AGENT.md), inert draft preparation and exact owner-approved submission | Local stdio only; tool lifetime 1-30 days, 64 retained clients. Owner-only CLI setup/approval, no browser settings UI or automatic refresh. A tool cannot approve work or write reviews/grades. |
| MCP compatibility | Explicit MCP 2025-06-18 lifecycle | No remote public workspace MCP listener or universal/newer stateless-client compatibility claim. |
| Owner tool management | A recent owner password check, explicit `login --fresh` and exact client-bound approval | A browser session can last eight hours, but management freshness is five minutes. A tool cannot renew or issue its own approval. |
| Console history | Metadata, manual paging, at most 100 loaded rows | Filters apply to loaded rows, not a full-history search. Counts cover the configured owner across approved tasks when reusable Board admission is enabled; otherwise they retain the configured task scope. Other owners are excluded. Older loaded pages retain their recorded observation time. |
| Activity HUD | Working/Queued/Idle from fresh model-job counts, separate historical attention, timestamped recent model states and successful external tool reads | Active counts queued + claimed + invoking once. Completed means model jobs only. Recent activity shows up to 6 entries, not a complete audit or real-time thread activity. Tool reads retain 64 sanitized events per owner and project 12; console polling and failed reads are excluded. Recording gaps/history failures are explicit. |
| Freshness | Read-only refresh every 15 seconds while signed in/visible; manual refresh, full timestamp/timezone and age | Status becomes stale after 60 seconds. Updater activity becomes stale after 3 minutes. Small future skew up to 5 seconds is tolerated; material skew remains unknown. |
| Cockpit | Visible layout switch, optional SVG starfield, projected counts and expanding reading decks | The browser remembers display preferences locally. Pause and reduced motion apply to animations. Refresh reads data. Browser reload loads a changed interface. |
| Updates | Signed source publication and separately enrolled Linux host updater | GitHub Actions does not deploy. The runtime bundle has 20 allowed modules; host support, Node, configuration and state are outside it. |
| Cost | Retained Free-policy enrollment, recorded workflow usage and estimated rolling Codex savings; no paid fallback | No live billing/quota verification or monetary guarantee. Rolling savings needs complete comparable records; provider tokens are separate from Codex credit estimates. |
| Portability | Offline preview and Linux-qualified signed runtime | No general production installer, bundled production Board app or cross-platform host qualification. |

The console's reviewed-correction note is deliberately specific to one immutable historical proposal. It is not a general review editor or automatic validation of every answer. It never rewrites the original generated response.

## Verification limits

Tests use synthetic inputs and local fixtures unless a dated evidence record says otherwise. Provider calls are excluded from normal tests. A deployment smoke call is claimed only when a dated record explicitly documents it. Passing tests, publishing a signature and installing a release are distinct results.

The earlier live audit used the old catalogue-task scope and showed two completed jobs. A later live reconciliation found 13 completed, 1 failed and 3 uncertain records for the configured owner; the console-scope mismatch is tracked as PR-BUG-005. Queued/running/uncertain/error scenarios are covered by regression fixtures, but the audit did not manufacture those states in the live ledger. Physical phone interaction, a complete assistive-technology audit, arbitrary power loss, disk exhaustion and all fresh-host configurations remain outside that live UI check.

See [Status](STATUS.md) for dated evidence and [Work register](WORK-REGISTER.md) for requested improvements. A documentation example or backlog item does not itself authorize live calls, access changes or installation.

## V1 source changes

With BRIDGE_WORKSPACE_ENABLED explicitly enabled, ordinary bounded owner text requests are supported through a prepare/review/approve flow. The former no-arbitrary-console-input limit applies to the legacy finite picker. Workspace requests allow 4,096 output tokens; finite catalogue requests keep their 512-token ceiling. Both preserve one call, no tools, no automatic retries and no paid fallback.

V1 adds local reviews and exports, not automatic implementation, quality validation or Board acceptance. Only fenced code is offered as individual downloads; the original full answer is always available. Groq-reported token usage is retained when available; missing telemetry and billed cost are not inferred from configured ceilings. Host setup and provider enrollment remain explicit Linux operator procedures, not a portable one-command installer.

These capabilities were installed and explicitly activated on the recorded enrolled host as v1.0.26. One generic live provider smoke request, exact exports, restart recovery and desktop/phone checks passed; owner acceptance remains separate. Other installations still require explicit activation. Exact release identity and dated verification are listed in [Status](STATUS.md).

The self-contained composed console has a 216 KiB response cap (including the workspace overlay and preview banner). Tool-read observation never grants work or changes request results; recording failure does not block a successful read.
