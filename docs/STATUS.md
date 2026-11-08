# Verification status

Last documentation review: **November 8, 2026 UTC**. This page separates a reusable source contract from one enrolled host's dated observations. Read [Limitations](LIMITATIONS.md) and [known work](WORK-REGISTER.md) alongside it.

## Latest recorded host release — v1.0.34 flight instruments

On November 6, 2026, the enrolled host installed **v1.0.34 / sequence 34001**
after [PR #38](https://github.com/bmartynowicz/picard-relay/pull/38). Source:
`f764cdf2d0543f6f6dc24fa05ca47f6b9d2a9c20`; physical release:
`03beb69c280faa1ae3f07d053089bdf5114d39f8f8581208dd852ad0b1904815`.
The [signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/42132908841)
passed on its first attempt.

Authenticated browser verification at 16:04 UTC checked all five views,
whole-VM CPU and memory details, saved-result recovery, fixed HUD/navigation,
background-only look-around, CPU-linked travel speed, deck retraction and
pause/reduced motion. Actual 390px and 320px layouts had no horizontal overflow.
Those checks made no new provider call or paid-resource request.

A read-only server audit at 21:29 UTC matched all 20 installed file sizes/hashes
to the signed manifest and merged source. Configuration, proxy, updater policy
and the 32 historical jobs, 33 historical invocation markers and 42 historical
workspace records were preserved. One previously authorized gauge-helper job,
its marker and two workspace records explain the additions: the final totals
were 33 jobs, 34 markers and 29 completed / 1 failed / 3 uncertain outcomes.
SQLite integrity passed; service and saved-result recovery were ready and
SELinux remained Enforcing. This is a dated observation, not a fresh assertion
about every host or a device-performance benchmark.

The walkthrough below records the earlier v1.0.33 appearance. It does not show
the v1.0.34 power reading or look-around controls.

## Coding workflow — verified from main on November 8

[PR #40](https://github.com/bmartynowicz/picard-relay/pull/40) fixed an oversized
GitHub worker-list response that interrupted result handoff. Exact merged main
`075d15b080dec941cf976663c431fbea2daa6631` passed all seven repository groups through
the [Picard coordinator](https://github.com/bmartynowicz/picard-relay/actions/runs/42507868898)
and [protected worker](https://github.com/bmartynowicz/picard-relay/actions/runs/42507907646).
Normal read-only collection verified the receipt and saved recovery after a
credential-free coordinator restart, with zero uploaded artifacts and retries.
The one-use verification PR was closed unmerged. This coordinator/CLI-only change
required no signed-runtime deployment. See [the coding workflow](../experimental/compute-broker/CODING-WORKFLOW.md).

## Recorded walkthrough release — v1.0.33 cockpit

On November 5, 2026 at 17:37 UTC, **v1.0.33 / sequence 33001** was installed
using the authenticated owner update button after [PR #35](https://github.com/bmartynowicz/picard-relay/pull/35).
Source: `043a11cf49b2c70de6a5558bb1979ed2f18e5bde`; physical release:
`b9d5044804385cc0902d432e650d911ec749c900cebc514eb2087f06f5bf7a5d`.
All 20 installed files matched the signed manifest and merged source. The
[signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/42075634462)
passed on its first attempt. The updater reported installed, exited successfully
and retained its cooldown after reload.

Authenticated Chrome checks completed at 17:43 UTC: System identity and saved
result recovery passed; the cockpit showed 128 round stars with both planes
visible immediately and moving. Pause/resume, static reduced motion and actual
390px/320px layouts without horizontal overflow passed. Navigation and reading
surfaces stayed opaque. The [owner-supplied walkthrough](COCKPIT-TOUR.md) shows
this release and its real recorded data, rather than the older synthetic demo.

All 32 jobs (28 completed, 1 failed, 3 uncertain), 33 invocation markers and
environment/configuration/proxy/updater-policy hashes matched the pre-install
baseline. The service, provider and saved-result recovery were ready, with no
unresolved invocation or pending cost latch. SELinux remained Enforcing. No new
provider call or paid resource was used for deployment validation. These dated
checks are not a performance benchmark or a claim about every installation.

The exact tested source `4282f17d76bf5f5cac3de43abed652e41206f8fb` and merge have
the same tree. The [seven-group Linux worker](https://github.com/bmartynowicz/picard-relay/actions/runs/42074610507)
passed after a fractional CLI deadline bug was corrected. Its coordinator still
failed during result handoff; the worker receipt was recovered and validated
read-only. This does not claim repaired end-to-end unattended recovery. The CLI
correction is outside the 20-module runtime bundle. Default cockpit selection,
the reload reset and owner acceptance remain separate work.

## v1.0.26 workspace activation baseline

On November 3, 2026 at 9:55 PM EST (November 4 UTC), **v1.0.26 / sequence 26002** was installed through the enrolled updater. Source: `cae592b60114118dc11bb794fde59932ab8ef2ee`; physical release: `ead28a19e2f4d38bf8e1b5203dc8ced3ce41b30596802903a11cb57439a556d4`. All 20 installed modules match the signed manifest and merged source. [PR #6](https://github.com/bmartynowicz/picard-relay/pull/6) is merged. The [signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41763218647) passed on attempt 2 with unchanged source after an initial pre-existing CLI deadline-test timing failure. No runtime change was made to obtain that rerun.

At 9:59 PM EST the existing host was explicitly activated with `BRIDGE_WORKSPACE_ENABLED=true` and exact workspace HTTPS routes. Every other runtime setting and existing proxy directive was preserved. A protected operator checkpoint contains the pre-activation ledger, invocation markers, auth state and configuration; the ledger backup passed integrity checking. The updater's existing pinned signature and sequence policy remained in force; SELinux remained Enforcing.

Authenticated production verification completed at 10:02 PM EST. One clearly titled, generic deployment smoke request was prepared, reviewed and approved in the ordinary workspace, then completed through real Groq. Copy and actual Markdown/code/JSON downloads match the saved answer and output hash. A validation-only local review persisted after reload and a guarded service restart; all job and marker hashes were unchanged across that restart, with no second invocation. Generated code was not executed.

All 17 historical job rows and 18 historical invocation markers are unchanged from the protected pre-activation checkpoint. The smoke test adds exactly one completed job and one marker: current counts are **14 completed / 1 failed / 3 uncertain**, with no queued/running work. Named Jobs history shows all 18 records, and an old result with its reviewed correction remains recoverable. System shows the exact v1 release and successful running updater activity. Eight unauthenticated/cross-origin/unlisted-route checks passed.

Desktop, 390px and 320px screenshots were inspected without horizontal overflow; reduced motion disables motion controls, and temporary emulation was reset. Service, provider and result recovery are ready; there is no busy/draining/unresolved invocation or STOP/HOLD/update journal/pending cost latch. This is deployment validation, not owner acceptance or a capacity guarantee.

Source qualification separately passed full Linux Node 24.22.2 updater/runtime/socket checks and 21 new v1 checks normally and jitless. These use synthetic transports and real loopback owner authentication, marker files and restart/uncertainty boundaries. The roughly 98–101 MB RSS observation belongs to that fixture, not a production load test. See [V1](V1.md), [structured contract](workspace-contract.json) and [Limitations](LIMITATIONS.md).

## v0.1.25 verification

On November 3, 2026 at 7:45 PM EST (November 4 UTC), **v0.1.25 / sequence 25001** was installed through the enrolled updater. Source: `d5e64bbe625a695d06b3101d60ec7dfab4b4f38c`; physical release: `331d497940e6b730b244f6fb2630ba5f646686dfd53cf8e1b86e3d0f187bd5e2`.

[PR #5](https://github.com/bmartynowicz/picard-relay/pull/5) adds mechanical digit motion to actual Overview count changes. Its [exact-source signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41748629801) passed every release gate. All 20 physical installed modules match the signed manifest and merged source. No host, provider, grant, database or permission migration was required.

The complete UI regression suite was then run against that physically installed HTML on Node 24.22.2, normally and with `--jitless`. Carries, decreases, interrupted updates, unchanged/unknown values, accessibility labels, pause/reduced motion, hidden pages and authentication clearing passed without a provider call.

Authenticated production verification at 7:48 PM EST confirmed the version/source, exact visible and accessible digits, Pause motion and the disabled Motion reduced state. All 17 job references and states reconcile with the owner ledger: 13 completed, 1 failed, 3 uncertain and no queued/running work. The observation advanced automatically; Groq totals agree and a saved result was recovered with its spent approval still disabled. Desktop, 390px and 320px screenshots were inspected without horizontal overflow. Temporary browser emulation was reset.

No production count changed during the review, so live carry/decrease transitions are not claimed from the static production screenshot. Those paths have separate browser-fixture and installed-code regression evidence. The local preview controls remain outside the production runtime.

Configuration, all 18 historical invocation markers and ledger counts were preserved from the v0.1.24 pre-install baseline. Service, provider and result recovery are ready; the host is idle, SELinux is Enforcing, and no STOP/HOLD, pending cost latch or update journal remains. No provider call or new grant was used. Owner acceptance remains separate.

## v0.1.22 verification

On November 3, 2026, **v0.1.22 / sequence 22001** was installed by the enrolled updater. Source: `f20c1194895074dc8f4633d84ebeff7d28526a75`; physical release: `62127b8e10e1fa3298636b29b03431b7f039e4fbabdb3a9f6954b1af1274ca9c`.

[PR #4](https://github.com/bmartynowicz/picard-relay/pull/4) corrects the legacy task filter, adds bounded read-only live refresh and current Groq activity, and quiets spent console examples. Its [exact-source signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41734484111) passed. All 20 installed module bytes match the signed source; owner/task isolation cases passed against installed code in both modes. Configuration, all 18 invocation markers and 13 completed/1 failed/3 uncertain ledger counts are preserved. The service/recovery/provider are ready, the host is idle, and SELinux remains Enforcing. No provider call or grant renewal was used.

Authenticated production verification completed on November 3 at 6:23 PM EST. All 17 visible job references and states match the configured owner ledger: 13 completed, 1 failed and 3 uncertain, with 0 queued/running. Overview and Groq agree, and the observation advanced automatically from 6:22:11 PM to 6:22:27 PM without manual refresh.

Needs review shows all four failed/uncertain records with no-retry guidance. Spent examples remain readable with approval disabled and their warning hidden; existing saved results and reviewed corrections remain intact.

Desktop, 390px and 320px screenshots were inspected without horizontal overflow. These are actual production checks, separate from the earlier synthetic preview and installed-code fixtures.

Configuration, all 18 invocation markers and ledger counts remained unchanged after the review; no provider call was triggered. The private board has the production screenshot and delivery evidence. Owner acceptance remains separate.

## v0.1.21 verification

On November 3, 2026, **v0.1.21 / sequence 21001** was installed through the enrolled updater and verified. Source commit: `dc5cc1d142b79ab211ca99b532589af34b240aa8`; physical release: `74070c36de307b43a44ece52eb6b7785c3ebe21776e4e8532c13f9fb6985800c`.

[PR #3](https://github.com/bmartynowicz/picard-relay/pull/3) completes the reporting-only correction for unconfirmed dispatcher outcomes. The [signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41731254396) passed on the exact merged source. All 20 packaged and installed module hashes/lengths matched that source. The existing updater enforced its pinned signature, sequence and state-preservation checks.

All 15 reporting regressions passed against the physically installed modules on Node 24.22.2, normally and with `--jitless`, in isolated temporary fixtures. They cover timeout/network uncertainty, unavailable outcome persistence/readback, request identity, safe errors, saved-result recovery without another answer, and actual fixture-service log agreement. These are installed-code fixture checks; no real provider failure was induced.

Authenticated live HTTPS checks confirmed the new System version/source/release and successful updater outcome, healthy Overview, preserved owner session after restart, Jobs details and saved-result navigation, the original saved answer and reviewed-correction note, and the spent approval remaining disabled. Configuration, all 18 baseline invocation markers and ledger counts (13 completed / 1 failed / 3 uncertain) were preserved. Service and result recovery were ready, with no busy/draining/unresolved-invocation state; SELinux remained Enforcing. No provider call, renewed grant or production state reset was used. Owner acceptance remains separate.

## v0.1.19 verification

On November 3, 2026, **v0.1.19 / sequence 19001** was installed and verified. Source commit: `6ddc19561926561b3e6d44a3b7ead5e3f1d4425b`; physical release: `4e733beece3139b8cf5434721e198cd34bf86d8ac6884dc912debe9439a893d8`.

[PR #2](https://github.com/bmartynowicz/picard-relay/pull/2) adds **Documentation ↗** beside Refresh in the shared console header. The [signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41727722968) passed on the exact merged source, and all 20 packaged modules matched before installation. Live checks confirmed the link in all five views, keyboard focus, 390px/320px layouts without overflow, and a separate-tab guide index leading to the rendered illustrated quickstart. Existing configuration, all 17 historical invocation markers and ledger counts were preserved. No provider calls or new grants were used; owner acceptance remains separate.

## v0.1.18 verification

On November 3, 2026, **v0.1.18 / sequence 18001** was installed and verified on the enrolled host. The tested source commit is `2e242df358bebb1b44d91cfe16cd812254e1ce65`; the physical release hash is `4c0940721b031a444cb666d99f264b1150d19ce875395967693dd96b0204a68f`.

[PR #1](https://github.com/bmartynowicz/picard-relay/pull/1) merged the three console follow-ups and current human/AI documentation. The [signing workflow](https://github.com/bmartynowicz/picard-relay/actions/runs/41725556990) passed on that exact merged source. All 20 packaged module hashes/lengths matched the source before installation; the enrolled updater independently performed its pinned signature verification.

Authenticated live checks passed: the original Back/filter reproduction, Forward, selected-job reload, fresh zero-age observation, the exact-response correction note, unchanged original response, an unrelated unannotated result, and the note's 390px/320px layouts without page overflow. System displayed the expected version/source/release and enabled/running updater evidence. Configuration, all 17 historical invocation markers and ledger counts (13 completed / 3 uncertain) were preserved. No provider call was made for the fixes, testing or deployment. Owner acceptance is separate and is not asserted.

The illustrated quickstart was checked after publication on GitHub. Documentation checks passed for current entry/guides, structured work records, accessible SVG metadata and the runtime allowlist. The register distinguishes these verified bug fixes from planned/paused/fixture-only features.

## Previous baseline

The enrolled host was observed running **v0.1.17 / sequence 17001**, source commit `b2e92c8d571c1345030c7ff8cef71dc9a4561a9f`, physical release `01d95f95bbe1f41e72879f996e20e79c308c45b48605330a9b5537aa8b37a468`. Authenticated desktop/390px/320px review covered all five views, two completed jobs and both saved results. The System view showed enabled/running updater activity with dated attempt/outcome.

Provider/new-work availability was intentionally false because no usable enrolled allowance remained; result recovery and service readiness were true. This is a healthy recovery-only state, not proof that a fresh provider call could run.

The next audit identified three remaining follow-ups. Those are fixed in the v0.1.18 record above. See the [structured work register](work-register.json) for separate bug and feature states.

## Source qualification

The full updater/runtime package commands and real Unix-socket check ran in an isolated Linux directory using the installed Node 24 binary on November 3. All package checks reached their passing completion marker, including normal/jitless console checks, request/response recovery, uncertainty preservation, signature/transaction fixtures and actual socket permissions/lifecycle tests. No provider call was made.

The exact merged source also passed the release workflow linked above before installation. Targeted local UI checks are supplemental, not installed-state evidence.

## Evidence interpretation

The live audit did not create queued/running/uncertain failures to expand its visible data. Those cases are exercised in synthetic regressions. No arbitrary fresh host, destructive crash/power-loss/disk-full test, physical-device audit or complete assistive-technology evaluation is claimed.

The historical [October 29 verification](../experimental/VERIFICATION.md) and `VERIFICATION.txt` describe their original source snapshot. Statements there about blocked sockets or absent production adapters do not override later, specifically dated evidence. A source test is not installed-state evidence, and owner acceptance is never inferred from a successful technical check.
