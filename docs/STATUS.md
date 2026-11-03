# Verification status

Last documentation review: **November 3, 2026**. This page separates a reusable source contract from one enrolled host's dated observations. Read [Limitations](LIMITATIONS.md) and [known work](WORK-REGISTER.md) alongside it.

## Current verified release

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
