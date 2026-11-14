# Alternate Groq model evaluation candidate

This opt-in **Linux operator pilot** adds an actual one-request transport for
`qwen/qwen3.8-27b` and `openai/gpt-oss-120b`. It does not change the normal
service, console, Board bridge, MCP model or any installed host. Those continue
to select GPT-OSS 20B. There is no model dropdown or automatic fallback.

The pilot exists to qualify a different model before routing real Board work to
it. Compare the same frozen task and source packet, including preparation,
source-backed review and any explicit repairs. A successful HTTP response is not
evidence of quality or quota savings. Saved provider usage names the actual model;
provider tokens are not converted to Codex credits or billed dollars.

## Exact model identities and parameters

Checked against Groq's official documentation on November 14, 2026:

- [Supported models](https://console.groq.com/docs/models) lists Qwen 3.8 27B as
  `qwen/qwen3.8-27b`, a preview model, and GPT-OSS 120B as
  `openai/gpt-oss-120b`. Preview availability can change. Qwen is not an alias for
  Qwen Flash; no Nemotron or other provider is substituted.
- [Reasoning parameters](https://console.groq.com/docs/reasoning) documents low
  effort and hidden reasoning for these supported models. The pilot pins those
  parameters, the review-only instruction revision and Groq HTTPS endpoint in a
  model-profile digest. It requests one completion, no tools and at most 4,096
  output tokens.

The catalogue is not proof that an account/key has Free access or remaining
quota. Each model needs its own separately recorded account/project/key evidence
and exact owner-approved input. There is no automatic enrollment or billing check.

## Operator enrollment and exact approval

The operator supplies a **new root-owned approval file** and root-owned key file
using the existing protected Linux file rules. The service user may read them
through its group; neither may be group-writable, world-accessible, a symlink or
hard-linked. Files are rechecked at the transport boundary. The pilot cannot
create an approval, refresh its time or enroll itself.

The approval uses the existing v3 review-request gate with:

- Exact owner, task, grant ID, event ID, request text and context; their existing
  input hash; one call; a maximum one-hour request lifetime; 4,096 output tokens;
  Free/no-paid-fallback scope; and `public-source-review` or
  `sanitized-source-proposal` provenance.
- A fresh v2 cost-enrollment record containing the original enrollment fields
  plus `modelProfileSha256`. Its exact model must match the pinned profile, and
  its canonical enrollment digest must match the gate. Existing v1 20B records
  cannot authorize an alternate model. Do not relabel or renew an old approval.
- `markerDirectory`, an existing private 0700 directory owned by the executing
  service user. The protected approval fixes this location. The event ID fixes
  its consumed-marker filename; a command-line option cannot choose another
  location to obtain a second call.

An operator can compute the public profile digest without creating an approval:

```sh
node --input-type=module -e "import {groqReviewProfile,groqReviewProfileDigest} from './experimental/runtime-control/src/admission-enrollment.mjs'; console.log(groqReviewProfileDigest(groqReviewProfile('qwen/qwen3.8-27b',{alternateModelsEnabled:true})))"
```

Keep the password/key out of command arguments, output, Board notes and source.
Source changes, an example or an inspected file never constitute approval.

## Inspect, run once and recover the saved answer

After actual operator enrollment and approval:

```sh
node tools/groq-model-pilot.mjs inspect --gate-file /protected/review-gate.json
node tools/groq-model-pilot.mjs run --gate-file /protected/review-gate.json --key-file /protected/groq-key --enable-model-evaluation
node tools/groq-model-pilot.mjs result --result-file /private/markers/groq-model-pilot-EVENT_ID.consumed.result.json
```

`inspect` makes no provider call. `run` is disabled without the explicit switch,
validates the new model-bound enrollment and exact input, then uses the existing
durable one-shot adapter. Its consumed marker is synced before I/O. A second
process, restart, changed model, expired approval or uncertain call cannot obtain
another allowance. Redirects, mismatched response identities, tools and payment/
quota failures stop without retries or fallback. An existing saved result also
blocks another call, even if its marker was accidentally removed.

The private result retains its body hash, model/profile/enrollment/input identity
and reported provider usage. Recovery reads that file without a key, renewed
approval or provider call. A partial response is labeled incomplete by the
existing adapter. Missing results after uncertain work require investigation;
never delete a marker or invent another path to repeat the call.

## Qualification and remaining integration

Run `npm run test:model-evaluation` on Linux with Node 24. The tests use synthetic
keys, protected fixture files and fake provider replies; no live model call is
made. Linux runs qualify real ownership, consumed-marker races, restart recovery
and saved results. Those tests are explicitly skipped on Windows; Windows
transport checks do not substitute for Linux qualification.

The earlier Board record for reconstructed commit `67caccf` remains historical
evidence. Its unpublished source was unavailable in the current checkout, so
this transport continuation is isolated on current public main and does not
claim to contain or requalify that earlier patch.

Remaining: independent Linux qualification of this exact source, operator
model-specific Free enrollment, one separately approved live test, actual
quality/cost comparison and integration into authenticated hosted/MCP selection.
The pilot does not write fabricated provider references into hosted Savings.
Publication, signed installation, activation and owner acceptance are separate.
