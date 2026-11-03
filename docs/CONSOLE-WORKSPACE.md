# Owner console guide

The authenticated console has five views when finite admission is enabled. A host without that feature has four views and no Requests submission controls.

The **Documentation ↗** link in the shared header opens the guide index in a new tab. It is available from every view and the sign-in screen, and leads to the quickstart, illustrations, limits, known work and AI-readable references. The current console stays open.

| View | What to use it for |
| --- | --- |
| Overview | Check service reachability, provider/new-work availability, result recovery, scoped job counts and recent activity. Read the blocking reason and observation age. |
| Jobs | Inspect recorded job metadata. Choose a completed row and Open saved result when its result is recoverable from the current catalogue. |
| Requests | Review one enrolled exact input/hash and slot, approve and queue available work, or check an existing saved result. |
| Groq | Understand the configured model, Free-only enrollment, output limit, one-use approval and uncertainty/no-retry rules. |
| System | Inspect readable version, sequence, source commit, physical release fingerprint and dated updater activity. |

![Choose new work or recover a saved result](images/using-picard.svg)

## New work versus recovery

Reading status, browsing job metadata, refreshing and checking a saved result do not make an AI call. Approve and queue can register one exact available request for a bounded provider invocation. It is disabled for spent or unavailable authority.

In Requests, distinguish the input label/source, full exact input, input hash and request slot. Two requests can have the same task title and still be different inputs. The persistent availability explanation remains visible while a saved result is recovered.

The UI shows the recorded state, formatted inert code/tables and an expandable Original saved text. Completed means a reply was saved; review its contents independently. The narrowly bound Reviewed correction note identifies a known equality-case problem in one historical regression proposal, links to the reviewed cases, and preserves the original response. Other proposals are not automatically reviewed.

## Navigation and history

Views use hash routes; selected jobs/results use `#jobs/<ref>` and `#requests/<ref>`. Reload and successful sign-in preserve the intended destination. If browser history restores a loaded selected job that the retained filter would hide, Show changes to All loaded jobs so the job remains inspectable. Explicitly choosing a filter clears selection normally.

Jobs filters apply to loaded rows only. Paging is manual and capped at 100 loaded rows. The current enrolled request catalogue may not include every job in metadata history. A result outside that catalogue is explained; a different result is never substituted.

## Time, failure and privacy

Times include date/timezone. Observations are manually refreshed. Status older than a minute becomes unknown/stale; updater activity older than three minutes becomes unknown. Up to five seconds of future skew is tolerated as zero age, while a materially future timestamp remains unknown.

A failed refresh can retain the last actual values but must label current health/availability unknown. Saved responses survive allowance exhaustion; new-work readiness and result recovery are separate.

Logout, authentication loss and pagehide clear private inputs/results, selections, counters and accessibility labels. There is one active owner session, with an eight-hour absolute lifetime. Another login can replace it. No browser local/session storage holds tokens.

The insignia and counter animations are bounded and pausable, respect reduced motion and stop when the page is hidden. On narrow screens the input/result disclosures and normal page flow reduce nested scrolling. The complete live workflow should be checked at desktop, 390px and 320px widths after UI changes.

See [Quickstart](QUICKSTART.md), [limitations](LIMITATIONS.md), [API](API.md) and [known work](WORK-REGISTER.md). The synthetic console preview is useful for layout/regression tests; it does not prove live authentication, TLS or provider behavior.
