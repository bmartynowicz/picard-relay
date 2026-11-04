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
