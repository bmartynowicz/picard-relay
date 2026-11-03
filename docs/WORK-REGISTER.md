# Known bugs and feature requests

Snapshot: **November 3, 2026**. The owner's private task board is the operational record. This is a sanitized product summary, not an exhaustive issue tracker or authorization to start every item. Machine-readable records and state definitions are in [work-register.json](work-register.json).

## Remaining live-audit fixes

| ID | Priority | Issue | Current state |
| --- | --- | --- | --- |
| PR-BUG-001 / R01 | P2 | Back navigation restores a job route while a retained filter hides the job. | Source fixed and regression-tested; deployment verification pending. |
| PR-BUG-002 / R02 | P3 | A successful fresh refresh temporarily shows an unknown age. | Source fixed and regression-tested; deployment verification pending. |
| PR-BUG-003 / R03 | P2 | The known reviewed correction is not discoverable beside the original saved proposal. | Exact-response correction note and pinned link implemented; deployment verification pending. |

The correction note preserves the original model response. It does not implement or close the broader Board form-validation feature. A completed model proposal and a reviewed/deployed product change are separate outcomes.

Earlier console audit fixes were observed on v0.1.17: truthful blocked-work explanations, request labels/hashes, saved-result links and inert formatting, persistent submission warnings, readable release identity, updater activity, scoped timestamps, mobile flow and heading hierarchy. The three records above are follow-ups found during the next live pass; prior broad verification is not proof that these remaining cases were already fixed.

## Requested or unfinished features

| ID | Feature | State / limitation |
| --- | --- | --- |
| PR-FTR-001 | Additional provider connectors | Paused. Groq remains the only supported live provider; there is no paid fallback. |
| PR-FTR-002 | Portable host onboarding/installer | Planned. Current deployment needs explicit Linux host enrollment and verification. |
| PR-FTR-003 | Broader routine request enrollment | Needs design. Finite exact catalogue requests work; arbitrary new prompts do not. |
| PR-FTR-004 | Controlled execution | Offline fixtures only. No live generated code, shell or tools are executed. |
| PR-FTR-005 | Portable task-board integration | Planned. The original consuming Board app is not included in this repository. |

Unqualified power-loss/disk-full behavior, physical phone/screen-reader coverage and fresh-host portability are [verification limits](LIMITATIONS.md), not evidence of a specific observed failure. This snapshot does not assert owner acceptance or enumerate unrelated private Board work.

When changing a record, update its structured state and dated evidence as well as this summary. Keep source implementation, tests, deployment verification and human acceptance distinct. For current installed evidence, use [Status](STATUS.md).
