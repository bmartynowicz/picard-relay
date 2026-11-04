# Picard-assisted code review

On November 4, 2026, Picard's authenticated owner Requests console ran one generic code-proposal request titled **Zero-dollar compute eligibility selector** using `groq:openai/gpt-oss-20b`, one call, a 4096-token output ceiling, no tools, retries or paid fallback. Its input described only the public selector contract; no private source, credentials, account quota or production state was submitted. Measured token usage and billed cost were not recorded by the relay.

The saved answer was reviewed before use. Its pure selector structure informed `src/policy.mjs`, but the original implementation was not accepted:

- Duplicate IDs rejected only the later entry, allowing the first to remain eligible.
- The project-CI restriction was reversed, allowing CI resources to receive data jobs.
- Job requirements used coercing comparisons; the clock lacked strict validation.
- Malformed registries could throw; operation lists were not fully validated.
- The supplied test imported nonexistent `assertEquals` from `node:test` and failed to load.

The original saved answer is preserved in Picard. The local audit also keeps its exact extracted code and visible provenance outside the public source tree. The console review records **changes requested**, without another provider call. The reviewed replacement uses strict safe integers, whole-registry duplicate rejection, correct CI scope, bounded identifiers, deterministic ordering and explicit rejection reasons. New semantic regressions cover these errors.

The durable SQLite ledger, reservations, fixture adapter, MCP process, documentation and tests were implemented and reviewed separately. None of the generated response was automatically executed or installed into the production relay. See [README.md](README.md) for the boundary between this offline preview and unfinished live-provider work.

## Execution receipt proposal

Later on November 4, Picard ran one **Compute worker receipt validator** proposal using the same Groq model and retained Free enrollment, a 4096-token output limit, no tools/retries/paid fallback. Input was a generic public validator specification, without private source, credentials or account information. Measured usage and billed cost were not recorded. The original was inspected before its pure Node tests were run: 31 passed and one failed out of 32.

Review found stringify-before-validation could invoke getters/toJSON; total size used character count rather than UTF-8 bytes; recursive JSON/depth/plain-object checks were missing; hidden/symbol fields and accepted/uncertain artifacts could escape checks; and several negative tests passed only because an unrelated artifact mismatch masked the missing check. The original remains saved in Picard and outside Git. The console records **changes requested**, with no second provider call.

`src/receipt.mjs` is the reviewed replacement. It clones bounded descriptor-checked JSON data before serialization, rejects proxies/accessors/executable and unsafe values, measures actual UTF-8 bytes, binds exact identities and verifies artifact state/size/hash/content. Independent regressions directly target each defect. Adapter/worker/ledger/MCP code was implemented separately; no model output was automatically installed or dispatched as executable code.
