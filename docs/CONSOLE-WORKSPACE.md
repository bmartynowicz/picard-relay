# Owner console guide

The authenticated console has five views when finite admission is enabled. A host without that feature has four views and no Requests submission controls.

The **Documentation ↗** link in the shared header opens the guide index in a new tab. It is available from every view and the sign-in screen, and leads to the quickstart, illustrations, limits, known work and AI-readable references. The current console stays open.

| View | What to use it for |
| --- | --- |
| Overview | Check service reachability, provider/new-work availability, result recovery, scoped job counts and recent activity. Read the blocking reason and observation age. |
| Jobs | Inspect recorded job metadata. Choose a completed row and Open saved result when its result is recoverable from the current catalogue. |
| Requests | Review one enrolled exact input/hash and slot, approve and queue available work, or check an existing saved result. |
| Groq | Watch current provider availability, relay outcome totals, recent activity and observation time. Request limits and safeguards are collapsed below the live data. |
| System | Inspect readable version, sequence, source commit, physical release fingerprint and dated updater activity. |

![Choose new work or recover a saved result](images/using-picard.svg)

## New work versus recovery

Reading status, browsing job metadata, refreshing and checking a saved result do not make an AI call. Approve and queue can register one exact available request for a bounded provider invocation. It is disabled for spent or unavailable authority.

In Requests, distinguish the input label/source, full exact input, input hash and request slot. Two requests can have the same task title and still be different inputs. A real unavailability reason remains visible while a saved result is recovered. A fully spent, otherwise healthy console catalogue has no prominent slot warning; saved results remain readable and approval stays disabled.

The UI shows the recorded state, formatted inert code/tables and an expandable Original saved text. Completed means a reply was saved; review its contents independently. The narrowly bound Reviewed correction note identifies a known equality-case problem in one historical regression proposal, links to the reviewed cases, and preserves the original response. Other proposals are not automatically reviewed.

## Live data and scope

Status refreshes every 15 seconds while the owner is signed in and the tab is visible. These are read-only status/history requests, never provider calls. Refresh remains available; hidden tabs pause polling and resume on return. Failed reads retain the previous observation and mark current health/availability unknown.

When reusable Board admission is already enabled, Overview and Jobs show the configured owner's relay jobs across approved tasks. They no longer use the old console-catalogue task as an accidental filter. Other owners remain excluded. A host without that separately enabled feature retains its configured task scope, and the UI labels its scope.

Overview includes failed jobs; Running combines claimed and invoking jobs. Groq uses the same current counts/history. These are relay records and availability observations, not a live Groq billing/quota API. No inferred remaining quota is displayed.

## Navigation and history

Views use hash routes; selected jobs/results use `#jobs/<ref>` and `#requests/<ref>`. Reload and successful sign-in preserve the intended destination. If browser history restores a loaded selected job that the retained filter would hide, Show changes to All loaded jobs so the job remains inspectable. Explicitly choosing a filter clears selection normally.

Jobs filters apply to loaded rows only. Paging is manual and capped at 100 loaded rows. Automatic history refresh updates the latest page; loading more than 25 rows retains those older pages and their recorded observation time until Refresh jobs is used. Live status totals continue to refresh. The current enrolled request catalogue may not include every job in metadata history. A result outside that catalogue is explained; a different result is never substituted.

## Time, failure and privacy

Times include date/timezone. Observations refresh automatically while visible and can also be refreshed manually. Status older than a minute becomes unknown/stale; updater activity older than three minutes becomes unknown. Up to five seconds of future skew is tolerated as zero age, while a materially future timestamp remains unknown.

A failed refresh can retain the last actual values but must label current health/availability unknown. Saved responses survive allowance exhaustion; new-work readiness and result recovery are separate.

Logout, authentication loss and pagehide clear private inputs/results, selections, counters and accessibility labels. There is one active owner session, with an eight-hour absolute lifetime. Another login can replace it. No browser local/session storage holds tokens.

The insignia and counter animations are bounded and pausable, respect reduced motion and stop when the page is hidden. The proposed mechanical counter enhancement rolls only changed Overview digits upward or downward for an actual observed change. Initial, unchanged and unknown values stay static; assistive tools receive the exact target immediately. A newer observation cancels an unfinished roll, and authentication clearing removes every old glyph. This enhancement is a source/preview candidate until a separately verified release is recorded. On narrow screens the input/result disclosures and normal page flow reduce nested scrolling. The complete live workflow should be checked at desktop, 390px and 320px widths after UI changes.

See [Quickstart](QUICKSTART.md), [limitations](LIMITATIONS.md), [API](API.md) and [known work](WORK-REGISTER.md). The synthetic console preview is useful for layout/regression tests; it does not prove live authentication, TLS or provider behavior.
