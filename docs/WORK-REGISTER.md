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

## Source correction awaiting release

| ID | Priority | Issue | Current state |
| --- | --- | --- | --- |
| PR-BUG-004 | P2 | Dispatcher guesses a terminal outcome when both persistence and readback are unavailable; non-Groq errors can expose raw exception text. | Implemented with offline reporting, recovery and service-log regressions. Merge, signed publication, installation and live verification are not yet asserted. |

The original failed-versus-uncertain mismatch was already corrected in earlier source. This follow-up removes the remaining fallback guess, requires a matching persisted request, and returns only an allowlisted code plus fixed review guidance. It changes reporting, with no new retry, grant, dependency, database migration or provider activation.

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
