# Verification status

Last documentation review: **November 3, 2026**. This page separates a reusable source contract from one enrolled host's dated observations. Read [Limitations](LIMITATIONS.md) and [known work](WORK-REGISTER.md) alongside it.

## Verified baseline

The enrolled host was observed running **v0.1.17 / sequence 17001**, source commit `b2e92c8d571c1345030c7ff8cef71dc9a4561a9f`, physical release `01d95f95bbe1f41e72879f996e20e79c308c45b48605330a9b5537aa8b37a468`. Authenticated desktop/390px/320px review covered all five views, two completed jobs and both saved results. The System view showed enabled/running updater activity with dated attempt/outcome.

Provider/new-work availability was intentionally false because no usable enrolled allowance remained; result recovery and service readiness were true. This is a healthy recovery-only state, not proof that a fresh provider call could run.

The current three follow-up fixes are implemented and regression-tested on their branch. Merge, signing, installation and exact live reproduction are pending in this checkpoint. See the [structured work register](work-register.json) for separate states.

## Source qualification

The full updater/runtime package commands and real Unix-socket check ran in an isolated Linux directory using the installed Node 24 binary on November 3. All package checks reached their passing completion marker, including normal/jitless console checks, request/response recovery, uncertainty preservation, signature/transaction fixtures and actual socket permissions/lifecycle tests. No provider call was made.

The release workflow must independently pass on the exact merged source before installation. Targeted local UI checks are supplemental, not installed-state evidence.

## Evidence interpretation

The live audit did not create queued/running/uncertain failures to expand its visible data. Those cases are exercised in synthetic regressions. No arbitrary fresh host, destructive crash/power-loss/disk-full test, physical-device audit or complete assistive-technology evaluation is claimed.

The historical [October 29 verification](../experimental/VERIFICATION.md) and `VERIFICATION.txt` describe their original source snapshot. Statements there about blocked sockets or absent production adapters do not override later, specifically dated evidence. A source test is not installed-state evidence, and owner acceptance is never inferred from a successful technical check.
