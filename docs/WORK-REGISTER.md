# Known bugs and feature requests

Snapshot: **November 3, 2026**. The owner's private task board is the operational record. This is a sanitized product summary, not an exhaustive issue tracker or authorization to start every item. Machine-readable records and state definitions are in [work-register.json](work-register.json).

## Fixed live-audit findings

| ID | Priority | Issue | Current state |
| --- | --- | --- | --- |
| PR-BUG-001 / R01 | P2 | Back navigation restores a job route while a retained filter hides the job. | Fixed and live-verified on v0.1.18. |
| PR-BUG-002 / R02 | P3 | A successful fresh refresh temporarily shows an unknown age. | Fixed and live-verified on v0.1.18. |
| PR-BUG-003 / R03 | P2 | The known reviewed correction is not discoverable beside the original saved proposal. | Fixed and live-verified on v0.1.18; original response preserved. |

All three scoped findings were installed and verified through authenticated HTTPS on November 3, 2026 after [PR #1](https://github.com/bmartynowicz/picard-relay/pull/1) and its [signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41725556990). This does not assert owner acceptance or the absence of other bugs.

The correction note preserves the original model response. It does not implement or close the broader Board form-validation feature. A completed model proposal and a reviewed/deployed product change are separate outcomes.

Earlier console audit fixes were observed on v0.1.17: truthful blocked-work explanations, request labels/hashes, saved-result links and inert formatting, persistent submission warnings, readable release identity, updater activity, scoped timestamps, mobile flow and heading hierarchy. The three records above are follow-ups found during the next live pass; prior broad verification is not proof that these remaining cases were already fixed.

## Additional reporting correction

| ID | Priority | Issue | Current state |
| --- | --- | --- | --- |
| PR-BUG-004 | P2 | Dispatcher guesses a terminal outcome when both persistence and readback are unavailable; non-Groq errors can expose raw exception text. | Installed on v0.1.21; 15 reporting regressions passed against installed modules in isolated fixtures; live HTTPS service and saved-result checks passed. |

The original failed-versus-uncertain mismatch was already corrected in earlier source. This follow-up removes the remaining fallback guess, requires a matching persisted request, and returns only an allowlisted code plus fixed review guidance. It changes reporting, with no new retry, grant, dependency, database migration or provider activation.

The [PR #3](https://github.com/bmartynowicz/picard-relay/pull/3) [signed release](https://github.com/bmartynowicz/picard-relay/actions/runs/41731254396) was installed and verified on November 3, 2026. Configuration, all 18 historical markers and ledger counts were preserved. No real provider failure or replay was manufactured; see [Status](STATUS.md) for the exact installed-code fixture and live-check boundaries. Owner acceptance is separate.

## Live-data follow-up

| ID | Priority | Issue | Current state |
| --- | --- | --- | --- |
| PR-BUG-005 | P1 | The console retains the legacy catalogue-task filter and requires manual refresh, hiding other real jobs and failed outcomes. | Verified on v0.1.22: all 17 owner jobs and 13 completed/1 failed/3 uncertain counts reconciled live; automatic refresh and desktop/phone layouts passed. Owner review remains separate. |

A read-only live comparison on November 3, 2026 showed two completed jobs in the old console scope versus 13 completed, 1 failed and 3 uncertain jobs for the configured owner. The correction uses the scope of the already-enabled reusable Board workflow, keeps other owners excluded, adds read-only visible-tab refresh and moves static request policy below current data. No provider call, grant renewal or access for another owner is added.

[PR #4](https://github.com/bmartynowicz/picard-relay/pull/4) and its [signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41734484111) delivered source `f20c1194895074dc8f4633d84ebeff7d28526a75` as v0.1.22/22001, physical release `62127b8e10e1fa3298636b29b03431b7f039e4fbabdb3a9f6954b1af1274ca9c`. All 20 installed files match. The host is healthy; configuration, 18 markers and 13 completed/1 failed/3 uncertain records are preserved. No new provider call or grant was used. Three actual owner-scope fixture cases passed against installed code normally and jitless. Authenticated production browser verification passed separately from the synthetic preview: all 17 visible job references/states match the configured owner ledger; counters and Groq activity agree. The observation advanced automatically from 6:22:11 PM to 6:22:27 PM EST. The four failed/uncertain review rows, no-retry guidance, saved results and reviewed correction remain accessible. Desktop, 390px and 320px screenshots were inspected without horizontal overflow. The private task board contains the production screenshot; owner acceptance remains separate.

## Requested or unfinished features

| ID | Feature | State / limitation |
| --- | --- | --- |
| PR-FTR-001 | Additional provider connectors | Paused. Groq remains the only supported live provider; there is no paid fallback. |
| PR-FTR-002 | Portable host onboarding/installer | Planned. Current deployment needs explicit Linux host enrollment and verification. |
| PR-FTR-003 | Broader routine request enrollment | Needs design for general console enrollment. Finite console requests and separately enabled exact approved signed Board work exist; an arbitrary console prompt form does not. |
| PR-FTR-004 | Controlled execution | Offline fixtures only. No live generated code, shell or tools are executed. |
| PR-FTR-005 | Portable task-board integration | Planned. The original consuming Board app is not included in this repository. |

Unqualified power-loss/disk-full behavior, physical phone/screen-reader coverage and fresh-host portability are [verification limits](LIMITATIONS.md), not evidence of a specific observed failure. This snapshot does not assert owner acceptance or enumerate unrelated private Board work.

When changing a record, update its structured state and dated evidence as well as this summary. Keep source implementation, tests, deployment verification and human acceptance distinct. For current installed evidence, use [Status](STATUS.md).
