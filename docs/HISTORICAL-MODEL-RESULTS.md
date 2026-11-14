# Historical model-result compatibility candidate

This is an **opt-in read-only compatibility path**, not alternate-model dispatch.
Normal workspace/MCP requests and enrollment remain GPT-OSS 20B. No legacy guard,
consumed marker, job, result or approval is rewritten or removed.

An operator may enroll a bounded historical proof index after independently
verifying each original protected model-specific gate and saved result against
the imported ledger row. Do not derive the model approval from the row itself.
The index contains no provider key, but includes private approved request text
and must not be published.

The new optional environment pair is `BRIDGE_HISTORICAL_MODEL_RESULTS_FILE` and
`BRIDGE_HISTORICAL_MODEL_RESULTS_SHA256`. Both are required to authorize any
alternate-model read. The SHA256 pins the entire exact UTF-8 file; the existing
Linux protected-file reader requires root ownership, safe permissions, no links,
and bounded size. At most 16 distinct events and 262,144 bytes are allowed.

The private index schema is `{v:1,kind:"PICARD_HISTORICAL_MODEL_RESULTS_V1",records:[...]}`.
Each record has exactly `v:1`, `gate` (the original model-bound v3 approval),
`payloadSha256` (the exact imported payload_json bytes) and `resultSha256`
(the exact imported result_json bytes). The operator must compare those bytes
with original saved pilot evidence before producing the index and pin; this
candidate intentionally has no automatic approval/index generator.

The read validates original owner/task/request/grant/event, model/profile/enrollment,
exact input and context, timestamps, one-call Free scope, completed attempt1 and
both ledger hashes. Existing payload, result, review and grading validation still
runs. Invalid/missing/withdrawn proof yields unknown progress and an unreadable
historical result, not skipped records or invented rank. Cache bypass when this
optional reader is enabled ensures proof withdrawal applies on the next read.
Successful verified historical completed information results count once in the
existing earned-progress model. No alternate-model permission is created for new work.

Source tests do not enroll a production proof, authorize configuration changes,
prove Linux file permissions or establish deployed behavior. This candidate still
requires independent review, full Linux qualification and separately scoped
operator installation/enrollment. Keep original gates/results/markers intact.
