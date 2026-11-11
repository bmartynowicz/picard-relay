# Focused CLI workflow

For Picard-assisted text deliverables, prepare the task once with explicit
acceptance criteria and a compact output structure. Use GPT-6.1 Sol at low
reasoning effort as the starting default for this workflow. Review quality;
complex work may require a separately recorded correction or a different
effort chosen before both sides of a comparison. Other Codex work is unaffected.

`node tools/codex-workflow.mjs --task task.json --out new-run-directory`

For a measured pair, `tools/codex-workflow-pair.mjs` prepares the same inputs,
runs one native draft per side, then one short source-backed review per side.
All four runs use the same explicit default model and low effort. Source facts,
criteria and both draft inputs are frozen before either model runs. Preparation
packages existing reviewed evidence locally; it adds no model/provider call.
Reviews run in bounded fresh CLI contexts rather than replaying a long working
chat. Their real native usage joins each side's workflow preparation total.

```sh
node tools/codex-workflow-pair.mjs --task task.json --out new-pair \
  --node /ABSOLUTE/NODE24 --python /ABSOLUTE/PYTHON3 \
  --codex-js /ABSOLUTE/codex.js --settings /PRIVATE/savings-settings.json
```

The task supplies the same explicit `workflow` coverage described below, with
previously recorded preparation IDs and every used Picard reference. Reused
source preparation is retained, allocated once to each alternative. Reuse a
valid saved Picard answer when it still fits the source snapshot; the pair tool
never invokes a provider or signs in. The [workspace MCP](WORKSPACE-MCP.md) can
read that saved answer using its existing owner session. Its current tools are
read-only and do not run comparisons or record Savings.

The pair tool runs any supplied deterministic `checks` and a bounded review of
source meaning. It stores the reviews, counts even a failed or malformed paid
review, and reports `needs_correction` rather than automatically retrying. An
explicit correction still uses the runner's `--fix` option and original root;
any later paid review can also be an explicit linked follow-up. A regex mismatch
needs inspection before a paid correction. Preserving a meaning in different
words is not a defect. A model review is evidence, not owner acceptance or a
guarantee of factual completeness.

To resume, use `--input existing-pair` instead of `--task`/`--out`. Completed
native measurements permit metadata redelivery only; a partial attempt without
a measurement stops for inspection. Input changes fail closed. Original runs,
including higher costs and failed reviews, remain recorded. One-time software
development, later Savings display/reporting and any other unmeasured work must
be disclosed separately from the measured task phases.

The task JSON contains `brief`, `acceptanceCriteria`, `outputStructure`,
`sourceContext`, and an optional complete exported `savedResult`. Reference tasks
also require `requiredEvidence`: reviewed groups of `sourceId`, `url` and a
short exact `quote` from the source context. Both prompts retain these facts,
even when the summary omits them. Preserve every acceptance-critical exception
and safeguard in this list; the compiler checks exact source membership, not
semantic completeness. The combined list is bounded to 8,000 UTF-8 bytes.
Optional
`selection` groups contain `sourceId`, `url` and exact full `lines` from the
saved result. Review the selection against the sources, retaining dates,
limitations and source identity. The helper verifies result integrity and
preserves the original receipt separately from the selected derivative. A
short brief, invalid result or insufficient reduction stays direct. Do not
make a Picard call merely to add a summary to a self-contained task.

The new output directory freezes both prompts, defaults and an assisted proof
when a verified smaller context was used. Text is UTF-8 with exact LF bytes;
hash the actual input bytes rather than a shell-translated version. This
preparation makes no model/provider call and does not submit, approve or retry
relay work. Existing source-in-context conversations should retain their warm
prefix using `codex-handoff.mjs --source-in-context`.

The local execution wrapper reads these defaults and preserves the existing
completion callback. Record each completed native CLI turn using the usage
recorder, checking that delivery succeeded before declaring hosted success.

The Python 3 wrapper is `tools/codex-workflow-run.py`. Supply `--input` with a
frozen directory whose `prepared.json` includes the workflow defaults and
comparison ID (supply `comparison` in task JSON), `--variant baseline|assisted`, `--node`, `--codex-js` and the
existing local Savings `--settings` path. It preserves the completion notifier,
then explicitly delivers native usage. `--deliver-only` retries saved metadata
delivery without another model call. An explicit `--fix 1` consumes the existing
`assisted-fix-1-prompt.txt` or `baseline-fix-1-prompt.txt`, records that native
turn and attaches it to the original measurement. It never writes source
content or credentials to Savings. Inspect uncertain attempts before any new
call; these flags are not an approval or provider-call grant.

The native recorder accepts `--prepared-handoff proof.json` for a preloaded
result. It checks the exact completed prompt hash before adding a local
`prepare_context` usage label. This identifies local context preparation,
not a new Picard provider invocation. The source receipt remains separate.

Keep model, effort, fixed instructions and source snapshots matched within
each pair. Review every answer for source meaning as well as deterministic
checks. Attach each paid correction to its original root using
`codex-usage-notify.mjs --attach FIX_ID --follow-up-to ROOT_ID`. Keep failures,
uncertain calls and earlier attempts; never rerun solely to obtain a saving.
Local deterministic checks add no model tokens and are recorded separately.

Keep a source coverage checklist for every required fact before finalizing the
handoff, including exceptions and safeguards. A smaller summary can omit a
critical fact: in the Groq trial, visibility handling required one counted
correction. A matching keyword is not proof of factual completeness, and a
missing keyword is not by itself grounds for a paid correction. Check meaning
against the exact source. Keep that correction in the measured comparison.

Savings supports full recorded workflow coverage. Include native preparation,
Picard calls, finishing and every linked correction. Earlier comparisons retain
their original finishing-only scope; unknown past usage is never backfilled as
zero. The credit display estimates Codex usage, not included subscription
allowance. Groq-reported tokens are included in the cross-provider token total
and shown separately; there is no invented conversion to Codex credits or billed
dollars. Equal cache reuse supports a cleaner comparison, but cannot be assumed.

Before task-specific source discovery, `tools/codex-workflow-span.mjs begin
--transcript NATIVE_JSONL --out CHECKPOINT.json` checkpoints native coordinator
usage. `finish --checkpoint CHECKPOINT.json --out PHASE.json` counts actual
model-pass records added during that phase, checks the unchanged log prefix and
model/turn, and freezes a receipt for redelivery. This includes the coordinator's
source research rather than hiding it outside the comparison. Keep software
development, unrelated work and overlapping spans outside the task phase. The
local checkpoint contains a private log path; only its `record` metadata leaves
the machine through the recorder's `--phase-record PHASE.json` option.

The runner's `--preparation LABEL` executes and records a frozen
`preparation-LABEL-prompt.txt` before finishing. Put every measured preparation
ID into the task's explicit coverage:

```json
{"workflow":{"v":1,"preparationIds":{"baseline":["SHA256_RUN_ID"],"assisted":["SHA256_RUN_ID"]},"picardRefs":["SAVED_REQUEST_SHA256"]}}
```

Shared discovery/preparation is allocated once to each independent alternative,
not twice within either side. The runner delivers coverage automatically and
keeps all follow-up fixes attached to their root. List every used Picard request,
including unsuccessful or uncertain attempts. The owner CLI also accepts
`--comparison ID --usage-settings PRIVATE_SETTINGS.json` on submit/result to
register the exact saved request automatically. Later Picard correction calls
with that ID join the original totals without replacing coverage or repeating a
provider invocation. Metadata delivery is idempotent and retains a local outbox.

An unavailable preparation record, missing provider usage, failed/uncertain
provider call or duplicate phase/root allocation leaves the workflow incomplete.
Known usage remains visible, but no full total or full-workflow saving is claimed.
Provider telemetry is observational; it changes no approval, one-call boundary,
retry policy or billing authority. Human time is not measured.

Overview's rolling headline uses the latest 20 complete, comparable workflows
from retained usage history, ordered by latest recorded activity including fixes.
It divides the difference between combined Codex credit totals by the combined
baseline total; it does not average task percentages. Both sides must have full
coverage and usable credit estimates with a positive baseline. Cost increases
remain included. Legacy/incomplete/unpriced comparisons remain visible but do
not enter the headline, and no eligible comparison means “not yet measured”.
The sample count and combined totals accompany the estimated savings. Provider
tokens remain separate from Codex credits; actual allowance is not measured.
