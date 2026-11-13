# Controlled measurement reruns

An independent measurement run can repeat the **unchanged model input** of a completed Board request once, after a new exact owner approval. This is a separate authority path, not a retry or renewal of the earlier grant. It is disabled by default. Source availability is not production activation or permission for a provider call.

## Authority and compatibility

The Board uses a new version-4 scope and separate immutable measurement-run/grant tables. The legacy unique `(owner, task, input hash)` grant index remains intact. Preparation creates a server UUID and binds the comparison, task revision, predecessor/result hash, source/acceptance hashes, exact input, provider/model, low native effort, output cap, retained Free enrollment and expiry. Existing drafts cannot be upgraded. The model text/context are unchanged; measurement metadata is not appended to the model request.

Only the authenticated owner-interface route can approve the exact new envelope. The MCP operation prepares inert drafts and exposes no approval or dispatch tool. The Board atomically reserves one grant only if the predecessor receipt remains completed and no same-input grant is unresolved. Concurrent clicks recover the same run; a new comparison cannot bypass an uncertain or failed predecessor. Enqueue is durable before transmission, and later bridge attempts retrieve the original result instead of invoking again.

The signed relay attestation is strict version 2, bound to the run UUID, envelope hash and completed predecessor event/body hash. The relay independently checks predecessor completion and rejects any unresolved same-input job. Its durable ledger binds one run to one event/payload/envelope, including across restarts. The existing one-shot provider marker and stable event/request/grant identities still enforce the invocation boundary. No paid fallback, provider retry or automatic repair is introduced.

## Staged rollout requiring operator approval

1. Review the complete Board patch and matching runtime commit and their validation. Preserve private audience, current state, configuration, enrollment and old receipts. Do not run fresh-host setup over a working relay.
2. Apply the additive Board migration `0016_controlled_measurement_runs.sql`. It creates separate tables and a union authority view; it does not delete existing rows or remove the legacy unique index. Keep `MEASUREMENT_RUNS_ENABLED` unset/false.
3. Publish the reviewed Board build and the matching signed runtime through their normal approval/release paths. No source PR or check authorizes those publications.
4. Separately authorize activation: Board `MEASUREMENT_RUNS_ENABLED=true`; relay `BRIDGE_ADMISSION_MEASUREMENT_RUNS_ENABLED=true`. Relay activation also requires existing signed/reusable admission. The configuration digest changes, so explicitly review/rebind the matching admission catalogue/configuration; retain the existing Free enrollment/key and durable history. Old approvals are not transferred. Verify authenticated health advertises `measurementRuns:true` and the expected enrollment/output cap.
5. Prepare a **fresh** measurement envelope through `prepare_picard_measurement_run` with the frozen provider input and source/acceptance hashes. The owner must review its distinct comparison/run and explicitly approve one additional call. Never upgrade an earlier legacy draft or change input bytes to evade an old grant.
6. Verify the actual saved request/source facts, provider reference and one-call receipt; perform the bounded native review/correction and include all preparation, failed attempts, native fixes and reporting in the original comparison ledger. Do not claim full Savings while either side or usage coverage is missing. Provider billed dollars and human time are not inferred from tokens.

## Rollback

Disable new admission in both services. Retain tables, grants, run associations, completed results and consumed/uncertain markers. Saved-result reads remain available; no downgrade to legacy authority or new invocation of queued measurement work is allowed. Do not drop history as a rollback operation. A subsequent activation or replacement run still needs its own reviewed configuration and exact owner approval.

## Verification

Board tests cover inert preparation, exact envelope approval, immutable history, legacy uniqueness, races, pending/failed/uncertain predecessors, expiry/revocation/enrollment changes, crash recovery, rollback reads and unchanged provider input. Relay tests cover strict v2 binding, disabled defaults, completed predecessor and unresolved-input checks, durable run consumption, downgrade denial and existing one-shot behavior. All fixture transport is synthetic. Linux filesystem, socket, updater and full repository checks must be reported separately from Windows fixture results; live-provider acceptance requires the separately approved real run.
