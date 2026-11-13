# Known bugs and feature requests

Snapshot: **November 12, 2026**. The owner's private task board is the operational
record. This is a sanitized source/delivery summary, not a complete board export
or permission to start every item. [Structured records](work-register.json) ·
[Limitations](LIMITATIONS.md) · [Dated verification](STATUS.md)

## Still to build or qualify

| ID | Work | Current limit / next step |
| --- | --- | --- |
| PR-FTR-001 | Additional provider connectors | Paused. The text workspace has one fixed Groq model; compute-provider enrollment is a separate contract. |
| PR-FTR-002 | Portable host installation | [Guided fresh-host setup candidate](SETUP.md): actual Ubuntu 24.04 x86-64 install/services/local TLS checked in CI. Signed Update/Replace key enrollment, retained answers and new synthetic work passed on Ubuntu x64/ARM64 VMs and Oracle 9 x64/ARM64 containers in PR141. Native Oracle Linux9.8/UEK/Enforcing SELinux with1GB RAM also passed with the labeling/readiness correction in PR143. OCI/public ACME/real-key checks remain host-specific. Existing installs are refused. |
| PR-FTR-004 | Execute generated work | Generated output stays inert. Deterministic fixtures and fixed CI operations do not enable arbitrary model-generated code. |
| PR-FTR-005 | Reusable task-board connector | The original private Board is application-specific and not bundled. A portable consuming client needs its own authorization/integration work. |
| PR-FTR-014 | Less manual feedback submission | The shared form prepares a draft; destination submission is still manual. A safe, deduplicated posting flow remains to design. |
| PR-FTR-015 | Physical voice badge and relay sync | Prototype/build work continues separately. Hold-to-record, durable storage/recovery and hardware sync require target qualification; a successful build is not a hardware result. |

This snapshot does not claim these are the only remaining ideas or defects.
Account-wide cost controls, arbitrary power-loss/disk-full qualification and
broader device/accessibility testing remain [explicit limits](LIMITATIONS.md).

## Delivered capabilities and scoped fixes

Delivered does not mean owner-accepted. Version numbers below refer to dated
checks on one enrolled host, not every installation.

| ID | Capability / fix | Delivery scope |
| --- | --- | --- |
| PR-FTR-003 | Ordinary bounded request enrollment | Free-text workspace requests shipped; the older finite picker retains exact enrolled slots. |
| PR-FTR-006 | Mechanical rolling counters | Installed and checked on v0.1.25; real observed counts, reduced motion and retained uncertainty semantics. |
| PR-FTR-007 | Request-to-result owner workspace | Activated on v1.0.26 with exact approval, history, saved exports and output-bound reviews. |
| PR-FTR-008 | Separate fixed-job compute broker | Merged and qualified from main; exact public-commit checks return verified per-group receipts. Historical Oracle/GitHub batch proof does not renew its grants. |
| PR-FTR-009 | Cockpit, reading decks, ranks and stars | Delivered cockpit foundation; later curved-panel and short-phone refinements are separately dated. |
| PR-FTR-010 | Whole-VM CPU and background look-around | Checked on v1.0.34. The HUD stays fixed; CPU-linked motion is bounded. |
| PR-FTR-011 | Independent tool access and approved handoff | PR109/120 merged; v1.0.59 checked with one approved live request and old-answer recovery after client restart. No self-approval or automatic renewal. |
| PR-FTR-012 | First-run walkthrough and rank guide | PR75 shipped, including replay from Settings. Onboarding ends after a review; rank progress remains. |
| PR-FTR-013 | Stealth shortcut and automatic display triggers | Shortcut and optional tab/inactivity triggers shipped; hidden-tab behavior checked live. This is a display mode, not network anonymity. |
| PR-BUG-006 | Cockpit discovery and persistence | Visible choices, curved controls, panel handoffs and dismissible readout shipped. PR100 short-phone reading was checked on v1.0.56. |
| PR-BUG-007 | CI worker-result handoff | PR40 fixed the bounded worker-history response. Normal collection and saved restart recovery passed from main. |
| PR-BUG-008 | Updater setup/startup failure reporting | PR43 fixed reporting; Linux regressions cover negative paths and the ordinary live update/cooldown flow passed. No production startup fault was injected. |
| PR-BUG-009 | Enrollment proxy setup and fresh owner sign-in | PR123 merged and checked from main. The supported CLI has explicit `login --fresh`; the proxy example and upgrade guide preserve workspace credentials. |

The update button, Groq key replacement, quality grades, feedback draft form,
reviewed contributor credits and workflow-usage accounting are also in current
source. Their host support and setup requirements still apply. A grade is not
an acceptance review; a prepared feedback draft is not a posted issue.

## Historical live-audit fixes

| ID | Finding | Recorded qualification |
| --- | --- | --- |
| PR-BUG-001 / R01 | Back navigation restores a job hidden by a retained filter | Fixed and checked on v0.1.18. |
| PR-BUG-002 / R02 | Fresh observation briefly says age unknown | Fixed and checked on v0.1.18. |
| PR-BUG-003 / R03 | Reviewed correction missing beside the original proposal | Fixed and checked on v0.1.18; original answer preserved. |
| PR-BUG-004 | Unconfirmed persistence can produce a guessed dispatcher outcome | Consistent uncertain-outcome reporting checked on v0.1.21 without replaying production work. |
| PR-BUG-005 | Console retains a legacy task filter/static observations | Owner-wide workspace observations and saved-result recovery shipped; original task/owner authorization boundaries remain. |

Older release details remain in [Status](STATUS.md). Their original scope and
dates apply. Updating this register does not retroactively accept work, prove a
new installation or erase a historical failure/uncertainty record.
